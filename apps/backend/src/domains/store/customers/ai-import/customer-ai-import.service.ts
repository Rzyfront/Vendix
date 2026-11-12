import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { computeNitDv } from '../../../../common/utils/nit.util';
import * as XLSX from 'xlsx';
import { AIEngineService } from '../../../../ai-engine/ai-engine.service';
import { AIMessage } from '../../../../ai-engine/interfaces/ai-provider.interface';
import { parseAiJson } from '../../../../ai-engine/utils/ai-json.util';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AiScanFile } from '@common/ai-scan-jobs/interfaces/ai-scan-job.interface';
import { AiScanHandlerRegistry } from '@common/ai-scan-jobs/ai-scan-handler.registry';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { CustomersService } from '../customers.service';
import { AddressesService } from '../../addresses/addresses.service';
import { CreateCustomerLocationDto } from '../../addresses/dto';
import { CreateCustomerDto } from '../dto/create-customer.dto';
import { UpdateCustomerDto } from '../dto/update-customer.dto';
import { addressKey } from './customer-ai-import.util';
import {
  AnalyzeCustomerImportDto,
  AnalyzedImportCustomer,
  AnalyzedImportLocation,
  CommitCustomerImportDto,
  CommitCustomerImportResult,
  CommitCustomerItemDto,
  CommitCustomerResult,
  CustomerImportAnalysis,
  CustomerImportScanResult,
  IMPORT_MAX_CUSTOMERS,
  IMPORT_MAX_LOCATIONS,
  ImportCustomer,
  ImportCustomerDto,
  ImportCustomerMatch,
  ImportExistingLocation,
  ImportLocation,
  ImportLocationDto,
  ImportPersonType,
  ImportRowStatus,
} from './dto/customer-ai-import.dto';

const DOCUMENT_TYPES = ['CC', 'CE', 'NIT', 'TI', 'PA', 'PEP', 'PPT', 'RC'];

const IMAGE_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PDF_MIMETYPE = 'application/pdf';
const SHEET_MIMETYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
];
const SHEET_EXTENSIONS = ['xlsx', 'xls', 'csv'];

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // imágenes y PDF
const MAX_SHEET_BYTES = 5 * 1024 * 1024; // xlsx / xls / csv
const MAX_SHEET_TEXT_CHARS = 120_000;

const sharp: typeof import('sharp').default = require('sharp'); // eslint-disable-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment -- sharp 0.35 types are ESM-only but CJS runtime exports the function

/**
 * Carga masiva de clientes asistida por IA (S7).
 *
 *   POST store/customers/ai-import/async   → encola el escaneo (kind `customer_import`)
 *   POST store/customers/ai-import/analyze → cruza con clientes existentes (sin persistir)
 *   POST store/customers/ai-import/commit  → crea / actualiza / agrega ubicaciones
 *
 * Nada se persiste antes de `commit`. `commit` reutiliza
 * `CustomersService.create/update` y `AddressesService.addCustomerLocation`;
 * no duplica ninguna regla de documento, DV ni deduplicación de direcciones.
 */
@Injectable()
export class CustomerAiImportService implements OnModuleInit {
  private readonly logger = new Logger(CustomerAiImportService.name);

  constructor(
    private readonly aiEngine: AIEngineService,
    private readonly prisma: StorePrismaService,
    private readonly customersService: CustomersService,
    private readonly addressesService: AddressesService,
    private readonly aiScanRegistry: AiScanHandlerRegistry,
  ) {}

