import type { LogEntry } from './types';

/**
 * Tool icons for display - Unicode symbols for visual appeal
 * Use with width-based padding for alignment
 */
export const TOOL_ICONS = {
  Read: '▸', // file read (triangle pointer)
  Write: '◂', // file write (triangle pointer left)
  Glob: '◦', // pattern search (hollow bullet)
  Grep: '⌕', // content search (search icon) - falls back to /
  Edit: '✎', // edit operation (pencil)
  Bash: '$', // command execution (shell prompt - ASCII)
  Task: '◈', // agent task (diamond)
  WebFetch: '⬇', // web fetch (down arrow)
  WebSearch: '◎', // web search (bullseye)
  success: '✓', // success checkmark
  failure: '✗', // failure X
  // v1.5 claude-team review signals
  'review-reviewer': '⚖', // primary reviewer verdict (scales)
  'review-devil': '🗡', // devil's advocate verdict (dagger)
  'review-auditor': '🔎', // auditor verdict (magnifier)
  'review-goal': '🎯', // goal-gate score (target)
  // v0.2.1 extended-thinking mirror
  thinking: '💭', // reasoning/thinking stream
} as const;

/**
 * ASCII fallbacks for --no-emoji mode
 */
export const ASCII_ICONS = {
  Read: '>',
  Write: '<',
  Glob: '?',
  Grep: '/',
  Edit: '*',
  Bash: '$',
  Task: '@',
  WebFetch: 'v',
  WebSearch: '?',
  success: '+',
  failure: 'x',
  'review-reviewer': 'V',
  'review-devil': 'D',
  'review-auditor': 'A',
  'review-goal': 'G',
  thinking: '~',
} as const;

/**
 * Raw JSON line types from Claude --output-format stream-json
 *
 * Actual format has top-level types: "assistant", "user", "system", "result"
 * with nested message.content arrays containing blocks.
 */

interface ContentBlock {
  type: string;
  name?: string; // tool_use
  input?: unknown; // tool_use
  text?: string; // text block
  thinking?: string; // thinking block
  content?: unknown; // tool_result content
  is_error?: boolean; // tool_result error flag
}

interface MessageWrapper {
  content?: ContentBlock[];
}

interface StreamJsonLine {
  type: string;
  message?: MessageWrapper;
}

/**
 * Safely coerce a value to string (handles non-string content from runtime JSON)
 */
function coerceToString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value == null) {
    return '';
  }
  try {
    return JSON.stringify(value);
  } catch {
    // oxlint-disable-next-line no-base-to-string -- fallback for circular refs, [object Object] is acceptable
    return String(value);
  }
}

/**
 * Get icon for a tool (or success/failure indicator)
 * @param tool Tool name or 'success'/'failure'
 * @param ascii Use ASCII fallbacks instead of unicode
 */
export function getIcon(tool: string, ascii = false): string {
  const icons = ascii ? ASCII_ICONS : TOOL_ICONS;
  if (tool in icons) {
    return icons[tool as keyof typeof icons];
  }
  // Default icon for unknown tools
  return ascii ? '@' : '◈';
}

/**
 * Get icon for a LogEntry (uses tool name or success/failure state)
 * @param entry LogEntry to get icon for
 * @param ascii Use ASCII fallbacks instead of unicode
 */
export function iconForEntry(
  entry: { type: string; tool?: string; success?: boolean; reviewSignal?: string },
  ascii = false
): string {
  // Thinking entries get the bubble icon (v0.2.1)
  if (entry.type === 'thinking') {
    return getIcon('thinking', ascii);
  }
  // For review-signal entries, use dedicated stage icons (v1.5+)
  if (entry.type === 'review-signal' && entry.reviewSignal) {
    switch (entry.reviewSignal) {
      case 'verdict':
        return getIcon('review-reviewer', ascii);
      case 'devil-verdict':
        return getIcon('review-devil', ascii);
      case 'audit-verdict':
        return getIcon('review-auditor', ascii);
      case 'goal-score':
        return getIcon('review-goal', ascii);
    }
  }
  // For tool entries, use tool name
  if (entry.type === 'tool' && entry.tool) {
    return getIcon(entry.tool, ascii);
  }
  // For response/error entries, use success state
  if (entry.success === false) {
    return getIcon('failure', ascii);
  }
  if (entry.success === true) {
    return getIcon('success', ascii);
  }
  // Default for text responses
  return ascii ? '@' : '◈';
}

