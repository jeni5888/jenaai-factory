/**
 * Header component with "Mission Control" aesthetic.
 * Prominent Ralph branding with status indicator, task context, and timer.
 *
 * v0.3: width-responsive 3-row content layout for Expertenmodus:
 *   Row 1 (always):   state + Iter #N + Atmpt #M + progress + Task + Round X/Y + timer
 *   Row 2 (≥100 cols, when token data): ↓in ↑out │ cache XX% │ $cost │ rate $/h │ Team
 *   Row 3 (≥140 cols, when epic context): Epic: … │ Plan: SHIP │ Mode: claude-team │ Branch: …
 * Still 3 lines total (top border + 1 content + bottom border) when no token data —
 * that preserves `header.test.ts` assertions.
 */

import type { Component } from '@mariozechner/pi-tui';

import { truncateToWidth } from '@mariozechner/pi-tui';

import type { Epic, Task } from '../lib/types.ts';
import type { Theme } from '../themes/index.ts';

import { visibleWidth, padToWidth } from '../lib/render.ts';

/** Status indicators - pulsing dot for running state */
export const STATE_ICONS = {
  running: '●',
  idle: '○',
  complete: '✓',
} as const;

export const ASCII_STATE_ICONS = {
  running: '*',
  idle: 'o',
  complete: '+',
} as const;

export interface HeaderProps {
  state: 'running' | 'idle' | 'complete';
  task?: Task;
  epic?: Epic;
  iteration: number;
  taskProgress: { done: number; total: number };
  elapsed: number;
  theme: Theme;
  useAscii?: boolean;
  // Token/cost tracking
  inputTokens?: string; // pre-formatted, e.g. "45.2K"
  outputTokens?: string;
  cost?: string; // pre-formatted, e.g. "$2.34"
  // Team status
  teamStatus?: string; // e.g. "2 active" or "Review: SHIP"
  // v0.3 densification — all optional, rendered only when available
  attempt?: number; // current attempt in Ralph 5-attempt budget
  reviewRound?: { current: number; max: number }; // e.g. {current:2, max:3}
  cachePct?: number; // 0..100 — cache-hit ratio
  rateUsdPerHour?: number; // burn rate
  planReviewStatus?: 'SHIP' | 'NEEDS_WORK' | 'MAJOR_RETHINK' | 'UNKNOWN';
  implMode?: 'claude-team' | 'codex' | 'rp' | 'export' | 'none';
  branchName?: string;
  // v0.3 sparklines (rendered at ≥200 cols)
  inputSpark?: string;
  costSpark?: string;
  iterSpark?: string;
}

/**
 * Format elapsed time as HH:MM:SS or MM:SS
 */
function formatTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function verdictColor(theme: Theme, verdict: string | undefined): (s: string) => string {
  if (!verdict) return theme.dim;
  if (verdict === 'SHIP' || verdict === 'APPROVE' || verdict === 'PASS') return theme.success;
  if (verdict === 'NEEDS_WORK' || verdict === 'OBJECT' || verdict === 'MINOR')
    return theme.warning;
  if (verdict === 'MAJOR_RETHINK' || verdict === 'MAJOR' || verdict === 'CRITICAL')
    return theme.error;
  return theme.text;
}

/**
 * Header component - Mission Control style with prominent branding.
 */
export class Header implements Component {
  private state: HeaderProps['state'];
  private task: Task | undefined;
  private epic: Epic | undefined;
  private iteration: number;
  private taskProgress: { done: number; total: number };
  private elapsed: number;
  private theme: Theme;
  private useAscii: boolean;
  private inputTokens: string;
  private outputTokens: string;
  private cost: string;
  private teamStatus: string;
  // v0.3 extra
  private attempt: number | undefined;
  private reviewRound: HeaderProps['reviewRound'];
  private cachePct: number | undefined;
  private rateUsdPerHour: number | undefined;
  private planReviewStatus: HeaderProps['planReviewStatus'];
  private implMode: HeaderProps['implMode'];
  private branchName: string | undefined;
  private inputSpark: string;
  private costSpark: string;
  private iterSpark: string;

