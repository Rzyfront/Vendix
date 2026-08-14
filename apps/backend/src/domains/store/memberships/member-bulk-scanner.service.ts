import { Injectable, Logger } from '@nestjs/common';
import { membership_status_enum } from '@prisma/client';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import { AIMessage } from '../../../ai-engine/interfaces/ai-provider.interface';
import { parseAiJson } from '../../../ai-engine/utils/ai-json.util';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { MembershipPlansService } from '../membership-plans/membership-plans.service';
import { CustomersService } from '../customers/customers.service';
import { MembershipsService } from './memberships.service';
import { MemberProfilesService } from './member-profiles.service';
import { MembershipNotesService } from './membership-notes.service';
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
    private readonly membershipNotesService: MembershipNotesService,
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

    this.logger.debug(
      `[MemberRosterScan] AI response: success=${response.success}, contentLength=${response.content?.length ?? 0}, model=${response.model}, error=${response.error}`,
    );
    this.logger.debug(
      `[MemberRosterScan] AI content preview: ${response.content?.substring(0, 300)}`,
    );

    if (!response.success || !response.content) {
      this.logger.error(
        `[MemberRosterScan] AI failed: ${response.error ?? 'no content'}`,
      );
      throw new VendixHttpException(ErrorCodes.MEMBER_SCAN_AI_FAIL);
    }

    try {
      const parsed = parseAiJson(response.content);
      return this.normalizeScanResponse(parsed);
    } catch (err: any) {
      if (err instanceof VendixHttpException) throw err;
      // Log the FULL raw content (mirrors InvoiceScannerService) so a
      // truncated payload (roster > max_tokens) is diagnosable in the dev
      // logs — a cut-off object has no closing brace and cannot be salvaged.
      this.logger.error(
        `[MemberRosterScan] Failed to parse AI response (${err?.message}). Raw content: ${response.content}`,
      );
      throw new VendixHttpException(ErrorCodes.MEMBER_SCAN_PARSE_FAIL);
    }
  }

  // Defensive JSON parsing now lives in `ai-engine/utils/ai-json.util.ts`,
  // shared by every OCR scanner instead of re-derived per service.

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
        select: { id: true, code: true, name: true, duration_days: true },
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

    // Map detected_plans index → period length (days). Prefer the MATCHED
    // plan's real `duration_days`; fall back to the value the AI extracted;
    // default 30. Used to INFER a member's missing start/end date.
    const planDurationByIndex = new Map<number, number>();
    plansInput.forEach((p, idx) => {
      const matchedId = planRefByIndex.get(idx);
      const matched = matchedId
        ? existingPlans.find((e) => e.id === matchedId)
        : null;
      const dur =
        matched?.duration_days ??
        (typeof p?.duration_days === 'number' ? p.duration_days : null) ??
        30;
      planDurationByIndex.set(idx, dur > 0 ? dur : 30);
    });

    // Resolve the store timezone ONCE and derive the current year in it. The
    // source rosters omit the year ("4 de julio"); the model then invents one
    // (usually a past year → everything imported as `expired`). We inject the
    // store-local current year and let the status rule flag anything already
    // elapsed as `expired` (decisión de producto: nunca rodar al año siguiente).
    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const currentYear = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
      }).format(new Date()),
    );

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
      const errors: string[] = [];
      const warnings: string[] = [];

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
      // Phone lookup (QUI-558 fluency): when document/email miss, try a
      // phone match. The phone is normalized to digits-last-10 so the
      // match tolerates +57 prefixes, spaces, dashes, parentheses, and
      // leading zeros. Only re-uses when the match is unique; ambiguous
      // matches (multiple customers sharing the same phone) leave the
      // row as `create` and surface a warning for the user to merge.
      if (!existingCustomerId && raw.phone) {
        const byPhone = await this.findCustomerByPhoneInOrg(
          storeId,
          raw.phone,
        );
        if (byPhone?.unique) {
          existingCustomerId = byPhone.id;
          action = 'reuse';
        } else if (byPhone && !byPhone.unique) {
          warnings.push(
            `Teléfono ${raw.phone} está asociado a varios socios; revisa manualmente para evitar duplicados.`,
          );
        }
      }

      // 2) Plan resolution — match `plan_name` against detected_plans with the
      //    accent/plural-tolerant helper. The old raw `===` missed "Élite" vs
      //    "elite" and "Estudiante" vs "Estudiantes", so members were left
      //    without a plan even when the plan DID match against the DB. Derive
      //    both the plan ref and the period length in a single lookup.
      let planRef: number | null = null;
      let durationDays = 30;
      if (raw.plan_name) {
        const idx = this.findDetectedPlanIndex(raw.plan_name, plansInput);
        if (idx >= 0) {
          planRef = planRefByIndex.get(idx) ?? null;
          durationDays = planDurationByIndex.get(idx) ?? 30;
        }
      }

      // 3) Status & dates: inject the current year when the source omitted it
      //    and infer the missing start/end from the plan's duration.
      const {
        status,
        periodStart,
        periodEnd,
        yearInjected,
        startInferred,
        endInferred,
      } = this.resolveMembershipDates(
        raw.membership_start_date,
        raw.membership_end_date,
        durationDays,
        currentYear,
        today,
      );

      // 4) Per-row validation (errors are hard blockers; warnings are
      //    soft — the user can fix in the modal). The arrays are declared
      //    at the top of the loop so the phone-lookup branch above can push
      //    ambiguous-match warnings without hitting a TDZ (QUI-558 fix).

      // Date-inference advisories (soft): the user can override in the modal.
      if (yearInjected) {
        warnings.push(
          `El año no venía en el archivo; se asumió ${currentYear}. Verifica la fecha.`,
        );
      }
      if (startInferred) {
        warnings.push(
          `Fecha de inicio estimada (vencimiento − ${durationDays} días).`,
        );
      }
      if (endInferred) {
        warnings.push(
          `Fecha de vencimiento estimada (inicio + ${durationDays} días).`,
        );
      }

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

          // Fill-in merge (QUI-558): when the OCR brought a value the
          // existing customer is missing, persist it. NEVER overwrite a
          // stored value — the user can edit later if they want to change
          // it. Document fields are intentionally skipped (sensitive).
          try {
            const existing = await this.prisma.withoutScope().users.findFirst({
              where: { id: customerId },
              select: {
                first_name: true,
                last_name: true,
                phone: true,
                email: true,
              },
            });
            if (existing) {
              const fillIn: {
                first_name?: string;
                last_name?: string;
                phone?: string;
                email?: string;
              } = {};
              if (!existing.first_name?.trim() && m.first_name?.trim()) {
                fillIn.first_name = m.first_name.trim();
              }
              if (!existing.last_name?.trim() && m.last_name?.trim()) {
                fillIn.last_name = m.last_name.trim();
              }
              if (!existing.phone?.trim() && m.phone?.trim()) {
                fillIn.phone = m.phone.trim();
              }
              const synthEmail = m.email?.trim();
              if (!existing.email?.trim() && synthEmail) {
                fillIn.email = synthEmail;
              }
              if (Object.keys(fillIn).length > 0) {
                await this.customersService.update(storeId, customerId, fillIn);
              }
            }
          } catch (err: any) {
            this.logger.warn(
              `[MemberRosterCommit] fill-in merge failed for customer ${customerId}: ${err?.message}`,
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
            document_type: m.document_type as any ?? null,
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

        // Notes (EPS, estado_fisico, lesiones, …) — persist via the
        // dedicated service. Drops unknown keys server-side (the
        // `MembershipNotesService` doesn't filter on the key whitelist yet,
        // so callers should pass only canonical keys; the prompt enforces
        // this on the AI side).
        if (Array.isArray(m.notes) && m.notes.length > 0) {
          try {
            await this.membershipNotesService.bulkSet(customerId, {
              notes: m.notes.map((n) => ({
                note_key: n.note_key,
                note_value: n.note_value,
                include_in_summary: n.include_in_summary ?? false,
              })),
            });
          } catch (err: any) {
            this.logger.warn(
              `[MemberRosterCommit] notes persistence failed for customer ${customerId}: ${err?.message}`,
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
   * Fold a string for accent/diacritic-insensitive matching. NFD decomposes
   * accented characters (é → e + combining acute U+0301); we strip the combining
   * marks (U+0300–U+036F), lowercase, replace punctuation/symbols with spaces,
   * and collapse whitespace. So "Élite", "elite", and "ÉLITE" all fold to
   * "elite". This is the canonical Unicode approach (superior to a hand-rolled
   * á→a map because it covers every diacritic).
   */
  private normalizeForMatch(s: string | null | undefined): string {
    return (s ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Enlaza el `plan_name` de un socio contra `detected_plans[]` de forma
   * insensible a tildes/mayúsculas y tolerante a singular/plural. Reutiliza
   * `normalizeForMatch` (el mismo folding Unicode que usa `matchPlan`), de modo
   * que "Élite"/"elite" y "Estudiante"/"Estudiantes" enlacen. El `===` crudo
   * anterior fallaba en ambos casos y dejaba al socio sin plan aunque el plan
   * sí hubiera matcheado contra la BD.
   *
   * Tier 1: igualdad normalizada. Tier 2: contains bidireccional (para
   * singular/plural). Devuelve el índice en `plans` o -1 si no hay enlace.
   */
  private findDetectedPlanIndex(
    planName: string | null | undefined,
    plans: Array<{ name?: string | null }>,
  ): number {
    const target = this.normalizeForMatch(planName);
    if (!target) return -1;

    // Tier 1: igualdad normalizada.
    let idx = plans.findIndex(
      (p) => p?.name && this.normalizeForMatch(p.name) === target,
    );
    if (idx >= 0) return idx;

    // Tier 2: contains bidireccional (Estudiante ⊂ Estudiantes).
    idx = plans.findIndex((p) => {
      const c = this.normalizeForMatch(p?.name);
      return !!c && (c.includes(target) || target.includes(c));
    });
    return idx;
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
        source_name: null,
        needs_review: true,
        raw_candidates: [],
      };
    }

    const target = this.normalizeForMatch(extracted.name);
    // A name that folds to empty (all punctuation/whitespace) has nothing to
    // match on. Bail out as `new`: otherwise Tier 2's `candidate.includes('')`
    // is always true and every plan would over-match at score 65.
    if (!target) {
      return {
        ref_index,
        status: 'new',
        matched_plan_id: null,
        confidence: 0,
        candidates: [],
      };
    }
    const scored: Array<{ id: number; name: string; code: string; score: number }> = [];

    // Tier 1: exact.
    const exact = existing.find(
      (p) => this.normalizeForMatch(p.name) === target,
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
        source_name: extracted.name,
        needs_review: false,
        raw_candidates: [
          { id: exact.id, name: exact.name, code: exact.code, score: 100 },
        ],
      };
    }

    // Tier 2: bidirectional contains.
    for (const p of existing) {
      const candidate = this.normalizeForMatch(p.name);
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
        const candidateWords = this.normalizeForMatch(p.name)
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
      this.logger.warn(
        `[MemberRosterAnalyze] Plan "${extracted.name}" did not match any plan in this store (top score=${
          top[0]?.score ?? 0
        }, candidates=${top.length}). Will be flagged needs_review.`,
      );
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
        source_name: extracted?.name ?? null,
        needs_review: true,
        raw_candidates: top.map((t) => ({
          id: t.id,
          name: t.name,
          code: t.code,
          score: Math.round(t.score * 100) / 100,
        })),
      };
    }

    const best = top[0];
    const status: 'existing' | 'partial' =
      best.score >= 65 ? 'existing' : 'partial';

    if (status === 'partial') {
      this.logger.warn(
        `[MemberRosterAnalyze] Plan "${extracted.name}" only partially matches (top="${best.name}" score=${Math.round(best.score)}). User must pick a candidate.`,
      );
    }

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
      source_name: extracted?.name ?? null,
      needs_review: status === 'partial',
      raw_candidates: top.map((t) => ({
        id: t.id,
        name: t.name,
        code: t.code,
        score: Math.round(t.score * 100) / 100,
      })),
    };
  }

  /**
   * Resuelve status y fechas de la membresía inyectando el año actual (tz de
   * la tienda) cuando la fuente lo omite, e infiriendo la fecha faltante a
   * partir de la duración del plan:
   *   ambas       → se usan tal cual
   *   solo inicio → fin    = inicio + durationDays
   *   solo fin    → inicio = fin    − durationDays
   *   ninguna     → pending_payment
   *
   * Política de año (decisión de producto): SIEMPRE se usa el año actual; si la
   * fecha resultante ya pasó, la membresía queda `expired` + warning (nunca se
   * rueda al año siguiente). El status compara el fin (mediodía local) contra
   * `today` (00:00 local) para evitar el off-by-one de UTC.
   */
  private resolveMembershipDates(
    startRaw: string | null,
    endRaw: string | null,
    durationDays: number,
    currentYear: number,
    today: Date,
  ): {
    status: 'active' | 'expired' | 'pending_payment';
    periodStart: string | null;
    periodEnd: string | null;
    yearInjected: boolean;
    startInferred: boolean;
    endInferred: boolean;
  } {
    const s = this.parseFlexibleDate(startRaw, currentYear);
    const e = this.parseFlexibleDate(endRaw, currentYear);

    let start: Date;
    let end: Date;
    let startInferred = false;
    let endInferred = false;

    if (s && e) {
      start = s.date;
      end = e.date;
    } else if (s && !e) {
      start = s.date;
      end = this.addDays(s.date, durationDays);
      endInferred = true;
    } else if (!s && e) {
      end = e.date;
      start = this.addDays(e.date, -durationDays);
      startInferred = true;
    } else {
      // Ninguna fecha utilizable — el socio queda pendiente de cobro.
      return {
        status: 'pending_payment',
        periodStart: null,
        periodEnd: null,
        yearInjected: false,
        startInferred: false,
        endInferred: false,
      };
    }

    const yearInjected = (s?.injected ?? false) || (e?.injected ?? false);
    const status: 'active' | 'expired' =
      end.getTime() >= today.getTime() ? 'active' : 'expired';

    return {
      status,
      periodStart: this.toIsoDate(start),
      periodEnd: this.toIsoDate(end),
      yearInjected,
      startInferred,
      endInferred,
    };
  }

  /**
   * Tolerant date parser for OCR'd rosters (QUI-558). Accepts the formats
   * the AI emits AND the ones it sometimes leaks through unchanged:
   *
   *   - `YYYY-MM-DD`            (ISO; per the prompt rule 14)
   *   - `YYYY-MM-DDTHH:mm:ss`   (ISO with time)
   *   - `DD/MM/YYYY`            (Colombia — first because it's the
   *                              dominant local format)
   *   - `DD-MM-YYYY` / `DD.MM.YYYY`
   *   - `MM/DD/YYYY`            (US fallback — only when the first chunk is
   *                              > 12, otherwise ambiguous and DD/MM wins)
   *   - `DD/MM/YY`              (two-digit year, 2000-2069)
   *   - `D de mes de YYYY` / `D mes YYYY` (Spanish words: "4 de julio de 2024",
   *                              "4 julio 2024")
   *
   * Returns `{ date, injected, format }` where `injected` is true when the
   * year was a sentinel and had to be replaced with `currentYear`. Returns
   * `null` when nothing matched.
   *
   * Builds the Date in HORA LOCAL a mediodía (`new Date(y, m-1, d, 12)`) so
   * the status compare against `today` (00:00 local) does not suffer the
   * UTC off-by-one.
   */
  private parseFlexibleDate(
    raw: string | null,
    currentYear: number,
  ): { date: Date; injected: boolean; format: string } | null {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s) return null;

    // Spanish month map (lowercase, no accents).
    const MESES: Record<string, number> = {
      enero: 1,
      febrero: 2,
      marzo: 3,
      abril: 4,
      mayo: 5,
      junio: 6,
      julio: 7,
      agosto: 8,
      septiembre: 9,
      setiembre: 9,
      octubre: 10,
      noviembre: 11,
      diciembre: 12,
    };

    // 1) ISO: YYYY-MM-DD (with optional time).
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) {
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10);
      const d = parseInt(m[3], 10);
      const r = this.buildDate(y, mo, d, currentYear);
      if (r) return { ...r, format: 'YYYY-MM-DD' };
    }

    // 2) DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (Colombia first).
    m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(s);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      let y = parseInt(m[3], 10);
      if (y < 100) y = 2000 + y; // 24 → 2024
      // DD/MM/YYYY if `a > 12` (otherwise could be MM/DD — try DD/MM first).
      if (a > 12 && b <= 12) {
        const r = this.buildDate(y, b, a, currentYear);
        if (r) return { ...r, format: 'DD/MM/YYYY' };
      }
      if (b > 12 && a <= 12) {
        // US-style: MM/DD/YYYY
        const r = this.buildDate(y, a, b, currentYear);
        if (r) return { ...r, format: 'MM/DD/YYYY' };
      }
      if (a <= 12 && b <= 12) {
        // Ambiguous — Colombian default ⇒ DD/MM/YYYY.
        const r = this.buildDate(y, b, a, currentYear);
        if (r) return { ...r, format: 'DD/MM/YYYY' };
      }
    }

    // 3) "4 de julio de 2024" / "4 julio 2024" / "4 de julio" /
    //    "4 julio". We split into two patterns so the regex engine can't
    //    backtrack and silently capture the connector word "de" as the
    //    month when both the trailing "de" and the year are absent
    //    (QUI-558 fluency fix).
    m =
      /^(\d{1,2})\s+de\s+([a-záéíóúñ]+)(?:\s+de\s+(\d{2,4}))?/i.exec(s) ||
      /^(\d{1,2})\s+([a-záéíóúñ]+)(?:\s+(\d{2,4}))?/i.exec(s);
    if (m) {
      const d = parseInt(m[1], 10);
      const mesName = m[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const mo = MESES[mesName];
      const yRaw = m[3] ? parseInt(m[3], 10) : currentYear;
      const y = yRaw < 100 ? 2000 + yRaw : yRaw;
      if (mo) {
        const injected = !m[3];
        const r = this.buildDate(y, mo, d, currentYear, injected);
        if (r) return { ...r, format: 'D mes YYYY' };
      }
    }

    return null;
  }

  /** Builds a local-noon Date; returns null on invalid components. */
  private buildDate(
    year: number,
    month: number,
    day: number,
    currentYear: number,
    forcedInjected = false,
  ): { date: Date; injected: boolean } | null {
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return null;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    let injected = forcedInjected;
    if (!Number.isFinite(year) || year < 100 || year === 0) {
      year = currentYear;
      injected = true;
    }
    const date = new Date(year, month - 1, day, 12, 0, 0);
    if (!Number.isFinite(date.getTime())) return null;
    return { date, injected };
  }

  /** `YYYY-MM-DD` a partir de los componentes LOCALES de la Date. */
  private toIsoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** Suma (o resta, con `n` negativo) días a una Date preservando la hora. */
  private addDays(d: Date, n: number): Date {
    const d2 = new Date(d);
    d2.setDate(d2.getDate() + n);
    return d2;
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
   * Phone lookup (QUI-558). Normalizes to "last 10 digits" so the match
   * tolerates any of: `+57 300 123 4567`, `300-123-4567`, `(300) 123-4567`,
   * `3001234567`, `+573001234567`. The derived `digitsLast10` is the join
   * key — Colombian mobile numbers are 10 digits, and we drop the country
   * code so a user whose stored phone is `+57 300 123 4567` matches an
   * OCR'd `3001234567`.
   *
   * Returns `{ id, unique }` so the caller can warn on ambiguous matches
   * (multiple customers sharing the same phone) — those NEVER auto-reuse;
   * the user must manually pick.
   */
  private async findCustomerByPhoneInOrg(
    storeId: number,
    phone: string,
  ): Promise<{ id: number; unique: boolean } | null> {
    const store = await this.prisma.withoutScope().stores.findFirst({
      where: { id: storeId },
      select: { organization_id: true },
    });
    if (!store) return null;

    const digitsLast10 = this.normalizePhoneLast10(phone);
    if (!digitsLast10) return null;

    // We can't filter by a computed substring on Postgres without a
    // generated column, so the practical approach is: pull all customer
    // phones in the org and match in memory. For a typical gym (≤10k
    // customers) this is cheap; for very large tenants we can add a
    // trigram index or a stored normalized column later.
    const candidates = await this.prisma.users.findMany({
      where: {
        organization_id: store.organization_id,
        phone: { not: null },
        user_roles: { some: { roles: { name: 'customer' } } },
      },
      select: { id: true, phone: true },
      take: 5000,
    });

    const matches: number[] = [];
    for (const c of candidates) {
      if (!c.phone) continue;
      if (this.normalizePhoneLast10(c.phone) === digitsLast10) {
        matches.push(c.id);
      }
    }

    if (matches.length === 0) return null;
    if (matches.length === 1) return { id: matches[0], unique: true };
    // Ambiguous — pick the first for the warning, but flag unique=false.
    return { id: matches[0], unique: false };
  }

  /**
   * `+57 300 123 4567` / `300-123-4567` / `3001234567` → `3001234567`.
   * Returns null when the input is not a valid phone (no digits).
   */
  private normalizePhoneLast10(phone: string | null | undefined): string | null {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    if (!digits) return null;
    const last10 = digits.slice(-10);
    return /^\d{10}$/.test(last10) ? last10 : null;
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
    // Tolerant parse — the AI converts per rule 7, but real OCR'd docs
    // sometimes leak DD/MM/YYYY. Use the current year for the sentinel
    // injection (no effect for a real 4-digit year).
    if (m.date_of_birth) {
      const currentYear = new Date().getFullYear();
      const parsed = this.parseFlexibleDate(m.date_of_birth, currentYear);
      if (parsed) {
        dto.date_of_birth = this.toIsoDate(parsed.date);
      } else {
        dto.date_of_birth = m.date_of_birth;
      }
    }
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