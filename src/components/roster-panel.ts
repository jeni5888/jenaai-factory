/**
 * RosterPanel — v0.3 Expertenmodus "Subagents" display.
 *
 * Always renders a 5-row skeleton for the v1.5 claude-team pipeline:
 *   ⚖  Reviewer    ● working  12s   SHIP
 *   🗡  Devil        ◦ idle
 *   🔎  Auditor    ● working  04s   MAJOR
 *   🎯  Goal-Gate   ✓ done     08s   87
 *   ◈  Architect   ○ queued
 *
 * Consumes `TeamsTracker.rosterSnapshot()`. Never shows blank — before
 * any subagent event arrives, all 5 rows render in "idle" state. This is
 * the Partner-Demo money-shot referenced in the v0.3 plan.
 */

import type { Component } from '@mariozechner/pi-tui';

import type { RosterRow } from '../lib/teams-tracker';
import type { Theme } from '../themes/index.ts';

import { getIcon } from '../lib/parser.ts';
import { padToWidth, truncateToWidth, visibleWidth } from '../lib/render.ts';

export interface RosterPanelProps {
  rows: RosterRow[];
  theme: Theme;
  useAscii?: boolean;
  /** Render without top/bottom borders (for embedding in other layouts). */
  borderless?: boolean;
}

const ROLE_ICON_KEY: Record<RosterRow['role'], string> = {
  reviewer: 'review-reviewer',
  devil: 'review-devil',
  auditor: 'review-auditor',
  'goal-gate': 'review-goal',
  architect: 'Task', // reuses diamond; architect has no dedicated icon
};

const STATUS_SYMBOL: Record<RosterRow['status'], string> = {
  working: '●',
  spawning: '◔',
  completed: '✓',
  failed: '✗',
  idle: '◦',
};

const STATUS_ASCII: Record<RosterRow['status'], string> = {
  working: '*',
  spawning: '.',
  completed: '+',
  failed: 'x',
  idle: '-',
};

function formatElapsed(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m${String(s).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h${String(mm).padStart(2, '0')}m`;
}

function verdictColor(theme: Theme, row: RosterRow): (s: string) => string {
  const v = (row.verdict ?? '').toString();
  if (row.verdictKind === 'goal-score') {
    const n = parseInt(v, 10);
    if (!Number.isNaN(n)) {
      if (n >= 80) return theme.success;
      if (n >= 60) return theme.warning;
      return theme.error;
    }
  }
  if (v === 'SHIP' || v === 'APPROVE' || v === 'PASS') return theme.success;
  if (v === 'NEEDS_WORK' || v === 'OBJECT' || v === 'MINOR') return theme.warning;
  if (v === 'MAJOR_RETHINK' || v === 'MAJOR' || v === 'CRITICAL') return theme.error;
  return theme.text;
}

function statusColor(theme: Theme, status: RosterRow['status']): (s: string) => string {
  switch (status) {
    case 'working':
    case 'spawning':
      return theme.progress;
    case 'completed':
      return theme.success;
    case 'failed':
      return theme.error;
    case 'idle':
    default:
      return theme.dim;
  }
}

export class RosterPanel implements Component {
  private rows: RosterRow[];
  private theme: Theme;
  private useAscii: boolean;
  private borderless: boolean;

  constructor(props: RosterPanelProps) {
    this.rows = props.rows;
    this.theme = props.theme;
    this.useAscii = props.useAscii ?? false;
    this.borderless = props.borderless ?? false;
  }

  setRows(rows: RosterRow[]): void {
    this.rows = rows;
  }

  update(props: Partial<RosterPanelProps>): void {
    if (props.rows !== undefined) this.rows = props.rows;
    if (props.theme !== undefined) this.theme = props.theme;
    if (props.useAscii !== undefined) this.useAscii = props.useAscii;
    if (props.borderless !== undefined) this.borderless = props.borderless;
  }

  /** Number of content rows the caller should budget for (excludes borders). */
  get rowCount(): number {
    return Math.max(1, this.rows.length);
  }

  render(width: number): string[] {
    if (width < 8) return [];

    const borderH = this.useAscii ? '-' : '─';
    const borderV = this.useAscii ? '|' : '│';
    const cornerTL = this.useAscii ? '+' : '┌';
    const cornerTR = this.useAscii ? '+' : '┐';
    const cornerBL = this.useAscii ? '+' : '└';
    const cornerBR = this.useAscii ? '+' : '┘';

    const lines: string[] = [];
    const label = ' Subagents ';
    const labelWidth = visibleWidth(label);
    const innerBorderLen = Math.max(0, width - 2 - labelWidth);

    if (!this.borderless) {
      lines.push(
        this.theme.border(cornerTL) +
          this.theme.accent(label) +
          this.theme.border(borderH.repeat(innerBorderLen)) +
          this.theme.border(cornerTR)
      );
    }

    const contentWidth = width - 2; // minus the two vertical borders

    for (const row of this.rows) {
      // Layout: [icon] [label] [statusSym] [elapsed] [verdict]
      const iconCh = getIcon(ROLE_ICON_KEY[row.role] ?? 'Task', this.useAscii);
      const symbolCh = this.useAscii ? STATUS_ASCII[row.status] : STATUS_SYMBOL[row.status];
      const elapsedStr =
        row.status === 'idle' || row.elapsedSec === 0 ? '' : formatElapsed(row.elapsedSec);
      const verdictStr = row.verdict ?? '';

      // Build raw representation first for width math.
      const labelPadded = row.label.padEnd(10);
      const elapsedCol = elapsedStr.padStart(6);
      const raw = `${iconCh} ${labelPadded} ${symbolCh} ${elapsedCol}  ${verdictStr}`;
      const rawWidth = visibleWidth(raw);

      const coloredIcon = this.theme.accent(iconCh);
      const coloredLabel = this.theme.text(labelPadded);
      const coloredSymbol = statusColor(this.theme, row.status)(symbolCh);
      const coloredElapsed =
        row.status === 'working' || row.status === 'spawning'
          ? this.theme.progress(elapsedCol)
          : this.theme.dim(elapsedCol);
      const coloredVerdict = verdictStr
        ? verdictColor(this.theme, row)(verdictStr)
        : '';

      const composed =
        coloredIcon +
        ' ' +
        coloredLabel +
        ' ' +
        coloredSymbol +
        ' ' +
        coloredElapsed +
        '  ' +
        coloredVerdict;

      // Truncate (pads also if short)
      let rowLine: string;
      if (rawWidth > contentWidth - 2) {
        rowLine = truncateToWidth(composed, contentWidth - 2, '…');
      } else {
        rowLine = composed;
      }
      const padded = padToWidth(' ' + rowLine, contentWidth);

      if (this.borderless) {
        lines.push(padded);
      } else {
        lines.push(this.theme.border(borderV) + padded + this.theme.border(borderV));
      }
    }

    if (!this.borderless) {
      lines.push(
        this.theme.border(cornerBL) +
          this.theme.border(borderH.repeat(width - 2)) +
          this.theme.border(cornerBR)
      );
    }

    return lines;
  }

  handleInput(_data: string): void {}

  invalidate(): void {}
}
