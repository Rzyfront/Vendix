/**
 * F5 — Shared contract of a Vex write batch (`ai_agent_write_batches`).
 *
 * One batch = up to {@link WRITE_BATCH_MAX_STEPS} reversible writes the person
 * approves with ONE click. Lifecycle:
 *
 *   proposed ──approve (atomic claim)──▶ executing ──▶ applied
 *      │                                    │      └──▶ partially_applied (stopped at first failure)
 *      │                                    │      └──▶ failed            (first step failed, nothing applied)
 *      │                                    └─────────▶ unknown_effect    (a step's effect could not be verified)
 *      ├──reject──▶ rejected
 *      └──TTL─────▶ expired
 *
 * Rules every writer keeps (do not relax them):
 *  - Each step passes the T13 role gate (`AIToolRegistry.previewForConsent`)
 *    BEFORE the batch is proposed. One denied step = no batch at all.
 *  - Irreversible tools (`AIToolRegistry.isIrreversible` or the plan service's
 *    domain match) never enter a batch: they keep their own confirmation card.
 *  - The executor claims the batch with ONE conditional update
 *    (`status='proposed'` → `executing`). A second approval (double click, two
 *    tabs) loses the claim and returns the current state; it never re-runs.
 *  - Steps run in order; the first failure stops the batch. Every step that did
 *    not run ends in a TERMINAL status (`skipped` / `unselected`), never
 *    `pending` or `running`.
 *  - Undo exists only for steps whose tool declares `compensate` and only within
 *    {@link WRITE_BATCH_UNDO_WINDOW_MS}; everything else reads "no reversible
 *    desde Vex".
 */

/** D1: one approval covers at most this many steps. */
export const WRITE_BATCH_MAX_STEPS = 25;
/** D1: records affected across one batch (sum of each preview's reach). */
export const WRITE_BATCH_MAX_RECORDS = 500;
/** A proposed batch not approved within this window expires. */
export const WRITE_BATCH_TTL_MS = 30 * 60 * 1000;
/** "Deshacer" is offered for this long after the batch finished. */
export const WRITE_BATCH_UNDO_WINDOW_MS = 30 * 60 * 1000;

export type WriteBatchStatus =
  | 'proposed'
  | 'executing'
  | 'applied'
  | 'partially_applied'
  | 'failed'
  | 'unknown_effect'
  | 'rejected'
  | 'expired';

export const WRITE_BATCH_TERMINAL_STATUSES: readonly WriteBatchStatus[] = [
  'applied',
  'partially_applied',
  'failed',
  'unknown_effect',
  'rejected',
  'expired',
];

export type WriteBatchStepStatus =
  /** Proposed, waiting for the approval. */
  | 'pending'
  /** The executor is running it right now. */
  | 'running'
  | 'applied'
  | 'failed'
  /** Its effect could not be verified: blocks the batch, needs review. */
  | 'unknown'
  /** Not run because an earlier step failed or was unknown. */
  | 'skipped'
  /** The person unticked it in the card. */
  | 'unselected'
  /** Rejected / expired batch: never ran. */
  | 'cancelled'
  /** Undo claimed and running (transient, like `running`). */
  | 'compensating'
  /** Applied, then undone through its tool's `compensate`. */
  | 'compensated'
  /** Undo was attempted and failed: the step remains applied. */
  | 'compensation_failed';

export const WRITE_BATCH_STEP_TERMINAL_STATUSES: readonly WriteBatchStepStatus[] =
  [
    'applied',
    'failed',
    'unknown',
    'skipped',
    'unselected',
    'cancelled',
    'compensated',
    'compensation_failed',
  ];

/** One proposed change as the model sends it to `propose_write_batch`. */
export interface WriteBatchStepInput {
  tool: string;
  arguments: Record<string, unknown>;
  /** Short human label: "Subir 5 % Coca Cola 1L". */
  label: string;
  /** step_ids of earlier steps this one needs (informational ordering). */
  depends_on?: string[];
}

/** Before → after projection kept from the tool's real `preview()`. */
export interface WriteBatchStepPreview {
  status: 'ok' | 'warning';
  target: string;
  changes: Array<{ field: string; label: string; from: unknown; to: unknown }>;
  message?: string;
  domain?: string;
}

/** One step persisted in `ai_agent_write_batches.steps` (jsonb array). */
export interface WriteBatchStepRecord {
  /** `s1` … `sN`, stable across the batch's life. */
  step_id: string;
  /** 1-based execution order. */
  order: number;
  tool: string;
  arguments: Record<string, unknown>;
  label: string;
  depends_on?: string[];
  /** sha256 of canonical JSON of {tool, arguments} (same canonicalJson as plan-approval). */
  args_hash: string;
  /** `toolPreviewHash(preview)` from ai-tool-registry. */
  preview_hash: string;
  tool_version: string;
  preview: WriteBatchStepPreview;
  /** Records this step reaches (1 unless the tool's own batch reaches N). */
  affected_records: number;
  /** True when the tool declares `compensate` (undo is honest for it). */
  compensable: boolean;
  status: WriteBatchStepStatus;
  /** `vex-batch:<batch_id>:<step_id>` — idempotency key in ai_agent_effects. */
  operation_id?: string;
  /** Human one-liner of what happened (never raw tool output). */
  result_summary?: string;
  /** Human error line (never a stack trace). */
  error?: string;
  /** Opaque state `compensate.capture` returned before the step ran. */
  compensation_snapshot?: unknown;
  started_at?: string;
  finished_at?: string;
  compensated_at?: string;
}

/** `ai_agent_write_batches.summary` once the batch reached a terminal status. */
export interface WriteBatchSummary {
  applied: number;
  failed: number;
  unknown: number;
  skipped: number;
  unselected: number;
  compensable: number;
  /** Highest order that was applied (0 when nothing ran). */
  applied_through_order: number;
  /**
   * The sentence the person reads (D2), e.g.
   * "Se aplicó hasta el paso 2, el resto se omitió." /
   * "Se aplicaron los 3 cambios." / "No se aplicó ningún cambio."
   */
  message: string;
}

/** Client-safe projection returned by every `/store/vex/batches` endpoint. */
export interface WriteBatchView {
  id: string;
  conversation_id: number | null;
  goal: string;
  status: WriteBatchStatus;
  part_index: number;
  part_total: number;
  group_id: string | null;
  step_count: number;
  affected_records: number;
  steps: Array<
    Omit<
      WriteBatchStepRecord,
      'compensation_snapshot' | 'args_hash' | 'preview_hash'
    > & { can_undo: boolean }
  >;
  summary: WriteBatchSummary | null;
  approved_at: string | null;
  finished_at: string | null;
  expires_at: string;
  /** Until when "Deshacer" is offered (null when nothing is compensable). */
  undo_until: string | null;
  created_at: string;
}

/** Operation id of one batch step in `ai_agent_effects` (idempotency key). */
export function writeBatchOperationId(batchId: string, stepId: string): string {
  return `vex-batch:${batchId}:${stepId}`;
}
