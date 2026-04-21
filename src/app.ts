/**
 * Main App component for Jenaai Factory TUI.
 * Wires together all components with state management and polling.
 */

import {
  TUI,
  matchesKey,
  ProcessTerminal,
  type Component,
} from "@mariozechner/pi-tui";
import { stat } from "node:fs/promises";
import { join } from "node:path";

import type { Epic, EpicTask, LogEntry, Run, Task } from "./lib/types.ts";

import { CostTracker } from "./lib/cost-tracker.ts";
import { RingBuffer, sparkOf } from "./lib/sparkline.ts";
import { writeSnapshot } from "./lib/snapshot.ts";
import { TeamsTracker } from "./lib/teams-tracker.ts";
import { Header } from "./components/header.ts";
import { HelpOverlay } from "./components/help-overlay.ts";
import { OutputPanel } from "./components/output.ts";
import { RosterPanel } from "./components/roster-panel.ts";
import { SplitPanel } from "./components/split-panel.ts";
import { StatusBar } from "./components/status-bar.ts";
import { TaskDetail } from "./components/task-detail.ts";
import { TaskList } from "./components/task-list.ts";
import {
  getEpic,
  getEpics,
  getTask,
  getTaskSpec,
  FlowctlNotFoundError,
} from "./lib/flowctl.ts";
import { LogWatcher } from "./lib/log-watcher.ts";
import {
  discoverRuns,
  findRepoRoot,
  getLatestRun,
  getReceiptStatus,
  getBlockReason,
} from "./lib/runs.ts";
import {
  spawnRalph,
  findRalphScript,
  RalphNotFoundError,
} from "./lib/spawn.ts";
import { getTheme, type Theme } from "./themes/index.ts";

/**
 * App state interface
 */
export interface AppState {
  runs: Run[];
  currentRun?: Run;
  tasks: EpicTask[];
  selectedTaskIndex: number;
  outputBuffer: LogEntry[];
  iteration: number;
  elapsed: number; // seconds since run started
  showHelp: boolean;
  error?: string;
}

/**
 * App options from CLI
 */
export interface AppOptions {
  light?: boolean;
  noEmoji?: boolean;
  run?: string; // specific run ID to monitor
}

/** Compact mode threshold */
const COMPACT_WIDTH = 120;
const COMPACT_HEIGHT = 30;

/** Polling intervals (ms) */
const TASK_POLL_INTERVAL = 2000;
const TIMER_INTERVAL = 1000;

/**
 * Check if directory exists
 */
async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Fetch tasks from multiple epics, aggregating them in order
 * If epicIds is empty, fetches all open epics
 */
async function fetchAllTasks(
  epicIds: string[]
): Promise<{ tasks: EpicTask[]; epicIds: string[] }> {
  let targetEpics = epicIds;

  // If no epics specified, get all open epics (same as Ralph behavior)
  if (targetEpics.length === 0) {
    const allEpics = await getEpics();
    targetEpics = allEpics.filter((e) => e.status === "open").map((e) => e.id);
  }

  // Fetch all epics in parallel
  const epics = await Promise.all(
    targetEpics.map((id) => getEpic(id).catch(() => null))
  );

  // Aggregate tasks from all epics
  const allTasks: EpicTask[] = [];
  for (const epic of epics) {
    if (epic?.tasks) {
      allTasks.push(...epic.tasks);
    }
  }

  return { tasks: allTasks, epicIds: targetEpics };
}

/**
 * Main App component that implements pi-tui Component interface
 */
class App implements Component {
  private state: AppState;
  private theme: Theme;
  private useAscii: boolean;

  // Components
  private header: Header;
  private taskList: TaskList;
  private taskDetail: TaskDetail;
  private outputPanel: OutputPanel;
  private statusBar: StatusBar;
  private helpOverlay: HelpOverlay;
  private taskSplitPanel: SplitPanel;
  private rosterPanel: RosterPanel;

  // Trackers
  private costTracker: CostTracker;
  private teamsTracker: TeamsTracker;

  // v0.3: iter clock start
  private iterStartMs: number = Date.now();

  // v0.3: rolling-window sparklines fed by the new-iteration hook.
  // 30 samples each, rendered in header row-2 at ≥200 cols.
  private inputTokenSpark = new RingBuffer<number>(30);
  private costSpark = new RingBuffer<number>(30);
  private iterDurationSpark = new RingBuffer<number>(30);