  /** Registra el handler async `customer_import` (cola genérica `ai-scan`). */
  onModuleInit(): void {
    this.aiScanRegistry.register<CustomerImportScanResult>(
      'customer_import',
      ({ files }) => this.scanFromFiles(files),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Escaneo
  // ─────────────────────────────────────────────────────────────────────────

  toScanFile(file: Express.Multer.File): AiScanFile {
    return {
      buffer: file.buffer,
      mimeType: file.mimetype,
      originalName: file.originalname,
      size: file.size,
    };
  }

  /** Validación previa (mime/tamaño) reutilizable por el controller antes de encolar. */
  assertValidFile(file?: Express.Multer.File): void {
    this.assertValidScanFile(file ? this.toScanFile(file) : undefined);
  }

  async scanFromFiles(files: AiScanFile[]): Promise<CustomerImportScanResult> {
    const file = files?.[0];
    this.assertValidScanFile(file);

    const instruction =
      'Extract all customers and their locations from this document. Return ONLY the JSON object matching the schema defined in your system instructions.';
    let message: AIMessage;

    if (this.isSpreadsheet(file)) {
      const csv = this.spreadsheetToText(file);
      message = {
        role: 'user',
        content: `${instruction}\n\nThe document is a table exported as CSV text:\n\n${csv}`,
      };
    } else {
      const { base64, mimeType } = await this.preprocessImage(file);
      message = {
        role: 'user',
        content: [
          { type: 'text', text: instruction },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64}`,
              detail: 'high',
            },
          },
        ],
      };
    }

    const response = await this.aiEngine.run('customer_import_ocr', {}, [
      message,
    ]);

    if (!response.success || !response.content) {
      this.logger.error(
        `[CustomerImportScan] AI failed: ${response.error ?? 'no content'}`,
      );
      throw new VendixHttpException(
        ErrorCodes.SYS_INTERNAL_001,
        'La IA no pudo procesar el documento de clientes. Intenta de nuevo.',
      );
    }

    let parsed: unknown;
    try {
      parsed = parseAiJson(response.content);
    } catch (err: any) {
      this.logger.error(
        `[CustomerImportScan] Failed to parse AI response (${err?.message}). Raw content: ${response.content}`,
      );
      throw new VendixHttpException(
        ErrorCodes.SYS_INTERNAL_001,
        'No se pudo interpretar la respuesta de la IA. Intenta con un documento más claro o más corto.',
      );
    }
    return this.normalizeScan(parsed);
  }

  /**
   * Normaliza el JSON de la IA: tipos, documentos sin puntos/espacios, tipo de
   * persona inferido y fusión de clientes repetidos por (tipo, número).
   */
  normalizeScan(parsed: unknown): CustomerImportScanResult {
    const raw = (parsed ?? {}) as { customers?: unknown; warnings?: unknown };
    const warnings: string[] = Array.isArray(raw.warnings)
      ? raw.warnings.map((w) => String(w)).filter(Boolean)
      : [];
    const list = Array.isArray(raw.customers) ? raw.customers : [];

    const merged = this.mergeCustomers(
      list.map((c) => this.normalizeCustomer(c)),
    );
    if (merged.length > IMPORT_MAX_CUSTOMERS) {
      warnings.push(
        `El documento tiene más de ${IMPORT_MAX_CUSTOMERS} clientes; solo se cargaron los primeros ${IMPORT_MAX_CUSTOMERS}.`,
      );
    }
    return {
      customers: merged.slice(0, IMPORT_MAX_CUSTOMERS),
      warnings,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Análisis (sin persistir)
  // ─────────────────────────────────────────────────────────────────────────

  async analyze(dto: AnalyzeCustomerImportDto): Promise<CustomerImportAnalysis> {
    const ctx = RequestContextService.getContext();
    const storeId = ctx?.store_id;
    const organizationId = ctx?.organization_id;
    if (!storeId || !organizationId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const customers = this.mergeCustomers(
      dto.customers.map((c) => this.normalizeCustomer(c)),
    );

    const analyzed: AnalyzedImportCustomer[] = [];
    for (const customer of customers) {
      analyzed.push(
        await this.analyzeCustomer(customer, organizationId, storeId),
      );
    }

    return {
      customers: analyzed,
      summary: {
        total_customers: analyzed.length,
        total_locations: analyzed.reduce((n, c) => n + c.locations.length, 0),
        existing: analyzed.filter((c) => c.match).length,
        with_errors: analyzed.filter((c) => c.status === 'error').length,
      },
    };
  }

  private async analyzeCustomer(
    customer: ImportCustomer,
    organizationId: number,
    storeId: number,
  ): Promise<AnalyzedImportCustomer> {
    let match: ImportCustomerMatch | null = null;
    let existingKeys = new Set<string>();

    // S8 — coincidencia por identificación O correo, dentro del alcance
    // operativo (tienda u organización).
    const matches =
      customer.document_number || customer.email
        ? await this.customersService.findCustomerMatchesInScope(
            organizationId,
            storeId,
            {
              document_type: customer.document_type ?? null,
              document_number: customer.document_number ?? null,
              email: customer.email ?? null,
            },
          )
        : [];
    const existing = matches[0];
    if (existing) {
      const rows = await this.prisma.addresses.findMany({
        where: { store_id: storeId, user_id: existing.id, type: 'shipping' },
        select: {
          id: true,
          label: true,
          address_line1: true,
          city: true,
        },
        orderBy: { id: 'asc' },
      });
      const existingLocations: ImportExistingLocation[] = rows.map((r) => ({
        id: r.id,
        label: r.label ?? null,
        address_line1: r.address_line1 ?? null,
        city: r.city ?? null,
      }));
      existingKeys = new Set(
        rows.map((r) => `${addressKey(r.address_line1)}|${addressKey(r.city)}`),
      );
      match = {
        existing_customer_id: existing.id,
        display_name: existing.display_name,
        in_store: existing.in_store,
        existing_locations: existingLocations,
        matched_by: existing.matched_by,
        other_matches: matches.slice(1).map((m) => ({
          id: m.id,
          display_name: m.display_name,
          matched_by: m.matched_by,
        })),
      };
    }

    const messages: string[] = [];
    let status: ImportRowStatus = 'ready';
    const raise = (level: ImportRowStatus, message: string) => {
      messages.push(message);
      if (level === 'error' || status === 'ready') status = level;
    };

    // La IA puede leer mal el dígito de verificación: si no corresponde al
    // NIT se descarta (el alta lo calcula) y se avisa, en vez de fallar al
    // crear el lote.
    let checkedCustomer = customer;
    if (
      customer.document_type === 'NIT' &&
      customer.document_number &&
      customer.verification_digit
    ) {
      const expected = computeNitDv(customer.document_number);
      if (expected && expected !== customer.verification_digit) {
        checkedCustomer = { ...customer, verification_digit: null };
        raise(
          'warning',
          `El dígito de verificación leído (${customer.verification_digit}) no corresponde al NIT; se usará ${expected}.`,
        );
      }
    }

    // Un cliente existente no necesita nombre: solo se agregan ubicaciones.
    if (!match) {
      if (customer.person_type === 'JURIDICA') {
        if (!customer.legal_name) raise('error', 'Falta la razón social.');
      } else if (!customer.first_name) {
        raise('error', 'Falta el nombre.');
      }
      if (!customer.document_number) {
        raise('warning', 'Sin documento: no se puede detectar si ya existe.');
      }
    }

    const seen = new Set<string>();
    const locations: AnalyzedImportLocation[] = customer.locations.map((loc) => {
      const locMessages: string[] = [];
      let locStatus: ImportRowStatus = 'ready';
      if (!loc.address_line_1) {
        locMessages.push('Falta la dirección.');
        locStatus = 'error';
      }
      if (!loc.city) {
        locMessages.push('Falta la ciudad.');
        locStatus = 'error';
      }
      const key = `${addressKey(loc.address_line_1)}|${addressKey(loc.city)}`;
      const alreadyRegistered = existingKeys.has(key) && !!loc.address_line_1;
      if (alreadyRegistered) {
        locMessages.push('Ya registrada para este cliente.');
        if (locStatus === 'ready') locStatus = 'warning';
      } else if (seen.has(key) && loc.address_line_1) {
        locMessages.push('Repetida dentro de este cliente.');
        if (locStatus === 'ready') locStatus = 'warning';
      }
      seen.add(key);
      return {
        ...loc,
        already_registered: alreadyRegistered,
        status: locStatus,
        messages: locMessages,
      };
    });

    if (locations.some((l) => l.status === 'error')) {
      raise('error', 'Hay ubicaciones con datos faltantes.');
    }

    return { ...checkedCustomer, locations, match, status, messages };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Commit
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Procesa los clientes en secuencia. Un cliente que falla NO aborta el lote:
   * queda como `failed` con su mensaje y se continúa con el siguiente.
   */
  async commit(
    dto: CommitCustomerImportDto,
  ): Promise<CommitCustomerImportResult> {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const results: CommitCustomerResult[] = [];
    for (let index = 0; index < dto.customers.length; index++) {
      const item = dto.customers[index];
      try {
        results.push(await this.commitCustomer(storeId, index, item));
      } catch (error) {
        results.push({
          index,
          display_name: this.displayName(item),
          outcome: 'failed',
          customer_id: item.existing_customer_id ?? null,
          locations_added: 0,
          locations_already_registered: 0,
          location_errors: [],
          error: this.errorMessage(error),
        });
      }
    }

    return {
      created: results.filter((r) => r.outcome === 'created').length,
      updated: results.filter((r) => r.outcome === 'updated').length,
      locations_added: results.reduce((n, r) => n + r.locations_added, 0),
      locations_already_registered: results.reduce(
        (n, r) => n + r.locations_already_registered,
        0,
      ),
      skipped: results.filter((r) => r.outcome === 'skipped').length,
      failed: results.filter((r) => r.outcome === 'failed').length,
      results,
    };
  }

  private async commitCustomer(
    storeId: number,
    index: number,
    item: CommitCustomerItemDto,
  ): Promise<CommitCustomerResult> {
    const result: CommitCustomerResult = {
      index,
      display_name: this.displayName(item),
      outcome: 'skipped',
      customer_id: null,
      locations_added: 0,
      locations_already_registered: 0,
      location_errors: [],
      error: null,
    };

    if (item.action === 'skip') return result;

    let customerId: number | null = item.existing_customer_id ?? null;
    let action = item.action;
    let resolvedByConflict = false;

    if (action === 'create') {
      try {
        const created = await this.customersService.create(
          storeId,
          this.toCreateDto(item),
        );
        customerId = created.id;
        result.outcome = 'created';
      } catch (error) {
        // Carrera: el documento ya existe → se degrada a "agregar ubicaciones".
        const existingId = this.documentConflictCustomerId(error);
        if (existingId === null) throw error;
        // D6 — el documento ya existe en la organización (otra tienda o una
        // carrera): se enlaza ese cliente en vez de duplicarlo.
        customerId = existingId;
        action = 'add_locations';
        resolvedByConflict = true;
      }
    }

    if (customerId === null) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'Falta el cliente existente al que agregar las ubicaciones.',
      );
    }
    // S8 — un id que llega del cliente (o de un conflicto) debe estar dentro
    // del alcance operativo: con scope STORE no se toca un cliente que solo
    // existe en otra tienda de la organización.
    const organizationId = RequestContextService.getContext()?.organization_id;
    if (
      action !== 'create' &&
      !resolvedByConflict &&
      (!organizationId ||
        !(await this.customersService.isCustomerInDuplicateScope(
          organizationId,
          storeId,
          customerId,
        )))
    ) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'El cliente existente no pertenece a esta tienda.',
      );
    }
    result.customer_id = customerId;
    if (action !== 'create') result.outcome = 'locations_added';

    // Primero las ubicaciones: `addCustomerLocation` valida la organización y
    // vincula al cliente con la tienda (necesario antes de actualizarlo).
    for (const loc of item.locations ?? []) {
      try {
        const { created } = await this.addressesService.addCustomerLocation(
          customerId,
          this.toLocationDto(loc),
        );
        if (created) result.locations_added += 1;
        else result.locations_already_registered += 1;
      } catch (error) {
        result.location_errors.push(
          `${loc.address_line_1 ?? 'Ubicación'}: ${this.errorMessage(error)}`,
        );
      }
    }

    if (action === 'update_and_add_locations') {
      await this.customersService.update(
        storeId,
        customerId,
        this.toUpdateDto(item),
      );
      result.outcome = 'updated';
    }

    return result;
  }

  private documentConflictCustomerId(error: unknown): number | null {
    if (
      !(error instanceof VendixHttpException) ||
      error.errorCode !== ErrorCodes.SYS_CONFLICT_001.code
    ) {
      return null;
    }
    const body = error.getResponse() as {
      details?: { kind?: string; existing_customer_id?: number };
    };
    if (
      body?.details?.kind === 'document' &&
      typeof body.details.existing_customer_id === 'number'
    ) {
      return body.details.existing_customer_id;
    }
    return null;
  }

  private toCreateDto(item: ImportCustomerDto): CreateCustomerDto {
    const personType = this.resolvePersonType(item);
    const isJuridica = personType === 'JURIDICA';
    return {
      person_type: personType,
      first_name: isJuridica ? null : this.clean(item.first_name),
      last_name: isJuridica ? null : this.clean(item.last_name),
      legal_name: isJuridica ? this.clean(item.legal_name) : null,
      document_type: this.normalizeDocumentType(item.document_type) as
        | CreateCustomerDto['document_type']
        | null,
      document_number: this.normalizeDocumentNumber(item.document_number),
      verification_digit: this.normalizeDv(item.verification_digit),
      email: this.clean(item.email) ?? undefined,
      phone: this.normalizePhone(item.phone),
    };
  }

  /** Solo envía los campos que traen valor; nunca borra datos existentes. */
  private toUpdateDto(item: ImportCustomerDto): UpdateCustomerDto {
    const dto: UpdateCustomerDto = {};
    const isJuridica = this.resolvePersonType(item) === 'JURIDICA';
    const legalName = this.clean(item.legal_name);
    const firstName = this.clean(item.first_name);
    const lastName = this.clean(item.last_name);
    const email = this.clean(item.email);
    const phone = this.normalizePhone(item.phone);
    if (isJuridica) {
      if (legalName) dto.legal_name = legalName;
    } else {
      if (firstName) dto.first_name = firstName;
      if (lastName) dto.last_name = lastName;
    }
    if (email) dto.email = email;
    if (phone) dto.phone = phone;
    return dto;
  }

  private toLocationDto(loc: ImportLocationDto): CreateCustomerLocationDto {
    const code = this.clean(loc.municipality_code);
    const dto = new CreateCustomerLocationDto();
    dto.address_line_1 = this.clean(loc.address_line_1) ?? '';
    dto.address_line_2 = this.clean(loc.address_line_2) ?? undefined;
    dto.city = this.clean(loc.city) ?? '';
    dto.state = this.clean(loc.state) ?? undefined;
    dto.country = 'CO';
    dto.municipality_code = code && /^\d{5}$/.test(code) ? code : undefined;
    dto.label = this.clean(loc.label) ?? undefined;
    dto.phone_number = this.clean(loc.phone) ?? undefined;
    return dto;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers de normalización
  // ─────────────────────────────────────────────────────────────────────────

  private normalizeCustomer(input: unknown): ImportCustomer {
    const c = (input ?? {}) as Record<string, unknown>;
    const documentType = this.normalizeDocumentType(this.str(c.document_type));
    const customer: ImportCustomer = {
      person_type: null,
      first_name: this.clean(this.str(c.first_name)),
      last_name: this.clean(this.str(c.last_name)),
      legal_name: this.clean(this.str(c.legal_name)),
      document_type: documentType,
      document_number: this.normalizeDocumentNumber(this.str(c.document_number)),
      verification_digit: this.normalizeDv(this.str(c.verification_digit)),
      email: this.clean(this.str(c.email))?.toLowerCase() ?? null,
      phone: this.clean(this.str(c.phone)),
      locations: (Array.isArray(c.locations) ? c.locations : [])
        .map((l) => this.normalizeLocation(l))
        .filter((l) => this.hasLocationData(l))
        .slice(0, IMPORT_MAX_LOCATIONS),
    };
    customer.person_type = this.resolvePersonType({
      ...customer,
      person_type: this.str(c.person_type) as ImportPersonType | null,
    });
    return customer;
  }

  private normalizeLocation(input: unknown): ImportLocation {
    const l = (input ?? {}) as Record<string, unknown>;
    const code = this.clean(this.str(l.municipality_code));
    return {
      label: this.clean(this.str(l.label)),
      address_line_1: this.clean(this.str(l.address_line_1)),
      address_line_2: this.clean(this.str(l.address_line_2)),
      city: this.clean(this.str(l.city)),
      state: this.clean(this.str(l.state)),
      municipality_code: code && /^\d{5}$/.test(code) ? code : null,
      phone: this.clean(this.str(l.phone)),
    };
  }

  private hasLocationData(l: ImportLocation): boolean {
    return !!(l.address_line_1 || l.city || l.label);
  }

  /** Une clientes con el mismo (tipo, número) de documento; el resto pasa igual. */
  private mergeCustomers(customers: ImportCustomer[]): ImportCustomer[] {
    const out: ImportCustomer[] = [];
    const byKey = new Map<string, ImportCustomer>();

    for (const c of customers) {
      if (!c.document_number) {
        out.push(c);
        continue;
      }
      const key = `${c.document_type ?? ''}|${c.document_number.toLowerCase()}`;
      const base = byKey.get(key);
      if (!base) {
        byKey.set(key, c);
        out.push(c);
        continue;
      }
      for (const field of [
        'person_type',
        'first_name',
        'last_name',
        'legal_name',
        'verification_digit',
        'email',
        'phone',
      ] as const) {
        if (base[field] === null) {
          (base as unknown as Record<string, unknown>)[field] = c[field];
        }
      }
      const known = new Set(
        base.locations.map(
          (l) => `${addressKey(l.address_line_1)}|${addressKey(l.city)}`,
        ),
      );
      for (const loc of c.locations) {
        const lk = `${addressKey(loc.address_line_1)}|${addressKey(loc.city)}`;
        if (loc.address_line_1 && known.has(lk)) continue;
        known.add(lk);
        base.locations.push(loc);
      }
    }
    return out;
  }

  private resolvePersonType(c: {
    person_type?: ImportPersonType | string | null;
    document_type?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    legal_name?: string | null;
  }): ImportPersonType | null {
    if (c.person_type === 'NATURAL' || c.person_type === 'JURIDICA') {
      return c.person_type;
    }
    const docType = this.normalizeDocumentType(c.document_type);
    if (docType === 'NIT') {
      return c.first_name && !c.legal_name ? 'NATURAL' : 'JURIDICA';
    }
    if (c.legal_name && !c.first_name) return 'JURIDICA';
    if (docType || c.first_name) return 'NATURAL';
    return null;
  }

  private normalizeDocumentType(value: string | null | undefined): string | null {
    const v = (value ?? '').toUpperCase().replace(/[^A-Z]/g, '');
    return DOCUMENT_TYPES.includes(v) ? v : null;
  }

  private normalizeDocumentNumber(
    value: string | null | undefined,
  ): string | null {
    const v = (value ?? '').replace(/[^0-9A-Za-z]/g, '');
    return v ? v : null;
  }

  private normalizeDv(value: string | null | undefined): string | null {
    const v = (value ?? '').replace(/\D/g, '');
    return v.length === 1 ? v : null;
  }

  private normalizePhone(value: string | null | undefined): string | null {
    const v = (value ?? '').replace(/[^\d+#*\s()-]/g, '').trim();
    return v ? v : null;
  }

  private str(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    return null;
  }

  private clean(value: string | null | undefined): string | null {
    const v = (value ?? '').replace(/\s+/g, ' ').trim();
    return v ? v : null;
  }

  private displayName(c: {
    first_name?: string | null;
    last_name?: string | null;
    legal_name?: string | null;
    email?: string | null;
    document_number?: string | null;
  }): string {
    const person = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
    return (
      c.legal_name?.trim() ||
      person ||
      c.email ||
      c.document_number ||
      'Cliente sin nombre'
    );
  }

  private errorMessage(error: unknown): string {
    if (error instanceof VendixHttpException) {
      const body = error.getResponse() as { message?: string | string[] };
      const message = Array.isArray(body?.message)
        ? body.message.join('; ')
        : body?.message;
      return message || error.message;
    }
    return (error as Error)?.message || 'Error desconocido';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Archivos
  // ─────────────────────────────────────────────────────────────────────────

  private extension(file: AiScanFile): string {
    return (file.originalName?.split('.').pop() ?? '').toLowerCase();
  }

  private isSpreadsheet(file: AiScanFile): boolean {
    if (SHEET_MIMETYPES.includes(file.mimeType)) return true;
    return (
      file.mimeType === 'application/octet-stream' &&
      SHEET_EXTENSIONS.includes(this.extension(file))
    );
  }

  private assertValidScanFile(file?: AiScanFile): asserts file is AiScanFile {
    if (!file) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'Sube un documento para analizar.',
      );
    }
    if (this.isSpreadsheet(file)) {
      if (file.size > MAX_SHEET_BYTES) {
        throw new VendixHttpException(
          ErrorCodes.SYS_VALIDATION_001,
          'Las hojas de cálculo no pueden superar 5 MB.',
        );
      }
      return;
    }
    if (
      IMAGE_MIMETYPES.includes(file.mimeType) ||
      file.mimeType === PDF_MIMETYPE
    ) {
      if (file.size > MAX_DOCUMENT_BYTES) {
        throw new VendixHttpException(
          ErrorCodes.SYS_VALIDATION_001,
          'Las imágenes y PDF no pueden superar 10 MB.',
        );
      }
      return;
    }
    throw new VendixHttpException(
      ErrorCodes.SYS_VALIDATION_001,
      'Formato no soportado. Usa imagen (JPG, PNG, WebP), PDF, Excel (xlsx, xls) o CSV.',
    );
  }

  /** xlsx / xls / csv → texto CSV (todas las hojas con datos). */
  private spreadsheetToText(file: AiScanFile): string {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(file.buffer, { type: 'buffer' });
    } catch {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'No se pudo leer la hoja de cálculo. Verifica que no esté dañada.',
      );
    }
    const parts: string[] = [];
    for (const name of workbook.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name], {
        blankrows: false,
      });
      if (csv.trim()) {
        parts.push(workbook.SheetNames.length > 1 ? `# ${name}\n${csv}` : csv);
      }
    }
    const text = parts.join('\n\n');
    if (!text.trim()) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'La hoja de cálculo no tiene datos.',
      );
    }
    return text.length > MAX_SHEET_TEXT_CHARS
      ? text.slice(0, MAX_SHEET_TEXT_CHARS)
      : text;
  }

  /** Igual que los demás escáneres: reduce imágenes; PDF pasa crudo. */
  private async preprocessImage(
    file: AiScanFile,
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
      const processed = await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();
      return { base64: processed.toString('base64'), mimeType: 'image/jpeg' };
    } catch (err) {
      this.logger.warn(
        `[CustomerImportScan] Image preprocessing failed, using raw: ${(err as Error).message}`,
      );
      return {
        base64: file.buffer.toString('base64'),
        mimeType: file.mimeType,
      };
    }
  }
}