/**
 * Parse a single JSON line from stream-json format
 * @param line Raw JSON string
 * @returns LogEntry array (may return multiple for assistant messages with multiple blocks)
 */
export function parseLine(line: string): LogEntry | null {
  const entries = parseLineMulti(line);
  return entries.length > 0 ? (entries[0] ?? null) : null;
}

/**
 * Regex patterns for the claude-team review signal tags.
 *
 * The 3-agent + goal-gate pipeline (v1.5+) emits these in the final text block
 * of each reviewer's response. The TUI parses them independently so it can
 * show the pipeline state even when the receipt JSON hasn't been written yet.
 */
const REVIEW_SIGNAL_PATTERNS: Array<{
  kind: 'verdict' | 'devil-verdict' | 'audit-verdict' | 'goal-score';
  re: RegExp;
}> = [
  { kind: 'verdict', re: /<verdict>(SHIP|NEEDS_WORK|MAJOR_RETHINK)<\/verdict>/g },
  { kind: 'devil-verdict', re: /<devil-verdict>(APPROVE|OBJECT)<\/devil-verdict>/g },
  {
    kind: 'audit-verdict',
    re: /<audit-verdict>(PASS|MINOR|MAJOR|CRITICAL)<\/audit-verdict>/g,
  },
  { kind: 'goal-score', re: /<goal-score>(\d{1,3})<\/goal-score>/g },
];

/**
 * Scan a text block for review-signal tags and emit one LogEntry per match.
 * Used for assistant text blocks and user tool_result blocks that contain the
 * final output of claude-team reviewers.
 */
export function detectReviewSignals(text: string): LogEntry[] {
  if (!text) return [];
  const out: LogEntry[] = [];
  for (const { kind, re } of REVIEW_SIGNAL_PATTERNS) {
    const matches = text.matchAll(re);
    for (const m of matches) {
      const value = m[1];
      if (value === undefined) continue;
      out.push({
        type: 'review-signal',
        content: `${kind}=${value}`,
        reviewSignal: kind,
        reviewValue: value,
        success: kind === 'goal-score' ? parseInt(value, 10) >= 80 : undefined,
      });
    }
  }
  return out;
}

/**
 * Parse a line returning all entries (assistant messages can have multiple tool_use blocks)
 */
export function parseLineMulti(line: string): LogEntry[] {
  const trimmed = line.trim();
  if (!trimmed) {
    return [];
  }

  let parsed: StreamJsonLine;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
    return [];
  }

  const entries: LogEntry[] = [];
  const blocks = parsed.message?.content ?? [];

  switch (parsed.type) {
    case 'assistant': {
      // Extract tool_use and text blocks from assistant message
      for (const block of blocks) {
        if (block.type === 'tool_use') {
          const tool = typeof block.name === 'string' ? block.name : 'unknown';
          entries.push({
            type: 'tool',
            tool,
            content: formatToolInput(tool, block.input),
          });
        } else if (block.type === 'text' && block.text) {
          const text = coerceToString(block.text);
          entries.push({ type: 'response', content: text });
          // v1.5+: surface claude-team review verdicts before the receipt lands
          for (const signal of detectReviewSignals(text)) {
            entries.push(signal);
          }
        } else if (block.type === 'thinking' && block.thinking) {
          // v0.2.1: mirror extended-thinking blocks so you can see what the
          // agent is reasoning about in real time. The stream-json emits
          // thinking as its own block type alongside text and tool_use.
          entries.push({
            type: 'thinking',
            content: coerceToString(block.thinking),
          });
        }
      }
      break;
    }

    case 'user': {
      // Extract tool_result blocks from user message
      for (const block of blocks) {
        if (block.type === 'tool_result') {
          const content = coerceToString(block.content);
          entries.push({
            type: 'response',
            content,
            success: !block.is_error,
          });
          // v1.5+: reviewer subagents deliver their verdict inside tool_result
          for (const signal of detectReviewSignals(content)) {
            entries.push(signal);
          }
        }
      }
      break;
    }

    case 'result': {
      // Final result message with token usage
      const resultObj = parsed as {
        result?: string;
        cost_usd?: number;
        total_cost_usd?: number;
        is_error?: boolean;
        model?: string;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        };
      };
      const resultContent = resultObj.result;
      const entry: LogEntry = {
        type: 'response',
        content: coerceToString(resultContent ?? ''),
        success: !resultObj.is_error,
      };

      // Extract token usage
      if (resultObj.usage) {
        entry.usage = {
          inputTokens: resultObj.usage.input_tokens ?? 0,
          outputTokens: resultObj.usage.output_tokens ?? 0,
          cacheReadTokens: resultObj.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: resultObj.usage.cache_creation_input_tokens ?? 0,
        };
      }
      if (resultObj.cost_usd != null) entry.costUsd = resultObj.cost_usd;
      if (resultObj.total_cost_usd != null) entry.totalCostUsd = resultObj.total_cost_usd;
      if (resultObj.model) entry.model = resultObj.model;

      entries.push(entry);
      break;
    }

    // Skip system messages - not useful for TUI display
  }

  return entries;
}

