import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// ───────────────────────────────────────────────────────────────────────────
// Interfaces — AI extraction (no class-validator, raw JSON from the model)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Plan row emitted by `member_roster_ocr`. Free-form price/currency/duration:
 * the scanner may emit nulls when the source document does not state them
 * explicitly. Caller must NOT invent values for null fields.
 */
export interface ExtractedPlan {
  name: string | null;
  price?: number | null;
  currency?: string | null;
  duration_days?: number | null;
  raw_period_label?: string | null;
}

/**
 * Single member row emitted by `member_roster_ocr`. The bulk-importer pipeline
 * (analyze → commit) drives `action`, `existing_customer_id`, `resolved_status`,
 * `resolved_period_start`, `resolved_period_end`, `plan_ref`, `status`,
 * `warnings` and `errors` from this raw payload. `plan_name` MUST match an
 * entry in the document's `detected_plans[].name` to be auto-resolved.
 */
export interface ExtractedMember {
  first_name: string | null;
  last_name: string | null;
  document_type: string | null;
  document_number: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  gender: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  medical_notes: string | null;
  goals: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  plan_name: string | null;
  membership_start_date: string | null;
  membership_end_date: string | null;
  raw_row: string | null;
}

/**
 * Top-level payload emitted by `member_roster_ocr`. Mirrors the JSON schema
 * encoded in the AI app's system prompt (see Block 1 of the plan).
 */
export interface RosterScanResult {
  document_type: string;
  detected_plans: ExtractedPlan[];
  members: ExtractedMember[];
  warnings: string[];
  confidence: number;
}

// ───────────────────────────────────────────────────────────────────────────
// Analysis — server-side match result returned by `analyzeRoster`
// ───────────────────────────────────────────────────────────────────────────

/** A membership plan candidate from the store's catalog. */
export interface PlanCandidate {
  id: number;
  name: string;
  code?: string | null;
  confidence: number;
}

/**
 * Server-side resolution for a single detected plan. `matched_plan_id` is
 * populated only when `status === 'existing'`. `candidates` is the top-5 list
 * so the UI can offer "mapear a existente" (Decisión 4).
 */
export interface PlanMatch {
  /** Index into the original `RosterScanResult.detected_plans[]`. */
  ref_index: number;
  /**
   * `existing` — high-confidence match (≥65). `partial` — medium match (≥30)
   * with candidates for manual pick. `new` — no match in this store.
   */
  status: 'existing' | 'partial' | 'new';
  matched_plan_id?: number | null;
  /** 0-100 confidence score; mirrors the invoice scanner tier scale. */
  confidence: number;
  candidates: PlanCandidate[];
}

/**
 * Per-member analysis row. Adds the bulk-import pipeline's resolution on top
 * of the raw `ExtractedMember`. Field names mirror Block 2's `analyzeRoster`
 * contract verbatim so the frontend modal can bind directly.
 */
export interface AnalyzedMember extends ExtractedMember {
  /** 1-based row number from the original scan (NOT 0-indexed). */
  row_number: number;
  /**
   * `reuse` — an existing customer was matched (by document or email).
   * `create` — no match; a new customer will be created on commit.
   */
  action: 'reuse' | 'create';
  existing_customer_id?: number | null;
  /**
   * Resolved plan id (FK to `membership_plans.id`) OR `null` if the member
   * did not declare a plan / the plan was not auto-resolved. `null` ⇒
   * the user MUST assign a plan before commit (the row is marked `warning`).
   */
  plan_ref: number | null;
  /**
   * Server-resolved initial membership status per Decisión 2 (the `active` /
   * `expired` / `pending_payment` rule). The frontend keeps this editable
   * per row; the commit DTO carries the user-confirmed value, not this one.
   */
  resolved_status: 'active' | 'expired' | 'pending_payment' | null;
  /** ISO date (YYYY-MM-DD) or null. Same editability rule as `resolved_status`. */
  resolved_period_start: string | null;
  resolved_period_end: string | null;
  /**
   * Per-row health flag:
   *  - `ready`   — has name+document AND a resolved plan; safe to commit.
   *  - `warning` — needs user input (plan assign, ambiguous match, duplicate).
   *  - `error`   — invalid row (missing both name and document); MUST skip.
   */
  status: 'ready' | 'warning' | 'error';
  warnings: string[];
  errors: string[];
}

