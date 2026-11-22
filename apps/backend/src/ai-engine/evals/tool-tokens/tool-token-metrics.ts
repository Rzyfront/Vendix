/**
 * Pure metrics for the tool-token baseline (T60). No model, DB, network or
 * server: every number comes from the repository's own bytes-based estimator
 * (`estimateAgentInputTokens`, `bytes_v1`), which is deliberately pessimistic
 * and NOT a tokenizer. Never report these as provider-observed tokens.
 */
import type {
  AIMessage,
  AIToolDefinition,
} from '../../interfaces/ai-provider.interface';
import { estimateAgentInputTokens } from '../../context/agent-context-budget';
import { buildToolSuccessEnvelope } from '../../tools/interfaces/tool.interface';

/** Estimator tag, the same one the turn trace records (`token_estimator`). */
export const TOKEN_ESTIMATOR = 'bytes_v1';

/** Output placeholder for the closing answer of every trajectory (assumption). */
export const FINAL_ANSWER_OUTPUT_BYTES = 600;

export type TaskKind = 'single' | 'multi_step';

export interface OracleCall {
  tool: string;
  /** Arguments the model would send; sized as the assistant tool-call message. */
  args?: Record<string, unknown>;
  /** Expected result row count (list tools); defaults to the fixture's. */
  rows?: number;
}
/** Calls issued in the same model turn (one round-trip). */
export type OracleGroup = OracleCall[];

export interface BankTask {
  id: string;
  source: string;
  message: string;
  kind: TaskKind;
  oracle: { groups: OracleGroup[] };
}

/** One realistic result per tool, shaped like the handler output. */
export interface ResultFixture {
  /** Key of the envelope that holds the rows, or null for a scalar result. */
  rows_key: string | null;
  envelope: Record<string, unknown>;
  sample_row?: Record<string, unknown>;
  default_rows?: number;
  /** handler_shape: read from the handler; service_shape_approx: the row is
   * approximated; assumed_shape: handler not read, shape assumed. */
  fidelity: 'handler_shape' | 'service_shape_approx' | 'assumed_shape';
  derived_from: string;
}

export function fixtureResult(fixture: ResultFixture, rows?: number): string {
  if (fixture.rows_key === null || !fixture.sample_row)
    return JSON.stringify(fixture.envelope);
  const count = Math.max(0, Math.floor(rows ?? fixture.default_rows ?? 1));
  return JSON.stringify({
    ...fixture.envelope,
    [fixture.rows_key]: Array.from({ length: count }, () => fixture.sample_row),
  });
}

/** One model call per sequential group, plus the call that writes the answer. */
export function roundTrips(groups: OracleGroup[]): number {
  return groups.length + 1;
}

export interface TrajectoryInput {
  base: AIMessage[];
  groups: OracleGroup[];
  fixtures: Record<string, ResultFixture>;
  /** Tool definitions offered to round `k` (0 = turn 0). */
  toolsForRound: (round: number) => AIToolDefinition[];
  /**
   * Config 1: the leading messages of round `k` (the stubs message changes per
   * round). Absent = `base` on every round, which is what config 0 measures.
   */
  baseForRound?: (round: number) => AIMessage[];
  /** Result text of a call when it is not a fixture (e.g. `describe_tool`). */
  resultFor?: (call: OracleCall) => string | undefined;
}

export interface TrajectoryMeasure {
  round_trips: number;
  input_by_round: number[];
  input_total: number;
  output_estimate: number;
  intermediate_result_bytes: number;
}

export function measureTrajectory(input: TrajectoryInput): TrajectoryMeasure {
  const history: AIMessage[] = [];
  const input_by_round: number[] = [];
  let output = FINAL_ANSWER_OUTPUT_BYTES;
  let intermediate = 0;
  for (let round = 0; round <= input.groups.length; round++) {
    input_by_round.push(
      estimateAgentInputTokens(
        [...(input.baseForRound?.(round) ?? input.base), ...history],
        input.toolsForRound(round),
      ),
    );
    const group = input.groups[round];
    if (!group) break;
    const calls = group.map((call, i) => ({
      id: `call_${round}_${i}`,
      type: 'function' as const,
      function: {
        name: call.tool,
        arguments: JSON.stringify(call.args ?? {}),
      },
    }));
    history.push({ role: 'assistant', content: '', tool_calls: calls });
    output += Buffer.byteLength(JSON.stringify(calls), 'utf8');
    group.forEach((call, i) => {
      const fixture = input.fixtures[call.tool];
      const override = input.resultFor?.(call);
      if (!fixture && override === undefined)
        throw new Error(`No result fixture for tool ${call.tool}`);
      const content = override ?? fixtureResult(fixture, call.rows);
      intermediate += Buffer.byteLength(content, 'utf8');
      history.push({
        role: 'tool',
        tool_call_id: calls[i].id,
        content,
      });
    });
  }
  return {
    round_trips: roundTrips(input.groups),
    input_by_round,
    input_total: input_by_round.reduce((a, b) => a + b, 0),
    output_estimate: output,
    intermediate_result_bytes: intermediate,
  };
}