  // v0.3: transient snapshot toast that clears itself.
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  // References
  private logWatcher: LogWatcher | null = null;
  private taskPollTimer: ReturnType<typeof setInterval> | null = null;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private tui: TUI | null = null;
  private taskDetailReq = 0; // Request token for async task detail updates

  constructor(
    state: AppState,
    theme: Theme,
    useAscii: boolean,
    epic: Epic | undefined,
    currentTask: Task | undefined,
    taskSpec: string
  ) {
    this.state = state;
    this.theme = theme;
    this.useAscii = useAscii;

    // Create trackers
    this.costTracker = new CostTracker();
    this.teamsTracker = new TeamsTracker();

    // Set initial task for cost tracking
    if (currentTask) {
      this.costTracker.setCurrentTask(currentTask.id);
    }

    // Create components
    this.header = new Header({
      state: state.currentRun?.active ? "running" : "complete",
      task: currentTask,
      epic,
      iteration: state.iteration,
      taskProgress: {
        done: state.tasks.filter((t) => t.status === "done").length,
        total: state.tasks.length,
      },
      elapsed: state.elapsed,
      theme,
      useAscii,
    });

    this.taskList = new TaskList({
      tasks: state.tasks,
      selectedIndex: state.selectedTaskIndex,
      onSelect: () => {
        // Enter key - could expand task detail or similar
      },
      onSelectionChange: (task, index) => {
        this.state.selectedTaskIndex = index;
        this.costTracker.setCurrentTask(task.id);
        this.teamsTracker.setCurrentTask(task.id);
        void this.updateTaskDetail(task.id);
      },
      theme,
      useAscii,
    });

    this.taskDetail = new TaskDetail({
      task: currentTask ?? createPlaceholderTask(),
      spec: taskSpec || "No task selected",
      theme,
      useAscii,
    });

    this.outputPanel = new OutputPanel({
      buffer: state.outputBuffer,
      iteration: state.iteration,
      theme,
      useAscii,
    });

    this.statusBar = new StatusBar({
      runId: state.currentRun?.id,
      errorCount: 0,
      theme,
    });

    this.helpOverlay = new HelpOverlay({
      theme,
      visible: state.showHelp,
      onClose: () => {
        this.state.showHelp = false;
        this.helpOverlay.hide();
        this.tui?.hideOverlay();
        this.tui?.requestRender();
      },
    });

    // Create split panel for TaskList | TaskDetail (40/60 split)
    this.taskSplitPanel = new SplitPanel({
      left: this.taskList,
      right: this.taskDetail,
      ratio: 0.4,
      active: "left",
    });

    // v0.3: Subagent Roster Panel — always visible money-shot
    this.rosterPanel = new RosterPanel({
      rows: this.teamsTracker.rosterSnapshot(),
      theme,
      useAscii,
    });
  }

  setTui(tui: TUI): void {
    this.tui = tui;
  }

  setupLogWatcher(): void {
    if (!this.state.currentRun) return;

    this.logWatcher = new LogWatcher(this.state.currentRun.path);
    this.logWatcher.on("line", (entry) => {
      this.outputPanel.appendLine(entry);
      // Count errors
      if (entry.type === "error" || entry.success === false) {
        const currentErrorCount = this.state.outputBuffer.filter(
          (e) => e.type === "error" || e.success === false
        ).length;
        this.statusBar.update({ errorCount: currentErrorCount });
      }

      // Feed token usage to CostTracker
      if (entry.usage) {
        this.costTracker.addUsage(entry.usage);
        if (entry.model) {
          this.costTracker.setModel(entry.model);
        }
        this.updateTokenDisplay();
      }

      // Feed text content to TeamsTracker for team event detection
      if (entry.content) {
        this.teamsTracker.processLogLine(entry.content);
      }

      // v0.3: structured review-signal entries go straight into the tracker
      if (entry.type === "review-signal") {
        this.teamsTracker.processSignal(entry);
      }

      this.updateTeamDisplay();
      this.rosterPanel.setRows(this.teamsTracker.rosterSnapshot());

      this.tui?.requestRender();
    });
    this.logWatcher.on("new-iteration", (iteration) => {
      // v0.3: capture per-iteration telemetry into sparkline rings
      // BEFORE resetting the iteration counters.
      const iterUsage = this.costTracker.iteration;
      const iterDurationSec = Math.max(
        0,
        Math.floor((Date.now() - this.iterStartMs) / 1000)
      );
      if (iteration > 1) {
        this.inputTokenSpark.push(iterUsage.inputTokens);
        this.costSpark.push(
          iterUsage.inputTokens + iterUsage.outputTokens +
            iterUsage.cacheReadTokens + iterUsage.cacheWriteTokens
        );
        this.iterDurationSpark.push(iterDurationSec);
      }

      this.state.iteration = iteration;
      this.outputPanel.setIteration(iteration);
      this.outputPanel.clearBuffer();
      this.costTracker.resetIteration();
      // v0.3: teams-tracker.reset() clears per-iteration state but
      // preserves per-task history (verdictsByTask, roundsByTask).
      this.teamsTracker.reset();
      this.rosterPanel.setRows(this.teamsTracker.rosterSnapshot());
      this.iterStartMs = Date.now();
      this.header.update({ iteration });
      this.tui?.requestRender();
    });
    this.logWatcher.on("error", (err) => {
      console.error("Log watcher error:", err);
    });
  }

