/**
 * F10 (T63/T64) — `vendix.codemode/v1`: contract between the trusted host
 * (Vendix backend) and the isolated AWS Lambda that runs AI-written
 * JavaScript which composes READ-ONLY Vendix tools ("Code Mode").
 *
 * Channel A of the plan (odd/tasks/vex-agente-avanzado.md §F10.3 a):
 * re-invocation with pending calls and deterministic replay.
 *
 * - The Lambda has no network, no IAM permissions besides the ENI management
 *   its VPC requires, no secrets and no database. It NEVER executes a tool.
 * - Each round the host invokes the Lambda with the same source, the manifest
 *   and a COPY of the journal. The script runs from the start; every
 *   `tools.<name>(args)` call gets a deterministic `seq` (1, 2, 3… in call
 *   order). A call whose `seq` is in the journal with the same tool and the
 *   same `args_hash` resolves with the journaled outcome; a mismatch fails
 *   with `CODEMODE_REPLAY_DIVERGENCE`; a call not in the journal stays
 *   pending. When no more progress is possible the round ends with
 *   `pending`, `completed` or `error`.
 * - Between rounds the HOST executes the pending calls with the authority of
 *   the session (manifest, policy, schema, scoped registry, audit) and
 *   appends them to its own server-side journal. The host never reads a
 *   journal coming from the Lambda: the response has no journal field and
 *   any unknown key is a protocol error.
 * - The store, organization and user are fixed by the host from the session.
 *   Nothing in this contract lets the script name a tenant.
 *
 * The Lambda side (`infra/agent-sandbox/js/`) mirrors these shapes, the
 * canonical JSON rules and the test vectors below; any change here must be
 * mirrored there and in its tests.
 */
import { createHash } from 'node:crypto';
import { SANDBOX_LIMITS } from './sandbox-protocol.interface';

export const CODEMODE_PROTOCOL = 'vendix.codemode/v1' as const;

/** Plain JSON value. Functions, undefined, NaN and Infinity never cross. */
export type CodeModeJson =
  | string
  | number
  | boolean
  | null
  | CodeModeJson[]
  | { [key: string]: CodeModeJson };

export interface CodeModeLimits {
  /** Host wall time for the whole execution (all rounds + tool calls). */
  wall_ms: number;
  /** Interpreter CPU per round inside the Lambda (interrupt handler). */
  round_cpu_ms: number;
  /** Interpreter heap per round inside the Lambda. */
  memory_mb: number;
  /** Tool calls per execution (all rounds). */
  calls: number;
  /** Lambda invocations per execution. */
  rounds: number;
  /** Max pending calls returned by one round (lowest `seq` first). */
  pending_per_round: number;
  /** Max tools in the manifest. */
  manifest_tools: number;
  /** Max rows per tool result handed to the script. */
  rows: number;
  source_bytes: number;
  /** Serialized journal sent to the Lambda (far below the 6 MB sync cap). */
  journal_bytes: number;
  /** Serialized args of one call (same cap as the stdio broker frames). */
  args_bytes: number;
  /** Serialized `result` the host hands back to the model. */
  result_bytes: number;
  /** Total console output returned. */
  log_bytes: number;
  /** Whole Lambda response body. */
  output_bytes: number;
  /** UI blocks a script may emit with `vex.block()`. */
  blocks: number;
}

export const CODEMODE_LIMITS: Readonly<CodeModeLimits> = Object.freeze({
  wall_ms: SANDBOX_LIMITS.wall_ms,
  round_cpu_ms: SANDBOX_LIMITS.cpu_ms,
  memory_mb: SANDBOX_LIMITS.memory_mb,
  calls: SANDBOX_LIMITS.calls,
  rounds: 6,
  pending_per_round: 8,
  manifest_tools: 20,
  rows: SANDBOX_LIMITS.rows,
  source_bytes: SANDBOX_LIMITS.source_bytes,
  journal_bytes: SANDBOX_LIMITS.input_bytes,
  args_bytes: 16 * 1024,
  result_bytes: 8 * 1024,
  log_bytes: 2 * 1024,
  output_bytes: SANDBOX_LIMITS.output_bytes,
  blocks: 5,
});

/** N15: scripts are also offered in normal turns, at most 3 per turn. */
export const CODEMODE_SCRIPTS_PER_TURN = 3;

/** What a journaled call resolves to inside the script. */
export type CodeModeJournalOutcome =
  | { ok: true; value: CodeModeJson }
  /** Safe, bounded (<= 300 chars) text; the script sees a rejected promise. */
  | { ok: false; error: string };

export interface CodeModeJournalEntry {
  seq: number;
  tool: string;
  /** `codeModeArgsHash(args)` of the args the HOST executed. */
  args_hash: string;
  outcome: CodeModeJournalOutcome;
}

/**
 * Payload the host sends to the Lambda each round (InvocationType
 * RequestResponse, `TenantId` = opaque per-store key, never the store id).
 *
 * Script model: `source` is the BODY of an async function. Its `return`
 * value is the result. Injected globals only: `tools` (frozen object with one
 * async function per manifest name), `console` (log/info/warn/error, captured
 * and bounded), `vex.block(block)` (queues an untrusted UI block the host
 * validates), plus the language built-ins (JSON, Math, …). No `require`,
 * `process`, `fetch`, timers, file system or network. `Date` is frozen at
 * `clock_ms` and `Math.random` is a PRNG seeded with `seed`.
 */