  constructor(props: HeaderProps) {
    this.state = props.state;
    this.task = props.task;
    this.epic = props.epic;
    this.iteration = props.iteration;
    this.taskProgress = props.taskProgress;
    this.elapsed = props.elapsed;
    this.theme = props.theme;
    this.useAscii = props.useAscii ?? false;
    this.inputTokens = props.inputTokens ?? '';
    this.outputTokens = props.outputTokens ?? '';
    this.cost = props.cost ?? '';
    this.teamStatus = props.teamStatus ?? '';
    this.attempt = props.attempt;
    this.reviewRound = props.reviewRound;
    this.cachePct = props.cachePct;
    this.rateUsdPerHour = props.rateUsdPerHour;
    this.planReviewStatus = props.planReviewStatus;
    this.implMode = props.implMode;
    this.branchName = props.branchName;
    this.inputSpark = props.inputSpark ?? '';
    this.costSpark = props.costSpark ?? '';
    this.iterSpark = props.iterSpark ?? '';
  }

  update(props: Partial<HeaderProps>): void {
    if (props.state !== undefined) this.state = props.state;
    if (props.task !== undefined) this.task = props.task;
    if (props.epic !== undefined) this.epic = props.epic;
    if (props.iteration !== undefined) this.iteration = props.iteration;
    if (props.taskProgress !== undefined) this.taskProgress = props.taskProgress;
    if (props.elapsed !== undefined) this.elapsed = props.elapsed;
    if (props.theme !== undefined) this.theme = props.theme;
    if (props.useAscii !== undefined) this.useAscii = props.useAscii;
    if (props.inputTokens !== undefined) this.inputTokens = props.inputTokens;
    if (props.outputTokens !== undefined) this.outputTokens = props.outputTokens;
    if (props.cost !== undefined) this.cost = props.cost;
    if (props.teamStatus !== undefined) this.teamStatus = props.teamStatus;
    if (props.attempt !== undefined) this.attempt = props.attempt;
    if (props.reviewRound !== undefined) this.reviewRound = props.reviewRound;
    if (props.cachePct !== undefined) this.cachePct = props.cachePct;
    if (props.rateUsdPerHour !== undefined) this.rateUsdPerHour = props.rateUsdPerHour;
    if (props.planReviewStatus !== undefined) this.planReviewStatus = props.planReviewStatus;
    if (props.implMode !== undefined) this.implMode = props.implMode;
    if (props.branchName !== undefined) this.branchName = props.branchName;
    if (props.inputSpark !== undefined) this.inputSpark = props.inputSpark;
    if (props.costSpark !== undefined) this.costSpark = props.costSpark;
    if (props.iterSpark !== undefined) this.iterSpark = props.iterSpark;
  }

  private getStateIcon(): string {
    return (this.useAscii ? ASCII_STATE_ICONS : STATE_ICONS)[this.state];
  }

  private getStateColor(): (s: string) => string {
    switch (this.state) {
      case 'running':
        return this.theme.success;
      case 'complete':
        return this.theme.accent;
      default:
        return this.theme.dim;
    }
  }

