/**
 * F9 (T51/T52) — "data in → JSON out" contract between the trusted host and
 * the isolated AWS Lambda that runs AI-written Python (pandas/numpy/statsmodels).
 *
 * The Lambda has no network, no IAM permissions, no secrets and no database.
 * It never calls tools: the host materializes the inputs (blocks of the SAME
 * conversation), invokes the function, validates the output against this
 * schema and turns it into Vex blocks. Generated code NEVER runs in the API
 * process or in the backend worker.
 *
 * The Python side (`infra/agent-sandbox/python/`) mirrors these shapes; any
 * change here must be mirrored there and in its tests.
 */

export const ANALYSIS_PROTOCOL = 'vendix.analysis/v1' as const;

export interface AnalysisLimits {
  /** Host-side wall time for the whole invocation (Lambda timeout is larger). */
  wall_ms: number;
  /** Child-process CPU seconds inside the Lambda (RLIMIT_CPU). */
  cpu_s: number;
  /** Child-process address space inside the Lambda (RLIMIT_AS). */
  memory_mb: number;
  source_bytes: number;
  input_bytes: number;
  input_tables: number;
  input_rows: number;
  input_columns: number;
  output_bytes: number;
  output_tables: number;
  output_series: number;
  output_figures: number;
  output_rows: number;
  output_points: number;
}

export const ANALYSIS_LIMITS: Readonly<AnalysisLimits> = Object.freeze({
  wall_ms: 25_000,
  cpu_s: 15,
  memory_mb: 768,
  source_bytes: 32 * 1024,
  input_bytes: 2 * 1024 * 1024,
  input_tables: 5,
  input_rows: 5_000,
  input_columns: 50,
  output_bytes: 256 * 1024,
  output_tables: 5,
  output_series: 6,
  output_figures: 20,
  output_rows: 1_000,
  output_points: 1_000,
});

export type AnalysisCell = string | number | boolean | null;

/** One input dataset. In Python it arrives as `inputs[name]` (pandas DataFrame). */
export interface AnalysisInputTable {
  /** Python identifier: ^[a-z][a-z0-9_]{0,39}$ */
  name: string;
  columns: string[];
  rows: AnalysisCell[][];
}

/** Payload the host sends to the Lambda (InvocationType RequestResponse). */
export interface AnalysisRequest {
  protocol: typeof ANALYSIS_PROTOCOL;
  execution_id: string;
  /** 64 hex chars; the response must echo it. */
  nonce: string;
  language: 'python';
  /** Python body. It reads `inputs` and must assign `result = {...}`. */
  source: string;
  inputs: AnalysisInputTable[];
  limits: AnalysisLimits;
}

export interface AnalysisOutputTable {
  title: string;
  columns: string[];
  rows: Array<Array<string | number | null>>;
}

export interface AnalysisOutputSeries {
  title: string;
  chart: 'line' | 'bar' | 'scatter';
  x_label?: string;
  y_label?: string;
  /** Category or numeric x values, same length as every dataset. */
  x: Array<string | number>;
  datasets: Array<{ label: string; values: Array<number | null> }>;
}

export interface AnalysisOutputFigure {
  label: string;
  value: number | string | null;
  unit?: string;
}

/** What the generated code assigns to `result`. Validated on BOTH sides. */
export interface AnalysisOutput {
  tables?: AnalysisOutputTable[];
  series?: AnalysisOutputSeries[];
  figures?: AnalysisOutputFigure[];
  /** Short methodological notes (max 5, 300 chars each). */
  notes?: string[];
}

export type AnalysisErrorCode =
  | 'ANALYSIS_INPUT'
  | 'ANALYSIS_SYNTAX'
  | 'ANALYSIS_RUNTIME'
  | 'ANALYSIS_TIMEOUT'
  | 'ANALYSIS_MEMORY'
  | 'ANALYSIS_OUTPUT';

/** Lambda response body. */
export interface AnalysisResponse {
  protocol: typeof ANALYSIS_PROTOCOL;
  execution_id: string;
  nonce: string;
  /** Image digest the function reports (`sha256:<64 hex>`), checked by host. */
  runtime_digest: string;
  status: 'ok' | 'error';
  output?: AnalysisOutput;
  error_code?: AnalysisErrorCode;
  /** Bounded (<= 500 chars), already stripped of paths by the Lambda. */
  error_message?: string;
  usage?: { duration_ms: number; max_rss_mb?: number };
}

/** Host-side failure codes surfaced to the tool (never raw guest text). */
export type AnalysisFailureCode =
  | 'ANALYSIS_UNAVAILABLE'
  | 'ANALYSIS_DENIED'
  | 'ANALYSIS_LIMIT'
  | 'ANALYSIS_PROTOCOL'
  | 'ANALYSIS_EXPIRED'
  | AnalysisErrorCode;

export class AnalysisError extends Error {
  constructor(
    readonly code: AnalysisFailureCode,
    /** Safe, bounded detail for the model (e.g. a Python exception line). */
    readonly detail?: string,
  ) {
    super(code);
  }
}

/** What `run_analysis` asks the broker to execute. */
export interface AnalysisRunRequest {
  source: string;
  inputs: AnalysisInputTable[];
  purpose: 'projection' | 'correlation' | 'segmentation' | 'other';
}

export interface AnalysisRunResult {
  run_id: string;
  source_hash: string;
  output: AnalysisOutput;
  usage: { duration_ms: number };
}

/**
 * Port the tool depends on (implemented by SandboxAnalysisBrokerService).
 * `available()` is false unless the Lambda is configured AND certified (T53).
 */
export interface AnalysisRunner {
  available(): boolean;
  run(request: AnalysisRunRequest): Promise<AnalysisRunResult>;
}