export interface CodeModeRoundRequest {
  protocol: typeof CODEMODE_PROTOCOL;
  execution_id: string;
  /** 64 hex chars; the response must echo it. */
  nonce: string;
  /** 1-based round number; the response must echo it. */
  round: number;
  language: 'javascript';
  source: string;
  /** Tool names the script may call (subset of the turn's authorized tools). */
  manifest: string[];
  /** Copy of the server-side journal, ascending contiguous `seq` from 1. */
  journal: CodeModeJournalEntry[];
  /** Frozen wall clock (ms since epoch) for `Date`. */
  clock_ms: number;
  /** 64 hex chars seeding `Math.random`. Same for every round. */
  seed: string;
  limits: CodeModeLimits;
}

export interface CodeModePendingCall {
  /** Must continue the journal: journal.length + 1, +2, … contiguous. */
  seq: number;
  /** Must be in the manifest. */
  tool: string;
  /** Plain JSON object. The host recomputes its hash; the Lambda sends none. */
  args: { [key: string]: CodeModeJson };
}

export type CodeModeGuestErrorCode =
  | 'CODEMODE_INPUT'
  | 'CODEMODE_SYNTAX'
  | 'CODEMODE_RUNTIME'
  | 'CODEMODE_TIMEOUT'
  | 'CODEMODE_MEMORY'
  | 'CODEMODE_STALLED'
  | 'CODEMODE_REPLAY_DIVERGENCE'
  | 'CODEMODE_LIMIT'
  | 'CODEMODE_OUTPUT';

/** Lambda response body. Exact keys; anything else is CODEMODE_PROTOCOL. */
export interface CodeModeRoundResponse {
  protocol: typeof CODEMODE_PROTOCOL;
  execution_id: string;
  nonce: string;
  round: number;
  /** Image digest the function reports (`sha256:<64 hex>`), checked by host. */
  runtime_digest: string;
  status: 'pending' | 'completed' | 'error';
  /** status = pending: 1..pending_per_round calls, ascending contiguous seq. */
  pending?: CodeModePendingCall[];
  /** status = completed: the script's return value (null when none). */
  result?: CodeModeJson;
  /** status = completed: untrusted blocks queued with `vex.block()`. */
  blocks?: CodeModeJson[];
  /** Bounded console output (any status). */
  logs?: string[];
  error_code?: CodeModeGuestErrorCode;
  /** Bounded (<= 500 chars), already stripped of paths by the Lambda. */
  error_message?: string;
  usage?: { duration_ms: number; cpu_ms?: number; max_rss_mb?: number };
}

/** Host-side failure codes surfaced to the tool (never raw guest text). */
export type CodeModeFailureCode =
  | 'CODEMODE_UNAVAILABLE'
  | 'CODEMODE_DENIED'
  | 'CODEMODE_PROTOCOL'
  | 'CODEMODE_EXPIRED'
  | 'CODEMODE_TENANT_CHANGED'
  | CodeModeGuestErrorCode;

export class CodeModeError extends Error {
  constructor(
    readonly code: CodeModeFailureCode,
    /** Safe, bounded detail for the model (e.g. a JS exception line). */
    readonly detail?: string,
  ) {
    super(code);
  }
}

/** What `run_code` asks the bridge to execute. */
export interface CodeModeRunRequest {
  source: string;
  /** Manifest: read-only allowlisted tools authorized in this turn. */
  tools: string[];
  /** Short purpose shown in the audit and in «Ver cómo lo calculé». */
  purpose: string;
}

export interface CodeModeCallSummary {
  seq: number;
  tool: string;
  status: 'ok' | 'error' | 'denied';
  rows: number;
  duration_ms: number;
}

export interface CodeModeRunResult {
  run_id: string;
  source_hash: string;
  /** The script's return value, capped at `result_bytes` serialized. */
  result: CodeModeJson;
  result_truncated: boolean;
  logs: string[];
  calls: CodeModeCallSummary[];
  rows_seen: number;
  rounds: number;
  /** Untrusted until validated by the Vex block service. */
  blocks: CodeModeJson[];
  usage: { duration_ms: number };
}

/**
 * Port the tool depends on (implemented by CodeModeBridgeService).
 * `available()` is false unless the Lambda is enabled, configured AND
 * certified for the deployed digest (T69).
 */
export interface CodeModeRunner {
  available(): boolean;
  run(request: CodeModeRunRequest): Promise<CodeModeRunResult>;
}

/**
 * Canonical JSON shared by both sides: object keys sorted with the default
 * JS sort (UTF-16 code units), arrays in order, no whitespace, primitives via
 * JSON.stringify. Non-finite numbers and non-JSON values throw.
 */
export function codeModeCanonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value))
        throw new CodeModeError('CODEMODE_PROTOCOL', 'non-finite number');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value))
        return `[${value.map((item) => codeModeCanonicalJson(item)).join(',')}]`;
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${codeModeCanonicalJson(record[key])}`,
        )
        .join(',')}}`;
    }
    default:
      throw new CodeModeError('CODEMODE_PROTOCOL', 'non-JSON value');
  }
}

/** sha256 hex of the canonical JSON of the call args. */
export function codeModeArgsHash(args: unknown): string {
  return createHash('sha256')
    .update(codeModeCanonicalJson(args), 'utf8')
    .digest('hex');
}

/** Shared vectors: both implementations must reproduce them exactly. */
export const CODEMODE_HASH_VECTORS: ReadonlyArray<{
  args: CodeModeJson;
  canonical: string;
  sha256: string;
}> = Object.freeze([
  {
    args: { b: 1, a: [{ d: 2, c: 'x' }], ñ: 'é' },
    canonical: '{"a":[{"c":"x","d":2}],"b":1,"ñ":"é"}',
    sha256: '8eb4d2289bb29772b51463f3c628b3c74ccb6ab372535e311d7bbd6b06c02497',
  },
  {
    args: {},
    canonical: '{}',
    sha256: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
  },
]);