export interface MemberRosterAnalysis {
  plans: PlanMatch[];
  members: AnalyzedMember[];
  ready_count: number;
  with_warnings_count: number;
  with_errors_count: number;
  /** Warnings the AI itself emitted in `RosterScanResult.warnings[]`. */
  global_warnings: string[];
}

// ───────────────────────────────────────────────────────────────────────────
// Commit DTOs — validated user-confirmed payload for `commitRoster`
// ───────────────────────────────────────────────────────────────────────────

export class CommitPlanDto {
  @IsInt()
  @Type(() => Number)
  ref_index!: number;

  @IsString()
  @IsIn(['existing', 'new'])
  status!: 'existing' | 'new';

  /** Required when `status === 'existing'`. */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  plan_id?: number;

  /** Required when `status === 'new'`. Auto-deduped against `(store_id, code)`. */
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  price?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  duration_days?: number;

  /**
   * Default kind for memberships created against this plan during commit.
   * `gym` / `generic` / `service`. Not persisted on the plan itself — the
   * scanner mirror includes it for `MembershipsService.createFromImport`.
   */
  @IsOptional()
  @IsString()
  @IsIn(['gym', 'generic', 'service'])
  kind?: 'gym' | 'generic' | 'service';
}

export class CommitMemberDto {
  @IsInt()
  @Type(() => Number)
  row_number!: number;

  /** Index into the parent `CommitMemberRosterDto.plans[]`. */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  plan_ref_index?: number;

  /** Required when `action === 'reuse'`. */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  existing_customer_id?: number;

  @IsOptional()
  @IsString()
  first_name?: string;

  @IsOptional()
  @IsString()
  last_name?: string;

  @IsOptional()
  @IsString()
  document_type?: string;

  @IsOptional()
  @IsString()
  document_number?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsISO8601()
  date_of_birth?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  emergency_contact_name?: string;

  @IsOptional()
  @IsString()
  emergency_contact_phone?: string;

  @IsOptional()
  @IsString()
  medical_notes?: string;

  @IsOptional()
  @IsString()
  goals?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  height_cm?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  weight_kg?: number;

  /**
   * Initial membership status (Decisión 2). Caller-overridable per row.
   * Restricted to the three values the bulk-import rule may produce; the
   * other `membership_status_enum` values (`suspended`, `frozen`,
   * `cancelled`) require a real lifecycle transition and are not seeded
   * here.
   */
  @IsString()
  @IsIn(['active', 'expired', 'pending_payment'])
  status!: 'active' | 'expired' | 'pending_payment';

  @IsOptional()
  @IsISO8601()
  period_start?: string;

  @IsOptional()
  @IsISO8601()
  period_end?: string;

  @IsOptional()
  @IsBoolean()
  auto_renew?: boolean;
}

export class CommitMemberRosterDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CommitPlanDto)
  plans!: CommitPlanDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CommitMemberDto)
  members!: CommitMemberDto[];
}

// ───────────────────────────────────────────────────────────────────────────
// Commit result — pure response shape (no validation needed, internal types)
// ───────────────────────────────────────────────────────────────────────────

export interface CommitMemberResult {
  row_number: number;
  status: 'success' | 'error' | 'skipped';
  membership_id?: number;
  customer_id?: number;
  /** Human-readable error message; surfaced in the toast summary. */
  error?: string;
}

export interface CommitMemberRosterResult {
  /** Total member rows received from the caller. */
  ready: number;
  succeeded: number;
  failed: number;
  results: CommitMemberResult[];
  /**
   * Plans that failed to create on the first phase abort the whole commit —
   * no members are persisted when this list is non-empty.
   */
  plan_errors: Array<{ ref_index: number; error: string }>;
}