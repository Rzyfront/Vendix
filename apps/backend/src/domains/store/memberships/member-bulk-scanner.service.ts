import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { membership_status_enum } from '@prisma/client';
import { AIMessage } from '../../../ai-engine/interfaces/ai-provider.interface';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AiScanFile } from '@common/ai-scan-jobs/interfaces/ai-scan-job.interface';
import { AiScanHandlerRegistry } from '@common/ai-scan-jobs/ai-scan-handler.registry';
import type { AiJobProgress } from '@common/ai-scan-jobs/ai-job-monitor.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import {
  DetectedIngestFile,
  detectIngestFile,
  IngestSheetFormat,
} from '@common/ai-ingest/ingest-file.detector';
import { SheetParserService } from '@common/ai-ingest/sheets/sheet-parser.service';
import {
  AiExtractionError,
  AiExtractionService,
  newIngestQuotaKey,
} from '@common/ai-ingest/extraction/ai-extraction.service';
import { DocumentPagesService } from '@common/ai-ingest/documents/document-pages.service';
import { readDocumentWithAi } from '@common/ai-ingest/documents/document-reader';
import {
  canDecodeHeic,
  HEIC_UNSUPPORTED_MESSAGE,
} from '@common/ai-ingest/images/image-prep';
import {
  applyColumnMapping,
  columnMappingSchema,
  ColumnMapping,
  mapColumnsBySynonyms,
  mergeAiColumnMapping,
  missingRequiredGroups,
  unmappedHeadersWithData,
} from '@common/ai-ingest/sheets/column-mapper';
import type { SheetTable } from '@common/ai-ingest/ai-ingest.types';
import { resolveStoreTimezone } from '@common/utils/store-timezone.util';
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
  RosterRowIssue,
  RosterSkippedRow,
  CommitMemberRosterDto,
  CommitMemberRosterResult,
  CommitMemberResult,
} from './dto/scan-roster.dto';
import { UpsertMemberProfileDto } from './dto/upsert-member-profile.dto';
import {
  detectSheetPlans,
  MEMBER_ANALYZE_CHUNK,
  MEMBER_FIELD_DESCRIPTIONS,
  MEMBER_MAX_SHEET_ROWS,
  MEMBER_ROSTER_SCHEMA,
  MEMBER_SHEET_FIELDS,
  memberDedupeKey,
  MemberRowRecord,
  MemberSheetField,
  membersIngestProfile,
  normalizeMemberRow,
} from './member-ingest.profile';

type ReportProgress = (progress: AiJobProgress) => Promise<void>;
type RosterAnswer = {
  document_type?: unknown;
  detected_plans?: unknown[];
  members?: unknown[];
  warnings?: unknown[];
  confidence?: unknown;
};

const APP_KEY = membersIngestProfile.appKey;
const SAMPLE_ROWS_FOR_MAPPING = 5;
const IMAGE_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * MemberBulkScannerService — backend of the "Carga masiva de socios por IA"
 * feature. 1:1 calque of `InvoiceScannerService`/`RouteSheetScannerService`:
 *
 *   POST /store/memberships/bulk-scan/async  → job `member_roster` (raw OCR)
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
export class MemberBulkScannerService implements OnModuleInit {
  private readonly logger = new Logger(MemberBulkScannerService.name);

