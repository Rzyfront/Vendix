/**
 * PlatformInvoicePdfService — pipeline PDF del riel plataforma (C.5.5).
 *
 * Wrapper org-scoped sobre `InvoicePdfBuilder` del riel tienda.
 * Resuelve los tres acoplamientos hardcodeados del servicio tienda:
 *   1. Llave S3 `platform/invoices/{txId}/...` (no `stores/null/`)
 *   2. Formato desde perfil plataforma `invoice_profile_versions.config` (no `store_settings`)
 *   3. Emisor desde `organization` + `organization_settings.fiscal_data` (no `invoice.store`)
 *
 * Usa `GlobalPrismaService.withoutScope()` + `platformOrg.requirePlatformContext()`
 * para evitar el IDOR que `store_id: undefined` introduciría (mismo patrón C.2/C.3/C.4).
 * El PDF se arma vía `InvoicePdfBuilder.generate()` directamente — sin pasar por
 * `InvoicePdfService` — y se sube a S3 bajo `platform/invoices/{transmissionId}/...`.
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import * as QRCode from 'qrcode';

import { ErrorCodes, VendixHttpException } from '@common/errors';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PlatformOrgService } from '../../../../common/services/platform-org.service';
import { S3Service } from '../../../../common/services/s3.service';
import { InvoicePdfBuilder, InvoicePdfData } from '../../../store/invoicing/services/invoice-pdf.builder';
import {
  PRINT_FORMATS,
  PrintFormat,
} from '../../../store/settings/interfaces/store-settings.interface';
import {
  resolveTenantFiscalIdentity,
  tryResolveTenantFiscalIdentity,
} from '@common/helpers/fiscal-identity.helper';
// CUARTA copia de la misma etiqueta, encontrada al compilar: la factura de la
// plataforma imprimía «Regimen: Responsable de IVA» con el mismo literal
// derogado (art. 506 E.T., derogado por la Ley 1943/2018 art. 122 y la Ley
// 2010/2019 art. 160). Consume ahora la derivación única del num. 12 del art. 11
// de la Res. DIAN 000165/2023 en vez de una tabla propia.
import { resolveFiscalQualitiesLine } from '../../../store/print-formats/services/fiscal-issuer-identity';
import {
  PLATFORM_FISCAL_SETTINGS_KEY,
  PLATFORM_TIMEZONE,
} from '../../../../common/constants/platform-fiscal.constants';
import { formatStoreDate } from '../../../../common/utils/store-timezone.util';
import { findFiscalResponsibility } from '../../../fiscal-operations/constants/fiscal-responsibilities.catalog';

// sharp 0.35 types are ESM-only (export default) but the CJS runtime exports the function.
const sharp: typeof import('sharp').default = require('sharp'); // eslint-disable-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment

const PLATFORM_PDF_KEY_PREFIX = 'platform/invoices';

/** Nombres legibles de las unidades DIAN de uso comun (UN/ECE tal como las publica la DIAN). */
const UNIT_LABELS: Record<string, string> = {
  EA: 'Unidad',
  NIU: 'Unidad',
  '94': 'Unidad',
  C62: 'Unidad',
  LUN: 'Mes',
  ANA: 'Ano',
  DAY: 'Dia',
  HUR: 'Hora',
  MIN: 'Minuto',
  KGM: 'Kilogramo',
  GRM: 'Gramo',
  LTR: 'Litro',
  MTR: 'Metro',
  SET: 'Conjunto',
  ZZ: 'Mutuamente definido',
};

/** Tributos DIAN (`cbc:ID`) -> rotulo corto. */
const TAX_CODE_LABELS: Record<string, string> = {
  '01': 'IVA',
  '02': 'IC',
  '03': 'ICA',
  '04': 'INC',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'borrador',
  queued: 'en cola',
  signing: 'firmando',
  signed: 'firmado',
  submitted: 'enviado a la DIAN',
  accepted: 'aceptado',
  rejected: 'rechazado',
  error: 'con error',
  retrying: 'reintentando',
  cancelled: 'cancelado',
  contingency: 'en contingencia',
  pending: 'pendiente',
  not_applicable: 'no aplica',
};

type PlatformInvoiceSnapshot = Record<string, unknown> | null;

@Injectable()
export class PlatformInvoicePdfService {
  private readonly logger = new Logger(PlatformInvoicePdfService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly platformOrg: PlatformOrgService,
    private readonly s3_service: S3Service,
  ) {}

  /**
   * Genera el PDF para la transmisión plataforma, lo sube a S3 bajo
   * `platform/invoices/{transmissionId}/invoice-{document_number}.pdf`
   * y persiste el S3 key en `fiscal_transmissions.pdf_url`.
   *
   * Lazy: si ya existe `pdf_url`, devuelve la URL firmada sin regenerar
   * (mismo patrón que `InvoicePdfService.getPdf`).
   */
  async generatePdf(transmission_id: number): Promise<{ key: string; url: string }> {
    return this.generateOrRetrieve(transmission_id, false);
  }

  /**
   * Alias lazy de `generatePdf` — atiende el contrato `getPdf` del plan.
   * Si el PDF ya está en S3, firma y devuelve; si no, genera.
   */
  async getPdf(transmission_id: number): Promise<{ key: string; url: string }> {
    return this.generateOrRetrieve(transmission_id, false);
  }

