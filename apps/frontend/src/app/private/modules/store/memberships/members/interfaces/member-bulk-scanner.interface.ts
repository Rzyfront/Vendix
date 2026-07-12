/**
 * Member Bulk Scanner Interfaces
 *
 * Mirror of the backend bulk-roster AI scanner contract exposed under
 * `/store/memberships/bulk-scan` (3-phase flow: scan → analyze → commit).
 *
 * Phase 1 — `scanRoster(file)` returns the raw OCR-shaped extraction.
 * Phase 2 — `analyzeRoster(scan)` reconciles detected plans against existing
 *           plans and detects existing customers; produces a row-by-row
 *           readiness classification (ready / warning / error).
 * Phase 3 — `commitRoster(dto)` performs best-effort creation: plans first,
 *           then per-member customer + membership + profile.
 */

import { GymMembershipStatus } from './membership.interface';

// ============================================================================
// Phase 1 — Extraction
// ============================================================================

export type RosterDocumentType =
  | 'member_roster'
  | 'spreadsheet_photo'
  | 'membership_card'
  | 'contract'
  | 'id_document'
  | 'signup_sheet'
  | 'other';

/** A membership plan (tariff) detected in the source document. */
export interface ExtractedPlan {
  name: string;
  price: number | null;
  currency: string | null;
  duration_days: number | null;
  raw_period_label: string | null;
}

/** A member detected in the source document. */
export interface ExtractedMember {
  first_name: string | null;
  last_name: string | null;
  /**
   * Normalized to DIAN codes by the AI (`CC`, `CE`, `TI`, `PA`, `NIT`).
   * Falls back to `null` when the column is missing.
   */
  document_type: string | null;
  document_number: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  gender: 'masculino' | 'femenino' | 'otro' | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  medical_notes: string | null;
  goals: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  /**
   * MUST match a `detected_plans[].name` when the member has an associated
   * plan. Backend validates this during analyze and the modal surfaces
   * warnings for unassigned plans.
   */
  plan_name: string | null;
  /** ISO date — when the membership began in the real world. */
  membership_start_date: string | null;
  /** ISO date — membership expiry; drives status resolution. */
  membership_end_date: string | null;
  raw_row: string | null;
}

/**
 * Raw OCR result returned by `POST /store/memberships/bulk-scan`. Mirrors
 * the system_prompt JSON schema enforced by the backend.
 */
export interface RosterScanResult {
  document_type: RosterDocumentType;
  detected_plans: ExtractedPlan[];
  members: ExtractedMember[];
  warnings: string[];
  /** 0–100 calibration; low values surface a banner in the review step. */
  confidence: number;
}

// ============================================================================
// Phase 2 — Analysis (reconciliation)
// ============================================================================

export type PlanMatchStatus = 'existing' | 'new' | 'partial';

/** A live plan in this store that fuzzy-matches a detected plan. */
export interface PlanCandidate {
  id: number;
  code: string;
  name: string;
  /** Decimal string from the backend (matches `GymPlan.price`). */
  price: number | string;
  currency: string;
  duration_days: number;
  confidence: number;
}

export interface PlanMatch {
  /**
   * Stable reference index into `RosterScanResult.detected_plans` and the
   * back-end `CommitMemberRosterDto.plans[].ref_index`. Preserved across
   * phases so the modal can rebuild the commit DTO.
   */
  ref_index: number;
  status: PlanMatchStatus;
  matched_plan_id?: number;
  confidence: number;
  candidates: PlanCandidate[];
}

export type AnalyzedMemberStatus = 'ready' | 'warning' | 'error';
export type MemberAction = 'create' | 'reuse';

/**
 * Analysis row: an `ExtractedMember` enriched with per-row backend state
 * (action, reuse target, resolved dates & status, readiness classification).
 */
