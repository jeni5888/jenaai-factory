// Track Agent Teams status from Claude Code logs

export interface Teammate {
  name: string;
  role: string; // 'reviewer', 'devil-advocate', 'nextjs', 'swiftui', etc.
  status: 'spawning' | 'working' | 'completed' | 'failed';
  startTime: number;
  verdict?: string; // SHIP, NEEDS_WORK, MAJOR_RETHINK, APPROVE, OBJECT
}

export class TeamsTracker {
  private teammates: Map<string, Teammate> = new Map();
  private reviewVerdict: string = '';
  private devilVerdict: string = '';

  addTeammate(name: string, role: string) {
    this.teammates.set(name, {
      name,
      role,
      status: 'spawning',
      startTime: Date.now(),
    });
  }

  updateStatus(name: string, status: Teammate['status'], verdict?: string) {
    const teammate = this.teammates.get(name);
    if (teammate) {
      teammate.status = status;
      if (verdict) {
        teammate.verdict = verdict;
        if (teammate.role.includes('reviewer') && !teammate.role.includes('devil')) this.reviewVerdict = verdict;
        if (teammate.role.includes('devil')) this.devilVerdict = verdict;
      }
    }
  }

  // Parse log lines for team-related events
  processLogLine(text: string) {
    // Detect agent spawning
    const spawnMatch = text.match(/Spawning (jenaai-\w+) teammate/i);
    if (spawnMatch) {
      const name = spawnMatch[1]!;
      const role = name.replace('jenaai-', '');
      this.addTeammate(name, role);
    }

    // Detect review verdicts
    const verdictMatch = text.match(/<verdict>(SHIP|NEEDS_WORK|MAJOR_RETHINK)<\/verdict>/);
    if (verdictMatch) {
      this.reviewVerdict = verdictMatch[1]!;
      // Find the reviewer and update
      for (const [, t] of this.teammates) {
        if (t.role === 'reviewer' && t.status !== 'completed') {
          t.status = 'completed';
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
      }
    }
  }

  get activeCount(): number {
    return Array.from(this.teammates.values()).filter(t => t.status === 'spawning' || t.status === 'working').length;
  }

  get allTeammates(): Teammate[] {
    return Array.from(this.teammates.values());
  }

  get review(): string { return this.reviewVerdict; }
  get devil(): string { return this.devilVerdict; }

  reset() {
    this.teammates.clear();
    this.reviewVerdict = '';
    this.devilVerdict = '';
  }
}