/**
 * Format tool input for display
 */
function formatToolInput(tool: string, input: unknown): string {
  if (!input || typeof input !== 'object') {
    return tool;
  }

  const obj = input as Record<string, unknown>;

  // Helper to safely get string value with key aliases
  const getString = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const val = obj[key];
      if (typeof val === 'string') return val;
    }
    return undefined;
  };

  // Extract meaningful info per tool type (with common aliases)
  switch (tool) {
    case 'Read':
    case 'Write':
    case 'Edit': {
      const filePath = getString('file_path', 'path', 'file');
      return filePath ? `${tool}: ${filePath}` : tool;
    }

    case 'Glob':
    case 'Grep': {
      const pattern = getString('pattern', 'glob', 'query', 'regex');
      return pattern ? `${tool}: ${pattern}` : tool;
    }

    case 'Bash': {
      const command = getString('command', 'cmd');
      // Don't pre-truncate - let output panel truncate based on width
      return command ? `${tool}: ${command}` : tool;
    }

    case 'Task': {
      const description = getString('description', 'prompt', 'task');
      return description ? `${tool}: ${description}` : tool;
    }

    case 'WebFetch':
    case 'WebSearch': {
      const url = getString('url', 'uri');
      const query = getString('query', 'q', 'search');
      return url ? `${tool}: ${url}` : query ? `${tool}: ${query}` : tool;
    }

    default: {
      // Fallback: show first string value from input
      // Don't pre-truncate - let output panel handle based on width
      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (typeof val === 'string' && val.length > 0) {
          return `${tool}: ${val}`;
        }
      }
      return tool;
    }
  }
}

/**
 * Parse multiple lines at once
 * @param lines Array of JSON strings
 * @returns Array of valid LogEntry objects (invalid lines filtered out)
 */
export function parseLines(lines: string[]): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of lines) {
    entries.push(...parseLineMulti(line));
  }
  return entries;
}

/**
 * Parse a chunk of text containing multiple newline-separated JSON lines
 * @param chunk Raw text chunk (may contain partial lines)
 * @returns Object with parsed entries and any remaining partial line
 */
export function parseChunk(chunk: string): {
  entries: LogEntry[];
  remainder: string;
} {
  const lines = chunk.split('\n');
  const entries: LogEntry[] = [];

  // Last line may be incomplete - preserve it as remainder
  let remainder = lines.pop() ?? '';

  for (const line of lines) {
    entries.push(...parseLineMulti(line));
  }

  // Try parsing remainder - if valid JSON, it's complete (no trailing newline)
  if (remainder) {
    const lastEntries = parseLineMulti(remainder);
    if (lastEntries.length > 0) {
      entries.push(...lastEntries);
      remainder = '';
    }
  }

  return { entries, remainder };
}