  /**
   * Versión Buffer del PDF — no persiste en S3, útil para previsualizar
   * sin quemar consecutivo ni tocar la tabla.
   *
   * Si la transmisión existe, usa sus datos reales; si no, fabrica una
   * muestra con el emisor plataforma (mismo patrón que `InvoicePdfService.previewPdf`
   * pero org-scoped).
   */
  async previewPdf(transmission_id: number): Promise<Buffer> {
    const ctx = await this.platformOrg.requirePlatformContext();
    const transmission = await this.loadTransmission(transmission_id, ctx.organization_id);

    // Si no existe la transmisión, fabrica preview de muestra con emisor real
    if (!transmission) {
      return this.buildSamplePreview(ctx.organization_id);
    }

    const org = await this.loadPlatformOrganization(ctx.organization_id);
    // Preview: permisivo — el operador está configurando, no emitiendo.
    const issuer = this.resolveIssuer(org, false);
    const format = await this.resolveInvoiceFormat(ctx.organization_id, transmission);

    const logo_buffer = await this.loadLogo(issuer.logo_url, 'platform PDF preview');

    const snapshot = await this.loadTransmissionSnapshot(transmission.id);
    const pdf_data = await this.buildPdfDataFromTransmission(
      transmission,
      snapshot,
      org,
      issuer,
      logo_buffer,
      format,
    );

    return InvoicePdfBuilder.generate(pdf_data);
  }

  /**
   * Fuerza regeneración del PDF aunque ya exista en S3.
   */
  async regeneratePdf(transmission_id: number): Promise<{ key: string; url: string }> {
    return this.generateOrRetrieve(transmission_id, true);
  }

  /** Lectura de plataforma para diagnóstico — NO es el endpoint público. */
  async diagnoseScope(transmission_id: number): Promise<{
    org_id: number | null;
    store_id: number | null;
    invoice_status: string | null;
  }> {
    try {
      const ctx = await this.platformOrg.getPlatformContext();
      if (!ctx) return { org_id: null, store_id: null, invoice_status: null };
      return {
        org_id: ctx.organization_id,
        store_id: null,
        invoice_status: 'resolved',
      };
    } catch {
      return { org_id: null, store_id: null, invoice_status: null };
    }
  }

  // ─── Internals ────────────────────────────────────────────────────────

  private async generateOrRetrieve(
    transmission_id: number,
    force: boolean,
  ): Promise<{ key: string; url: string }> {
    const ctx = await this.platformOrg.requirePlatformContext();
    const transmission = await this.loadTransmission(transmission_id, ctx.organization_id);

    if (!transmission) {
      // Fallback: intenta `invoices` por compatibilidad (algunos paths legacy usan invoices)
      const invoice = await this.prisma.withoutScope().invoices.findFirst({
        where: { id: transmission_id, organization_id: ctx.organization_id },
        select: { id: true, pdf_url: true },
      });
      if (invoice) {
        return this.generateFromInvoice(invoice.id, ctx.organization_id, force);
      }
      throw new VendixHttpException(
        ErrorCodes.INVOICING_FIND_001,
        `No se encontro transmision plataforma con id=${transmission_id} en org=${ctx.organization_id}`,
        { transmission_id, platform_organization_id: ctx.organization_id },
      );
    }

    // La llave S3 lleva estado de transmision + hash del snapshot: si cualquiera
    // cambia, la llave cambia y el PDF se regenera (antes se guardaba una vez y
    // quedaba con datos/estado viejos para siempre).
    const snapshot = await this.loadTransmissionSnapshot(transmission.id);
    const s3_key = this.buildS3Key(transmission, snapshot);

    if (!force && transmission.pdf_url === s3_key) {
      try {
        const url = await this.s3_service.getPresignedUrl(s3_key);
        this.logger.log(`PDF cache hit for platform transmission #${transmission_id} (${s3_key})`);
        return { key: s3_key, url };
      } catch (error) {
        this.logger.warn(
          `Failed to sign existing pdf_url for transmission #${transmission_id}: ${(error as Error)?.message} — regenerating`,
        );
      }
    }

    const org = await this.loadPlatformOrganization(ctx.organization_id);
    const is_electronic_document = transmission.dian_status !== 'not_applicable';
    const issuer = this.resolveIssuer(org, is_electronic_document);
    const format = await this.resolveInvoiceFormat(ctx.organization_id, transmission);

    const logo_buffer = await this.loadLogo(issuer.logo_url, 'platform invoice PDF');

    const pdf_data = await this.buildPdfDataFromTransmission(
      transmission,
      snapshot,
      org,
      issuer,
      logo_buffer,
      format,
    );

    const pdf_buffer = await InvoicePdfBuilder.generate(pdf_data);

    await this.s3_service.uploadFile(pdf_buffer, s3_key, 'application/pdf');

    await this.prisma.withoutScope().fiscal_transmissions.update({
      where: { id: transmission.id },
      data: { pdf_url: s3_key },
    });

    const url = await this.s3_service.getPresignedUrl(s3_key);
    this.logger.log(`PDF generated for platform transmission #${transmission.document_number} (${s3_key})`);
    return { key: s3_key, url };
  }

