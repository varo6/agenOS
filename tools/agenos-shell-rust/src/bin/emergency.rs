use serde_json::json;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;
use tiny_http::{Method, Response, Server, StatusCode};

const HOST: &str = "127.0.0.1";
const PORT: u16 = 4174;
const MAIN_URL: &str = "http://127.0.0.1:4173/health";
const INSTALLER_APP: &[&str] = &["/usr/local/bin/agenos-installer-app"];
const INSTALLER_SERVER: &[&str] = &["/usr/local/bin/agenos-installer-server"];

const HTML: &str = r#"<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AgenOS Shell Error</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "IBM Plex Sans", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(227, 154, 85, 0.28), transparent 30%),
          linear-gradient(135deg, #120e0b 0%, #1c1511 55%, #0f1815 100%);
        color: #f8eee2;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      main {
        width: min(540px, 100%);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 28px;
        padding: 32px;
        background: rgba(20, 15, 11, 0.72);
        backdrop-filter: blur(18px);
      }
      h1 {
        margin: 0 0 12px;
        font-family: "Space Grotesk", sans-serif;
      }
      p { color: rgba(248, 238, 226, 0.78); }
      .actions { display: flex; gap: 12px; margin-top: 28px; flex-wrap: wrap; }
      button {
        border: none;
        border-radius: 999px;
        padding: 14px 20px;
        font: inherit;
        cursor: pointer;
      }
      .primary {
        background: linear-gradient(135deg, #f39d52, #f1c87b);
        color: #20140e;
        font-weight: 700;
      }
      .secondary {
        background: rgba(255,255,255,0.08);
        color: #f8eee2;
      }
      #status { min-height: 1.4em; margin-top: 16px; color: #ffd7b2; }
    </style>
  </head>
  <body>
    <main>
      <div>Fallback local</div>
      <h1>La shell principal no ha arrancado.</h1>
      <p>Esta pantalla es local a la sesión. Puedes reintentar la shell principal o abrir un terminal de mantenimiento sin reiniciar el equipo.</p>
      <div class="actions">
        <button class="primary" id="retry">Reintentar shell</button>
        <button class="secondary" id="terminal">Abrir terminal de mantenimiento</button>
      </div>
      <div id="status"></div>
    </main>
    <script>
      const status = document.getElementById("status");
      async function send(path) {
        status.textContent = "Trabajando...";
        const response = await fetch(path, { method: "POST" });
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.message || "La operación ha fallado.");
        }
        status.textContent = payload.message || "Operación completada.";
        return payload;
      }
      document.getElementById("retry").addEventListener("click", async () => {
        try {
          const payload = await send("/retry-shell");
          status.textContent = payload.message || "La shell principal se está relanzando.";
          window.close();
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : "No se pudo reintentar la shell.";
        }
      });
      document.getElementById("terminal").addEventListener("click", async () => {
        try {
          await send("/open-terminal");
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : "No se pudo abrir el terminal.";
        }
      });
    </script>
  </body>
</html>"#;

fn backend_healthy() -> bool {
    let result = ureq::get(MAIN_URL).call();
    result.is_ok()
}

fn start_detached(command: &[&str]) {
    if let Some((bin, args)) = command.split_first() {
        let _ = Command::new(bin)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }
}

fn relaunch_shell() -> (bool, String) {
    if !backend_healthy() {
        start_detached(INSTALLER_SERVER);
    }

    let mut healthy = false;
    for _ in 0..40 {
        if backend_healthy() {
            healthy = true;
            break;
        }
        thread::sleep(Duration::from_millis(250));
    }

    if !healthy {
        return (
            false,
            "El API del instalador no respondió en http://127.0.0.1:4173/health.".to_string(),
        );
    }

    start_detached(INSTALLER_APP);
    (true, "La shell principal se está relanzando.".to_string())
}

fn send_json(status: StatusCode, payload: serde_json::Value) -> Response<std::io::Cursor<Vec<u8>>> {
    let json_str = payload.to_string();
    Response::from_string(json_str)
        .with_status_code(status)
        .with_header(
            tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
        )
}

fn main() {
    let server = match Server::http(format!("{}:{}", HOST, PORT)) {
        Ok(server) => server,
        Err(error) => {
            eprintln!(
                "[agenos-emergency] failed to listen on http://{}:{}: {}",
                HOST, PORT, error
            );
            std::process::exit(1);
        }
    };
    println!("[agenos-emergency] listening on http://{}:{}", HOST, PORT);

    for request in server.incoming_requests() {
        let path = request.url();
        let method = request.method();

        if method == &Method::Get && path == "/health" {
            let _ = request.respond(send_json(StatusCode(200), json!({"ok": true})));
            continue;
        }

        if method == &Method::Get && (path == "/" || path == "/index.html") {
            let response = Response::from_string(HTML).with_header(
                tiny_http::Header::from_bytes(
                    &b"Content-Type"[..],
                    &b"text/html; charset=utf-8"[..],
                )
                .unwrap(),
            );
            let _ = request.respond(response);
            continue;
        }

        if method == &Method::Post && path == "/retry-shell" {
            let (ok, message) = relaunch_shell();
            let status = if ok { StatusCode(200) } else { StatusCode(500) };
            let _ = request.respond(send_json(status, json!({"ok": ok, "message": message})));
            continue;
        }

        if method == &Method::Post && path == "/open-terminal" {
            let status = match Command::new("/usr/local/bin/agenos-shell-helper")
                .arg("terminal")
                .status()
            {
                Ok(s) => s.code().unwrap_or(1),
                Err(_) => 1,
            };

            if status != 0 {
                let _ = request.respond(send_json(StatusCode(500), json!({"ok": false, "message": "No se pudo abrir el terminal de mantenimiento."})));
            } else {
                let _ = request.respond(send_json(
                    StatusCode(202),
                    json!({"ok": true, "message": "Terminal abierto."}),
                ));
            }
            continue;
        }

        let _ = request.respond(send_json(
            StatusCode(404),
            json!({"ok": false, "message": "Ruta no encontrada."}),
        ));
    }
}