  async startLogWatcher(): Promise<void> {
    if (this.logWatcher) {
      await this.logWatcher.start();
    }
  }

  setupPolling(): void {
    // Polling for tasks from all epics
    const epicIds = this.state.currentRun?.epics ?? [];
    this.taskPollTimer = setInterval(() => {
      void (async () => {
        try {
          const { tasks } = await fetchAllTasks(epicIds);

          this.state.tasks = tasks;
          this.taskList.setTasks(tasks);
          this.header.update({
            taskProgress: {
              done: tasks.filter((t) => t.status === "done").length,
              total: tasks.length,
            },
          });

          // Always refresh selected task detail (status, receipts, etc.)
          const selectedTask = tasks[this.state.selectedTaskIndex];
          if (selectedTask) {
            void this.updateTaskDetail(selectedTask.id);
          }

          this.tui?.requestRender();
        } catch {
          // Ignore poll errors
        }
      })();
    }, TASK_POLL_INTERVAL);

    // Timer for elapsed time (from run start, not TUI start)
    const parsed = this.state.currentRun?.startedAt
      ? Date.parse(this.state.currentRun.startedAt)
      : NaN;
    const runStartMs = Number.isFinite(parsed) ? parsed : Date.now();
    // Initialize elapsed immediately
    this.state.elapsed = Math.max(
      0,
      Math.floor((Date.now() - runStartMs) / 1000)
    );
    this.header.update({ elapsed: this.state.elapsed });

    this.timerInterval = setInterval(() => {
      this.state.elapsed = Math.max(
        0,
        Math.floor((Date.now() - runStartMs) / 1000)
      );
      const iterElapsedSec = Math.max(
        0,
        Math.floor((Date.now() - this.iterStartMs) / 1000)
      );
      this.header.update({ elapsed: this.state.elapsed });
      this.statusBar.update({
        iterElapsedSec,
        epicProgress: {
          done: this.state.tasks.filter((t) => t.status === 'done').length,
          total: this.state.tasks.length,
        },
      });
      // v0.3: rosterSnapshot is cheap; re-emit so elapsed seconds on
      // working agents tick visibly every second.
      this.rosterPanel.setRows(this.teamsTracker.rosterSnapshot());
      this.tui?.requestRender();
    }, TIMER_INTERVAL);
  }

  cleanup(): void {
    if (this.logWatcher) {
      this.logWatcher.stop();
    }
    if (this.taskPollTimer) {
      clearInterval(this.taskPollTimer);
    }
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
  }