/** Structural success proxy: every oracle tool exists and is authorized. */
export function successProxy(
  oracleTools: string[],
  authorized: ReadonlySet<string>,
  known: ReadonlySet<string>,
): { reachable: boolean; missing: string[]; unauthorized: string[] } {
  const unique = [...new Set(oracleTools)];
  const missing = unique.filter((t) => !known.has(t)).sort();
  const unauthorized = unique
    .filter((t) => known.has(t) && !authorized.has(t))
    .sort();
  return {
    reachable: !missing.length && !unauthorized.length,
    missing,
    unauthorized,
  };
}

export interface TaskTotals {
  tasks: number;
  input_total: number;
  output_estimate: number;
  round_trips: number;
  reachable: number;
}

export function summarizeByKind(
  rows: Array<{
    kind: TaskKind;
    input_total: number;
    output_estimate: number;
    round_trips: number;
    reachable: boolean;
  }>,
): Record<TaskKind | 'all', TaskTotals> {
  const empty = (): TaskTotals => ({
    tasks: 0,
    input_total: 0,
    output_estimate: 0,
    round_trips: 0,
    reachable: 0,
  });
  const out = { single: empty(), multi_step: empty(), all: empty() };
  for (const row of rows)
    for (const bucket of [out[row.kind], out.all]) {
      bucket.tasks += 1;
      bucket.input_total += row.input_total;
      bucket.output_estimate += row.output_estimate;
      bucket.round_trips += row.round_trips;
      bucket.reachable += row.reachable ? 1 : 0;
    }
  return out;
}

/** The bank must be well-formed before anything is measured. */
export function assertBank(tasks: BankTask[]): void {
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) throw new Error(`Duplicate task id ${task.id}`);
    seen.add(task.id);
    const groups = task.oracle?.groups ?? [];
    if (!groups.length || groups.some((g) => !g.length))
      throw new Error(`Task ${task.id} has an empty trajectory`);
    const expected: TaskKind = groups.length === 1 ? 'single' : 'multi_step';
    if (task.kind !== expected)
      throw new Error(
        `Task ${task.id}: kind ${task.kind} contradicts its ${groups.length} sequential group(s) (expected ${expected})`,
      );
  }
}

// ── Config 2 (T70): Code Mode scripts ──────────────────────────────────────

/** Mirrors CODEMODE_LIMITS.result_bytes and CODE_PREVIEW_ROWS (code-execution.tools.ts). */
export const SCRIPT_RESULT_BYTES = 8 * 1024;
export const SCRIPT_PREVIEW_ROWS = 5;
/** Mirrors the routing rule: 3+ chained reads, or intermediate data past ~50 rows. */
export const SCRIPT_MIN_CALLS = 3;
export const SCRIPT_MIN_ROWS = 50;

/** A task can run as one script only if all its tools are allowlisted reads. */
export function scriptability(
  tools: string[],
  allowlist: ReadonlySet<string>,
  writeTools: ReadonlySet<string>,
): { scriptable: boolean; blockers: string[] } {
  const blockers: string[] = [];
  for (const tool of [...new Set(tools)]) {
    if (writeTools.has(tool)) blockers.push(`write:${tool}`);
    else if (!allowlist.has(tool)) blockers.push(`not_in_allowlist:${tool}`);
  }
  return { scriptable: blockers.length === 0, blockers };
}

/** The model-facing routing rule: a script pays off with 3+ calls or 50+ rows. */
export function shouldScript(input: {
  calls: number;
  intermediateRows: number;
}): boolean {
  return (
    input.calls >= SCRIPT_MIN_CALLS ||
    input.intermediateRows >= SCRIPT_MIN_ROWS
  );
}

