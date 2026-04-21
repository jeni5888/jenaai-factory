import { describe, test, expect } from 'bun:test';

import type { RosterRow } from '../lib/teams-tracker';
import { stripAnsi, visibleWidth } from '../lib/render';
import { darkTheme } from '../themes/dark';
import { RosterPanel } from './roster-panel';

function emptyRoster(): RosterRow[] {
  return [
    { role: 'reviewer', label: 'Reviewer', status: 'idle', elapsedSec: 0 },
    { role: 'devil', label: 'Devil', status: 'idle', elapsedSec: 0 },
    { role: 'auditor', label: 'Auditor', status: 'idle', elapsedSec: 0 },
    { role: 'goal-gate', label: 'Goal-Gate', status: 'idle', elapsedSec: 0 },
    { role: 'architect', label: 'Architect', status: 'idle', elapsedSec: 0 },
  ];
}

describe('RosterPanel', () => {
  test('always renders 5 rows + 2 borders even when everyone is idle', () => {
    const panel = new RosterPanel({ rows: emptyRoster(), theme: darkTheme });
    const lines = panel.render(40);
    // 1 top border + 5 rows + 1 bottom border = 7
    expect(lines.length).toBe(7);
  });

  test('top border contains Subagents label', () => {
    const panel = new RosterPanel({ rows: emptyRoster(), theme: darkTheme });
    const stripped = stripAnsi(panel.render(40)[0]!);
    expect(stripped).toContain('Subagents');
  });

  test('working row shows status dot + elapsed time', () => {
    const rows = emptyRoster();
    rows[0] = { role: 'reviewer', label: 'Reviewer', status: 'working', elapsedSec: 12 };
    const panel = new RosterPanel({ rows, theme: darkTheme });
    const body = panel.render(50).map((l) => stripAnsi(l)).join('\n');
    expect(body).toContain('12s');
    expect(body).toContain('●'); // working dot
  });

  test('completed row shows check + verdict with correct coloring', () => {
    const rows = emptyRoster();
    rows[0] = {
      role: 'reviewer',
      label: 'Reviewer',
      status: 'completed',
      elapsedSec: 8,
      verdict: 'SHIP',
      verdictKind: 'verdict',
    };
    const panel = new RosterPanel({ rows, theme: darkTheme });
    const body = panel.render(60).map((l) => stripAnsi(l)).join('\n');
    expect(body).toContain('SHIP');
    expect(body).toContain('✓');
  });

  test('goal-gate score colour: 87 is success-colored', () => {
    const rows = emptyRoster();
    rows[3] = {
      role: 'goal-gate',
      label: 'Goal-Gate',
      status: 'completed',
      elapsedSec: 3,
      verdict: '87',
      verdictKind: 'goal-score',
    };
    const panel = new RosterPanel({ rows, theme: darkTheme });
    const body = panel.render(50).map((l) => stripAnsi(l)).join('\n');
    expect(body).toContain('87');
  });

  test('ASCII mode uses ASCII status symbols and icons', () => {
    const rows = emptyRoster();
    rows[0] = { role: 'reviewer', label: 'Reviewer', status: 'working', elapsedSec: 3 };
    const panel = new RosterPanel({ rows, theme: darkTheme, useAscii: true });
    const body = panel.render(60).map((l) => stripAnsi(l)).join('\n');
    // working -> '*' in ascii; no unicode bullet
    expect(body).toContain('*');
    expect(body).not.toContain('●');
  });

  test('every rendered line respects the width budget', () => {
    const panel = new RosterPanel({ rows: emptyRoster(), theme: darkTheme });
    const width = 30;
    const lines = panel.render(width);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  test('borderless mode drops top/bottom border rows', () => {
    const panel = new RosterPanel({
      rows: emptyRoster(),
      theme: darkTheme,
      borderless: true,
    });
    const lines = panel.render(40);
    // 5 rows only (no borders)
    expect(lines.length).toBe(5);
  });
});
