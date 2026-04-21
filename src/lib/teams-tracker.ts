// Track Agent Teams status from Claude Code logs (v0.3.0 extended)

import type { LogEntry, ReviewSignalKind } from './types';

export interface Teammate {
  name: string;
  role: string; // 'reviewer', 'devil-advocate', 'auditor', 'requirement-verifier', etc.
  status: 'spawning' | 'working' | 'completed' | 'failed';
  startTime: number;
  verdict?: string; // SHIP, NEEDS_WORK, MAJOR_RETHINK, APPROVE, OBJECT, PASS/MINOR/MAJOR/CRITICAL, numeric score
  // v0.3 additions
  completedAt?: number; // frozen elapsed baseline
  roundsSeen?: number; // number of review rounds this agent has fired on this task
  lastSignalKind?: ReviewSignalKind;
  lastSignalValue?: string;
}

/**
 * A stable row in the Subagent Roster Panel. The panel always renders the
 * full skeleton (Reviewer → Devil → Auditor → Goal-Gate → Architect) even
 * before any real spawn event — so the Partner-Demo never shows a blank box.
 */
export interface RosterRow {
  role: 'reviewer' | 'devil' | 'auditor' | 'goal-gate' | 'architect';
  label: string;
  status: 'idle' | 'spawning' | 'working' | 'completed' | 'failed';
  elapsedSec: number; // 0 when idle
  verdict?: string;
  verdictKind?: ReviewSignalKind;
}

export interface RoundSnapshot {
  at: number;
  reviewer?: string;
  devil?: string;
  auditor?: string;
  goalScore?: number;
}

/**
 * TeamsTracker — stores teammate lifecycle + review-signal history.
 * v0.3 adds:
 *   - processSignal(entry): consumes 'review-signal' LogEntry directly
 *     (no more regex on free text).
 *   - tickElapsed(): called on a UI timer so working agents show live seconds.
 *   - rosterSnapshot(): stable 5-row view for RosterPanel.
 *   - verdictsByTask: persistent history across iteration resets.
 */
export class TeamsTracker {
  private teammates: Map<string, Teammate> = new Map();
  private reviewVerdict = '';
  private devilVerdict = '';

  // v0.3: tag the most recent auditor + goal-gate signals separately so
  // the header and roster can reflect the v1.5 3+1 pipeline accurately.
  private auditVerdict = '';
  private goalScore = '';

  // Per-task rolling history — survives reset() on iteration flips because
  // it's indexed by task id, not by iteration.
  private verdictsByTask: Map<string, LogEntry[]> = new Map();
  // One RoundSnapshot[] per task, appended when a full round finishes
  // (reviewer + devil + auditor + goal_score seen).
  private roundsByTask: Map<string, RoundSnapshot[]> = new Map();
  private currentTaskId: string | undefined;
  private pendingRound: RoundSnapshot = { at: 0 };

  /** Bind the active task id so review signals get attributed correctly. */
  setCurrentTask(taskId: string | undefined): void {
    if (this.currentTaskId === taskId) return;
    // Flush any pending (partial) round for the previous task.
    if (this.currentTaskId && this.pendingRound.at > 0) {
      this.flushPendingRound(this.currentTaskId);
    }
    this.currentTaskId = taskId;
    this.pendingRound = { at: 0 };
  }

  addTeammate(name: string, role: string): void {
    this.teammates.set(name, {
      name,
      role,
      status: 'spawning',
      startTime: Date.now(),
    });
  }

  updateStatus(
    name: string,
    status: Teammate['status'],
    verdict?: string
  ): void {
    const teammate = this.teammates.get(name);
    if (!teammate) return;
    teammate.status = status;
    if (status === 'completed' || status === 'failed') {
      teammate.completedAt = Date.now();
    }
    if (verdict) {
      teammate.verdict = verdict;
      if (teammate.role.includes('reviewer') && !teammate.role.includes('devil')) {
        this.reviewVerdict = verdict;
      }
      if (teammate.role.includes('devil')) {
        this.devilVerdict = verdict;
      }
    }
  }

