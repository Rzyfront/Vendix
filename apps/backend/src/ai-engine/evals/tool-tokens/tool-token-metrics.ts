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
