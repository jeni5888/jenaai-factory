// Token and cost tracking for Claude Code sessions
// Reads token usage from Claude's stream-json result messages

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface TaskCost {
  taskId: string;
  usage: TokenUsage;
  cost: number;
}

// Pricing per 1M tokens (March 2026)
const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-4-6': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4-5': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  'default': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }, // assume opus
};

export class CostTracker {
  private totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  private iterationUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  private taskCosts: Map<string, TaskCost> = new Map();
  private currentTaskId: string = '';
  private modelId: string = 'default';

  setCurrentTask(taskId: string) {
    this.currentTaskId = taskId;
    if (!this.taskCosts.has(taskId)) {
      this.taskCosts.set(taskId, { taskId, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, cost: 0 });
    }
  }

  setModel(modelId: string) {
    this.modelId = modelId;
  }

  resetIteration() {
    this.iterationUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  }

  addUsage(usage: Partial<TokenUsage>) {
    const input = usage.inputTokens ?? 0;
    const output = usage.outputTokens ?? 0;
    const cacheRead = usage.cacheReadTokens ?? 0;
    const cacheWrite = usage.cacheWriteTokens ?? 0;

    this.totalUsage.inputTokens += input;
    this.totalUsage.outputTokens += output;
    this.totalUsage.cacheReadTokens += cacheRead;
    this.totalUsage.cacheWriteTokens += cacheWrite;

    this.iterationUsage.inputTokens += input;
    this.iterationUsage.outputTokens += output;
    this.iterationUsage.cacheReadTokens += cacheRead;
    this.iterationUsage.cacheWriteTokens += cacheWrite;

    if (this.currentTaskId) {
      const task = this.taskCosts.get(this.currentTaskId)!;
      task.usage.inputTokens += input;
      task.usage.outputTokens += output;
      task.usage.cacheReadTokens += cacheRead;
      task.usage.cacheWriteTokens += cacheWrite;
      task.cost = this.calculateCost(task.usage);
    }
  }

  private calculateCost(usage: TokenUsage): number {
    const pricing = MODEL_PRICING[this.modelId] ?? MODEL_PRICING['default'];
    return (
      (usage.inputTokens / 1_000_000) * pricing.input +
      (usage.outputTokens / 1_000_000) * pricing.output +
      (usage.cacheReadTokens / 1_000_000) * pricing.cacheRead +
      (usage.cacheWriteTokens / 1_000_000) * pricing.cacheWrite
    );
  }

  get totalCost(): number { return this.calculateCost(this.totalUsage); }
  get total(): TokenUsage { return { ...this.totalUsage }; }
  get iteration(): TokenUsage { return { ...this.iterationUsage }; }
  get tasks(): TaskCost[] { return Array.from(this.taskCosts.values()); }

  getTaskCost(taskId: string): number {
    return this.taskCosts.get(taskId)?.cost ?? 0;
  }

  formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return `${n}`;
  }

  formatCost(cost: number): string {
    return `$${cost.toFixed(2)}`;
  }
}
