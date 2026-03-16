# Jenaai Factory

Terminal Command Center for AI Agent Teams. Real-time visibility into autonomous agent runs.

Forked from [flow-next-tui](https://github.com/gmickel/gmickel-claude-marketplace/tree/main/flow-next-tui) by Gordon Mickel.

**Jenaai Factory** is a TUI for monitoring [jenaai-flow](https://github.com/jeni5888/jenaai-flow) Ralph autonomous agent runs. It provides real-time visibility into Ralph runs: task progress, streaming logs, and run state.

## Features

- **Task Progress** - Visual task list with status icons (done/in-progress/todo/blocked)
- **Live Logs** - Streaming output from Ralph iterations with tool icons
- **Task Details** - Markdown spec rendering and receipt status
- **Multi-Epic Support** - Monitors all open epics aggregated
- **Themes** - Dark (default) and light themes with 256-color palette
- **ASCII Mode** - `--no-emoji` for compatibility with limited fonts

## Requirements

- **Bun** - Runtime (macOS/Linux; Windows untested)
- **jenaai-flow** - `.flow/` directory with epics/tasks
- **Ralph** - `scripts/ralph/` scaffolded via `/jenaai-flow:ralph-init`

## Installation

```bash
# From npm (requires Bun runtime)
bun add -g @jeni5888/jenaai-factory

# Or run directly
bunx @jeni5888/jenaai-factory
```

## Usage

```bash
# Start TUI (auto-selects latest run)
jenaai-factory

# Or use short alias
jf

# Legacy alias also works
fntui

# With options
jenaai-factory --light          # Light theme
jenaai-factory --no-emoji       # ASCII icons
jenaai-factory --run <id>       # Select specific run
jenaai-factory -v               # Show version
```

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
3. `plugins/flow-next/scripts/flowctl` (legacy)
4. System PATH

### Unicode icons look wrong

Try `--no-emoji` for ASCII fallback, or use a font with good Unicode support (e.g., JetBrains Mono, Fira Code).

## License

MIT
