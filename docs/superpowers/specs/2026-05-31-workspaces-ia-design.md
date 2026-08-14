# AgenOS workspaces controlled by Pi

## Goal

Add a first-class workspace layer to AgenOS so the user and Pi can send applications to one of five numbered workspaces and optionally move the user's focus there.

The visible control is a system-style top bar with numbers `1 2 3 4 5`. The same workspace model is exposed to the AI tools, so Pi can launch an app in a target workspace and can change the user's focused workspace when appropriate.

## User experience

The AgenOS frontend shows a fixed top bar above the main shell.

- Left: `AgenOS`.
- Center: workspace buttons `1 2 3 4 5`.
- Right: short Pi connection/model state.
- Clicking a number focuses that workspace.
- The active workspace is visually highlighted.

The bar should feel like a lightweight OS panel, not a card inside the main shell. It remains visible on the chat and backend tabs.

## Workspace model

AgenOS owns five logical workspaces:

| Number | Sway name | Default use |
| --- | --- | --- |
| 1 | `1:agent` | AgenOS shell and Pi |
| 2 | `2:app` | General launched apps |
| 3 | `3:web` | Web/browser work |
| 4 | `4:media` | Media apps |
| 5 | `5:work` | Terminal/work tools |

Only workspace numbers `1` through `5` are valid. Invalid inputs are rejected before shelling out.

## Backend architecture

Add a backend workspace service responsible for validation and Sway integration. The service should expose:

- `listWorkspaces()`: returns the five known workspaces and the active workspace when it can be read.
- `focusWorkspace(input)`: validates the workspace number and runs `swaymsg workspace <name>` when a Sway session is available.
- `resolveDefaultWorkspaceForApp(appId)`: returns the default workspace when an app launch request does not specify one.

The service should be injectable for tests, following the existing patterns used by app/browser tools.

When no Sway session is available, focusing returns a clear non-fatal error instead of throwing an unstructured process failure.

## API

Add HTTP routes under the existing installer API:

- `GET /api/agent/workspaces`
- `POST /api/agent/workspaces/focus`

The focus body is:

```json
{
  "workspace": 2,
  "source": "ui"
}
```

`source` can be `ui`, `openclaw`, or `system`; unknown values default to `ui` for policy/audit purposes.

The UI client gets typed helpers for listing and focusing workspaces. The Electron bridge can stay unchanged unless the current bridge requires parity for packaged UI calls.

## AI tools

Extend foreground Pi tools so app launches can include workspace intent:

```json
{
  "app": "Chrome",
  "workspace": 2,
  "focus": true
}
```

Rules:

- `workspace` is optional.
- `focus` defaults to `true`.
- If `workspace` is omitted, the backend chooses a default from the app:
  - browser/general apps: `2`
  - terminal/work tools: `5`
  - AgenOS shell: `1`
- If `focus` is `false`, AgenOS may launch without changing the user's active workspace, but the workspace is still used when supported by Sway.

The Pi system context should mention that Pi can target workspaces by number and should use this capability when the user asks for an app in a specific place.

## App launch behavior

For browser launches, replace the current hard-coded focus to `2:app` with the workspace service. For other apps, focus the target workspace before spawning the app when `focus` is true. This keeps the implementation reliable without needing window matching rules in the first version.

This design intentionally does not guarantee moving already-open windows between workspaces. It handles the launch-and-focus flow first. Moving existing windows can be a later feature if needed.

## Frontend behavior

The App component should keep workspace state separate from chat/auth state.

- On load, fetch workspace metadata after initial status calls.
- Clicking a workspace optimistically marks it active, then reconciles with the API response.
- If focusing fails, show the existing global error panel.
- The top bar remains responsive on small screens: brand left, numbered controls centered, status shortened on the right.

## Policy and safety

Workspace focus is a low-risk local UI action and can be allowed for `ui` and `openclaw` sources. It should still validate the workspace number and never pass raw user text to `swaymsg`.

## Tests

Add focused tests for:

- Workspace validation rejects values outside `1..5`.
- Workspace focus builds the expected `swaymsg workspace <name>` command.
- No-Sway sessions return a structured failure.
- `apps_open` accepts `workspace` and `focus`, applies app defaults, and focuses before launch.
- Browser launch no longer hard-codes `2:app`.
- UI clicking workspace `2` calls the workspace client and updates the active state.

## Out of scope

- Renaming workspaces from the UI.
- Arbitrary workspace counts.
- Moving already-open windows to another workspace.
- Live subscription to Sway events. The first version can refresh after user/API actions.
