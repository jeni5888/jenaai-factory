// Task status types
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked';

// Epic status types (matches flowctl EPIC_STATUS: ["open", "done"])
export type EpicStatus = 'open' | 'done';

// Run state (derived from progress.txt)
export type RunState = 'running' | 'complete' | 'crashed';

// Log entry types for iter-*.log parsing
// 'review-signal' is emitted when the parser detects claude-team review verdicts
// (<verdict>, <devil-verdict>, <audit-verdict>, <goal-score>) in tool output.
// 'thinking' is emitted for extended-thinking blocks so the TUI can mirror the
// agent's reasoning stream live (v0.2.1+).
export type LogEntryType =
  | 'tool'
  | 'response'
  | 'error'
  | 'review-signal'
  | 'thinking';

// Subtypes for review-signal entries (claude-team 3-agent + goal-gate pipeline, v1.5+)
export type ReviewSignalKind =
  | 'verdict' // primary reviewer
  | 'devil-verdict' // devil's advocate
  | 'audit-verdict' // auditor (v1.5)
  | 'goal-score'; // requirement verifier (v1.5)

/**
 * Task as returned by flowctl show/tasks commands
 */
export interface Task {
  id: string; // fn-N.M or fn-N-xxx.M
  epic: string; // fn-N or fn-N-xxx
  title: string;
  status: TaskStatus;
  depends_on: string[];
  spec_path: string;
  priority: number | null;
  assignee: string | null;
  claim_note: string;
  claimed_at: string | null; // ISO timestamp
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
  evidence?: TaskEvidence;
}

/**
 * Task evidence recorded on completion
 * Note: flowctl can emit string or array for each field
 */
export interface TaskEvidence {
  commits: string | string[];
  tests: string | string[];
  prs: string | string[];
}

/**
 * Minimal task info in ready/blocked lists
 */
export interface TaskSummary {
  id: string;
  title: string;
  depends_on?: string[];
  blocked_by?: string[];
  assignee?: string;
}

/**
 * Task as embedded in Epic response (minimal fields)
 */
export interface EpicTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: number | null;
  depends_on: string[];
}

/**
 * Task as returned in flowctl tasks list (minimal fields)
 */
export interface TaskListItem {
  id: string;
  epic: string;
  title: string;
  status: TaskStatus;
  priority: number | null;
  depends_on: string[];
}

/**
 * Response from flowctl tasks command
 */
export interface TasksResponse {
  success: boolean;
  tasks: TaskListItem[];
  count: number;
}

/**
 * Epic list item as returned by flowctl epics --json
 * (minimal fields for listing)
 */
export interface EpicListItem {
  id: string; // fn-N or fn-N-xxx
  title: string;
  status: EpicStatus;
  tasks: number; // count of tasks
  done: number; // count of done tasks
}

/**
 * Response from flowctl epics command
 */
export interface EpicsResponse {
  success: boolean;
  epics: EpicListItem[];
  count: number;
}

/**
 * Epic as returned by flowctl show command
 */
export interface Epic {
  id: string; // fn-N or fn-N-xxx
  title: string;
  status: EpicStatus;
  branch_name: string | null; // can be null if not set
  spec_path: string;
  next_task: number;
  depends_on_epics: string[];
  plan_review_status: 'ship' | 'needs_work' | 'major_rethink' | 'unknown'; // flowctl default: "unknown"
  plan_reviewed_at: string | null; // ISO timestamp
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
  tasks: EpicTask[];
}

/**
 * Response from flowctl show <epic-id> --json
 * Wraps Epic with success boolean
 */
export interface EpicShowResponse extends Epic {
  success: boolean;
}

/**
 * Response from flowctl show <task-id> --json
 * Wraps Task with success boolean
 */
export interface TaskShowResponse extends Task {
  success: boolean;
}

/**
 * Ready response from flowctl ready command
 */
export interface ReadyResponse {
  success: boolean;
  epic: string;
  actor: string;
  ready: TaskSummary[];
  in_progress: TaskSummary[];
  blocked: TaskSummary[];
}

/**
 * Ralph run directory info
 */
export interface Run {
  id: string; // YYYYMMDDTHHMMSSZ-hostname-user-pid-rand (real) or YYYY-MM-DD-NNN (test)
  path: string; // full path to run dir
  epics: string[]; // epics being worked on (from run.json or progress.txt)
  active: boolean; // derived from progress.txt
  iteration: number; // current iteration number
  startedAt?: string; // ISO timestamp from run start
}

/**
 * Log entry from iter-*.log JSONL files
 */
export interface LogEntry {
  type: LogEntryType;
  tool?: string; // Read, Write, Bash, Edit, etc.
  content: string;
  success?: boolean;
  timestamp?: string; // ISO timestamp if available
  // Token usage from result messages (stream-json format)
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  costUsd?: number; // cost_usd from result message
  totalCostUsd?: number; // total_cost_usd from result message
  model?: string; // model identifier if available
  // Set when type === 'review-signal': which stage emitted the verdict
  reviewSignal?: ReviewSignalKind;
  // Literal value from the tag (e.g. "SHIP", "APPROVE", "CRITICAL", "87")
  reviewValue?: string;
}

/**
 * Review receipt from impl-review
 *
 * v1.5+ additions (all optional — v1.4 receipts stay valid):
 * - auditVerdict from jenaai-auditor (PASS|MINOR|MAJOR|CRITICAL)
 * - goalScore from jenaai-requirement-verifier (0–100)
 * - architecture from jenaai-architect feedback loop
 */
export interface ReviewReceipt {
  verdict: 'SHIP' | 'NEEDS_WORK' | 'MAJOR_RETHINK';
  timestamp: string;
  summary?: string;
  issues?: string[];
  mode?: 'claude-team' | 'codex' | 'rp' | 'export' | 'none';
  auditVerdict?: 'PASS' | 'MINOR' | 'MAJOR' | 'CRITICAL';
  goalScore?: number;
  architecture?: {
    scoreBefore?: number;
    scoreAfter?: number;
    delta?: string;
    bottleneck?: string;
  };
}

/**
 * flowctl validate response
 */
export interface ValidateResponse {
  success: boolean;
  epic: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  task_count: number;
}
