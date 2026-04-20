# Jenaai Factory

Terminal Command Center for AI Agent Teams. Real-time visibility into autonomous agent runs.

Forked from [flow-next-tui](https://github.com/gmickel/gmickel-claude-marketplace/tree/main/flow-next-tui) by Gordon Mickel.

**Jenaai Factory** is a TUI for monitoring [jenaai-flow](https://github.com/jeni5888/jenaai-flow) Ralph autonomous agent runs. It provides real-time visibility into Ralph runs: task progress, streaming logs, and run state.

## Features

- **Task Progress** — Visual task list with status icons (done / in-progress / todo / blocked).
- **Live Logs** — Streaming output from Ralph iterations with tool icons.
- **Task Details** — Markdown spec rendering and receipt status.
- **Multi-Epic Support** — Monitors all open epics aggregated.
- **Themes** — Dark (default) and light themes with 256-color palette.
- **ASCII Mode** — `--no-emoji` for compatibility with limited fonts.

### New in v0.2.0 — mirrors jenaai-flow v1.5 / v1.6 review pipeline

- **Pipeline row on Task Details** — When a task's impl-review receipt has the v1.5 fields, a second metadata row shows:
  - `Verdict:` primary reviewer (SHIP / NEEDS_WORK / MAJOR_RETHINK)
  - `Audit:` auditor verdict (PASS / MINOR / MAJOR / CRITICAL)
  - `Goal:` goal-gate score (0–100)
  - `Rounds:` how many R&R Continuation rounds this task has gone through (counted from `.flow/reviews/<TASK>-r*.md`)
- **Architecture row** — when `architecture.score_before` / `score_after` is present in the receipt (v1.3 native architecture loop), a third row shows the delta and the bottleneck.
- **Review-signal icons in the output log** — the parser detects `<verdict>`, `<devil-verdict>`, `<audit-verdict>`, and `<goal-score>` tags emitted by reviewer subagents and tags each with a dedicated icon:

  | Icon | ASCII | Stage |
  |------|-------|-------|
  | ⚖    | V     | Primary reviewer verdict (jenaai-reviewer) |
  | 🗡    | D     | Devil's advocate (jenaai-devil-advocate) |
  | 🔎    | A     | Auditor, v1.5 (jenaai-auditor) |
  | 🎯    | G     | Goal gate, v1.5 (jenaai-requirement-verifier) |

  So even before the receipt JSON lands, you can see the three reviewers land their verdicts live in the log stream, followed by the goal-gate score if the team goes SHIP.

- **Help overlay legend** — `?` now shows an inline legend for the four review-signal icons above.
- **Backward compatible** — tasks without v1.5 receipts render exactly like v0.1.x (no extra rows, no broken UI).

## Requirements

- **Bun** — Runtime (macOS/Linux; Windows untested).
- **jenaai-flow v1.5+** — `.flow/` directory with epics/tasks. v1.5 is when the Auditor + Goal-Gate land; TUI v0.2 surfaces both.
- **Ralph** — `scripts/ralph/` scaffolded via `/jenaai-flow:ralph-init` (only needed for autonomous-run monitoring; live log icons also work on interactive runs).

## Installation

```bash
# From npm (requires Bun runtime)
bun add -g @jeni5888/jenaai-factory

# Or run directly without installing
bunx @jeni5888/jenaai-factory
```

## Quick start in a project

Drop into any jenaai-flow project. If you have the Claude Code plugin installed but not the local bin, start from the plugin path:

```bash
# One-time: set up jenaai-flow in the project (installs .flow/bin/flowctl)
/jenaai-flow:setup              # from inside Claude Code
# or manually:
"${CLAUDE_PLUGIN_ROOT}/plugins/jenaai-flow/scripts/flowctl" init

# Scaffold Ralph harness (once per project)
/jenaai-flow:ralph-init         # from Claude Code
# or manually:
bash "${CLAUDE_PLUGIN_ROOT}/plugins/jenaai-flow/skills/jenaai-flow-ralph-init/templates/scaffold.sh"

# Plan an epic (Claude Code)
/jenaai-flow:plan "Add rate limiting"

# Launch a Ralph run in one terminal:
./scripts/ralph/ralph.sh fn-1-add-rate-limiting

# In another terminal, launch the TUI to watch it:
jenaai-factory
```

The TUI auto-detects the most recent run and streams its output. You do NOT need to pass `--run` unless you want to watch a specific past run.

## Usage

```bash
# Start TUI (auto-selects latest run in the current repo)
jenaai-factory

# Short aliases
jf
fntui                              # legacy alias also works

# With options
jenaai-factory --light             # Light theme
jenaai-factory --no-emoji          # ASCII icons (and legend keys)
jenaai-factory --run <id>          # Select specific run
jenaai-factory -v                  # Show version
```

### What you see, step by step

1. **Header**: current run ID, elapsed time, iteration counter, active epic.
2. **Task list (left)**: every task in every open epic, grouped and status-iconed. `j`/`k` to navigate.
3. **Task detail (right)**: when a task is selected, you see:
   - Title + ID
   - Status / Plan receipt ✓ / Impl receipt ✓
   - **v1.5 pipeline row** — `Verdict:` reviewer outcome, `Audit:` auditor verdict, `Goal:` goal-gate score, `Rounds:` R&R Continuation count (only shown when the data exists).
   - **v1.3 architecture row** — `Arch: before→after`, delta, bottleneck file/function (only shown when baseline exists).
   - Block reason (for blocked tasks).
   - Markdown spec rendering.
4. **Output (bottom)**: live log stream from the current iteration. Tool calls get tool icons (▸◂◦⌕✎$◈⬇◎), review verdicts get the stage icons (⚖🗡🔎🎯). Scroll with `g` / `G` / `Space` / `Ctrl+U`.

## Keyboard Shortcuts

### Navigation

| Key       | Action        |
| --------- | ------------- |
| `j` / `down` | Next task     |
| `k` / `up` | Previous task |

### Output Panel

| Key                | Action         |
| ------------------ | -------------- |
| `g`                | Jump to top    |
| `G`                | Jump to bottom |
| `Space` / `Ctrl+D` | Page down      |
| `Ctrl+U`           | Page up        |

### General

| Key            | Action                 |
| -------------- | ---------------------- |
| `?`            | Toggle help overlay    |
| `Esc`          | Close overlay          |
| `q` / `Ctrl+C` | Quit (detach from run) |

## Status Icons

| Icon | ASCII | Meaning     |
| ---- | ----- | ----------- |
| `done` | `[x]` | Done        |
| `in_progress` | `[>]` | In Progress |
| `todo` | `[ ]` | Todo        |
| `blocked` | `[!]` | Blocked     |

## Integration with Ralph

The TUI monitors Ralph runs via:

1. **Log files** - Reads `scripts/ralph/runs/<run>/iter-*.log` files
2. **flowctl polling** - Queries task status via `flowctl show`
3. **Receipt files** - Shows review status from `receipts/` directory

### Starting a Run

If no runs exist, the TUI will prompt to spawn Ralph:

```bash
# Manual spawn (TUI will detect it)
cd scripts/ralph && ./ralph.sh
```

### Detaching

`q` or `Ctrl+C` detaches from the TUI without killing Ralph. The run continues in the background.

## Architecture

```
src/
├── index.ts          # CLI entry (commander)
├── app.ts            # Main TUI, state, render
├── components/
│   ├── header.ts     # Status, task, timer
│   ├── task-list.ts  # Navigable task list
│   ├── task-detail.ts # Markdown + receipts
│   ├── output.ts     # Streaming logs
│   ├── status-bar.ts # Bottom hints
│   ├── split-panel.ts # Horizontal layout
│   └── help-overlay.ts # ? modal
├── lib/
│   ├── flowctl.ts    # flowctl integration
│   ├── runs.ts       # Run discovery
│   ├── spawn.ts      # Ralph spawning
│   ├── log-watcher.ts # File watching
│   ├── parser.ts     # stream-json parsing
│   ├── render.ts     # ANSI utilities
│   └── types.ts      # Type definitions
└── themes/
    ├── dark.ts       # Dark palette
    └── light.ts      # Light palette
```

## Development

```bash
# Install dependencies
bun install

# Run in dev mode
bun run dev

# Run tests
bun test

# Lint
bun run lint
```

## Troubleshooting

### "No .flow/ directory"

Run `flowctl init` or ensure you're in a jenaai-flow project root.

### "No scripts/ralph/"

Run `/jenaai-flow:ralph-init` to scaffold the Ralph harness.

### "flowctl not found"

The TUI searches for flowctl in:

1. `.flow/bin/flowctl`
2. `plugins/jenaai-flow/scripts/flowctl`
3. `plugins/flow-next/scripts/flowctl` (legacy fallback)
4. System PATH

### Unicode icons look wrong

Try `--no-emoji` for ASCII fallback, or use a font with good Unicode support (e.g., JetBrains Mono, Fira Code).

## License

MIT