  /**
   * Members per `analyze` request (each one costs a few queries). A sheet of
   * up to 5.000 rows is analyzed by the web in chunks of this size.
   */
  private static readonly MAX_MEMBERS_PER_ROSTER = MEMBER_ANALYZE_CHUNK;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly membershipPlansService: MembershipPlansService,
    private readonly membershipsService: MembershipsService,
    private readonly memberProfilesService: MemberProfilesService,
    private readonly customersService: CustomersService,
    private readonly responseService: ResponseService,
    private readonly aiScanRegistry: AiScanHandlerRegistry,
    private readonly sheetParser: SheetParserService,
    private readonly aiExtraction: AiExtractionService,
    private readonly documentPages: DocumentPagesService,
  ) {}

  /** Registra el handler async `member_roster` (cola generica `ai-scan`). */
  onModuleInit(): void {
    this.aiScanRegistry.register<RosterScanResult>(
      'member_roster',
      ({ files, reportProgress }) =>
        this.scanRosterFromFiles(files, reportProgress),
    );
  }

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
    return this.scanRosterFromFiles([this.toScanFile(file)]);
  }

  /**
   * Nucleo (buffer + tipo REAL por firma, sin multer): sincrono y handler
   * async. ia-cargas F2: hojas de cálculo con código (sinónimos + a lo sumo
   * UNA llamada de mapeo) y PDF/fotos por páginas con texto nativo primero.
   */
  async scanRosterFromFiles(
    files: AiScanFile[],
    reportProgress?: ReportProgress,
  ): Promise<RosterScanResult> {
    const file = files?.[0];
    const detected = this.assertValidScanFile(file);
    // One quota key per load: mapping, page batches and repairs charge one job.
    const quotaKey = newIngestQuotaKey();
    if (detected.kind === 'sheet') {
      return this.scanSheet(file, detected.sheetFormat!, reportProgress, quotaKey);
    }
    return this.scanDocument(file, detected, reportProgress, quotaKey);
  }

  /**
   * Imagen o PDF: páginas con texto nativo como texto, escaneadas y fotos como
   * imagen (fotos muy altas en franjas), lotes de 2 páginas con esquema y
   * progreso por páginas. Nunca el PDF crudo.
   */
  private async scanDocument(
    file: AiScanFile,
    detected: DetectedIngestFile,
    reportProgress: ReportProgress | undefined,
    quotaKey: string,
  ): Promise<RosterScanResult> {
    const read = await readDocumentWithAi<RosterAnswer>({
      file,
      mimeType: detected.mime,
      pages: this.documentPages,
      extraction: this.aiExtraction,
      appKey: APP_KEY,
      schema: MEMBER_ROSTER_SCHEMA,
      instruction:
        'Extract all members and plans from these pages. Return ONLY the JSON object matching the schema defined in your system instructions. Never invent data.',
      limits: membersIngestProfile.limits,
      quotaKey,
      reportProgress,
      logLabel: 'MemberRosterScan',
    });

    const scans = read.answers.map((a) => this.normalizeScanResponse(a));
    const plans = new Map<string, ExtractedPlan>();
    for (const plan of scans.flatMap((s) => s.detected_plans)) {
      const key = this.normalizeForMatch(plan.name);
      if (key && !plans.has(key)) plans.set(key, plan);
    }
    // Consecutive photo strips overlap: the same row may come twice.
    const seen = new Set<string>();
    let repeated = 0;
    const members = scans
      .flatMap((s) => s.members)
      .filter((m) => {
        const key = memberDedupeKey(m);
        if (!key) return true;
        if (seen.has(key)) {
          repeated += 1;
          return false;
        }
        seen.add(key);
        return true;
      });
    const warnings = [...scans.flatMap((s) => s.warnings), ...read.warnings];
    if (repeated) {
      warnings.push(
        `${repeated} socio(s) aparecían repetidos (mismo documento o nombre, plan y fechas) y se cargaron una sola vez.`,
      );
    }
    if (members.length > MEMBER_MAX_SHEET_ROWS) {
      warnings.push(
        `El documento tiene ${members.length} socios; solo se cargaron los primeros ${MEMBER_MAX_SHEET_ROWS}. Divide el archivo para cargar el resto.`,
      );
    }
    const kept = members.slice(0, MEMBER_MAX_SHEET_ROWS);
    const confidences = scans.map((s) => s.confidence).filter((c) => c > 0);
    return {
      document_type: scans.find((s) => s.document_type !== 'other')?.document_type ?? 'other',
      detected_plans: [...plans.values()],
      members: kept,
      warnings,
      confidence: confidences.length ? Math.min(...confidences) : 0,
      stats: {
        source: 'document',
        total_rows: kept.length,
        imported_rows: kept.length,
        skipped_rows: 0,
        mapping: null,
        pages: read.pages,
        text_pages: read.textPages,
      },
    };
  }

  /**
   * Hoja de cálculo (ia-cargas F2): parser determinista de F1 → columnas por
   * sinónimos (UNA llamada de mapeo solo si faltan obligatorios) → código para
   * todas las filas. Tope 5.000 filas; lo omitido va a `skipped` con fila.
   */
  private async scanSheet(
    file: AiScanFile,
    format: IngestSheetFormat,
    reportProgress: ReportProgress | undefined,
    quotaKey: string,
  ): Promise<RosterScanResult> {
    const progress = async (done: number, total: number, stage: string) => {
      if (!reportProgress || total <= 0) return;
      try {
        await reportProgress({ done, total, stage, unit: 'filas' });
      } catch {
        // Progress is best effort.
      }
    };

    const parsed = this.sheetParser.parse(file.buffer, format, {
      maxRows: MEMBER_MAX_SHEET_ROWS,
    });
    if (!parsed.tables.length) {
      throw new VendixHttpException(ErrorCodes.AI_INGEST_INVALID_FILE);
    }
    const warnings = [...parsed.warnings];
    const skipped: RosterSkippedRow[] = [...parsed.skipped];
    const rowIssues: RosterRowIssue[] = [];
    const columns: NonNullable<RosterScanResult['columns']> = [];
    const totalRows = parsed.tables.reduce((n, t) => n + t.rows.length, 0);
    await progress(0, totalRows, 'Leyendo la hoja');

    let mappingMode: 'synonyms' | 'ai' = 'synonyms';
    const records: MemberRowRecord[] = [];
    const multi = parsed.tables.length > 1;
    let done = 0;
    for (const table of parsed.tables) {
      const sheet = multi ? table.sheet : undefined;
      const { mapping, usedAi } = await this.mapColumns(table, warnings, quotaKey);
      if (usedAi) mappingMode = 'ai';
      for (const header of table.headers) {
        columns.push({ ...(sheet ? { sheet } : {}), column: header, field: mapping.get(header) ?? null });
      }
      if (!mapping.size) {
        warnings.push(
          `No se reconoció ninguna columna de socios${sheet ? ` en la hoja "${sheet}"` : ''}; revisa los encabezados.`,
        );
        if (table.row_numbers.length) {
          skipped.push({
            row: table.row_numbers[0],
            row_end: table.row_numbers[table.row_numbers.length - 1],
            ...(sheet ? { sheet } : {}),
            reason: 'unreadable',
            message: 'La hoja no tiene columnas de socios reconocibles.',
          });
        }
        done += table.rows.length;
        continue;
      }
      const ignored = table.headers.filter((h) => !mapping.has(h));
      if (ignored.length) {
        warnings.push(`Columnas ignoradas${sheet ? ` en "${sheet}"` : ''}: ${ignored.join(', ')}.`);
      }

      const seen = new Set<string>();
      table.rows.forEach((row, i) => {
        const ctx = { row: table.row_numbers[i], ...(sheet ? { sheet } : {}) };
        const { record, issues, skipMessage } = normalizeMemberRow(applyColumnMapping(row, mapping), ctx);
        rowIssues.push(...issues);
        if (!record) {
          skipped.push({ ...ctx, reason: 'unreadable', message: skipMessage ?? 'Fila sin datos de socio.' });
          return;
        }
        const key = memberDedupeKey(record.member);
        if (key && seen.has(key)) {
          skipped.push({
            ...ctx,
            reason: 'duplicate',
            message: 'Repite a un socio de una fila anterior con el mismo plan y fechas.',
          });
          return;
        }
        if (key) seen.add(key);
        records.push(record);
      });
      done += table.rows.length;
      await progress(done, totalRows, 'Leyendo la hoja');
    }

    const byPosition = (a: { row: number; sheet?: string }, b: { row: number; sheet?: string }) =>
      (a.sheet ?? '').localeCompare(b.sheet ?? '') || a.row - b.row;
    skipped.sort(byPosition);
    rowIssues.sort(byPosition);
    const omitted = skipped.reduce((n, s) => n + (s.row_end ? s.row_end - s.row + 1 : 1), 0);
    if (omitted) {
      warnings.push(`${omitted} fila(s) no se cargaron; mira "Filas omitidas" para ver cuáles y por qué.`);
    }
    await progress(totalRows, totalRows, 'Preparando la vista previa');

    return {
      document_type: 'spreadsheet',
      detected_plans: detectSheetPlans(records),
      members: records.map((r) => r.member),
      warnings,
      // Read by code, not guessed: the low-confidence banner does not apply.
      confidence: 100,
      skipped,
      row_issues: rowIssues,
      columns,
      stats: {
        source: 'sheet',
        total_rows: parsed.total_rows,
        imported_rows: records.length,
        skipped_rows: omitted,
        mapping: mappingMode,
      },
    };
  }

  /**
   * Encabezados → campos. Primero sinónimos; si no cubren los obligatorios (o
   * falta el documento y queda una columna con datos sin mapear), UNA llamada
   * con encabezados + 5 filas de muestra devuelve el mapeo, que luego se
   * aplica con código a todas las filas.
   */
  private async mapColumns(
    table: SheetTable,
    warnings: string[],
    quotaKey: string,
  ): Promise<{ mapping: ColumnMapping<MemberSheetField>; usedAi: boolean }> {
    const profile = membersIngestProfile;
    const synonyms = mapColumnsBySynonyms<MemberSheetField>(table.headers, profile.columnSynonyms);
    const missing = missingRequiredGroups(synonyms, profile.requiredFields);
    const sample = table.rows.slice(0, SAMPLE_ROWS_FOR_MAPPING);
    const wantedMissing =
      !missing.length &&
      missingRequiredGroups(synonyms, profile.wantedFields ?? []).length > 0 &&
      unmappedHeadersWithData(table.headers, synonyms, sample).length > 0;
    if (!missing.length && !wantedMissing) return { mapping: synonyms, usedAi: false };

    const fieldList = MEMBER_SHEET_FIELDS.map((f) => `- ${f}: ${MEMBER_FIELD_DESCRIPTIONS[f]}`).join('\n');
    const message: AIMessage = {
      role: 'user',
      content: [
        'TASK FOR THIS REQUEST (it replaces the output format of your instructions): do NOT extract members.',
        'Map each column of a gym/club member spreadsheet to ONE member field, or "ignore".',
        'Return ONLY a JSON object: {"columns":[{"column":"<exact column name>","field":"<field or ignore>"}],"warnings":[]}.',
        'Use each field at most once. Use the sample values, not only the column names.',
        'Fields:',
        fieldList,
        `Columns: ${JSON.stringify(table.headers)}`,
        `Sample rows: ${JSON.stringify(sample)}`,
      ].join('\n'),
    };
    try {
      const answer = await this.aiExtraction.extract<{
        columns?: { column?: unknown; field?: unknown }[];
      }>({
        appKey: APP_KEY,
        schema: columnMappingSchema(MEMBER_SHEET_FIELDS),
        messages: [message],
        quotaKey,
      });
      return {
        mapping: mergeAiColumnMapping(synonyms, table.headers, MEMBER_SHEET_FIELDS, answer),
        usedAi: true,
      };
    } catch (error) {
      // Required mapping and the AI is down: the job fails (and is retried).
      // An unreadable answer, or an optional call, falls back to the synonyms.
      if (!wantedMissing && (!(error instanceof AiExtractionError) || error.failure === 'ai_failed')) {
        throw error instanceof AiExtractionError ? error.toHttpException() : error;
      }
      this.logger.warn(
        `[MemberRosterScan] column mapping by AI failed (${error instanceof AiExtractionError ? error.failure : 'error'}); using synonyms only`,
      );
      warnings.push('No se pudieron reconocer todas las columnas; revisa nombres y documentos en la vista previa.');
      return { mapping: synonyms, usedAi: false };
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
  async analyzeRoster(
    scan: RosterScanResult,
    /**
     * ia-cargas F2 — members before this chunk in the whole load, so
     * `row_number` stays unique when the web analyzes a big sheet in parts.
     */
    rowOffset = 0,
  ): Promise<MemberRosterAnalysis> {
    const offset =
      Number.isInteger(rowOffset) && rowOffset > 0 ? rowOffset : 0;
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
      const row_number = offset + i + 1;

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
      //    soft — the user can fix in the modal).
      const errors: string[] = [];
      const warnings: string[] = [];

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

    const plansResolved = [...refToPlanId].map(([ref_index, plan_id]) => ({
      ref_index,
      plan_id,
    }));

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
      plans_resolved: plansResolved,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  /** Validacion previa (mime) reutilizable por el controller async antes de encolar. */
  assertValidFile(file?: Express.Multer.File): void {
    this.assertValidScanFile(file ? this.toScanFile(file) : undefined);
  }

  toScanFile(file: Express.Multer.File): AiScanFile {
    return {
      buffer: file.buffer,
      mimeType: file.mimetype,
      originalName: file.originalname,
      size: file.size,
    };
  }

  /**
   * Tipo REAL por firma (no el `mimetype` del cliente ni el que la cola
   * reconstruye desde la key de S3) y tamaño por tipo.
   */
  private assertValidScanFile(file?: AiScanFile): DetectedIngestFile {
    if (!file) {
      throw new VendixHttpException(ErrorCodes.MEMBER_SCAN_NO_FILE);
    }
    const detected = detectIngestFile(file);
    const { maxBytes } = membersIngestProfile.limits;
    if (detected?.kind === 'sheet') {
      if (file.size > maxBytes.sheet) {
        throw new VendixHttpException(
          ErrorCodes.SYS_VALIDATION_001,
          'Las hojas de cálculo no pueden superar 5 MB.',
        );
      }
      return detected;
    }
    if (
      detected &&
      (detected.kind === 'pdf' ||
        IMAGE_MIMETYPES.includes(detected.mime) ||
        (detected.mime === 'image/heic' && canDecodeHeic()))
    ) {
      if (file.size > maxBytes.pdf) {
        throw new VendixHttpException(
          ErrorCodes.SYS_VALIDATION_001,
          'Las imágenes y PDF no pueden superar 10 MB.',
        );
      }
      return detected;
    }
    if (detected?.mime === 'image/heic') {
      throw new VendixHttpException(
        ErrorCodes.AI_INGEST_UNSUPPORTED_TYPE,
        HEIC_UNSUPPORTED_MESSAGE,
      );
    }
    throw new VendixHttpException(ErrorCodes.MEMBER_SCAN_INVALID_FILE);
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
    const s = this.injectYear(startRaw, currentYear);
    const e = this.injectYear(endRaw, currentYear);

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
   * Parsea el prefijo `YYYY-MM-DD` del string. Cuando el año es un centinela
   * (`0000`, `0`) o de dos dígitos (< 100), lo reemplaza por `currentYear` y
   * marca `injected=true`. Construye la Date en HORA LOCAL a mediodía
   * (`new Date(y, m-1, d, 12)`) para que el status compare contra `today`
   * (00:00 local) sin el off-by-one de UTC. Devuelve `null` si no parsea.
   */
  private injectYear(
    dateStr: string | null,
    currentYear: number,
  ): { date: Date; injected: boolean } | null {
    if (!dateStr) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr.trim());
    if (!m) return null;

    let year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (!Number.isFinite(month) || !Number.isFinite(day)) return null;

    let injected = false;
    if (!Number.isFinite(year) || year < 100) {
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