  /**
   * v0.3: consume a structured review-signal LogEntry. Preferred over
   * processLogLine() because the parser already did the tag extraction.
   */
  processSignal(entry: LogEntry): void {
    if (entry.type !== 'review-signal' || !entry.reviewSignal || !entry.reviewValue) {
      return;
    }
    const kind = entry.reviewSignal;
    const value = entry.reviewValue;

    // Map signal to roster role + update our cached verdict line.
    const roleForSignal: Record<ReviewSignalKind, Teammate['role']> = {
      verdict: 'reviewer',
      'devil-verdict': 'devil-advocate',
      'audit-verdict': 'auditor',
      'goal-score': 'requirement-verifier',
    };
    const role = roleForSignal[kind];

    // Update cached top-level verdict strings (used by the header).
    if (kind === 'verdict') this.reviewVerdict = value;
    if (kind === 'devil-verdict') this.devilVerdict = value;
    if (kind === 'audit-verdict') this.auditVerdict = value;
    if (kind === 'goal-score') this.goalScore = value;

    // Find (or synthesize) the teammate for this role and mark it completed.
    let tm = Array.from(this.teammates.values()).find(
      (t) => t.role === role && t.status !== 'completed' && t.status !== 'failed'
    );
    if (!tm) {
      // Synthesize a teammate so the roster row flips to completed even
      // when we missed the spawn log line.
      const syntheticName = `jenaai-${role}`;
      this.teammates.set(syntheticName, {
        name: syntheticName,
        role,
        status: 'working',
        startTime: Date.now() - 1000, // tiny history so elapsed isn't 0
      });
      tm = this.teammates.get(syntheticName);
    }
    if (tm) {
      tm.status = 'completed';
      tm.completedAt = Date.now();
      tm.verdict = value;
      tm.lastSignalKind = kind;
      tm.lastSignalValue = value;
      tm.roundsSeen = (tm.roundsSeen ?? 0) + 1;
    }

    // Attribute signal to the current task and roll up into round snapshots.
    if (this.currentTaskId) {
      const list = this.verdictsByTask.get(this.currentTaskId) ?? [];
      list.push(entry);
      this.verdictsByTask.set(this.currentTaskId, list);

      if (this.pendingRound.at === 0) this.pendingRound.at = Date.now();
      if (kind === 'verdict') this.pendingRound.reviewer = value;
      if (kind === 'devil-verdict') this.pendingRound.devil = value;
      if (kind === 'audit-verdict') this.pendingRound.auditor = value;
      if (kind === 'goal-score') {
        const parsed = parseInt(value, 10);
        if (!Number.isNaN(parsed)) this.pendingRound.goalScore = parsed;
      }

      // A round is "complete" once goal-score arrives (the 4th stage) — flush it.
      if (kind === 'goal-score') {
        this.flushPendingRound(this.currentTaskId);
      }
    }
  }

  private flushPendingRound(taskId: string): void {
    if (this.pendingRound.at === 0) return;
    const arr = this.roundsByTask.get(taskId) ?? [];
    arr.push(this.pendingRound);
    // Cap history at 10 rounds per task; the UI shows the last 5.
    while (arr.length > 10) arr.shift();
    this.roundsByTask.set(taskId, arr);
    this.pendingRound = { at: 0 };
  }

  /**
   * Parse log lines for team-related events. Legacy path — kept for
   * backward-compat with spawn-detection, but new review verdicts should
   * flow through processSignal() (fed by the parser).
   */
  processLogLine(text: string): void {
    // Detect agent spawning
    const spawnMatch = text.match(/Spawning (jenaai-\w+) teammate/i);
    if (spawnMatch) {
      const name = spawnMatch[1]!;
      const role = name.replace('jenaai-', '');
      this.addTeammate(name, role);
    }

    // Legacy verdict detection — still works so older callers/tests don't break.
    const verdictMatch = text.match(/<verdict>(SHIP|NEEDS_WORK|MAJOR_RETHINK)<\/verdict>/);
    if (verdictMatch) {
      this.reviewVerdict = verdictMatch[1]!;
      for (const [, t] of this.teammates) {
        if (t.role === 'reviewer' && t.status !== 'completed') {
          t.status = 'completed';
          t.completedAt = Date.now();
          t.verdict = verdictMatch[1]!;
          break;
        }
      }
    }

    const devilMatch = text.match(/<devil-verdict>(APPROVE|OBJECT)<\/devil-verdict>/);
    if (devilMatch) {
      this.devilVerdict = devilMatch[1]!;
      for (const [, t] of this.teammates) {
        if (t.role.includes('devil') && t.status !== 'completed') {
          t.status = 'completed';
          t.completedAt = Date.now();
          t.verdict = devilMatch[1]!;
          break;
        }
      }
    }

    // Detect agent completion
    const doneMatch = text.match(/Agent ".*?(jenaai-\w+).*?" completed/i);
    if (doneMatch) {
      const teammate = this.teammates.get(doneMatch[1]!);
      if (teammate && teammate.status !== 'completed') {
        teammate.status = 'completed';
        teammate.completedAt = Date.now();
      }
    }
  }

