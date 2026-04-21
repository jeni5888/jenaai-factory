import { describe, test, expect } from 'bun:test';

import type { LogEntry } from './types';
import { TeamsTracker } from './teams-tracker';

function makeSignal(
  kind: 'verdict' | 'devil-verdict' | 'audit-verdict' | 'goal-score',
  value: string
): LogEntry {
  return {
    type: 'review-signal',
    content: `${kind}=${value}`,
    reviewSignal: kind,
    reviewValue: value,
  };
}

describe('TeamsTracker (legacy)', () => {
  test('processLogLine still detects spawns + verdicts for backward compat', () => {
    const t = new TeamsTracker();
    t.processLogLine('Spawning jenaai-reviewer teammate ...');
    t.processLogLine('<verdict>SHIP</verdict>');
    expect(t.review).toBe('SHIP');
    expect(t.activeCount).toBe(0);
  });

  test('devil-advocate spawn + verdict', () => {
    const t = new TeamsTracker();
    t.processLogLine('Spawning jenaai-devil-advocate teammate');
    t.processLogLine('<devil-verdict>APPROVE</devil-verdict>');
    expect(t.devil).toBe('APPROVE');
  });
});

describe('TeamsTracker (v0.3 processSignal)', () => {
  test('ignores non review-signal entries', () => {
    const t = new TeamsTracker();
    t.processSignal({ type: 'tool', content: 'Read: foo' });
    t.processSignal({ type: 'response', content: 'hi' });
    expect(t.review).toBe('');
  });

  test('updates cached verdicts from review-signal entries', () => {
    const t = new TeamsTracker();
    t.processSignal(makeSignal('verdict', 'SHIP'));
    t.processSignal(makeSignal('devil-verdict', 'APPROVE'));
    t.processSignal(makeSignal('audit-verdict', 'PASS'));
    t.processSignal(makeSignal('goal-score', '87'));
    expect(t.review).toBe('SHIP');
    expect(t.devil).toBe('APPROVE');
    expect(t.audit).toBe('PASS');
    expect(t.goal).toBe('87');
  });

  test('synthesizes teammates on signal even without a spawn line', () => {
    const t = new TeamsTracker();
    t.processSignal(makeSignal('audit-verdict', 'CRITICAL'));
    const roster = t.rosterSnapshot();
    const auditor = roster.find((r) => r.role === 'auditor');
    expect(auditor).toBeDefined();
    expect(auditor!.status).toBe('completed');
    expect(auditor!.verdict).toBe('CRITICAL');
  });
});

describe('TeamsTracker.rosterSnapshot', () => {
  test('always returns 5 rows in stable order — even empty', () => {
    const t = new TeamsTracker();
    const roster = t.rosterSnapshot();
    expect(roster.length).toBe(5);
    expect(roster.map((r) => r.role)).toEqual([
      'reviewer',
      'devil',
      'auditor',
      'goal-gate',
      'architect',
    ]);
    // All idle initially
    expect(roster.every((r) => r.status === 'idle')).toBe(true);
  });

  test('flips matching row to completed after a signal', () => {
    const t = new TeamsTracker();
    t.processSignal(makeSignal('verdict', 'NEEDS_WORK'));
    const reviewer = t.rosterSnapshot()[0]!;
    expect(reviewer.role).toBe('reviewer');
    expect(reviewer.status).toBe('completed');
    expect(reviewer.verdict).toBe('NEEDS_WORK');
  });

  test('elapsedSec is 0 for idle rows and non-negative otherwise', () => {
    const t = new TeamsTracker();
    t.addTeammate('jenaai-reviewer', 'reviewer');
    const roster = t.rosterSnapshot();
    const reviewer = roster.find((r) => r.role === 'reviewer')!;
    expect(reviewer.elapsedSec).toBeGreaterThanOrEqual(0);
    const devil = roster.find((r) => r.role === 'devil')!;
    expect(devil.elapsedSec).toBe(0);
  });
});

describe('TeamsTracker per-task history', () => {
  test('verdictsFor accumulates per task and survives reset()', () => {
    const t = new TeamsTracker();
    t.setCurrentTask('fn-1.2');
    t.processSignal(makeSignal('verdict', 'NEEDS_WORK'));
    t.processSignal(makeSignal('devil-verdict', 'OBJECT'));
    expect(t.verdictsFor('fn-1.2').length).toBe(2);

    // Iteration reset clears per-iteration state but not history.
    t.reset();
    expect(t.verdictsFor('fn-1.2').length).toBe(2);
  });

  test('roundsFor snapshots a full round once goal-score arrives', () => {
    const t = new TeamsTracker();
    t.setCurrentTask('fn-2.1');
    t.processSignal(makeSignal('verdict', 'SHIP'));
    t.processSignal(makeSignal('devil-verdict', 'APPROVE'));
    t.processSignal(makeSignal('audit-verdict', 'PASS'));
    t.processSignal(makeSignal('goal-score', '92'));
    const rounds = t.roundsFor('fn-2.1');
    expect(rounds.length).toBe(1);
    expect(rounds[0]!.reviewer).toBe('SHIP');
    expect(rounds[0]!.devil).toBe('APPROVE');
    expect(rounds[0]!.auditor).toBe('PASS');
    expect(rounds[0]!.goalScore).toBe(92);
  });
});