  private updateTokenDisplay(): void {
    const total = this.costTracker.total;
    const inputStr = this.costTracker.formatTokens(total.inputTokens);
    const outputStr = this.costTracker.formatTokens(total.outputTokens);
    const costStr = this.costTracker.formatCost(this.costTracker.totalCost);
    const cachePct = this.costTracker.cacheHitPct();
    const rate = this.costTracker.ratePerHour(this.state.elapsed);

    this.header.update({
      inputTokens: inputStr,
      outputTokens: outputStr,
      cost: costStr,
      cachePct,
      rateUsdPerHour: rate,
      inputSpark: this.inputTokenSpark.size > 0 ? sparkOf(this.inputTokenSpark) : '',
      costSpark: this.costSpark.size > 0 ? sparkOf(this.costSpark) : '',
      iterSpark: this.iterDurationSpark.size > 0 ? sparkOf(this.iterDurationSpark) : '',
    });
    this.statusBar.update({
      totalCost: `${costStr} total`,
      rateUsdPerHour: rate,
    });

    // Update per-task costs in task list (v0.3: threshold lowered so
    // even cheap tasks show a badge).
    const taskCostMap = new Map<string, string>();
    for (const tc of this.costTracker.tasks) {
      if (tc.cost > 0.001) {
        taskCostMap.set(tc.taskId, this.costTracker.formatCost(tc.cost));
      }
    }
    this.taskList.setTaskCosts(taskCostMap);
  }

