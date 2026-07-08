import { Injectable, Logger } from '@nestjs/common';
import { membership_status_enum } from '@prisma/client';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import { AIMessage } from '../../../ai-engine/interfaces/ai-provider.interface';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { MembershipPlansService } from '../membership-plans/membership-plans.service';
import { CustomersService } from '../customers/customers.service';
import { MembershipsService } from './memberships.service';
import { MemberProfilesService } from './member-profiles.service';
import {
  ExtractedMember,
  ExtractedPlan,
  MemberRosterAnalysis,
  AnalyzedMember,
  PlanMatch,
  RosterScanResult,
  CommitMemberRosterDto,
  CommitMemberRosterResult,
  CommitMemberResult,
} from './dto/scan-roster.dto';
import { UpsertMemberProfileDto } from './dto/upsert-member-profile.dto';
import sharp = require('sharp');

/**
 * MemberBulkScannerService — backend of the "Carga masiva de socios por IA"
 * feature. 1:1 calque of `InvoiceScannerService`/`RouteSheetScannerService`:
 *
 *   POST /store/memberships/bulk-scan        → `scanRoster`  (raw OCR)
 *   POST /store/memberships/bulk-scan/analyze → `analyzeRoster` (resolve plan/customer)
 *   POST /store/memberships/bulk-scan/commit  → `commitRoster` (persist)
 *
 * All three phases are best-effort per row inside `commitRoster` — except
 * plan creation, which is atomic (the whole commit aborts if any new plan
 * fails to persist).
 *
 * Customer creation, plan creation, membership creation and profile upsert
 * delegate to the existing services (`CustomersService.create`,
 * `MembershipPlansService.create`, `MembershipsService.createFromImport`,
 * `MemberProfilesService.upsert`). No Prisma mutations are duplicated.
 *
 * Tenant scope: this service uses `withoutScope()` + EXPLICIT `store_id`
 * predicates everywhere it talks to membership_plans / users directly,
 * matching the `MembershipsService` pattern (membership models are
 * `store_scoped_models` but the scoped extension does not provide the
 * upsert uniqueness guarantee we need, so we drop down to base client
 * and re-add `store_id` manually).
 */
@Injectable()
export class MemberBulkScannerService {
  private readonly logger = new Logger(MemberBulkScannerService.name);

  /** Hard cap driven by the AI app's `max_tokens` (≈200 rows). */
  private static readonly MAX_MEMBERS_PER_ROSTER = 200;

