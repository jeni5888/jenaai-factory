/**
 * StatusBar component - segmented bottom bar with shortcuts and status.
 * Inspired by modern terminal UIs with distinct segments.
 *
 * v0.3: adds optional progress bar (epic %), iter clock, $/h burn rate,
 * and error keybind hint. All new segments are optional — tests that
 * only check for length=1 and shortcut text stay green.
 */

import type { Component } from '@mariozechner/pi-tui';

import type { Theme } from '../themes/index.ts';

import {
  padToWidth,
  stripAnsi,
  truncateToWidth,
  visibleWidth,
} from '../lib/render.ts';

export interface StatusBarProps {
  runId?: string;
  errorCount?: number;
  totalCost?: string;
  theme: Theme;
  // v0.3 additions, all optional
  epicProgress?: { done: number; total: number };
  iterElapsedSec?: number; // current iter-*.log elapsed
  rateUsdPerHour?: number; // $/h burn rate
  /** Shortcut hints ordered from most-important to least-important. */
  shortcuts?: string; // overrides the default hint string
  /** Active filter for the output panel (v0.3 keybindings t/e/v). */
  filterMode?: 'all' | 'thinking' | 'errors' | 'reviews';
  /** Toast string shown briefly after snapshot (`s` key). */
  toast?: string;
}

function formatIterClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * 15-col ASCII progress bar: [███████░░░░░░░░] 42% (12/37)
 * Returns raw + coloured variants separately so callers can compute widths.
 */
function progressBar(
  theme: Theme,
  done: number,
  total: number
): { raw: string; colored: string } {
  const width = 15;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const fill = total > 0 ? Math.round((done / total) * width) : 0;
  const filledCells = Math.max(0, Math.min(width, fill));
  const emptyCells = width - filledCells;
  const bar = `[${'█'.repeat(filledCells)}${'░'.repeat(emptyCells)}]`;
  const tail = ` ${pct}% (${done}/${total})`;
  const raw = `${bar}${tail}`;
  const colored =
    theme.border('[') +
    theme.success('█'.repeat(filledCells)) +
    theme.dim('░'.repeat(emptyCells)) +
    theme.border(']') +
    theme.text(tail);
  return { raw, colored };
}

/**
 * StatusBar component - segmented status bar.
 */
export class StatusBar implements Component {
  private runId: string | undefined;
  private errorCount: number;
  private totalCost: string | undefined;
  private theme: Theme;
  // v0.3
  private epicProgress: StatusBarProps['epicProgress'];
  private iterElapsedSec: number | undefined;
  private rateUsdPerHour: number | undefined;
  private shortcuts: string;
  private filterMode: StatusBarProps['filterMode'];
  private toast: string | undefined;

  constructor(props: StatusBarProps) {
    this.runId = props.runId;
    this.errorCount = props.errorCount ?? 0;
    this.totalCost = props.totalCost;
    this.theme = props.theme;
    this.epicProgress = props.epicProgress;
    this.iterElapsedSec = props.iterElapsedSec;
    this.rateUsdPerHour = props.rateUsdPerHour;
    // Default kept short so 80-col layouts still fit runId + cost + errors.
    // App.ts can pass a richer string when width ≥ 100.
    this.shortcuts = props.shortcuts ?? 'q quit  j/k nav  ? help';
    this.filterMode = props.filterMode ?? 'all';
    this.toast = props.toast;
  }

  update(props: Partial<StatusBarProps>): void {
    if ('runId' in props) this.runId = props.runId;
    if ('errorCount' in props) this.errorCount = props.errorCount ?? 0;
    if ('totalCost' in props) this.totalCost = props.totalCost;
    if ('theme' in props && props.theme) this.theme = props.theme;
    if ('epicProgress' in props) this.epicProgress = props.epicProgress;
    if ('iterElapsedSec' in props) this.iterElapsedSec = props.iterElapsedSec;
    if ('rateUsdPerHour' in props) this.rateUsdPerHour = props.rateUsdPerHour;
    if ('shortcuts' in props && props.shortcuts !== undefined) this.shortcuts = props.shortcuts;
    if ('filterMode' in props) this.filterMode = props.filterMode;
    if ('toast' in props) this.toast = props.toast;
  }