  /**
   * v0.3: capture the current frame to /tmp and flash a transient toast.
   * Requires the TUI to be attached so we can compute the width; falls back
   * to 120 cols if detached.
   */
  private captureSnapshot(): void {
    try {
      const width = this.tui?.terminal?.columns ?? 120;
      const frame = this.render(width);
      const paths = writeSnapshot(frame);
      const toast = `snapshot → ${paths.ansi}`;
      this.statusBar.update({ toast });
      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        this.statusBar.update({ toast: undefined });
        this.tui?.requestRender();
      }, 2500);
      this.tui?.requestRender();
    } catch (err) {
      this.statusBar.update({
        toast: `snapshot failed: ${(err as Error).message ?? 'unknown'}`,
      });
      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        this.statusBar.update({ toast: undefined });
        this.tui?.requestRender();
      }, 2500);
    }
  }

  private updateTeamDisplay(): void {
    const active = this.teamsTracker.activeCount;
    const review = this.teamsTracker.review;
    const devil = this.teamsTracker.devil;
    const audit = this.teamsTracker.audit;
    const goal = this.teamsTracker.goal;

    let teamStatus = '';
    const fragments: string[] = [];
    if (review) fragments.push(`R:${review}`);
    if (devil) fragments.push(`D:${devil}`);
    if (audit) fragments.push(`A:${audit}`);
    if (goal) fragments.push(`G:${goal}`);
    if (fragments.length > 0) {
      teamStatus = fragments.join(' ');
    } else if (active > 0) {
      teamStatus = `${active} active`;
    }

    if (teamStatus) {
      this.header.update({ teamStatus });
    }
  }

  private async updateTaskDetail(taskId: string): Promise<void> {
    // Use request token to handle out-of-order responses from rapid navigation
    const req = ++this.taskDetailReq;
    try {
      const [task, spec] = await Promise.all([
        getTask(taskId),
        getTaskSpec(taskId),
      ]);
      if (req !== this.taskDetailReq) return; // Stale request

      this.taskDetail.setTask(task);
      this.taskDetail.setSpec(spec);

      // Update receipts and block reason
      if (this.state.currentRun) {
        const [receipts, reason] = await Promise.all([
          getReceiptStatus(this.state.currentRun.path, taskId),
          task.status === "blocked"
            ? getBlockReason(taskId, this.state.currentRun.path)
            : Promise.resolve(null),
        ]);
        if (req !== this.taskDetailReq) return; // Stale request

        this.taskDetail.setReceipts(receipts);
        this.taskDetail.setBlockReason(
          task.status === "blocked" ? reason : null
        );
      }

      this.header.update({ task });
      this.tui?.requestRender();
    } catch {
      // Task may not exist - ignore
    }
  }

  render(width: number): string[] {
    const terminal = this.tui?.terminal;
    const height = terminal?.rows ?? 40;
    const isCompact = width < COMPACT_WIDTH || height < COMPACT_HEIGHT;

    // v0.3: Expertenmodus layout kicks in at ≥160 cols — roster becomes a
    // 26-col left sidebar, always visible.
    const WIDE_MODE_WIDTH = 160;
    const SIDEBAR_WIDTH = 26;
    const isWideMode = !isCompact && width >= WIDE_MODE_WIDTH;

    // Always refresh roster rows before the render loop consumes them.
    this.rosterPanel.setRows(this.teamsTracker.rosterSnapshot());

    // Calculate layout heights (clamp to avoid negative slice indices)
    // Header is 3 rows normally, 4 rows when token/team data is shown,
    // 5 rows at wide mode when we also get the epic/plan-review row.
    const hasTokenData =
      this.costTracker.totalCost > 0 ||
      this.teamsTracker.activeCount > 0 ||
      this.teamsTracker.review !== '';
    const hasRow3 = width >= 140 && this.state.currentRun !== undefined;
    const headerHeight = isCompact ? 1 : (hasTokenData ? (hasRow3 ? 5 : 4) : 3);
    const statusBarHeight = 1;
    const contentHeight = Math.max(0, height - headerHeight - statusBarHeight);

    // Update viewports
    if (!isCompact) {
      const taskPanelHeight = Math.floor(contentHeight * 0.4);
      const outputHeight = contentHeight - taskPanelHeight;
      this.taskDetail.setViewportHeight(taskPanelHeight);
      this.outputPanel.setViewportHeight(outputHeight);
    } else {
      this.outputPanel.setViewportHeight(contentHeight);
    }

    // Build lines
    const lines: string[] = [];

    // Header
    const headerLines = this.header.render(width);
    if (isCompact) {
      // Compact: single row header
      lines.push(headerLines[0] ?? "");
    } else {
      lines.push(...headerLines);
    }

    // Content area
    if (isCompact) {
      // Compact: full-width output only
      const outputLines = this.outputPanel.render(width);
      lines.push(...outputLines.slice(0, contentHeight));
    } else if (isWideMode) {
      // v0.3 wide mode: [Roster Sidebar | Task Split + Output]
      const mainWidth = width - SIDEBAR_WIDTH - 1; // 1 for separator
      const taskPanelHeight = Math.floor(contentHeight * 0.4);
      const outputHeight = contentHeight - taskPanelHeight;

      this.taskList.setMaxVisible(Math.max(1, taskPanelHeight - 2));
      this.taskDetail.setViewportHeight(taskPanelHeight);
      this.outputPanel.setViewportHeight(outputHeight);

      const rosterLines = this.rosterPanel.render(SIDEBAR_WIDTH);
      const taskLines = this.taskSplitPanel.render(mainWidth).slice(0, taskPanelHeight);
      const outputLines = this.outputPanel.render(mainWidth).slice(0, outputHeight);
      const mainLines = [...taskLines, ...outputLines];

      const sep = this.theme.border('│');
      const padRoster = (r: string) => {
        // Roster lines come pre-padded to SIDEBAR_WIDTH.
        return r;
      };
      for (let i = 0; i < contentHeight; i++) {
        const l =
          (rosterLines[i] ?? ' '.repeat(SIDEBAR_WIDTH)).padEnd(SIDEBAR_WIDTH);
        const r = mainLines[i] ?? ' '.repeat(mainWidth);
        lines.push(padRoster(l) + sep + r);
      }
    } else {
      // Normal: TaskList|TaskDetail + Roster strip (6 rows) + OutputPanel
      const taskPanelHeight = Math.floor(contentHeight * 0.36);
      const rosterStripHeight = Math.min(7, Math.max(5, contentHeight - taskPanelHeight - 10));
      // RosterPanel renders as borders + 5 rows = 7 lines. Give it 7 when possible.
      const effectiveRoster = Math.min(7, rosterStripHeight);
      const outputHeight = Math.max(
        3,
        contentHeight - taskPanelHeight - effectiveRoster
      );

      this.taskList.setMaxVisible(Math.max(1, taskPanelHeight - 2));
      this.taskDetail.setViewportHeight(taskPanelHeight);
      this.outputPanel.setViewportHeight(outputHeight);

      // Task split panel
      const taskLines = this.taskSplitPanel.render(width);
      lines.push(...taskLines.slice(0, taskPanelHeight));

      // Pad if task panel is shorter
      while (lines.length < headerHeight + taskPanelHeight) {
        lines.push(" ".repeat(width));
      }

      // Roster strip (v0.3) — 7 lines at most
      const rosterLines = this.rosterPanel.render(width);
      lines.push(...rosterLines.slice(0, effectiveRoster));
      while (lines.length < headerHeight + taskPanelHeight + effectiveRoster) {
        lines.push(" ".repeat(width));
      }

      // Output panel
      const outputLines = this.outputPanel.render(width);
      lines.push(...outputLines.slice(0, outputHeight));
    }

    // Status bar
    const statusLines = this.statusBar.render(width);
    lines.push(...statusLines);

    return lines;
  }

  handleInput(data: string): void {
    // Help overlay takes priority (handled by TUI overlay system)

    // ? - toggle help
    if (data === "?") {
      this.state.showHelp = !this.state.showHelp;
      if (this.state.showHelp) {
        this.helpOverlay.show();
        this.tui?.showOverlay(this.helpOverlay);
      } else {
        this.helpOverlay.hide();
        this.tui?.hideOverlay();
      }
      return;
    }

    // q or Ctrl+C - quit
    if (matchesKey(data, "q") || data === "\x03") {
      this.cleanup();
      this.tui?.stop();
      process.exit(0);
    }

    // v0.3: `s` — snapshot the current frame to /tmp for partner-demo sharing.
    if (data === "s" || matchesKey(data, "s")) {
      this.captureSnapshot();
      return;
    }

    // j/k navigation - forward to task list
    if (
      matchesKey(data, "j") ||
      matchesKey(data, "k") ||
      matchesKey(data, "up") ||
      matchesKey(data, "down")
    ) {
      this.taskList.handleInput(data);
      return;
    }

    // Other keys to output panel (scrolling)
    this.outputPanel.handleInput(data);
  }

  invalidate(): void {
    this.header.invalidate();
    this.taskList.invalidate();
    this.taskDetail.invalidate();
    this.outputPanel.invalidate();
    this.statusBar.invalidate();
    this.helpOverlay.invalidate();
  }
}