export interface AnalyzedMember extends ExtractedMember {
  /** Stable index in `RosterScanResult.members` — used to rebuild the DTO. */
  row_number: number;
  /**
   * `reuse` if the customer already exists in this organization (matched
   * by document number or email); `create` otherwise. Backend dedups.
   */
  action: MemberAction;
  /** Set when `action === 'reuse'`. */
  existing_customer_id?: number;
  /** Points at `PlanMatch.ref_index` when assigned; null if unresolved. */
  plan_ref: number | null;
  /**
   * Status calculated by the backend per Decision 2:
   * - `active`           → date_end present, still in the future
   * - `expired`          → date_end present, already in the past
   * - `pending_payment`  → no date_end (to be charged via renew)
   */
  resolved_status: GymMembershipStatus;
  resolved_period_start: string | null;
  resolved_period_end: string | null;
  status: AnalyzedMemberStatus;
  warnings: string[];
  errors: string[];
  /**
   * User opt-out: row remains in the analysis but is skipped during commit.
   * Defaults to `false` (include). The modal exposes a toggle per row.
   */
  excluded?: boolean;
}

export interface MemberRosterAnalysis {
  plans: PlanMatch[];
  members: AnalyzedMember[];
  /** Rows safe to commit (name/doc present + a resolved plan). */
  ready_count: number;
  /** Rows needing user attention (unassigned plan, ambiguous match, duplicate). */
  with_warnings_count: number;
  /** Invalid rows (missing both name AND document); skipped on commit. */
  with_errors_count: number;
  /**
   * Warnings the AI itself emitted in `RosterScanResult.warnings[]` (e.g. low
   * OCR confidence, illegible columns, document type that may need review).
   */
  global_warnings: string[];
}

// ============================================================================
// Phase 3 — Commit (validated, user-editable)
// ============================================================================

/**
 * Plan decision sent to the backend. Either:
 * - `status: 'existing'` → reuse `plan_id`, OR
 * - `status: 'new'`      → create with code/name/price/duration.
 */
export interface CommitPlanDto {
  ref_index: number;
  status: 'existing' | 'new';
  plan_id?: number;
  code?: string;
  name?: string;
  price?: number;
  currency?: string;
  duration_days?: number;
}

/**
 * Per-row commit decision. Personal fields are explicitly listed (not picked
 * up from `RosterScanResult.members[].row_number`) so the user can edit them
 * inline before the commit. Status + period_* are also user-editable (the
 * backend allows `active` membership without an order for historical data).
 */
export interface CommitMemberDto {
  row_number: number;
  plan_ref_index: number | null;
  /** Set when the analyzer found a reusable customer and the user keeps it. */
  existing_customer_id?: number;
  first_name: string | null;
  last_name: string | null;
  document_type: string | null;
  document_number: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  gender: 'masculino' | 'femenino' | 'otro' | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  medical_notes: string | null;
  goals: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  /**
   * User override for the resolved status. The backend persists the value
   * verbatim (active memberships are treated as migrated data with no
   * source_order_id).
   */
  status: GymMembershipStatus;
  period_start: string | null;
  /** `null` for `pending_payment` memberships without expiry. */
  period_end: string | null;
}

/** Top-level commit payload. */
export interface CommitMemberRosterDto {
  plans: CommitPlanDto[];
  members: CommitMemberDto[];
}

/** Per-member commit outcome — echoed back so the UI can report failures. */
export interface CommitMemberResult {
  row_number: number;
  status: 'success' | 'error' | 'skipped';
  customer_id?: number;
  membership_id?: number;
  /** Human-readable error message; surfaced in the toast summary. */
  error?: string;
}

export interface CommitMemberRosterResult {
  /** Total member rows the backend received. */
  ready: number;
  succeeded: number;
  failed: number;
  results: CommitMemberResult[];
  /**
   * Plans that failed to create on the first (atomic) phase abort the whole
   * commit — when this array is non-empty, NO member rows were persisted.
   */
  plan_errors: Array<{ ref_index: number; error: string }>;
}