  render(width: number): string[] {
    if (width <= 0) return [''];

    const safeRunId = this.runId ? stripAnsi(this.runId) : undefined;
    const sep = this.theme.border(' │ ');
    const sepRaw = ' │ ';

    const segments: { raw: string; colored: string }[] = [];

    // 1. Shortcuts
    segments.push({
      raw: this.shortcuts,
      colored: this.theme.dim(this.shortcuts),
    });

    // 2. Active filter badge (only if non-default)
    if (this.filterMode && this.filterMode !== 'all') {
      const filterText = `filter: ${this.filterMode}`;
      segments.push({
        raw: filterText,
        colored: this.theme.warning(filterText),
      });
    }

    // 3. Epic progress bar
    if (this.epicProgress && this.epicProgress.total > 0) {
      const bar = progressBar(this.theme, this.epicProgress.done, this.epicProgress.total);
      segments.push({ raw: bar.raw, colored: bar.colored });
    }

    // 4. Iter elapsed clock
    if (this.iterElapsedSec !== undefined) {
      const clock = formatIterClock(this.iterElapsedSec);
      const iterText = `iter ⏱ ${clock}`;
      segments.push({
        raw: iterText,
        colored: this.theme.dim('iter ⏱ ') + this.theme.text(clock),
      });
    }

    // 5. Run ID
    if (safeRunId) {
      segments.push({
        raw: safeRunId,
        colored: this.theme.accent(safeRunId),
      });
    }

    // 6. Total cost + rate/h
    if (this.totalCost) {
      const rate =
        this.rateUsdPerHour !== undefined && this.rateUsdPerHour > 0
          ? ` ($${this.rateUsdPerHour.toFixed(2)}/h)`
          : '';
      const raw = `${this.totalCost}${rate}`;
      segments.push({
        raw,
        colored: this.theme.accent(this.totalCost) + this.theme.dim(rate),
      });
    }

    // 7. Toast (transient) — takes precedence over error count visually
    if (this.toast) {
      segments.push({
        raw: this.toast,
        colored: this.theme.success(this.toast),
      });
    } else if (this.errorCount > 0) {
      const errText = `${this.errorCount} error${this.errorCount === 1 ? '' : 's'} (e→log)`;
      segments.push({
        raw: errText,
        colored: this.theme.error(errText),
      });
    }

    const totalRawWidth =
      segments.reduce((acc, s) => acc + visibleWidth(s.raw), 0) +
      (segments.length - 1) * visibleWidth(sepRaw);

    let line: string;
    if (totalRawWidth <= width) {
      const gapWidth = Math.max(0, width - totalRawWidth);
      if (segments.length === 1) {
        line = segments[0]!.colored + ' '.repeat(gapWidth);
      } else {
        const firstSeg = segments[0]!;
        const restSegs = segments
          .slice(1)
          .map((s) => s.colored)
          .join(sep);
        const restRaw = segments
          .slice(1)
          .map((s) => s.raw)
          .join(sepRaw);
        const gapForRest = Math.max(
          0,
          width -
            visibleWidth(firstSeg.raw) -
            visibleWidth(restRaw) -
            (segments.length - 1) * visibleWidth(sepRaw)
        );
        line = firstSeg.colored + ' '.repeat(gapForRest) + restSegs;
      }
    } else {
      // Drop optional segments from the right until it fits, keeping shortcuts visible.
      let keptRawLen = visibleWidth(segments[0]!.raw);
      const kept: typeof segments = [segments[0]!];
      for (let i = 1; i < segments.length; i++) {
        const next = segments[i]!;
        const nextLen = visibleWidth(next.raw);
        const projected = keptRawLen + visibleWidth(sepRaw) + nextLen;
        if (projected <= width) {
          kept.push(next);
          keptRawLen = projected;
        }
      }
      if (kept.length === 1) {
        line = truncateToWidth(kept[0]!.colored, width, '…');
      } else {
        const firstSeg = kept[0]!;
        const restSegs = kept
          .slice(1)
          .map((s) => s.colored)
          .join(sep);
        const restRaw = kept
          .slice(1)
          .map((s) => s.raw)
          .join(sepRaw);
        const gap = Math.max(
          0,
          width -
            visibleWidth(firstSeg.raw) -
            visibleWidth(restRaw) -
            (kept.length - 1) * visibleWidth(sepRaw)
        );
        line = firstSeg.colored + ' '.repeat(gap) + restSegs;
      }
    }

    return [padToWidth(line, width)];
  }

  handleInput(_data: string): void {}

  invalidate(): void {}
}