  /** Mimetypes accepted by both the file interceptor and `scanRoster`. */
  private static readonly ALLOWED_MIMETYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];

  constructor(
    private readonly aiEngine: AIEngineService,
    private readonly prisma: StorePrismaService,
    private readonly membershipPlansService: MembershipPlansService,
    private readonly membershipsService: MembershipsService,
    private readonly memberProfilesService: MemberProfilesService,
    private readonly customersService: CustomersService,
    private readonly responseService: ResponseService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // /scan
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Scan a roster document (planilla, photographed list, membership cards,
   * contracts) into a normalized `RosterScanResult`. Replicates the
   * invoice/route-sheet pipeline: validate → preprocess → multimodal
   * AI call → JSON parse → normalize. Does NOT persist anything.
   */
  async scanRoster(file: Express.Multer.File): Promise<RosterScanResult> {
    this.assertValidFile(file);

    const { base64, mimeType } = await this.preprocessImage(file);
    const dataUri = `data:${mimeType};base64,${base64}`;

    this.logger.debug(
      `[MemberRosterScan] Sending to AI engine (appKey=member_roster_ocr, size=${file.size}B)...`,
    );

    const imageMessage: AIMessage = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Extract all members and plans from this document. Return ONLY the JSON object matching the schema defined in your system instructions.',
        },
        {
          type: 'image_url',
          image_url: { url: dataUri, detail: 'high' },
        },
      ],
    };

    const response = await this.aiEngine.run('member_roster_ocr', {}, [
      imageMessage,
    ]);

    if (!response.success || !response.content) {
      this.logger.error(
        `[MemberRosterScan] AI failed: ${response.error ?? 'no content'}`,
      );
      throw new VendixHttpException(ErrorCodes.MEMBER_SCAN_AI_FAIL);
    }

    try {
      let content = response.content.trim();
      // Strip markdown code fences if present
      if (content.startsWith('```')) {
        content = content
          .replace(/^```(?:json)?\n?/, '')
          .replace(/\n?```$/, '');
      }
      const parsed = JSON.parse(content);
      return this.normalizeScanResponse(parsed);
    } catch (err: any) {
      if (err instanceof VendixHttpException) throw err;
      this.logger.error(
        `[MemberRosterScan] Failed to parse AI response: ${err?.message}`,
      );
      throw new VendixHttpException(ErrorCodes.MEMBER_SCAN_PARSE_FAIL);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // /analyze
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Resolve every extracted plan/member against the live catalog (plans,
   * customers, existing memberships). Returns the editable analysis payload
   * the frontend modal binds to. Never throws per row — collects per-row
   * warnings/errors into the `status` flag.
   */
  async analyzeRoster(scan: RosterScanResult): Promise<MemberRosterAnalysis> {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const members = Array.isArray(scan.members) ? scan.members : [];
    if (members.length === 0) {
      throw new VendixHttpException(ErrorCodes.MEMBER_BULK_EMPTY);
    }
    if (members.length > MemberBulkScannerService.MAX_MEMBERS_PER_ROSTER) {
      throw new VendixHttpException(ErrorCodes.MEMBER_BULK_TOO_MANY);
    }

    const plansInput = Array.isArray(scan.detected_plans)
      ? scan.detected_plans
      : [];

    // ── Plan matching ─────────────────────────────────────────────────────
    const existingPlans = await this.prisma
      .withoutScope()
      .membership_plans.findMany({
        where: { store_id: storeId },
        select: { id: true, code: true, name: true },
        take: 500,
      });

    const planMatches: PlanMatch[] = plansInput.map((p, idx) =>
      this.matchPlan(idx, p, existingPlans),
    );

    // Map detected_plans index → matched plan id (or null).
    const planRefByIndex = new Map<number, number | null>();
    planMatches.forEach((pm) => {
      planRefByIndex.set(pm.ref_index, pm.matched_plan_id ?? null);
    });

    // ── Member analysis ───────────────────────────────────────────────────
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const analyzed: AnalyzedMember[] = [];
    let ready = 0;
    let withWarnings = 0;
    let withErrors = 0;

    for (let i = 0; i < members.length; i++) {
      const raw = members[i];
      const row_number = i + 1;

      // 1) Customer resolution (document first, then email).
      let existingCustomerId: number | null = null;
      let action: 'reuse' | 'create' = 'create';

      if (raw.document_number) {
        const byDoc = await this.findCustomerByDocumentInOrg(
          storeId,
          raw.document_number,
          raw.document_type ?? null,
        );
        if (byDoc) {
          existingCustomerId = byDoc.id;
          action = 'reuse';
        }
      }
      if (!existingCustomerId && raw.email) {
        const byEmail = await this.findCustomerByEmailInOrg(
          storeId,
          raw.email,
        );
        if (byEmail) {
          existingCustomerId = byEmail.id;
          action = 'reuse';
        }
      }

      // 2) Plan resolution — match by `plan_name` against detected_plans.
      let planRef: number | null = null;
      if (raw.plan_name) {
        const idx = plansInput.findIndex(
          (p) => p?.name && p.name === raw.plan_name,
        );
        if (idx >= 0) {
          planRef = planRefByIndex.get(idx) ?? null;
        }
      }

      // 3) Status & dates per Decisión 2.
      const { status, periodStart, periodEnd } = this.resolveStatusAndDates(
        raw.membership_start_date,
        raw.membership_end_date,
        today,
      );

      // 4) Per-row validation (errors are hard blockers; warnings are
      //    soft — the user can fix in the modal).
      const errors: string[] = [];
      const warnings: string[] = [];

      const hasName = !!(raw.first_name && raw.first_name.trim());
      const hasDoc = !!(raw.document_number && raw.document_number.trim());
      if (!hasName && !hasDoc) {
        errors.push('Falta nombre y documento: no se puede identificar al socio.');
      }

      if (raw.plan_name && planRef == null) {
        warnings.push(
          `Plan "${raw.plan_name}" no se pudo asociar; asígnalo manualmente.`,
        );
      }

      // Duplicate active/pending membership (same customer + plan)?
      if (existingCustomerId && planRef != null) {
        const dup = await this.findOpenMembership(
          existingCustomerId,
          planRef,
        );
        if (dup) {
          warnings.push(
            'El socio ya tiene una membresía activa o pendiente para este plan; se omitirá en commit.',
          );
        }
      }

      let rowStatus: 'ready' | 'warning' | 'error' = 'ready';
      if (errors.length > 0) {
        rowStatus = 'error';
        withErrors++;
      } else if (warnings.length > 0 || planRef == null) {
        rowStatus = 'warning';
        withWarnings++;
      } else {
        ready++;
      }

      analyzed.push({
        ...raw,
        row_number,
        action,
        existing_customer_id: existingCustomerId,
        plan_ref: planRef,
        resolved_status: status,
        resolved_period_start: periodStart,
        resolved_period_end: periodEnd,
        status: rowStatus,
        warnings,
        errors,
      });
    }

    return {
      plans: planMatches,
      members: analyzed,
      ready_count: ready,
      with_warnings_count: withWarnings,
      with_errors_count: withErrors,
      global_warnings: Array.isArray(scan.warnings) ? scan.warnings : [],
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // /commit
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Persist the user-confirmed plan/member edits. Best-effort:
   *  - Phase 1 (plans): ATOMIC. Any failure short-circuits the commit and
   *    surfaces `plan_errors` so the caller can fix the modal and retry.
   *    No member rows are written when this phase fails.
   *  - Phase 2 (members): BEST-EFFORT. Each member is wrapped in its own
   *    try/catch and pushed to `results[]` regardless of outcome — a single
   *    bad row never aborts the batch.
   */
  async commitRoster(
    dto: CommitMemberRosterDto,
  ): Promise<CommitMemberRosterResult> {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const plans = Array.isArray(dto?.plans) ? dto.plans : [];
    const members = Array.isArray(dto?.members) ? dto.members : [];

    // ── Phase 1: plans (atomic) ───────────────────────────────────────────
    const refToPlanId = new Map<number, number>();
    const planErrors: Array<{ ref_index: number; error: string }> = [];

    for (const p of plans) {
      if (p.status === 'existing') {
        if (!p.plan_id) {
          planErrors.push({
            ref_index: p.ref_index,
            error: 'Plan existente requiere plan_id',
          });
          continue;
        }
        const found = await this.prisma
          .withoutScope()
          .membership_plans.findFirst({
            where: { id: p.plan_id, store_id: storeId },
            select: { id: true },
          });
        if (!found) {
          planErrors.push({
            ref_index: p.ref_index,
            error: `Plan id=${p.plan_id} no encontrado en esta tienda`,
          });
          continue;
        }
        refToPlanId.set(p.ref_index, found.id);
        continue;
      }

      // status === 'new'
      if (!p.code || !p.name) {
        planErrors.push({
          ref_index: p.ref_index,
          error: 'Plan nuevo requiere code y name',
        });
        continue;
      }

      try {
        const created = await this.membershipPlansService.create({
          code: p.code,
          name: p.name,
          price: p.price ?? 0,
          currency: p.currency ?? 'COP',
          duration_days: p.duration_days ?? 30,
          is_active: true,
        });
        refToPlanId.set(p.ref_index, created.id);
      } catch (err: any) {
        planErrors.push({
          ref_index: p.ref_index,
          error: err?.message ?? 'Error desconocido creando el plan',
        });
      }
    }

    if (planErrors.length > 0) {
      // Plan creation is atomic — do NOT persist any member row when any
      // plan failed. Caller must fix the modal and retry.
      return {
        ready: members.length,
        succeeded: 0,
        failed: 0,
        results: [],
        plan_errors: planErrors,
      };
    }

    // ── Phase 2: members (best-effort) ────────────────────────────────────
    const results: CommitMemberResult[] = [];
    let succeeded = 0;
    let failed = 0;

    for (const m of members) {
      try {
        const planId =
          m.plan_ref_index != null
            ? refToPlanId.get(m.plan_ref_index)
            : undefined;

        if (!planId) {
          throw new Error(
            'El socio no tiene un plan resuelto; asígnalo antes de confirmar.',
          );
        }

        // Resolve / create customer.
        let customerId: number;
        if (m.existing_customer_id) {
          customerId = m.existing_customer_id;
          // Idempotent link — ignores "already linked" by design.
          try {
            await this.customersService.linkCustomerToStore(
              customerId,
              storeId,
            );
          } catch (err: any) {
            this.logger.warn(
              `[MemberRosterCommit] linkCustomerToStore failed for customer ${customerId}: ${err?.message}`,
            );
          }
        } else {
          const email =
            m.email?.trim() ||
            `membership-import-${m.row_number}-${Date.now()}@noemail.local`;
          const created = await this.customersService.create(storeId, {
            email,
            first_name: m.first_name?.trim() || ' ',
            last_name: m.last_name?.trim() || ' ',
            document_type: m.document_type ?? null,
            document_number: m.document_number ?? null,
            phone: m.phone ?? null,
          });
          customerId = created.id;
        }

        // Create the membership with caller-supplied status / dates.
        const membership = await this.membershipsService.createFromImport({
          customer_id: customerId,
          plan_id: planId,
          status: m.status as membership_status_enum,
          period_start: m.period_start,
          period_end: m.period_end,
        });

        // Optional profile upsert — only when at least one field is present.
        const profileDto = this.buildProfileDto(m);
        if (profileDto) {
          try {
            await this.memberProfilesService.upsert(customerId, profileDto);
          } catch (err: any) {
            this.logger.warn(
              `[MemberRosterCommit] profile upsert failed for customer ${customerId}: ${err?.message}`,
            );
          }
        }

        results.push({
          row_number: m.row_number,
          status: 'success',
          membership_id: membership.id,
          customer_id: customerId,
        });
        succeeded++;
      } catch (err: any) {
        results.push({
          row_number: m.row_number,
          status: 'error',
          error: err?.message ?? 'Error desconocido',
        });
        failed++;
      }
    }

    return {
      ready: members.length,
      succeeded,
      failed,
      results,
      plan_errors: [],
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private assertValidFile(file?: Express.Multer.File): void {
    if (!file) {
      throw new VendixHttpException(ErrorCodes.MEMBER_SCAN_NO_FILE);
    }
    if (
      !MemberBulkScannerService.ALLOWED_MIMETYPES.includes(file.mimetype)
    ) {
      throw new VendixHttpException(ErrorCodes.MEMBER_SCAN_INVALID_FILE);
    }
  }

  /**
   * Reused verbatim from `InvoiceScannerService.preprocessImage` and
   * `RouteSheetScannerService.preprocessImage` (both 1:1 calques of each
   * other). Copy-on-purpose: extracting to a shared helper would require
   * moving the method on the source services and risks subtle behaviour
   * drift in working callers. Kept identical (same constants, same
   * fall-through to raw buffer for PDFs).
   */
  private async preprocessImage(
    file: Express.Multer.File,
  ): Promise<{ base64: string; mimeType: string }> {
    const MAX_DIMENSION = 1536;
    const JPEG_QUALITY = 85;

    try {
      const metadata = await sharp(file.buffer).metadata();
      const needsResize =
        (metadata.width && metadata.width > MAX_DIMENSION) ||
        (metadata.height && metadata.height > MAX_DIMENSION);

      let pipeline = sharp(file.buffer);

      if (needsResize) {
        pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      const processedBuffer = await pipeline
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();

      return {
        base64: processedBuffer.toString('base64'),
        mimeType: 'image/jpeg',
      };
    } catch (err) {
      // PDFs and unsupported mimetypes fall through to the raw buffer so
      // the vision model processes them natively.
      this.logger.warn(
        `[MemberRosterScan] Image preprocessing failed, using raw: ${err.message}`,
      );
      return {
        base64: file.buffer.toString('base64'),
        mimeType: file.mimetype,
      };
    }
  }

  /**
   * Normalize the AI JSON into a strictly-typed `RosterScanResult`. Mirrors
   * the defensive shape used by `RouteSheetScannerService.normalizeScanResponse`:
   * coerce types, default nulls, clamp `confidence` to [0,100], and never
   * trust the model's claim of having found anything.
   */
  private normalizeScanResponse(parsed: any): RosterScanResult {
    if (!parsed || typeof parsed !== 'object') {
      throw new VendixHttpException(ErrorCodes.MEMBER_SCAN_PARSE_FAIL);
    }

    const detected_plans: ExtractedPlan[] = Array.isArray(parsed.detected_plans)
      ? parsed.detected_plans.map((p: any) => ({
          name: p?.name ? String(p.name) : null,
          price: this.toFiniteNumber(p?.price),
          currency: p?.currency ? String(p.currency) : null,
          duration_days: this.toFiniteNumber(p?.duration_days),
          raw_period_label: p?.raw_period_label
            ? String(p.raw_period_label)
            : null,
        }))
      : [];

    const members: ExtractedMember[] = Array.isArray(parsed.members)
      ? parsed.members.map((m: any) => this.normalizeMember(m))
      : [];

    const warnings: string[] = Array.isArray(parsed.warnings)
      ? parsed.warnings.map((w: any) => String(w)).filter(Boolean)
      : [];

    let confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence)) confidence = 0;
    confidence = Math.max(0, Math.min(100, confidence));

    return {
      document_type: parsed.document_type
        ? String(parsed.document_type)
        : 'other',
      detected_plans,
      members,
      warnings,
      confidence,
    };
  }

  private normalizeMember(m: any): ExtractedMember {
    return {
      first_name: m?.first_name ? String(m.first_name) : null,
      last_name: m?.last_name ? String(m.last_name) : null,
      document_type: m?.document_type ? String(m.document_type) : null,
      document_number: m?.document_number ? String(m.document_number) : null,
      email: m?.email ? String(m.email) : null,
      phone: m?.phone ? String(m.phone) : null,
      date_of_birth: m?.date_of_birth ? String(m.date_of_birth) : null,
      gender: m?.gender ? String(m.gender) : null,
      emergency_contact_name: m?.emergency_contact_name
        ? String(m.emergency_contact_name)
        : null,
      emergency_contact_phone: m?.emergency_contact_phone
        ? String(m.emergency_contact_phone)
        : null,
      medical_notes: m?.medical_notes ? String(m.medical_notes) : null,
      goals: m?.goals ? String(m.goals) : null,
      height_cm: this.toFiniteNumber(m?.height_cm),
      weight_kg: this.toFiniteNumber(m?.weight_kg),
      plan_name: m?.plan_name ? String(m.plan_name) : null,
      membership_start_date: m?.membership_start_date
        ? String(m.membership_start_date)
        : null,
      membership_end_date: m?.membership_end_date
        ? String(m.membership_end_date)
        : null,
      raw_row: m?.raw_row ? String(m.raw_row) : null,
    };
  }

  private toFiniteNumber(v: any): number | null {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Replicate the 3-tier scoring from `InvoiceScannerService.matchSupplier`
   * against the in-memory list of plans for this store. Returns the best
   * match and the top-5 candidates for the UI's "mapear a existente" picker.
   *
   * Tier 1: exact name (case-insensitive).
   * Tier 2: bidirectional contains → score 65-85.
   * Tier 3: word overlap → score up to 60.
   *
   * `existing` ≥ 65; `partial` 30-64 (still emit `candidates`); `new` < 30.
   */
  private matchPlan(
    ref_index: number,
    extracted: ExtractedPlan,
    existing: Array<{ id: number; code: string; name: string }>,
  ): PlanMatch {
    if (!extracted?.name) {
      return {
        ref_index,
        status: 'new',
        matched_plan_id: null,
        confidence: 0,
        candidates: [],
      };
    }

    const target = extracted.name.toLowerCase().trim();
    const scored: Array<{ id: number; name: string; code: string; score: number }> = [];

    // Tier 1: exact.
    const exact = existing.find(
      (p) => p.name.toLowerCase().trim() === target,
    );
    if (exact) {
      return {
        ref_index,
        status: 'existing',
        matched_plan_id: exact.id,
        confidence: 100,
        candidates: [
          { id: exact.id, name: exact.name, code: exact.code, confidence: 100 },
        ],
      };
    }

    // Tier 2: bidirectional contains.
    for (const p of existing) {
      const candidate = p.name.toLowerCase().trim();
      if (
        candidate.includes(target) ||
        target.includes(candidate)
      ) {
        const ratio =
          Math.min(target.length, candidate.length) /
          Math.max(target.length, candidate.length);
        const score = 65 + ratio * 20; // 65-85 range
        scored.push({ id: p.id, name: p.name, code: p.code, score });
      }
    }

    // Tier 3: word-level overlap.
    const targetWords = target.split(/\s+/).filter((w) => w.length > 2);
    if (targetWords.length > 0) {
      for (const p of existing) {
        const candidateWords = p.name
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2);
        if (candidateWords.length === 0) continue;

        let matches = 0;
        for (const tw of targetWords) {
          for (const cw of candidateWords) {
            if (cw.includes(tw) || tw.includes(cw)) {
              matches++;
              break;
            }
          }
        }
        const score =
          (matches / Math.max(targetWords.length, candidateWords.length)) * 60;
        if (score >= 30) {
          // Avoid double-counting if tier 2 already added this plan.
          if (!scored.some((s) => s.id === p.id)) {
            scored.push({ id: p.id, name: p.name, code: p.code, score });
          } else {
            // Promote the tier-2 score if tier-3 is higher.
            const prev = scored.find((s) => s.id === p.id)!;
            if (score > prev.score) prev.score = score;
          }
        }
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 5);

    if (top.length === 0 || top[0].score < 30) {
      return {
        ref_index,
        status: 'new',
        matched_plan_id: null,
        confidence: top[0]?.score ?? 0,
        candidates: top.map((t) => ({
          id: t.id,
          name: t.name,
          code: t.code,
          confidence: Math.round(t.score),
        })),
      };
    }

    const best = top[0];
    const status: 'existing' | 'partial' =
      best.score >= 65 ? 'existing' : 'partial';

    return {
      ref_index,
      status,
      matched_plan_id: status === 'existing' ? best.id : null,
      confidence: Math.round(best.score),
      candidates: top.map((t) => ({
        id: t.id,
        name: t.name,
        code: t.code,
        confidence: Math.round(t.score),
      })),
    };
  }

  /**
   * Resolve initial status and dates per Decisión 2:
   *   period_end >= today  → 'active'   + dates preserved
   *   period_end <  today  → 'expired'  + dates preserved
   *   no period_end        → 'pending_payment' + period_end = null
   *
   * Comparison against `today` (normalized to 00:00 local) avoids the
   * off-by-one-day trap when comparing a `YYYY-MM-DD` string against
   * `new Date()` (which would default to 00:00 UTC and skew by 5h in
   * Colombian timezone).
   */
  private resolveStatusAndDates(
    startDateStr: string | null,
    endDateStr: string | null,
    today: Date,
  ): {
    status: 'active' | 'expired' | 'pending_payment';
    periodStart: string | null;
    periodEnd: string | null;
  } {
    const periodStart = startDateStr ?? null;

    if (!endDateStr) {
      return {
        status: 'pending_payment',
        periodStart,
        periodEnd: null,
      };
    }

    const endDate = new Date(endDateStr);
    if (!Number.isFinite(endDate.getTime())) {
      // Unparseable — fall back to pending_payment so the user fixes it.
      return {
        status: 'pending_payment',
        periodStart,
        periodEnd: null,
      };
    }

    if (endDate.getTime() >= today.getTime()) {
      return { status: 'active', periodStart, periodEnd: endDateStr };
    }
    return { status: 'expired', periodStart, periodEnd: endDateStr };
  }

  private async findCustomerByDocumentInOrg(
    storeId: number,
    documentNumber: string,
    documentType: string | null,
  ): Promise<{ id: number } | null> {
    const store = await this.prisma.withoutScope().stores.findFirst({
      where: { id: storeId },
      select: { organization_id: true },
    });
    if (!store) return null;

    // Strip separators for a tolerant lookup (same shape stored on create).
    const normalized = documentNumber
      .trim()
      .toUpperCase()
      .replace(/[\s\-.]/g, '');
    if (!normalized) return null;

    const where: any = {
      organization_id: store.organization_id,
      document_number: { equals: normalized, mode: 'insensitive' },
      user_roles: { some: { roles: { name: 'customer' } } },
    };
    if (documentType) where.document_type = documentType.toUpperCase();

    const found = await this.prisma.users.findFirst({
      where,
      select: { id: true },
    });
    return found ? { id: found.id } : null;
  }

  private async findCustomerByEmailInOrg(
    storeId: number,
    email: string,
  ): Promise<{ id: number } | null> {
    const store = await this.prisma.withoutScope().stores.findFirst({
      where: { id: storeId },
      select: { organization_id: true },
    });
    if (!store) return null;

    const normalized = email.trim().toLowerCase();
    if (!normalized) return null;

    const found = await this.prisma.users.findFirst({
      where: {
        organization_id: store.organization_id,
        email: { equals: normalized, mode: 'insensitive' },
        user_roles: { some: { roles: { name: 'customer' } } },
      },
      select: { id: true },
    });
    return found ? { id: found.id } : null;
  }

  /**
   * Detect an already-active/pending membership for (customer, plan) so
   * the analyze step can warn the user before they confirm a duplicate.
   */
  private async findOpenMembership(
    customerId: number,
    planId: number,
  ): Promise<{ id: number } | null> {
    const found = await this.prisma.withoutScope().memberships.findFirst({
      where: {
        customer_id: customerId,
        plan_id: planId,
        status: {
          in: [
            membership_status_enum.active,
            membership_status_enum.pending_payment,
          ],
        },
      },
      select: { id: true },
    });
    return found ? { id: found.id } : null;
  }

  /**
   * Map a `CommitMemberDto` to the optional profile upsert payload. Returns
   * `null` when no profile field was provided so the caller can skip the
   * upsert entirely (avoids a no-op DB round-trip per member).
   */
  private buildProfileDto(m: {
    date_of_birth?: string;
    gender?: string;
    emergency_contact_name?: string;
    emergency_contact_phone?: string;
    medical_notes?: string;
    goals?: string;
    height_cm?: number;
    weight_kg?: number;
  }): UpsertMemberProfileDto | null {
    const dto = new UpsertMemberProfileDto();
    if (m.date_of_birth) dto.date_of_birth = m.date_of_birth;
    if (m.gender) dto.gender = m.gender;
    if (m.emergency_contact_name)
      dto.emergency_contact_name = m.emergency_contact_name;
    if (m.emergency_contact_phone)
      dto.emergency_contact_phone = m.emergency_contact_phone;
    if (m.medical_notes) dto.medical_notes = m.medical_notes;
    if (m.goals) dto.goals = m.goals;
    if (m.height_cm !== undefined) dto.height_cm = m.height_cm;
    if (m.weight_kg !== undefined) dto.weight_kg = m.weight_kg;

    return Object.keys(dto).length === 0 ? null : dto;
  }
}