/**
 * Snapshot exporter for Partner-Demo screenshots (v0.3).
 *
 * Given the current composed frame (array of ANSI-coloured lines), writes
 * two files under /tmp with a timestamped filename:
 *
 *   /tmp/jenaai-factory-snapshot-<ISO>.ansi   — preserves colours (cat -R)
 *   /tmp/jenaai-factory-snapshot-<ISO>.txt    — stripped of ANSI, greppable
 *
 * Returns the two absolute paths so the caller can display a toast.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { stripAnsi } from './render';

export interface SnapshotPaths {
  ansi: string;
  text: string;
}

export function writeSnapshot(lines: readonly string[]): SnapshotPaths {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `jenaai-factory-snapshot-${stamp}`;
  const dir = tmpdir();
  const ansi = join(dir, `${base}.ansi`);
  const text = join(dir, `${base}.txt`);

  const ansiBody = lines.join('\n') + '\n';
  const textBody = lines.map((l) => stripAnsi(l)).join('\n') + '\n';

  writeFileSync(ansi, ansiBody, { encoding: 'utf-8' });
  writeFileSync(text, textBody, { encoding: 'utf-8' });

  return { ansi, text };
}