/**
 * Create and run the TUI app
 */
export async function createApp(options: AppOptions = {}): Promise<void> {
  const theme = getTheme(options.light);
  const useAscii = options.noEmoji ?? false;

  // Initial state
  const state: AppState = {
    runs: [],
    currentRun: undefined,
    tasks: [],
    selectedTaskIndex: 0,
    outputBuffer: [],
    iteration: 0,
    elapsed: 0,
    showHelp: false,
    error: undefined,
  };

  // Validate prerequisites
  const repoRoot = await findRepoRoot();

  // Check .flow/ exists
  const flowDir = join(repoRoot, ".flow");
  if (!(await dirExists(flowDir))) {
    renderError(
      "No .flow/ directory. Run flowctl init or ensure you're in a jenaai-flow project.",
      theme
    );
    process.exit(1);
  }

  // Check scripts/ralph/ exists
  const ralphDir = join(repoRoot, "scripts", "ralph");
  if (!(await dirExists(ralphDir))) {
    renderError(
      "No scripts/ralph/. Run /jenaai-flow:ralph-init to scaffold Ralph.",
      theme
    );
    process.exit(1);
  }

  // Discover runs
  try {
    state.runs = await discoverRuns();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    renderError(`Failed to discover runs: ${msg}`, theme);
    process.exit(1);
  }

  // Select run
  if (options.run) {
    // User specified run
    const run = state.runs.find((r) => r.id === options.run);
    if (!run) {
      renderError(
        `Run '${options.run}' not found. Available: ${state.runs.map((r) => r.id).join(", ") || "none"}`,
        theme
      );
      process.exit(1);
    }
    state.currentRun = run;
  } else if (state.runs.length > 0) {
    // Auto-select latest
    state.currentRun = getLatestRun(state.runs);
  } else {
    // No runs - prompt to start Ralph
    const shouldStart = await promptStartRalph(theme);
    if (shouldStart) {
      try {
        // Need an epic to start Ralph - check for open epics
        const epics = await getEpics();
        const openEpics = epics.filter((e) => e.status === "open");

        if (openEpics.length === 0) {
          renderError(
            "No open epics. Create an epic first with flowctl epic create.",
            theme
          );
          process.exit(1);
        }

        // Use first open epic
        const epicId = openEpics[0]?.id;
        if (!epicId) {
          renderError("No epic ID found.", theme);
          process.exit(1);
        }

        console.log(theme.dim(`Starting Ralph on ${epicId}...`));
        const result = await spawnRalph(epicId);
        console.log(
          theme.success(`Ralph started: ${result.runId} (pid ${result.pid})`)
        );

        // Re-discover runs and validate we found the new one
        state.runs = await discoverRuns();
        state.currentRun = state.runs.find((r) => r.id === result.runId);
        if (!state.currentRun) {
          renderError(
            `Started Ralph but run '${result.runId}' not found in discovery.`,
            theme
          );
          process.exit(1);
        }
      } catch (err) {
        if (err instanceof RalphNotFoundError) {
          renderError(err.message, theme);
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          renderError(`Failed to start Ralph: ${msg}`, theme);
        }
        process.exit(1);
      }
    } else {
      renderError(
        "No runs found. Start Ralph with: cd scripts/ralph && ./ralph.sh",
        theme
      );
      process.exit(1);
    }
  }

  // Load initial epics/tasks
  let epic: Epic | undefined; // First epic (for header display)
  let currentTask: Task | undefined;
  let taskSpec = "";

  try {
    const epicIds = state.currentRun?.epics ?? [];
    const { tasks } = await fetchAllTasks(epicIds);
    state.tasks = tasks;

    // Get first epic for header display (if any)
    const actualEpicIds =
      epicIds.length > 0
        ? epicIds
        : tasks
            .map((t) => t.id.split(".")[0])
            .filter((v, i, a) => a.indexOf(v) === i);
    const firstEpicId = actualEpicIds[0];
    if (firstEpicId) {
      epic = await getEpic(firstEpicId).catch(() => undefined);
    }

    // iteration is 0-indexed, runs.ts counts files; use max(0, count-1) for correct initial value
    // LogWatcher will update to actual value when it starts
    if (state.currentRun) {
      state.iteration = Math.max(0, state.currentRun.iteration - 1);
    }

    // Find current task (first in_progress or first todo)
    const inProgress = state.tasks.find((t) => t.status === "in_progress");
    const firstTodo = state.tasks.find((t) => t.status === "todo");
    const activeTask = inProgress ?? firstTodo;

    if (activeTask) {
      state.selectedTaskIndex = state.tasks.findIndex(
        (t) => t.id === activeTask.id
      );
      currentTask = await getTask(activeTask.id);
      taskSpec = await getTaskSpec(activeTask.id);
    }
  } catch (err) {
    // Fail fast with clean error instead of broken UI state
    const msg =
      err instanceof FlowctlNotFoundError
        ? err.message
        : `Failed to load tasks: ${err instanceof Error ? err.message : String(err)}`;
    renderError(msg, theme);
    process.exit(1);
  }

  // Create app component
  const app = new App(state, theme, useAscii, epic, currentTask, taskSpec);

  // Create terminal and TUI
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  // Wire up
  app.setTui(tui);
  tui.addChild(app);
  tui.setFocus(app);

  // Set up watchers and polling
  app.setupLogWatcher();
  app.setupPolling();

  // Handle process signals
  process.on("SIGINT", () => {
    app.cleanup();
    tui.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    app.cleanup();
    tui.stop();
    process.exit(0);
  });

  // Start log watcher
  await app.startLogWatcher();

  // Start TUI
  tui.start();

  // Keep process alive
  await new Promise(() => {});
}

/**
 * Create placeholder task for initial state
 */
function createPlaceholderTask(): Task {
  return {
    id: "fn-0.0",
    epic: "fn-0",
    title: "No task selected",
    status: "todo",
    depends_on: [],
    spec_path: "",
    priority: null,
    assignee: null,
    claim_note: "",
    claimed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Render error and exit
 */
function renderError(message: string, theme: Theme): void {
  console.error(theme.error(`Error: ${message}`));
}

/**
 * Prompt user to start Ralph
 */
async function promptStartRalph(theme: Theme): Promise<boolean> {
  // Check if ralph.sh exists first
  const result = await findRalphScript();
  if (!result) {
    return false; // Can't start Ralph anyway
  }

  console.log(theme.warning("No runs found."));
  console.log(theme.dim("Start Ralph now? [y/n]"));

  // Read single character from stdin
  return new Promise((resolve) => {
    const { stdin } = process;

    // Check if stdin is a TTY
    if (!stdin.isTTY) {
      resolve(false);
      return;
    }

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onData = (key: string): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);

      if (key === "y" || key === "Y") {
        resolve(true);
      } else {
        resolve(false);
      }
    };

    stdin.on("data", onData);
  });
}
