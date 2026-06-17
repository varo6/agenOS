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