  render(width: number): string[] {
    if (width < 20) return [padToWidth('', width)];

    const lines: string[] = [];
    const borderH = this.useAscii ? '-' : '─';
    const cornerTL = this.useAscii ? '+' : '╭';
    const cornerTR = this.useAscii ? '+' : '╮';
    const cornerBL = this.useAscii ? '+' : '╰';
    const cornerBR = this.useAscii ? '+' : '╯';
    const borderV = this.useAscii ? '|' : '│';

    // Top border with branding label
    const label = ' Jenaai Factory ';
    const labelWidth = visibleWidth(label);
    const borderWidth = width - 2;
    const leftBorderLen = Math.floor((borderWidth - labelWidth) / 2);
    const rightBorderLen = borderWidth - leftBorderLen - labelWidth;

    const topBorder =
      this.theme.border(cornerTL) +
      this.theme.border(borderH.repeat(Math.max(0, leftBorderLen))) +
      this.theme.accent(label) +
      this.theme.border(borderH.repeat(Math.max(0, rightBorderLen))) +
      this.theme.border(cornerTR);
    lines.push(topBorder);

    // === Row 1: status + iteration + attempt + task + round + timer ===
    const icon = this.getStateIcon();
    const colorFn = this.getStateColor();
    const timer = formatTime(this.elapsed);
    const { done, total } = this.taskProgress;
    const contentWidth = width - 4; // 2 for borders + 2 for padding

    const stateLabel =
      this.state === 'running' ? 'Running' : this.state === 'complete' ? 'Done' : 'Idle';

    const statusSeg =
      colorFn(icon) +
      ' ' +
      (this.state === 'running'
        ? this.theme.text(stateLabel)
        : this.state === 'complete'
          ? this.theme.dim(stateLabel)
          : this.theme.dim(stateLabel));

    const iterSeg = this.theme.dim('Iter ') + this.theme.accent(`#${this.iteration}`);
    const atmptSeg =
      this.attempt !== undefined
        ? this.theme.dim(' · Atmpt ') + this.theme.accent(`#${this.attempt}`)
        : '';

    const progressSeg =
      this.theme.accent(`${done}`) + this.theme.dim('/') + this.theme.text(`${total}`);

    let taskSeg = '';
    if (this.task) {
      taskSeg = this.theme.dim('Task: ') + this.theme.accent(this.task.id);
    } else if (this.epic) {
      taskSeg = this.theme.dim('Epic: ') + this.theme.accent(this.epic.id);
    }

    let roundSeg = '';
    if (this.reviewRound && this.reviewRound.max > 0) {
      const { current, max } = this.reviewRound;
      const colorRound = current >= max ? this.theme.warning : this.theme.accent;
      roundSeg =
        this.theme.dim('Round ') + colorRound(`${current}/${max}`);
    }

    const timerSeg = this.theme.dim('⏱ ') + this.theme.text(timer);

    const leftParts = [statusSeg + atmptSeg, iterSeg, progressSeg];
    if (taskSeg) leftParts.push(taskSeg);
    if (roundSeg) leftParts.push(roundSeg);

    const leftContent = leftParts.join(this.theme.border(' │ '));
    // Raw length calc (stripped) for gap sizing — reconstruct all raw pieces.
    const rawBits: string[] = [];
    rawBits.push(
      `${icon} ${stateLabel}${this.attempt !== undefined ? ` · Atmpt #${this.attempt}` : ''}`
    );
    rawBits.push(`Iter #${this.iteration}`);
    rawBits.push(`${done}/${total}`);
    if (taskSeg) rawBits.push(`Task: ${this.task?.id ?? this.epic?.id}`);
    if (roundSeg && this.reviewRound)
      rawBits.push(`Round ${this.reviewRound.current}/${this.reviewRound.max}`);
    const leftRaw = rawBits.join(' │ ');
    const leftWidth = visibleWidth(leftRaw);
    const timerRaw = `⏱ ${timer}`;
    const timerWidth = visibleWidth(timerRaw);
    const gapWidth = Math.max(1, contentWidth - leftWidth - timerWidth);

    const contentLine = ' ' + leftContent + ' '.repeat(gapWidth) + timerSeg + ' ';
    lines.push(
      this.theme.border(borderV) +
        truncateToWidth(contentLine, width - 2, '…') +
        this.theme.border(borderV)
    );

    // === Row 2: tokens + cache% + cost + rate + team (only when data present) ===
    const hasTokenData = this.inputTokens || this.outputTokens || this.cost;
    const hasTeamData = this.teamStatus;
    const showRow2 = (hasTokenData || hasTeamData) && width >= 40;
    if (showRow2) {
      const row2Parts: string[] = [];
      const row2Raw: string[] = [];

      if (this.inputTokens || this.outputTokens) {
        const inStr = this.inputTokens || '0';
        const outStr = this.outputTokens || '0';
        const sparkIn = width >= 200 && this.inputSpark ? ' ' + this.theme.dim(this.inputSpark) : '';
        const sparkInRaw = width >= 200 && this.inputSpark ? ' ' + this.inputSpark : '';
        const tokenSeg =
          this.theme.dim('↓') + this.theme.text(inStr) +
          this.theme.dim(' ↑') + this.theme.text(outStr) +
          sparkIn;
        row2Parts.push(tokenSeg);
        row2Raw.push(`↓${inStr} ↑${outStr}${sparkInRaw}`);
      }

      if (this.cachePct !== undefined && Number.isFinite(this.cachePct)) {
        const pct = Math.max(0, Math.min(100, Math.round(this.cachePct)));
        const cacheSeg = this.theme.dim('cache ') + this.theme.success(`${pct}%`);
        row2Parts.push(cacheSeg);
        row2Raw.push(`cache ${pct}%`);
      }

      if (this.cost) {
        const sparkCost = width >= 200 && this.costSpark ? ' ' + this.theme.dim(this.costSpark) : '';
        const sparkCostRaw = width >= 200 && this.costSpark ? ' ' + this.costSpark : '';
        const costSeg = this.theme.accent(this.cost) + sparkCost;
        row2Parts.push(costSeg);
        row2Raw.push(`${this.cost}${sparkCostRaw}`);
      }

      if (this.rateUsdPerHour !== undefined && this.rateUsdPerHour > 0) {
        const rateStr = `rate $${this.rateUsdPerHour.toFixed(2)}/h`;
        const sparkIter = width >= 200 && this.iterSpark ? ' ' + this.theme.dim(this.iterSpark) : '';
        const sparkIterRaw = width >= 200 && this.iterSpark ? ' ' + this.iterSpark : '';
        const rateSeg = this.theme.dim(rateStr) + sparkIter;
        row2Parts.push(rateSeg);
        row2Raw.push(`${rateStr}${sparkIterRaw}`);
      }

      if (this.teamStatus) {
        const teamSeg = this.theme.dim('Team: ') + this.theme.text(this.teamStatus);
        row2Parts.push(teamSeg);
        row2Raw.push(`Team: ${this.teamStatus}`);
      }

      const row2Left = row2Parts.join(this.theme.border(' │ '));
      const row2LeftRaw = row2Raw.join(' │ ');
      const row2LeftWidth = visibleWidth(row2LeftRaw);
      const row2Gap = Math.max(1, contentWidth - row2LeftWidth);
      const row2Line = ' ' + row2Left + ' '.repeat(row2Gap) + ' ';

      lines.push(
        this.theme.border(borderV) +
          truncateToWidth(row2Line, width - 2, '…') +
          this.theme.border(borderV)
      );
    }

    // === Row 3: epic + plan review + impl mode + branch (≥140 cols) ===
    const hasRow3Data =
      !!this.epic || !!this.planReviewStatus || !!this.implMode || !!this.branchName;
    if (hasRow3Data && width >= 140) {
      const row3Parts: string[] = [];
      const row3Raw: string[] = [];

      if (this.epic) {
        const epicTitle = this.epic.title ?? this.epic.id;
        const epicSeg =
          this.theme.dim('Epic: ') + this.theme.text(epicTitle);
        row3Parts.push(epicSeg);
        row3Raw.push(`Epic: ${epicTitle}`);
      }
      if (this.planReviewStatus && this.planReviewStatus !== 'UNKNOWN') {
        const planSeg =
          this.theme.dim('Plan: ') + verdictColor(this.theme, this.planReviewStatus)(this.planReviewStatus);
        row3Parts.push(planSeg);
        row3Raw.push(`Plan: ${this.planReviewStatus}`);
      }
      if (this.implMode) {
        const modeSeg = this.theme.dim('Mode: ') + this.theme.accent(this.implMode);
        row3Parts.push(modeSeg);
        row3Raw.push(`Mode: ${this.implMode}`);
      }
      // Branch only shown at ≥200 cols — less critical than plan/mode
      if (this.branchName && width >= 200) {
        const branchSeg = this.theme.dim('Branch: ') + this.theme.text(this.branchName);
        row3Parts.push(branchSeg);
        row3Raw.push(`Branch: ${this.branchName}`);
      }

      if (row3Parts.length > 0) {
        const row3Left = row3Parts.join(this.theme.border(' │ '));
        const row3LeftRaw = row3Raw.join(' │ ');
        const row3LeftWidth = visibleWidth(row3LeftRaw);
        const row3Gap = Math.max(1, contentWidth - row3LeftWidth);
        const row3Line = ' ' + row3Left + ' '.repeat(row3Gap) + ' ';

        lines.push(
          this.theme.border(borderV) +
            truncateToWidth(row3Line, width - 2, '…') +
            this.theme.border(borderV)
        );
      }
    }

    // Bottom border
    const bottomBorder =
      this.theme.border(cornerBL) +
      this.theme.border(borderH.repeat(width - 2)) +
      this.theme.border(cornerBR);
    lines.push(bottomBorder);

    return lines;
  }

  handleInput(_data: string): void {}

  invalidate(): void {}
}
