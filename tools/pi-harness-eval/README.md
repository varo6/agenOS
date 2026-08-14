# AgenOS Pi Harness Eval

Standalone trace replay eval for the AgenOS Pi foreground harness. This lives under `tools/` on purpose: it is not packaged into the OS image and does not affect ISO builds.

The eval follows the stable part of Self-Harness:

- collect execution traces from the Pi harness
- score deterministic tasks against those traces
- cluster recurring failures
- generate human-review proposal notes

It does not modify prompts, tools, policies, or source files.

## Quick Run

From this folder:

```bash
bun run eval -- --trace ../../components/ui/.agenos/ui-dev/pi/traces/pi-chat.ndjson
```

Most local runs will use the default trace location instead:

```bash
bun run eval
```

For the current Pi/Codex target model:

```bash
bun run eval -- --model gpt-5.6-terra
```

Defaults:

- suite: `scenarios/pi-smoke.json`
- trace: `~/.agenos/ui-dev/pi/traces/pi-chat.ndjson`
- output: `.out/latest`

The command writes:

- `.out/latest/summary.json`
- `.out/latest/report.md`
- `.out/latest/proposals.md`

## Demo Fixture

```bash
bun run eval -- --trace fixtures/pi-chat.ndjson --out .out/fixture
```

## Eval Contract

Each scenario matches one trace by prompt text, then checks stable fields:

- final trace status
- required and forbidden tools
- output includes/excludes
- max duration

Use this to test harness behavior after manually driving Pi through the prompts in `scenarios/pi-smoke.json`.

## Confirmed-memory comparison

`src/learning-live.ts` drives the real foreground harness once in an isolated temporary agent
directory. It copies OAuth credentials into that directory, deletes the copy afterwards, and
writes only the redacted harness trace. Run baseline and learned variants separately so their
session histories cannot contaminate each other:

```bash
bun run learning:live -- --mode baseline --auth ~/.codex/auth.json --out .out/self-improvement/baseline.ndjson
bun run learning:live -- --mode learned --auth ~/.codex/auth.json --out .out/self-improvement/learned.ndjson
cd ../..
make pi-harness-eval ARGS="--suite scenarios/pi-learning.json --trace .out/self-improvement/learned.ndjson --out .out/self-improvement/learned-report"
```

The learning suite checks both user-visible recall and trace evidence: selected learned-memory
IDs, the context token budget, final status, output, and latency. A selected memory is not counted
as behavioral improvement unless the complete scenario passes.