  private async generateFromInvoice(
    invoice_id: number,
    platform_org_id: number,
    force: boolean,
  ): Promise<{ key: string; url: string }> {
    const invoice = await this.prisma.withoutScope().invoices.findFirst({
      where: { id: invoice_id, organization_id: platform_org_id },
      include: {
        invoice_items: true,
        invoice_taxes: true,
        resolution: {
          select: {
            resolution_number: true,
            prefix: true,
            range_from: true,
            range_to: true,
            resolution_date: true,
            valid_from: true,
            valid_to: true,
          },
        },
        organization: {
          select: {
            id: true,
            name: true,
            legal_name: true,
            tax_id: true,
            phone: true,
            email: true,
            logo_url: true,
            fiscal_scope: true,
            addresses: { take: 1 },
            organization_settings: { select: { settings: true } },
          },
        },
        customer: { select: { id: true, first_name: true, last_name: true, email: true } },
      },
    });

    if (!invoice) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_FIND_001,
        `No se encontro invoice plataforma con id=${invoice_id}`,
        { invoice_id, platform_organization_id: platform_org_id },
      );
    }

    if (!force && (invoice as any).pdf_url) {
      try {
        const url = await this.s3_service.getPresignedUrl((invoice as any).pdf_url);
        return { key: (invoice as any).pdf_url, url };
      } catch {}
    }

    const org = await this.loadPlatformOrganization(platform_org_id);
    const is_electronic_document = (invoice as any).dian_status !== 'not_applicable';
    const issuer = this.resolveIssuer(org, is_electronic_document);
    const format = await this.resolveInvoiceFormat(platform_org_id, invoice as any);

    const logo_buffer = await this.loadLogo(issuer.logo_url, 'platform invoice PDF (invoices fallback)');

    const customer_address = this.formatCustomerAddress((invoice as any).customer_address);
    const customer = (invoice as any).customer;
    const customer_name =
      (invoice as any).customer_name ||
      (customer ? `${customer.first_name} ${customer.last_name}` : 'Consumidor Final');
    const resolution = (invoice as any).resolution;

    const pdf_data: InvoicePdfData = {
      company_name: issuer.legal_name,
      company_nit: issuer.nit,
      company_address: issuer.address_line,
      company_phone: issuer.phone,
      company_email: issuer.email,
      company_logo_buffer: logo_buffer,
      company_trade_name: issuer.trade_name,
      company_fiscal_qualities: issuer.fiscal_qualities,
      company_tax_responsibilities: issuer.tax_responsibilities,
      format,
      resolution_number: resolution?.resolution_number,
      resolution_date: resolution?.resolution_date ? this.formatDate(resolution.resolution_date) : undefined,
      resolution_range_from: resolution?.range_from,
      resolution_range_to: resolution?.range_to,
      resolution_prefix: resolution?.prefix,
      resolution_valid_from: resolution?.valid_from ? this.formatDate(resolution.valid_from) : undefined,
      resolution_valid_to: resolution?.valid_to ? this.formatDate(resolution.valid_to) : undefined,
      customer_name,
      customer_tax_id: (invoice as any).customer_tax_id || undefined,
      customer_address,
      customer_email: customer?.email || undefined,
      invoice_number: (invoice as any).invoice_number,
      invoice_type: (invoice as any).invoice_type,
      issue_date: this.formatDate((invoice as any).issue_date),
      due_date: (invoice as any).due_date ? this.formatDate((invoice as any).due_date) : undefined,
      payment_date: (invoice as any).payment_date ? this.formatDate((invoice as any).payment_date) : undefined,
      currency: (invoice as any).currency || 'COP',
      notes: (invoice as any).notes || undefined,
      items: ((invoice as any).invoice_items || []).map((item: any) => ({
        description: item.description,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        discount_amount: Number(item.discount_amount),
        tax_amount: Number(item.tax_amount),
        total_amount: Number(item.total_amount),
        applied_price_tier_name: item.applied_price_tier_name ?? null,
        stock_units_consumed:
          typeof item.stock_units_consumed === 'number' ? item.stock_units_consumed : null,
        serial_numbers_snapshot: item.serial_numbers_snapshot ?? null,
      })),
      taxes: ((invoice as any).invoice_taxes || []).map((tax: any) => ({
        tax_name: tax.tax_name,
        tax_rate: Number(tax.tax_rate),
        taxable_amount: Number(tax.taxable_amount),
        tax_amount: Number(tax.tax_amount),
      })),
      subtotal_amount: Number((invoice as any).subtotal_amount),
      discount_amount: Number((invoice as any).discount_amount),
      tax_amount: Number((invoice as any).tax_amount),
      withholding_amount: Number((invoice as any).withholding_amount),
      total_amount: Number((invoice as any).total_amount),
      cufe: (invoice as any).cufe || undefined,
      qr_code: (invoice as any).qr_code || undefined,
      qr_code_buffer: await this.renderVerificationQr((invoice as any).qr_code),
      payment_form: (invoice as any).payment_form || undefined,
      payment_method: (invoice as any).payment_means_code || undefined,
    };

    const pdf_buffer = await InvoicePdfBuilder.generate(pdf_data);
    const s3_key = this.buildLegacyS3Key(invoice.id, (invoice as any).invoice_number);

    await this.s3_service.uploadFile(pdf_buffer, s3_key, 'application/pdf');
    await this.prisma.withoutScope().invoices.update({
      where: { id: invoice.id },
      data: { pdf_url: s3_key } as any,
    });

    const url = await this.s3_service.getPresignedUrl(s3_key);
    return { key: s3_key, url };
  }

  private async loadTransmission(transmission_id: number, platform_org_id: number) {
    return this.prisma.withoutScope().fiscal_transmissions.findFirst({
      where: {
        id: transmission_id,
        organization_id: platform_org_id,
        source_type: { in: ['platform_invoice', 'platform_support_document'] },
      },
    });
  }

  private async loadPlatformOrganization(organization_id: number) {
    const org = await this.prisma.withoutScope().organizations.findFirst({
      where: { id: organization_id },
      select: {
        id: true,
        name: true,
        legal_name: true,
        tax_id: true,
        phone: true,
        email: true,
        logo_url: true,
        fiscal_scope: true,
        document_type: true,
        person_type: true,
        fiscal_responsibilities: true,
        addresses: { take: 1 } as any,
        organization_settings: { select: { settings: true } },
      },
    });
    if (!org) {
      throw new VendixHttpException(
        ErrorCodes.PLATFORM_FISCAL_SCOPE_MISSING,
        `Organizacion plataforma id=${organization_id} no encontrada`,
        { organization_id },
      );
    }
    // Include addresses relation shape expected by resolveIssuer: array of objects
    // Prisma returns addresses as array; ensure we have it.
    return org as any;
  }

  private resolveIssuer(org: any, strict = true) {
    const fiscal = ((org?.organization_settings?.settings as any)?.fiscal_data ?? null) as
      | Record<string, unknown>
      | null;
    const address = org?.addresses?.[0] ?? null;

    const source = {
      nit: org?.tax_id || '',
      fiscal_data: fiscal,
      entity: org ? { legal_name: org.legal_name, name: org.name } : null,
      organization: org
        ? {
            legal_name: org.legal_name,
            name: org.name,
            email: org.email,
            phone: org.phone,
            document_type: org.document_type,
            person_type: org.person_type,
            fiscal_responsibilities: org.fiscal_responsibilities,
          }
        : null,
      address: address
        ? {
            address_line1: (address as any).address_line1 ?? (address as any).line ?? null,
            city: (address as any).city ?? null,
            state_province: (address as any).state_province ?? (address as any).department_code ?? null,
            municipality_code: (address as any).municipality_code ?? null,
            postal_code: (address as any).postal_code ?? null,
            phone_number: (address as any).phone_number ?? null,
          }
        : null,
      email: org?.email,
    };

    const identity = strict
      ? resolveTenantFiscalIdentity(source)
      : tryResolveTenantFiscalIdentity(source).identity;

    const address_line =
      identity.fiscal_address && (identity.city || identity.department)
        ? [identity.fiscal_address, identity.city, identity.department].filter(Boolean).join(', ')
        : identity.fiscal_address || undefined;

    const nit = identity.nit ? (identity.nit_dv ? `${identity.nit}-${identity.nit_dv}` : identity.nit) : 'N/A';

    return {
      legal_name: identity.legal_name,
      nit,
      trade_name: org?.name || undefined,
      address_line,
      phone: identity.phone,
      email: identity.email || org?.email || undefined,
      logo_url: org?.logo_url || undefined,
      fiscal_qualities: resolveFiscalQualitiesLine(
        identity.tax_responsibilities,
      ),
      tax_responsibilities: identity.tax_responsibilities,
    };
  }

  private async resolveInvoiceFormat(
    organization_id: number,
    transmission?: any,
  ): Promise<PrintFormat> {
    // 1) Intenta desde el perfil plataforma referenciado por la transmisión, si existe evidencia
    //    con profile_id. El snapshot actual no lo guarda, pero si en el futuro se añade,
    //    este camino ya lo respeta.
    try {
      if (transmission?.profile_id) {
        const version = await this.prisma
          .withoutScope()
          .invoice_profile_versions.findFirst({
            where: {
              profile_id: transmission.profile_id,
              version: transmission.profile_version ?? transmission.profileVersion ?? 1,
            },
            select: { config: true },
          });
        const candidate = this.extractPrintFormatFromConfig(version?.config);
        if (candidate) return candidate;
      }
    } catch {}

    // 2) Perfil por defecto / más reciente de la plataforma
    try {
      const profile = await this.prisma.withoutScope().invoice_profiles.findFirst({
        where: { organization_id, store_id: null, state: 'active' },
        orderBy: [{ is_default: 'desc' }, { updated_at: 'desc' }],
        select: { id: true, current_version: true },
      });
      if (profile) {
        const version = await this.prisma
          .withoutScope()
          .invoice_profile_versions.findFirst({
            where: { profile_id: profile.id, version: profile.current_version },
            select: { config: true },
          });
        const candidate = this.extractPrintFormatFromConfig(version?.config);
        if (candidate) return candidate;
      }
    } catch {}

    // 3) Fallback histórico del servicio tienda
    return 'letter';
  }

  private extractPrintFormatFromConfig(config: unknown): PrintFormat | null {
    if (!config || typeof config !== 'object') return null;
    const anyConfig = config as Record<string, unknown>;

    // Caso directo: config es string PrintFormat (legado / tests)
    // Caso objeto: config.format es string
    const direct =
      typeof anyConfig['format'] === 'string' ? (anyConfig['format'] as string) : null;
    if (direct && (PRINT_FORMATS as readonly string[]).includes(direct)) {
      return direct as PrintFormat;
    }

    // Caso ProfileFormatConfig: { format: { template_id, ... } } → no es PrintFormat, ignorar
    // Caso printing.invoice.format (per-document printing)
    const printing = anyConfig['printing'] as Record<string, unknown> | undefined;
    const invoicePrinting = printing?.['invoice'] as Record<string, unknown> | undefined;
    const printingFormat =
      typeof invoicePrinting?.['format'] === 'string' ? (invoicePrinting['format'] as string) : null;
    if (printingFormat && (PRINT_FORMATS as readonly string[]).includes(printingFormat)) {
      return printingFormat as PrintFormat;
    }

    // Caso legacy receipts.invoice_format
    const receipts = anyConfig['receipts'] as Record<string, unknown> | undefined;
    const receiptsFormat =
      typeof receipts?.['invoice_format'] === 'string' ? (receipts['invoice_format'] as string) : null;
    if (receiptsFormat && (PRINT_FORMATS as readonly string[]).includes(receiptsFormat)) {
      return receiptsFormat as PrintFormat;
    }

    // Caso store_settings style anidado en config.settings.receipts
    const settings = anyConfig['settings'] as Record<string, unknown> | undefined;
    const settingsReceipts = settings?.['receipts'] as Record<string, unknown> | undefined;
    const settingsFormat =
      typeof settingsReceipts?.['invoice_format'] === 'string'
        ? (settingsReceipts['invoice_format'] as string)
        : null;
    if (settingsFormat && (PRINT_FORMATS as readonly string[]).includes(settingsFormat)) {
      return settingsFormat as PrintFormat;
    }

    return null;
  }

  private async loadTransmissionSnapshot(transmission_id: number): Promise<{
    invoiceSnapshot: Record<string, unknown> | null;
    acquirerSnapshot: Record<string, unknown> | null;
  }> {
    const rows = await this.prisma.withoutScope().fiscal_evidences.findMany({
      where: {
        fiscal_transmission_id: transmission_id,
        evidence_type: 'manual_support',
      },
      orderBy: { created_at: 'desc' },
      select: { metadata: true },
      take: 10,
    });

    let invoiceSnapshot: Record<string, unknown> | null = null;
    let acquirerSnapshot: Record<string, unknown> | null = null;

    for (const row of rows as Array<{ metadata: unknown }>) {
      const meta = row.metadata as Record<string, unknown> | null;
      if (!meta || typeof meta !== 'object') continue;
      const kind = meta['kind'] as string | undefined;
      if (kind === 'platform_invoice_snapshot' && !invoiceSnapshot) {
        invoiceSnapshot = meta;
      } else if (kind === 'platform_acquirer_snapshot' && !acquirerSnapshot) {
        acquirerSnapshot = meta;
      }
      if (invoiceSnapshot && acquirerSnapshot) break;
    }

    // Fallback: si no hay snapshots separados, el mismo row puede ser el invoice snapshot
    // (buscar por presencia de items/totals)
    if (!invoiceSnapshot) {
      for (const row of rows as Array<{ metadata: unknown }>) {
        const meta = row.metadata as Record<string, unknown> | null;
        if (meta && ('items' in meta || 'totals' in meta) && !acquirerSnapshot) {
          // Heurística: si tiene items es invoice snapshot
          if (Array.isArray((meta as any).items)) {
            invoiceSnapshot = meta;
            break;
          }
        }
      }
    }

    return { invoiceSnapshot, acquirerSnapshot };
  }

  private async buildPdfDataFromTransmission(
    transmission: any,
    snapshot: { invoiceSnapshot: Record<string, unknown> | null; acquirerSnapshot: Record<string, unknown> | null },
    org: any,
    issuer: ReturnType<PlatformInvoicePdfService['resolveIssuer']>,
    logo_buffer: Buffer | undefined,
    format: PrintFormat,
  ): Promise<InvoicePdfData> {
    const invoiceSnap = snapshot.invoiceSnapshot as
      | {
          customer?: Record<string, unknown>;
          items?: Array<Record<string, unknown>>;
          totals?: { subtotal: number; tax_amount: number; total: number };
          currency?: string;
          period_start?: string | null;
          period_end?: string | null;
          withholdings?: unknown[];
          global_discount_amount?: number;
          operation_type?: string;
          issue_date?: string;
          issue_time?: string;
          payment_form?: string;
          payment_means_code?: string;
          due_date?: string | null;
          notes?: string | null;
          exchange_rate?: number | string | null;
          tax_breakdown?: Array<Record<string, unknown>>;
          resolution_id?: number | null;
        }
      | null;

    const acquirerSnap = snapshot.acquirerSnapshot as
      | {
          legal_name?: string;
          tax_id?: string;
          tax_id_dv?: string | null;
          person_type?: string;
          address?: { line?: string | null; city?: string | null; department_code?: string | null };
          email?: string | null;
          fiscal_responsibilities?: string[];
        }
      | null;

    // Cliente: prioriza acquirerSnapshot (identidad fiscal del tenant), luego customer del invoiceSnapshot, luego fallback consumidor final
    const customerFromAcquirer = acquirerSnap
      ? {
          name: acquirerSnap.legal_name || 'Consumidor Final',
          tax_id: acquirerSnap.tax_id
            ? `${acquirerSnap.tax_id}${acquirerSnap.tax_id_dv ? `-${acquirerSnap.tax_id_dv}` : ''}`
            : undefined,
          address: [acquirerSnap.address?.line, acquirerSnap.address?.city]
            .filter(Boolean)
            .join(', ') || undefined,
          email: acquirerSnap.email || undefined,
        }
      : null;

    const customerFromInvoice = invoiceSnap?.customer
      ? {
          name:
            (invoiceSnap.customer['legal_name'] as string) ||
            (invoiceSnap.customer['tax_id'] as string) ||
            'Consumidor Final',
          tax_id: invoiceSnap.customer['tax_id']
            ? `${invoiceSnap.customer['tax_id'] as string}${
                invoiceSnap.customer['tax_id_dv'] ? `-${invoiceSnap.customer['tax_id_dv'] as string}` : ''
              }`
            : undefined,
          address:
            (invoiceSnap.customer['address_line'] as string) ||
            (invoiceSnap.customer['line'] as string) ||
            undefined,
          email: (invoiceSnap.customer['email'] as string) || undefined,
        }
      : null;

    const customer = customerFromAcquirer ?? customerFromInvoice;
    const customer_name = customer?.name ?? 'Consumidor Final';
    const customer_tax_id = customer?.tax_id;
    const customer_address = customer?.address;
    const customer_email = customer?.email;

    // Items
    const rawItems = (invoiceSnap?.items as Array<Record<string, unknown>> | undefined) ?? [];
    const line_taxes: Array<{ type: string; rate: number; base: number; amount: number }> = [];
    const items: InvoicePdfData['items'] = rawItems.length
      ? rawItems.map((raw: Record<string, unknown>) => {
          const quantity = Number((raw['quantity'] as number) ?? 1);
          const unit_price = Number((raw['unit_price'] as number) ?? (raw['unitPrice'] as number) ?? 0);
          const line_total = Number(
            (raw['line_total'] as number) ?? (raw['total'] as number) ?? quantity * unit_price,
          );
          const taxes_raw = Array.isArray(raw['taxes'])
            ? (raw['taxes'] as Array<Record<string, unknown>>)
            : [];
          const parsed = taxes_raw.map((t) => ({
            type: this.taxLabelOf(t),
            rate: this.toPercent(t['rate'] ?? t['tax_rate']),
            base: Number(t['taxable_amount'] ?? t['base'] ?? 0),
            amount: Number(t['tax_amount'] ?? t['amount'] ?? 0),
          }));
          line_taxes.push(...parsed);
          const tax_from_lines = parsed.reduce((acc, t) => acc + t.amount, 0);
          const unit_code = raw['unit_code'] ? String(raw['unit_code']) : '';
          return {
            description: String(raw['description'] ?? 'Item'),
            quantity,
            unit_price,
            discount_amount: Number((raw['discount_amount'] as number) ?? (raw['discount'] as number) ?? 0),
            tax_amount:
              raw['tax_amount'] !== undefined ? Number(raw['tax_amount']) : tax_from_lines,
            total_amount: line_total,
            applied_price_tier_name: (raw['applied_price_tier_name'] as string | null) ?? null,
            stock_units_consumed:
              typeof raw['stock_units_consumed'] === 'number' ? (raw['stock_units_consumed'] as number) : null,
            serial_numbers_snapshot: (raw['serial_numbers_snapshot'] as string | null) ?? null,
            unit_label: unit_code ? (UNIT_LABELS[unit_code] ?? unit_code) : null,
            tax_label: parsed.length
              ? parsed.map((t) => `${t.type} ${this.fmtRate(t.rate)}%`).join(' + ')
              : null,
          };
        })
      : [
          {
            description: `Servicios periodo ${invoiceSnap?.period_start ?? transmission.created_at?.toISOString?.().slice(0, 10) ?? ''} — ${invoiceSnap?.period_end ?? ''}`.trim(),
            quantity: 1,
            unit_price: Number(invoiceSnap?.totals?.total ?? 0),
            discount_amount: 0,
            tax_amount: Number(invoiceSnap?.totals?.tax_amount ?? 0),
            total_amount: Number(invoiceSnap?.totals?.total ?? 0),
            applied_price_tier_name: null,
            stock_units_consumed: null,
            serial_numbers_snapshot: null,
          },
        ];

    // Desglose de impuestos: tax_breakdown del snapshot; fallback, agrupar desde las lineas.
    const breakdown_raw = Array.isArray(invoiceSnap?.tax_breakdown) ? invoiceSnap!.tax_breakdown! : [];
    let breakdown: Array<{ type: string; name: string; rate: number; base: number; amount: number }>;
    if (breakdown_raw.length) {
      breakdown = breakdown_raw.map((t) => {
        const type = this.taxLabelOf(t);
        return {
          type,
          name: t['name'] ? String(t['name']) : type,
          rate: this.toPercent(t['rate'] ?? t['tax_rate']),
          base: Number(t['base'] ?? t['taxable_amount'] ?? 0),
          amount: Number(t['amount'] ?? t['tax_amount'] ?? 0),
        };
      });
    } else {
      const grouped = new Map<string, { type: string; name: string; rate: number; base: number; amount: number }>();
      for (const t of line_taxes) {
        const key = `${t.type}|${t.rate}`;
        const cur = grouped.get(key) ?? { type: t.type, name: t.type, rate: t.rate, base: 0, amount: 0 };
        cur.base = Math.round((cur.base + t.base) * 100) / 100;
        cur.amount = Math.round((cur.amount + t.amount) * 100) / 100;
        grouped.set(key, cur);
      }
      breakdown = [...grouped.values()];
    }
    const taxes: InvoicePdfData['taxes'] = breakdown.map((t) => ({
      tax_name: t.name,
      tax_rate: t.rate,
      taxable_amount: t.base,
      tax_amount: t.amount,
    }));
    const tax_types = new Set(breakdown.map((t) => t.type));
    const tax_column_label =
      tax_types.size === 1 ? [...tax_types][0] : tax_types.size > 1 ? 'Imp.' : undefined;
    const tax_total_lines = breakdown.length
      ? breakdown.map((t) => ({ label: `${t.type} ${this.fmtRate(t.rate)}%`, amount: t.amount }))
      : undefined;

    const totals = invoiceSnap?.totals ?? { subtotal: 0, tax_amount: 0, total: 0 };
    const subtotal_amount = Number(totals.subtotal ?? 0);
    const tax_amount = Number(totals.tax_amount ?? 0);
    const total_amount = Number(totals.total ?? 0);
    const discount_amount = Number(invoiceSnap?.global_discount_amount ?? 0);
    const withholding_amount = Array.isArray(invoiceSnap?.withholdings)
      ? Math.round(
          (invoiceSnap!.withholdings as Array<Record<string, unknown>>).reduce((acc, w) => {
            const amount =
              w?.['amount'] != null
                ? Number(w['amount'])
                : Math.round(Number(w?.['base_amount'] ?? 0) * Number(w?.['rate'] ?? 0) * 100) / 100;
            return acc + (Number.isFinite(amount) ? amount : 0);
          }, 0) * 100,
        ) / 100
      : 0;

    // Resolucion usada por la factura (snapshot.resolution_id), no la clave tecnica
    const resolution = await this.loadResolutionForTransmission(transmission, invoiceSnap?.resolution_id);

    // Fecha de expedicion real (snapshot); fallback created_at para facturas viejas.
    const snap_issue = this.formatIsoDateOnly(invoiceSnap?.issue_date);
    const issue_date =
      snap_issue ??
      (transmission.created_at
        ? this.formatDate(new Date(transmission.created_at))
        : this.formatDate(new Date()));
    const due_date = this.formatIsoDateOnly(invoiceSnap?.due_date) ?? undefined;
    const issue_time =
      typeof invoiceSnap?.issue_time === 'string' && invoiceSnap.issue_time
        ? invoiceSnap.issue_time.slice(0, 8)
        : undefined;
    const currency = (invoiceSnap?.currency as string) || 'COP';
    const exchange_rate = Number(invoiceSnap?.exchange_rate);
    const currency_note =
      currency !== 'COP'
        ? `Moneda: ${currency}${
            Number.isFinite(exchange_rate) && exchange_rate > 0
              ? `  |  TRM: ${new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(exchange_rate)} COP`
              : ''
          }`
        : undefined;

    const responsibility_labels = this.resolveResponsibilityLabels(issuer.tax_responsibilities);
    const validity_legend = this.buildValidityLegend(transmission);

    const invoice_type =
      transmission.document_type === 'support_document' ? 'purchase_invoice' : 'invoice';

    return {
      company_name: issuer.legal_name,
      company_nit: issuer.nit,
      company_address: issuer.address_line,
      company_phone: issuer.phone,
      company_email: issuer.email,
      company_logo_buffer: logo_buffer,
      company_trade_name: issuer.trade_name,
      company_fiscal_qualities: issuer.fiscal_qualities,
      company_tax_responsibilities: issuer.tax_responsibilities,
      format,
      resolution_number: resolution?.resolution_number,
      resolution_date: resolution?.resolution_date ? this.formatDate(resolution.resolution_date) : undefined,
      resolution_range_from: resolution?.range_from,
      resolution_range_to: resolution?.range_to,
      resolution_prefix: resolution?.prefix,
      resolution_valid_from: resolution?.valid_from ? this.formatDate(resolution.valid_from) : undefined,
      resolution_valid_to: resolution?.valid_to ? this.formatDate(resolution.valid_to) : undefined,
      customer_name,
      customer_tax_id,
      customer_address,
      customer_email,
      invoice_number: transmission.document_number,
      invoice_type,
      issue_date,
      issue_time,
      due_date,
      currency,
      notes: invoiceSnap?.notes ? String(invoiceSnap.notes) : undefined,
      items,
      taxes,
      subtotal_amount,
      discount_amount,
      tax_amount,
      withholding_amount,
      total_amount,
      cufe: transmission.cufe || undefined,
      qr_code: transmission.qr_code || undefined,
      qr_code_buffer: await this.renderVerificationQr(transmission.qr_code),
      payment_form: invoiceSnap?.payment_form ? String(invoiceSnap.payment_form) : undefined,
      payment_method: invoiceSnap?.payment_means_code
        ? String(invoiceSnap.payment_means_code)
        : undefined,
      money_decimals: 2,
      tax_column_label,
      tax_total_lines,
      show_net_payable: true,
      currency_note,
      company_tax_responsibility_labels: responsibility_labels,
      validity_legend,
    };
  }

  private taxLabelOf(t: Record<string, unknown>): string {
    const raw = String(t['tax_type'] ?? t['code'] ?? t['tax_code'] ?? 'IVA').trim();
    return TAX_CODE_LABELS[raw] ?? raw.toUpperCase();
  }

  /** `0.19` (fraccion) o `19` (porcentaje) -> `19`. */
  private toPercent(value: unknown): number {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return 0;
    return n > 0 && n < 1 ? Math.round(n * 10000) / 100 : n;
  }

  private fmtRate(rate: number): string {
    return String(Math.round(rate * 100) / 100);
  }

  /** `YYYY-MM-DD[...]` -> `DD/MM/YYYY` sin pasar por zonas horarias. */
  private formatIsoDateOnly(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
  }

  private resolveResponsibilityLabels(codes?: string[]): string[] | undefined {
    if (!codes?.length) return undefined;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const code of codes) {
      const def = findFiscalResponsibility(code);
      const key = def?.code ?? String(code);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(def ? `${def.code} ${def.label}` : String(code));
    }
    return out;
  }

  private buildValidityLegend(transmission: any): string {
    const accepted =
      transmission.dian_status === 'accepted' || transmission.transmission_status === 'accepted';
    if (accepted) {
      return 'Documento validado por la DIAN. Esta factura electronica fue generada por Vendix y es valida conforme a la normativa de la DIAN.';
    }
    const raw = String(
      transmission.dian_status && transmission.dian_status !== 'not_applicable'
        ? transmission.dian_status
        : (transmission.transmission_status ?? 'pendiente'),
    );
    return `Documento NO validado por la DIAN — estado: ${STATUS_LABELS[raw] ?? raw}`;
  }

  /**
   * Convierte a PNG un logo WebP: pdfkit no decodifica WebP y el catch del
   * builder descartaba el logo en silencio.
   */
  private async loadLogo(logo_url: string | undefined, context: string): Promise<Buffer | undefined> {
    if (!logo_url) return undefined;
    let buffer: Buffer | undefined;
    try {
      buffer = await this.s3_service.downloadImage(logo_url);
    } catch (error) {
      this.logger.warn(`Could not download issuer logo for ${context}: ${(error as Error)?.message}`);
      return undefined;
    }
    if (!buffer) return undefined;
    const is_webp =
      buffer.length > 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP';
    if (!is_webp) return buffer;
    try {
      return await sharp(buffer).png().toBuffer();
    } catch (error) {
      this.logger.warn(`Could not convert WebP issuer logo to PNG for ${context}: ${(error as Error)?.message}`);
      return undefined;
    }
  }

  private async loadResolutionForTransmission(transmission: any, snapshot_resolution_id?: number | null) {
    const select = {
      resolution_number: true,
      prefix: true,
      range_from: true,
      range_to: true,
      resolution_date: true,
      valid_from: true,
      valid_to: true,
    } as const;
    try {
      // 1) La resolucion con que se emitio (snapshot.resolution_id).
      if (typeof snapshot_resolution_id === 'number') {
        const used = await this.prisma.withoutScope().invoice_resolutions.findUnique({
          where: { id: snapshot_resolution_id },
          select,
        });
        if (used) return used;
      }
      // 2) Por prefijo del consecutivo (facturas viejas sin resolution_id en snapshot).
      const prefix = String(transmission.document_number || '').replace(/[0-9]/g, '').slice(0, 10);
      if (prefix) {
        const byPrefix = await this.prisma.withoutScope().invoice_resolutions.findFirst({
          where: { prefix, organization_id: transmission.organization_id },
          select,
          orderBy: { created_at: 'desc' },
        });
        if (byPrefix) return byPrefix;
      }
      // 3) Ultimo recurso: la resolucion configurada hoy en la plataforma.
      const settingsRow = await this.prisma
        .withoutScope()
        .platform_settings.findUnique({ where: { key: PLATFORM_FISCAL_SETTINGS_KEY } });
      const value = (settingsRow?.value ?? {}) as { invoice_resolution_id?: number | null };
      if (value.invoice_resolution_id) {
        const res = await this.prisma.withoutScope().invoice_resolutions.findUnique({
          where: { id: value.invoice_resolution_id },
          select,
        });
        if (res) return res;
      }
    } catch (error) {
      this.logger.warn(`Could not resolve invoice resolution for platform PDF: ${(error as Error)?.message}`);
    }
    return null;
  }

  private async buildSamplePreview(organization_id: number): Promise<Buffer> {
    const org = await this.loadPlatformOrganization(organization_id);
    const issuer = this.resolveIssuer(org, false);
    const logo_buffer = await this.loadLogo(issuer.logo_url, 'platform PDF sample preview');
    const format = await this.resolveInvoiceFormat(organization_id);
    const today = this.formatDate(new Date());
    const sample_qr_url =
      'https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=MUESTRA-PLATAFORMA';
    return InvoicePdfBuilder.generate({
      company_name: issuer.legal_name,
      company_nit: issuer.nit,
      company_address: issuer.address_line,
      company_phone: issuer.phone,
      company_email: issuer.email,
      company_logo_buffer: logo_buffer,
      company_trade_name: issuer.trade_name,
      company_fiscal_qualities: issuer.fiscal_qualities,
      company_tax_responsibilities: issuer.tax_responsibilities,
      format,
      resolution_number: '00000000000',
      resolution_date: today,
      resolution_prefix: 'MUESTRA',
      resolution_range_from: 1,
      resolution_range_to: 1000,
      resolution_valid_from: today,
      resolution_valid_to: today,
      customer_name: 'CLIENTE DE MUESTRA PLATAFORMA S.A.S.',
      customer_tax_id: '900000000-0',
      customer_address: 'Direccion del cliente de muestra',
      customer_email: 'cliente@ejemplo.com',
      invoice_number: 'MUESTRA-PLAT-0001',
      invoice_type: 'invoice',
      issue_date: today,
      currency: 'COP',
      notes: 'Documento de muestra plataforma: no corresponde a una venta real.',
      items: [
        {
          description: 'Servicio SaaS de ejemplo (plataforma)',
          quantity: 1,
          unit_price: 150000,
          discount_amount: 0,
          tax_amount: 0,
          total_amount: 150000,
        },
      ],
      taxes: [],
      subtotal_amount: 150000,
      discount_amount: 0,
      tax_amount: 0,
      withholding_amount: 0,
      total_amount: 150000,
      cufe: 'MUESTRA-PLATAFORMA00000000000000000000000000000000000000000000000000000000000000000000000000',
      qr_code: sample_qr_url,
      qr_code_buffer: await this.renderVerificationQr(sample_qr_url),
      payment_form: '1',
      payment_method: '42',
    });
  }

  /**
   * `platform/invoices/<id>/<consecutivo>-<status>-<hash8>.pdf`: estado de la
   * transmision + hash corto del contenido, para regenerar al cambiar cualquiera.
   */
  private buildS3Key(
    transmission: any,
    snapshot: {
      invoiceSnapshot: PlatformInvoiceSnapshot;
      acquirerSnapshot: PlatformInvoiceSnapshot;
    },
  ): string {
    const safeNumber = String(transmission.document_number || transmission.id).replace(
      /[^A-Za-z0-9\-_]/g,
      '_',
    );
    const status = [transmission.transmission_status, transmission.dian_status]
      .filter(Boolean)
      .join('-')
      .replace(/[^A-Za-z0-9\-_]/g, '_');
    const hash = createHash('sha256')
      .update(
        JSON.stringify([
          snapshot.invoiceSnapshot,
          snapshot.acquirerSnapshot,
          transmission.cufe ?? null,
          transmission.qr_code ?? null,
        ]),
      )
      .digest('hex')
      .slice(0, 8);
    return `${PLATFORM_PDF_KEY_PREFIX}/${transmission.id}/${safeNumber}-${status}-${hash}.pdf`;
  }

  private buildLegacyS3Key(id: number, document_number: string): string {
    const safeNumber = String(document_number || id).replace(/[^A-Za-z0-9\-_]/g, '_');
    return `${PLATFORM_PDF_KEY_PREFIX}/${id}/invoice-${safeNumber}.pdf`;
  }

  private async renderVerificationQr(qr_content?: string | null): Promise<Buffer | undefined> {
    if (!qr_content) return undefined;
    try {
      return await QRCode.toBuffer(qr_content, {
        width: 320,
        margin: 1,
        color: { dark: '#000000', light: '#FFFFFF' },
      });
    } catch (error) {
      this.logger.warn(`No se pudo generar el QR de verificacion plataforma: ${(error as Error)?.message}`);
      return undefined;
    }
  }

  private formatDate(date: Date): string {
    // Step 8 — fecha en la zona de la plataforma (misma bifurcación fiscal
    // que `formatStoreDate`: instante real → convertido; medianoche UTC
    // exacta → leída tal cual), no `getDate()/getMonth()/getFullYear()`
    // crudos del contenedor.
    return formatStoreDate(new Date(date), PLATFORM_TIMEZONE);
  }

  private formatCustomerAddress(address: unknown): string | undefined {
    if (!address) return undefined;
    if (typeof address === 'string') return address;
    if (typeof address === 'object') {
      const addr = address as Record<string, unknown>;
      const parts: string[] = [];
      if (addr['address_line1']) parts.push(String(addr['address_line1']));
      if (addr['address_line2']) parts.push(String(addr['address_line2']));
      if (addr['line']) parts.push(String(addr['line']));
      if (addr['city']) parts.push(String(addr['city']));
      if (addr['state']) parts.push(String(addr['state']));
      if (addr['state_province']) parts.push(String(addr['state_province']));
      if (addr['country']) parts.push(String(addr['country']));
      return parts.length > 0 ? parts.join(', ') : undefined;
    }
    return undefined;
  }
}
