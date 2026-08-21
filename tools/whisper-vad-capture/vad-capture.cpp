// agenos-vad-capture -- captura de microfono cortada por Silero VAD.
//
// Lee PCM crudo S16LE mono a 16 kHz por stdin (normalmente lo escupe arecord) y
// decide en tiempo real cuando ha terminado la frase. Escribe un WAV recortado a
// la voz detectada y publica eventos NDJSON por stdout para que el proceso que
// lo lanza pueda pintar "te escucho" en cuanto hay voz de verdad.
//
// La razon de existir de este binario es que la API de VAD de whisper.cpp
// trabaja sobre un buffer completo: no hay forma de alimentarla muestra a
// muestra desde TypeScript sin cargar el modelo en cada vuelta. Aqui el modelo
// se carga una vez y cada tick se reevalua solo la cola del audio.

#include "whisper.h"

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <poll.h>
#include <unistd.h>

namespace {

constexpr int kSampleRate = WHISPER_SAMPLE_RATE; // 16000
constexpr int kWindow     = 512;                 // ventana de Silero: 32 ms
constexpr int kWindowMs   = 1000 * kWindow / kSampleRate;

struct options {
    std::string vad_model;
    std::string out_path;
    int   threads            = 2;
    int   max_ms             = 15000;
    int   silence_ms         = 650;
    int   min_speech_ms      = 250;
    int   speech_pad_ms      = 320;
    int   tick_ms            = 128;
    int   start_timeout_ms   = 8000;
    // Solo se reanaliza la cola del audio: sin esto el coste por tick crece con
    // la frase y una frase larga acabaria comiendose una CPU entera.
    int   analysis_window_ms = 4000;
    float threshold          = 0.5f;
};

void print_usage(const char * argv0) {
    fprintf(stderr,
        "usage: %s --vad-model FILE --out FILE.wav [options]\n"
        "\n"
        "Lee PCM S16LE mono 16 kHz por stdin.\n"
        "\n"
        "  --vad-model FILE        modelo ggml de Silero VAD (obligatorio)\n"
        "  --out FILE              WAV de salida (obligatorio)\n"
        "  --threads N             hilos del VAD               [2]\n"
        "  --max-ms N              tope duro de captura        [15000]\n"
        "  --silence-ms N          silencio que cierra la frase[650]\n"
        "  --min-speech-ms N       voz minima para aceptar     [250]\n"
        "  --speech-pad-ms N       margen alrededor de la voz  [320]\n"
        "  --tick-ms N             periodo de analisis         [128]\n"
        "  --start-timeout-ms N    espera maxima sin voz       [8000]\n"
        "  --analysis-window-ms N  cola de audio reanalizada   [4000]\n"
        "  --threshold F           umbral de Silero            [0.50]\n",
        argv0);
}

bool parse_options(int argc, char ** argv, options & opts) {
    for (int i = 1; i < argc; i++) {
        const std::string arg = argv[i];
        auto next = [&](void) -> const char * {
            if (i + 1 >= argc) {
                fprintf(stderr, "error: %s necesita un valor\n", arg.c_str());
                exit(2);
            }
            return argv[++i];
        };

        if (arg == "-h" || arg == "--help")            { print_usage(argv[0]); exit(0); }
        else if (arg == "--vad-model")                 { opts.vad_model          = next(); }
        else if (arg == "--out")                       { opts.out_path           = next(); }
        else if (arg == "--threads")                   { opts.threads            = atoi(next()); }
        else if (arg == "--max-ms")                    { opts.max_ms             = atoi(next()); }
        else if (arg == "--silence-ms")                { opts.silence_ms         = atoi(next()); }
        else if (arg == "--min-speech-ms")             { opts.min_speech_ms      = atoi(next()); }
        else if (arg == "--speech-pad-ms")             { opts.speech_pad_ms      = atoi(next()); }
        else if (arg == "--tick-ms")                   { opts.tick_ms            = atoi(next()); }
        else if (arg == "--start-timeout-ms")          { opts.start_timeout_ms   = atoi(next()); }
        else if (arg == "--analysis-window-ms")        { opts.analysis_window_ms = atoi(next()); }
        else if (arg == "--threshold")                 { opts.threshold          = (float) atof(next()); }
        else {
            fprintf(stderr, "error: argumento desconocido: %s\n", arg.c_str());
            return false;
        }
    }

    return !opts.vad_model.empty() && !opts.out_path.empty();
}

void emit(const std::string & line) {
    fputs(line.c_str(), stdout);
    fputc('\n', stdout);
    fflush(stdout);
}

void log_silence(enum ggml_log_level, const char *, void *) {}

void put_u32(std::vector<uint8_t> & out, uint32_t value) {
    out.push_back((uint8_t) ( value        & 0xff));
    out.push_back((uint8_t) ((value >>  8) & 0xff));
    out.push_back((uint8_t) ((value >> 16) & 0xff));
    out.push_back((uint8_t) ((value >> 24) & 0xff));
}

void put_u16(std::vector<uint8_t> & out, uint16_t value) {
    out.push_back((uint8_t) ( value       & 0xff));
    out.push_back((uint8_t) ((value >> 8) & 0xff));
}

bool write_wav(const std::string & path, const int16_t * samples, size_t n_samples) {
    std::vector<uint8_t> header;
    header.reserve(44);

    const uint32_t data_bytes = (uint32_t) (n_samples * sizeof(int16_t));

    header.insert(header.end(), {'R', 'I', 'F', 'F'});
    put_u32(header, 36 + data_bytes);
    header.insert(header.end(), {'W', 'A', 'V', 'E'});
    header.insert(header.end(), {'f', 'm', 't', ' '});
    put_u32(header, 16);
    put_u16(header, 1);            // PCM
    put_u16(header, 1);            // mono
    put_u32(header, kSampleRate);
    put_u32(header, kSampleRate * 2);
    put_u16(header, 2);            // block align
    put_u16(header, 16);           // bits por muestra
    header.insert(header.end(), {'d', 'a', 't', 'a'});
    put_u32(header, data_bytes);

    FILE * file = fopen(path.c_str(), "wb");
    if (file == nullptr) {
        return false;
    }

    const bool ok = fwrite(header.data(), 1, header.size(), file) == header.size()
        && (n_samples == 0 || fwrite(samples, sizeof(int16_t), n_samples, file) == n_samples);
    fclose(file);

    return ok;
}

int64_t now_ms() {
    return (int64_t) (ggml_time_us() / 1000);
}

} // namespace