  /**
   * No-op hook for UI timers — kept so apps can call it without branching.
   * Elapsed time is computed on-demand by rosterSnapshot() from startTime,
   * so we don't actually need to mutate state here. Exposed for future
   * use if we move to cached elapsed values.
   */
  tickElapsed(): void {
    // intentionally empty; elapsed is derived from clock on snapshot
  }

  /**
   * v0.3: stable 5-row view for the RosterPanel. Always returns rows in the
   * same order and never returns fewer than 5 rows — even before any spawn.
   */
  rosterSnapshot(): RosterRow[] {
    const order: Array<{ role: RosterRow['role']; label: string; match: (t: Teammate) => boolean }> = [
      { role: 'reviewer', label: 'Reviewer', match: (t) => t.role === 'reviewer' },
      { role: 'devil', label: 'Devil', match: (t) => t.role.includes('devil') },
      { role: 'auditor', label: 'Auditor', match: (t) => t.role.includes('auditor') },
      {
        role: 'goal-gate',
        label: 'Goal-Gate',
        match: (t) => t.role.includes('requirement') || t.role.includes('verifier') || t.role === 'goal-gate',
      },
      { role: 'architect', label: 'Architect', match: (t) => t.role.includes('architect') },
    ];

    const signalKindByRole: Record<RosterRow['role'], ReviewSignalKind> = {
      reviewer: 'verdict',
      devil: 'devil-verdict',
      auditor: 'audit-verdict',
      'goal-gate': 'goal-score',
      architect: 'verdict', // architect reuses reviewer icon
    };

    const now = Date.now();
    return order.map((slot) => {
      // Prefer an active one; fall back to most recent completed.
      const candidates = Array.from(this.teammates.values()).filter(slot.match);
      const active = candidates.find((t) => t.status === 'working' || t.status === 'spawning');
      const chosen =
        active ?? candidates.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0];

      if (!chosen) {
        return {
          role: slot.role,
          label: slot.label,
          status: 'idle',
          elapsedSec: 0,
        };
      }
      const baseline =
        chosen.status === 'completed' || chosen.status === 'failed'
          ? (chosen.completedAt ?? now)
          : now;
      const elapsedSec = Math.max(0, Math.floor((baseline - chosen.startTime) / 1000));
      return {
        role: slot.role,
        label: slot.label,
        status: chosen.status,
        elapsedSec,
        verdict: chosen.verdict,
        verdictKind: chosen.lastSignalKind ?? signalKindByRole[slot.role],
      };
    });
  }

  /** v0.3: last N review-signal entries for a given task. */
  verdictsFor(taskId: string): LogEntry[] {
    return this.verdictsByTask.get(taskId) ?? [];
  }

  /** v0.3: last N full review rounds for a given task (reviewer+devil+auditor+goal). */
  roundsFor(taskId: string): RoundSnapshot[] {
    return this.roundsByTask.get(taskId) ?? [];
  }

  get activeCount(): number {
    return Array.from(this.teammates.values()).filter(
      (t) => t.status === 'spawning' || t.status === 'working'
    ).length;
  }

  get allTeammates(): Teammate[] {
    return Array.from(this.teammates.values());
  }

  get review(): string {
    return this.reviewVerdict;
  }
  get devil(): string {
    return this.devilVerdict;
  }
  /** v0.3 accessors */
  get audit(): string {
    return this.auditVerdict;
  }
  get goal(): string {
    return this.goalScore;
  }

  /**
   * Clear per-iteration state. Historic per-task data (verdictsByTask,
   * roundsByTask) is preserved across iteration resets so the UI can show
   * long-run verdicts.
   */
  reset(): void {
    this.teammates.clear();
    this.reviewVerdict = '';
    this.devilVerdict = '';
    this.auditVerdict = '';
    this.goalScore = '';
    // intentionally NOT clearing verdictsByTask / roundsByTask
    this.pendingRound = { at: 0 };
  }
}