/**
 * Representative script derived only from the planned calls: one await per
 * sequential group (Promise.all for parallel ones) and a generic slimming
 * return (5-row preview + row count per list). Never tuned per task.
 */
export function buildScriptSource(groups: OracleGroup[]): string {
  const call = (c: OracleCall) =>
    `tools.${c.tool}(${JSON.stringify(c.args ?? {})})`;
  const lines = groups.map((group, i) =>
    group.length === 1
      ? `const g${i} = [await ${call(group[0])}];`
      : `const g${i} = await Promise.all([${group.map(call).join(', ')}]);`,
  );
  lines.push(
    "const slim = (v) => { const o = {}; for (const [k, x] of Object.entries(v ?? {})) { if (Array.isArray(x)) { o[k] = x.slice(0, 5); o[k + '_rows'] = x.length; } else o[k] = x; } return o; };",
    `return [${groups.map((_, i) => `...g${i}`).join(', ')}].map(slim);`,
  );
  return lines.join('\n');
}

/**
 * What the model receives back from `run_code` (same envelope as
 * `createCodeModeTools`): slimmed per-call results bounded to 8 KiB.
 */
export function scriptResultText(
  callResults: string[],
  tools: string[] = [],
): string {
  const calls: Array<{ seq: number; tool: string; status: string; rows: number }> =
    [];
  const slimmed = callResults.map((text, i) => {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let rows = 0;
    for (const [key, value] of Object.entries(parsed ?? {})) {
      if (Array.isArray(value)) {
        out[key] = value.slice(0, SCRIPT_PREVIEW_ROWS);
        out[`${key}_rows`] = value.length;
        rows += value.length;
      } else out[key] = value;
    }
    calls.push({ seq: i + 1, tool: tools[i] ?? `call_${i + 1}`, status: 'ok', rows });
    return out;
  });
  const text = JSON.stringify(slimmed);
  const truncated = Buffer.byteLength(text, 'utf8') > SCRIPT_RESULT_BYTES;
  const result = truncated
    ? Buffer.from(text, 'utf8')
        .subarray(0, SCRIPT_RESULT_BYTES - 64)
        .toString('utf8')
    : slimmed;
  return JSON.stringify(
    buildToolSuccessEnvelope('run_code', {
      status: 'ok',
      result,
      ...(truncated ? { result_truncated: true } : {}),
      logs: [],
      calls,
      rows_seen: calls.reduce((a, c) => a + c.rows, 0),
    }),
  );
}

export interface ScriptedInput {
  /** Leading messages: system prompt + digest, the routing-rule message, the user turn. */
  base: AIMessage[];
  groups: OracleGroup[];
  fixtures: Record<string, ResultFixture>;
  /** The turn's definitions plus `run_code`; the same on both rounds. */
  definitions: AIToolDefinition[];
  purpose: string;
}

/** One script turn: round 0 asks for run_code, round 1 writes the answer. */
export function measureScriptedTrajectory(
  input: ScriptedInput,
): TrajectoryMeasure {
  const calls = input.groups.flat();
  const results = calls.map((call) => {
    const fixture = input.fixtures[call.tool];
    if (!fixture) throw new Error(`No result fixture for tool ${call.tool}`);
    return fixtureResult(fixture, call.rows);
  });
  const toolCalls = [
    {
      id: 'call_script_0',
      type: 'function' as const,
      function: {
        name: 'run_code',
        arguments: JSON.stringify({
          source: buildScriptSource(input.groups),
          tools: [...new Set(calls.map((c) => c.tool))],
          purpose: input.purpose,
        }),
      },
    },
  ];
  const history: AIMessage[] = [
    { role: 'assistant', content: '', tool_calls: toolCalls },
    {
      role: 'tool',
      tool_call_id: 'call_script_0',
      content: scriptResultText(
        results,
        calls.map((c) => c.tool),
      ),
    },
  ];
  const input_by_round = [
    estimateAgentInputTokens(input.base, input.definitions),
    estimateAgentInputTokens([...input.base, ...history], input.definitions),
  ];
  return {
    round_trips: 2,
    input_by_round,
    input_total: input_by_round[0] + input_by_round[1],
    output_estimate:
      FINAL_ANSWER_OUTPUT_BYTES +
      Buffer.byteLength(JSON.stringify(toolCalls), 'utf8'),
    intermediate_result_bytes: results.reduce(
      (a, r) => a + Buffer.byteLength(r, 'utf8'),
      0,
    ),
  };
}