int main(int argc, char ** argv) {
    options opts;
    if (!parse_options(argc, argv, opts)) {
        print_usage(argv[0]);
        return 2;
    }

    ggml_time_init();
    whisper_log_set(log_silence, nullptr);

    whisper_vad_context_params ctx_params = whisper_vad_default_context_params();
    ctx_params.n_threads = std::max(1, opts.threads);
    ctx_params.use_gpu   = false;

    whisper_vad_context * vctx = whisper_vad_init_from_file_with_params(opts.vad_model.c_str(), ctx_params);
    if (vctx == nullptr) {
        emit("{\"event\":\"error\",\"message\":\"no se pudo cargar el modelo de Silero VAD\"}");
        return 3;
    }

    emit("{\"event\":\"listening\"}");

    const int analysis_windows = std::max(8, opts.analysis_window_ms / kWindowMs);
    const int max_samples      = (int) ((int64_t) opts.max_ms * kSampleRate / 1000);

    std::vector<int16_t> pcm16;
    std::vector<float>   pcmf32;
    pcm16.reserve(max_samples + kSampleRate);
    pcmf32.reserve(max_samples + kSampleRate);

    int  windows_scored     = 0;
    int  speech_windows     = 0;
    int  first_speech_window = -1;
    int  last_speech_window  = -1;
    bool announced_speech   = false;
    bool stdin_open         = true;

    std::string reason;
    uint8_t     leftover      = 0;
    bool        has_leftover  = false;
    std::vector<uint8_t> chunk(16384);

    const int64_t started_at = now_ms();
    int64_t next_tick_at = started_at + opts.tick_ms;

    while (reason.empty()) {
        if (stdin_open) {
            const int64_t wait_ms = std::max<int64_t>(0, next_tick_at - now_ms());
            struct pollfd pfd = { STDIN_FILENO, POLLIN, 0 };
            const int ready = poll(&pfd, 1, (int) wait_ms);

            if (ready < 0 && errno != EINTR) {
                reason = "read-error";
                break;
            }

            if (ready > 0) {
                const ssize_t got = read(STDIN_FILENO, chunk.data(), chunk.size());
                if (got < 0) {
                    if (errno != EINTR && errno != EAGAIN) {
                        reason = "read-error";
                        break;
                    }
                } else if (got == 0) {
                    stdin_open = false;
                } else {
                    size_t offset = 0;
                    if (has_leftover) {
                        const int16_t sample = (int16_t) ((uint16_t) leftover | ((uint16_t) chunk[0] << 8));
                        pcm16.push_back(sample);
                        pcmf32.push_back((float) sample / 32768.0f);
                        has_leftover = false;
                        offset = 1;
                    }

                    for (; offset + 1 < (size_t) got; offset += 2) {
                        const int16_t sample = (int16_t) ((uint16_t) chunk[offset] | ((uint16_t) chunk[offset + 1] << 8));
                        pcm16.push_back(sample);
                        pcmf32.push_back((float) sample / 32768.0f);
                    }

                    if (offset < (size_t) got) {
                        leftover     = chunk[offset];
                        has_leftover = true;
                    }
                }
            }
        }

        const bool tick_due = now_ms() >= next_tick_at;
        if (!tick_due && stdin_open) {
            continue;
        }
        next_tick_at = now_ms() + opts.tick_ms;

        const int windows_total = (int) (pcmf32.size() / kWindow);
        if (windows_total > windows_scored) {
            int start_window = std::max(0, windows_total - analysis_windows);
            start_window = std::min(start_window, windows_scored);

            const float * from = pcmf32.data() + (size_t) start_window * kWindow;
            const int     n    = (windows_total - start_window) * kWindow;

            if (!whisper_vad_detect_speech(vctx, from, n)) {
                reason = "vad-error";
                break;
            }

            const float * probs   = whisper_vad_probs(vctx);
            const int     n_probs = whisper_vad_n_probs(vctx);

            for (int i = 0; i < n_probs; i++) {
                const int window = start_window + i;
                if (window < windows_scored) {
                    continue;
                }
                if (probs[i] >= opts.threshold) {
                    speech_windows += 1;
                    last_speech_window = window;
                    if (first_speech_window < 0) {
                        first_speech_window = window;
                    }
                }
            }

            windows_scored = windows_total;
        }

        const int elapsed_ms = (int) ((int64_t) pcmf32.size() * 1000 / kSampleRate);
        const bool has_speech = speech_windows * kWindowMs >= opts.min_speech_ms;

        if (has_speech && !announced_speech) {
            announced_speech = true;
            emit("{\"event\":\"speech\"}");
        }

        if ((int) pcmf32.size() >= max_samples) {
            reason = "max-duration";
        } else if (has_speech && last_speech_window >= 0
                   && (windows_scored - 1 - last_speech_window) * kWindowMs >= opts.silence_ms) {
            reason = "silence";
        } else if (!has_speech && elapsed_ms >= opts.start_timeout_ms) {
            reason = "no-speech";
        } else if (!stdin_open) {
            reason = has_speech ? "eof" : "no-speech";
        }
    }

    const int  duration_ms = (int) ((int64_t) pcm16.size() * 1000 / kSampleRate);
    const int  speech_ms   = speech_windows * kWindowMs;
    const bool has_speech  = speech_ms >= opts.min_speech_ms && first_speech_window >= 0;

    whisper_vad_free(vctx);

    if (!has_speech) {
        char line[256];
        snprintf(line, sizeof(line),
            "{\"event\":\"done\",\"speech\":false,\"reason\":\"%s\",\"durationMs\":%d,\"speechMs\":%d}",
            reason.c_str(), duration_ms, speech_ms);
        emit(line);
        return 4;
    }

    const int pad_samples = opts.speech_pad_ms * kSampleRate / 1000;
    const int64_t from = std::max<int64_t>(0, (int64_t) first_speech_window * kWindow - pad_samples);
    const int64_t to   = std::min<int64_t>((int64_t) pcm16.size(),
                                           (int64_t) (last_speech_window + 1) * kWindow + pad_samples);

    if (!write_wav(opts.out_path, pcm16.data() + from, (size_t) std::max<int64_t>(0, to - from))) {
        emit("{\"event\":\"error\",\"message\":\"no se pudo escribir el wav de salida\"}");
        return 5;
    }

    char line[320];
    snprintf(line, sizeof(line),
        "{\"event\":\"done\",\"speech\":true,\"reason\":\"%s\",\"durationMs\":%d,\"speechMs\":%d,\"clipMs\":%d}",
        reason.c_str(), duration_ms, speech_ms, (int) ((to - from) * 1000 / kSampleRate));
    emit(line);

    return 0;
}
