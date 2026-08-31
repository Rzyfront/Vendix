import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PlatformOrgService } from '../../../../common/services/platform-org.service';
import { PlatformProfilesService } from './platform-profiles.service';
import {
  DIAN_PROFILE_TEMPLATES,
  findDianProfileTemplate,
} from '../../../store/invoicing/profiles/dian-profile-templates';
import { RequestContextService } from '@common/context/request-context.service';
import { InvoicingService } from '../../../store/invoicing/invoicing.service';
import { InvoiceFlowService } from '../../../store/invoicing/invoice-flow/invoice-flow.service';
import { PlatformInvoicingPersistenceService } from './platform-invoicing-persistence.service';
import { PlatformTenantsService } from './platform-tenants.service';
import { SubscriptionFiscalService } from './subscription-fiscal.service';

/**
 * CP-platform-fiscal-invoicing-mvp · Phase B.1
 *
 * Facade del rail super-admin. Traduce los DTOs `CreatePlatformSalesInvoiceDto`
 * y `CreatePlatformSupportDocumentDto` al shape del rail tienda
 * (`CreateInvoiceDto` de `apps/backend/src/domains/store/invoicing/dto/`),
 * persiste los snapshots del destinatario (ADR-7) y del invoice
 * (legacy C.11), y enrutta a `InvoicingService.create` (store rail).
 *
 * Por qué un wrapper y no una copia: el rail tienda ya implementa
 * aritmética Decimal (`InvoiceCalculatorService`), validators fiscales,
 * ClTec validation, cadena UBL. Reusar garantiza una sola fuente
 * de verdad para esas reglas — un cambio en el regimen AIU o un nuevo
 * codigo DIAN entra una vez y se aplica a los dos rails.
 *
 * Por qué `InvoicingService` reusa la ARITMETICA pero omite su UI:
 * el riel super-admin no usa `users.document_number` para el cliente
 * (ADR-7). El mapper armado en `mapToStoreCreateInvoiceDto` resuelve
 * el tenant del disk (PRD de Phase A.3) y plasma los datos en
 * `customer_*` que el riel tienda acepta (esos campos son
 * snapshot-fields en `invoices`, no FK a `users`).
 *
 * DI wiring: este servicio inyecta `InvoicingService`,
 * `InvoiceFlowService`, `PlatformInvoicingPersistenceService` y
 * `PlatformTenantsService`. Provider registration es Phase B.5.
 *
 * Regla: NO escribe codigo nuevo de aritmetica. NO redefine validaciones
 * AIU, ClTec, ni tax breakdown. NO toca nada del riel tienda.
 */

interface Deps {
  invoicingService: any;
  invoiceFlowService: any;
  persistence: any;
  tenants: any;
  subscriptionFiscalService: any;
}

@Injectable()
export class PlatformInvoicingService {
  private readonly logger = new Logger(PlatformInvoicingService.name);

  constructor(
    private readonly prismaService: GlobalPrismaService,
    private readonly invoicingService: InvoicingService,
    private readonly invoiceFlowService: InvoiceFlowService,
    private readonly persistence: PlatformInvoicingPersistenceService,
    private readonly tenants: PlatformTenantsService,
    private readonly subscriptionFiscalService: SubscriptionFiscalService,
    private readonly platformOrg: PlatformOrgService,
    private readonly platformProfiles: PlatformProfilesService,
  ) {}

  private get prismaClient(): PrismaClient | Prisma.TransactionClient {
    return this.prismaService as unknown as PrismaClient;
  }

  /**
   * Expose prisma a sub-services que lo reciben como parametro.
   * Por ejemplo `PlatformTenantsService.searchTenants(prisma, ...)`.
   * Solo lectura — el caller NO debe mutar.
   */
  get prisma(): any {
    return this.prismaService as unknown as PrismaClient;
  }

  /**
   * Crea y emite una `sales_invoice` del rail super-admin contra un
   * tenant cliente (ADR-7: NO contra `users`).
   *
   * Pasos:
   *   1. Resuelve el tenant desde `PlatformTenantsService` (id derivado
   *      del `kind:'store'|'organization'`).
   *   2. Persiste `platform_acquirer_snapshot` dentro de la Tx (identidad
   *      fiscal del destinatario, immutable para re-intentos).
   *   3. Llama `InvoicingService.create(storeCreateInvoiceDto, actorUserId)`.
   *   4. Persiste `platform_invoice_snapshot` (payload completo del doc).
   *
   * El dest_handle DEVUELVE `{ invoice_id (= transmission.id), ... }`
   * manteniendo la shape existente (paridad con legacy `createPlatformInvoice`).
   */
  async createSalesInvoice(args: {
    organizationId: number;
    accountingEntityId: number;
    dianConfigurationId: number;
    actorUserId: number;
    dto: any;
  }): Promise<{
    invoice_id: number;
    transmission_id: number;
    fiscal_number: string;
    transmission_status: string;
    dian_status: string;
    cufe: string | null;
  }> {
    let tenant: any;
    if (args.dto.customer?.kind === 'external') {
      if (!args.dto.customer.legal_name?.trim() || !args.dto.customer.tax_id?.trim()) {
        throw new VendixHttpException(
          ErrorCodes.SYS_VALIDATION_001,
          'El cliente externo requiere nombre o razón social y NIT / documento válido.',
        );
      }
      tenant = {
        kind: 'external',
        tenant_id: 0,
        name: args.dto.customer.legal_name,
        legal_name: args.dto.customer.legal_name,
        tax_id: args.dto.customer.tax_id,
        tax_id_dv: args.dto.customer.tax_id_dv ?? '0',
        document_type: args.dto.customer.document_type ?? 'NIT',
        person_type: args.dto.customer.person_type ?? '2',
        tax_regime_code: args.dto.customer.tax_regime_code ?? '49',
        fiscal_responsibilities: args.dto.customer.fiscal_responsibilities ?? ['R-99-PN'],
        email: args.dto.customer.email ?? null,
        phone: args.dto.customer.phone ?? null,
        address: {
          line: args.dto.customer.address?.line ?? null,
          city: args.dto.customer.address?.city ?? null,
          department_code: args.dto.customer.address?.department_code ?? null,
        },
      };
    } else {
      tenant = await this.tenants.getTenantByKindAndId(this.prismaClient, {
        organizationId: args.organizationId,
        kind: args.dto.customer.kind,
        id: args.dto.customer.tenant_id,
      });
      if (!tenant) {
        throw new VendixHttpException(
          ErrorCodes.INVOICING_TENANT_NOT_FOUND,
          `No se encontro el destinatario ${args.dto.customer.kind}:${args.dto.customer.tenant_id} en la plataforma.`,
        );
      }
    }

    if (args.dto.profile_id) {
      await this.assertPlatformProfileMatchesOperation(
        args.dto.profile_id,
        args.dto.operation_type,
        args.organizationId,
      );
    }

    const storeCreateDto = this.mapToStoreCreateInvoiceDto(args.dto, tenant);
    const validationError = this.validateCreateInput(args.dto, storeCreateDto);
    if (validationError) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        validationError,
      );
    }

    if (args.dto.currency?.iso_4217 === 'USD') {
      const rate = Number(args.dto.currency?.exchange_rate);
      if (!args.dto.currency?.exchange_rate || rate <= 0) {
        throw new VendixHttpException(
          ErrorCodes.INVOICING_TRM_001,
          'Factura en USD requiere exchange_rate > 0 (TRM oficial o tasa manual).',
        );
      }
      if (rate === 1) {
        throw new VendixHttpException(
          ErrorCodes.INVOICING_TRM_001,
          'exchange_rate = 1 no es una tasa valida (1 = identity, no conversion).',
        );
      }
    }

    const legacyDto = this.mapMvpV1ToLegacyCreateDto(args.dto, tenant);
    const legacyResult = await this.subscriptionFiscalService.createPlatformInvoice(legacyDto);

    if (args.dto.save_as_profile?.name) {
      try {
        // Delega en `PlatformProfilesService.create`, que es el unico camino que
        // escribe la fila del perfil y su version 1 en la MISMA transaccion. El
        // `create` crudo que vivia aqui escribia `invoice_profiles` directo y no
        // creaba `invoice_profile_versions`, dejando `current_version: 1`
        // apuntando a una version inexistente — la corrupcion que el comentario
        // de `current_version` en schema.prisma advierte.
        //
        // El snapshot va anidado bajo `dian` porque esa es la forma que
        // `normalizeAndAssertProfileConfig` conoce; las claves planas que se
        // pasaban antes se habrian rechazado uno por uno como desconocidas.
        // El cruce de nombres es deliberado y sigue a UBL:
        //   · `payment_form` ('1' contado / '2' credito) es `cbc:PaymentMeansCode`
        //   · `payment_means_code` ('10' efectivo)       es `cbc:PaymentMeansID`
        // que el contrato nombra `payment_means_code` y `payment_method_code`.
        // `config` es el snapshot COMPLETO del documento fiscal — diez
        // secciones —, no las cuatro claves que la emisión conoce. Mandar sólo
        // `dian` lo hace rechazar por `config_version`,
        // `format.display_decimals` y `format.show_aiu_breakdown`, y el catch
        // de abajo lo habría enterrado en un WARN. Por eso se parte de la
        // plantilla canónica del MISMO `operation_type` — la única fuente que
        // ya trae las diez secciones válidas — y encima se sobreescribe sólo lo
        // que la factura sí capturó.
        const operationType = args.dto.operation_type ?? '10';
        const template =
          DIAN_PROFILE_TEMPLATES.find(
            (t) => t.operation_type === operationType,
          ) ?? findDianProfileTemplate('dian-standard')!;

        await this.platformProfiles.create({
          name: args.dto.save_as_profile.name,
          operation_type: operationType,
          state: 'active',
          is_default: args.dto.save_as_profile.is_default ?? false,
          config: {
            ...template.config,
            dian: {
              ...template.config.dian,
              resolution_id: args.dto.resolution_id ?? null,
              payment_means_code: args.dto.payment_form ?? '1',
              payment_method_code: args.dto.payment_means_code ?? '10',
              header_notes: args.dto.notes ? [args.dto.notes] : null,
            },
          },
        });
      } catch (err) {
        // Guardar el perfil es accesorio a emitir: la factura ya se timbro y no
        // se puede deshacer, asi que un perfil que no nace no puede tumbar la
        // respuesta. Queda en WARN a proposito.
        this.logger.warn(`Error guardando perfil desde factura: ${err}`);
      }
    }

    return {
      invoice_id: legacyResult.transmission_id,
      transmission_id: legacyResult.transmission_id,
      fiscal_number: legacyResult.fiscal_number,
      transmission_status: legacyResult.transmission_status,
      dian_status: legacyResult.dian_status,
      cufe: legacyResult.cufe,
    };
  }

  /**
   * Crea un `support_document` (DSA) del rail super-admin.
   *
   * MVP: el legacy `subscriptionFiscalService` no tiene un
   * `createPlatformSupportDocument` paralelo (solo existe para
   * `sales_invoice`). Hasta que se cree ese camino, devolvemos 501
   * con `INVOICING_DOCUMENT_TYPE_UNSUPPORTED_V1` para que el operador
   * sepa que es una omision del MVP, no un bug de validacion.
   *
   * FB-02 queda marcado deferred hasta que la facade V1 tenga su
   * propio camino de emision DSA — lo cual requiere extender el
   * legacy service para aceptar `source_type='platform_support_document'`
   * (mismo patron que el sales_invoice BYPASS que esta facade usa).
   */
  async createSupportDocument(_args: {
    organizationId: number;
    accountingEntityId: number;
    dianConfigurationId: number;
    actorUserId: number;
    dto: any;
  }): Promise<{
    invoice_id: number;
    transmission_id: number;
    fiscal_number: string;
    transmission_status: string;
    dian_status: string;
    cufe: string | null;
  }> {
    // MVP: support_document necesita un camino legacy paralelo
    // (`createPlatformSupportDocument`) que NO existe en
    // `subscription-fiscal.service` — solo `createPlatformInvoice` para
    // ventas. Hasta que se cree ese camino, devolvemos 501 con código
    // dedicado para que el operador sepa que es una omisión del MVP, no
    // un bug de validación. FB-02 queda marcado deferred.
    throw new VendixHttpException(
      ErrorCodes.INVOICING_DOCUMENT_TYPE_UNSUPPORTED_V1,
      `Soporte para documentos soporte (DSA) en el rail plataforma no esta implementado en MVP. Usa /sales-invoices (FB-01) o espera una iteracion posterior que agregue createPlatformSupportDocument.`,
    );
  }

  /**
   * Envia una transmision a DIAN. Reusa `InvoiceFlowService.send` del
   * riel tienda. Si el caller pasa `invoiceId` (numeric) lo traduce
   * a `fiscal_transmission.id` (porque el detail de plataforma vive
   * sobre `transmissions.id`).
   */
  async sendInvoice(args: {
    invoiceId: number;
    actorUserId: number;
    force?: boolean;
  }) {
    // MVP: en V1 los platform_invoice NO referencian un subscription_invoice
    // (source_id=0). InvoiceFlowService.send exige ese lookup con store
    // scope, lo que rompe en riel plataforma. Devolvemos la transmision
    // existente — el operador puede re-disparar via retryTransmission
    // (que SI dispatch por source_type y reusa el provider directo).
    const transmission = await this.prismaClient.fiscal_transmissions.findFirst({
      where: {
        id: args.invoiceId,
        source_type: { in: ['platform_invoice', 'platform_support_document'] },
      },
    });
    if (!transmission) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_FIND_001,
        `No se encontro transmision platform_invoice/platform_support_document con id=${args.invoiceId}`,
      );
    }
    return {
      transmission_status: transmission.transmission_status,
      dian_status: transmission.dian_status,
      cufe: transmission.cufe,
      fiscal_number: transmission.document_number,
      document_type: transmission.document_type,
    };
  }

  /**
   * Cancela un documento platform en estado draft/validated. Reusa
   * `InvoiceFlowService.cancel`. El id es el de transmision (viene del
   * detail endpoint del rail plataforma).
   */
  async cancelInvoice(args: { invoiceId: number; actorUserId: number; reason?: string }) {
    // MVP: source_id=0 → no podemos invocar InvoiceFlowService.cancel
    // (rompe store scope). Marcamos la transmision como cancelled
    // directamente via prisma + retornamos el estado actualizado.
    const transmission = await this.prismaClient.fiscal_transmissions.findFirst({
      where: {
        id: args.invoiceId,
        source_type: { in: ['platform_invoice', 'platform_support_document'] },
      },
    });
    if (!transmission) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_FIND_001,
        `No se encontro transmision con id=${args.invoiceId}`,
      );
    }
    if (
      transmission.transmission_status === 'accepted' ||
      transmission.transmission_status === 'cancelled'
    ) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_TRANSITION_001,
        `No se puede cancelar transmision en estado ${transmission.transmission_status}`,
      );
    }
    const updated = await this.prismaClient.fiscal_transmissions.update({
      where: { id: transmission.id },
      data: {
        transmission_status: 'cancelled',
        accounting_status: 'blocked',
      },
    });
    return {
      id: updated.id,
      state: 'cancelled',
      transmission_status: updated.transmission_status,
      dian_status: updated.dian_status,
    };
  }

  /**
   * Prevalidacion pasiva: invoca `InvoiceFlowService.getEmitReadiness`
   * para devolver la misma shape `{blockers, warnings, computed}` que
   * el rail tienda. El frontend la pinta sin transformacion.
   */
  async evaluateReadiness(args: {
    organizationId: number;
    invoiceId: number;
  }) {
    // MVP: source_id=0 rompe invoiceFlowService.getEmitReadiness (store scope).
    // Construimos la misma shape `{blockers, warnings, computed}` desde la
    // fila de fiscal_transmissions directamente.
    const transmission = await this.prismaClient.fiscal_transmissions.findFirst({
      where: {
        id: args.invoiceId,
        source_type: { in: ['platform_invoice', 'platform_support_document'] },
      },
    });
    if (!transmission) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_FIND_001,
        `No se encontro transmision con id=${args.invoiceId}`,
      );
    }
    const blockers: Array<{ code: string; problem: string; fix: string }> = [];
    const warnings: Array<{ code: string; problem: string }> = [];
    if (!transmission.document_number) {
      blockers.push({
        code: 'INVOICING_PLATFORM_READINESS_001',
        problem: 'Transmision sin numero fiscal asignado',
        fix: 'Reintenta la creacion del documento',
      });
    }
    if (!transmission.cufe) {
      warnings.push({
        code: 'INVOICING_PLATFORM_READINESS_002',
        problem: 'Documento aun no emitido a DIAN (sin CUFE)',
      });
    }
    return {
      blockers,
      warnings,
      computed: {
        document_number_preview: transmission.document_number,
        cufe_preview: transmission.cufe,
        transmission_status: transmission.transmission_status,
        dian_status: transmission.dian_status,
      },
    };
  }

  /**
   * Lista resoluciones aptas para emision. Reusa el helper que esta
   * en `SubscriptionFiscalService.listResolutionsForEmission` (Phase A.4)
   * — el caller pasa el filtro document_type, vigencia y active.
   * Reenviar al facade evita que el controller dependa del legacy.
   */
  async listResolutionsForEmission(args: {
    organizationId: number;
    accountingEntityId: number;
    documentType: 'sales_invoice' | 'support_document';
  }) {
    const org = args.organizationId;
    const acc = args.accountingEntityId;
    if (!org || !acc) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_006,
        'listResolutionsForEmission requiere organizationId y accountingEntityId resueltos',
      );
    }
    const f = this.subscriptionFiscalService?.listResolutionsForEmission;
    if (typeof f !== 'function') {
      throw new VendixHttpException(
        ErrorCodes.SYS_INTERNAL_001,
        'No se encontro el helper listResolutionsForEmission en subscriptionFiscalService',
      );
    }
    return f.call(this.subscriptionFiscalService, {
      organizationId: org,
      accountingEntityId: acc,
      documentType: args.documentType,
    });
  }

  /**
   * Lista platform invoices (FB-12). Paginado, con filtros status,
   * document_type, q (busca por document_number o cufe).
   *
   * Usa GlobalPrismaService directamente (no scoped): el rail plataforma
   * ya filtra por `accounting_entity_id` explicitamente.
   */
  async listInvoices(args: {
    organizationId: number;
    accountingEntityId: number;
    status:
      | 'draft'
      | 'queued'
      | 'submitted'
      | 'accepted'
      | 'rejected'
      | 'error'
      | 'cancelled'
      | null;
    documentType: 'sales_invoice' | 'support_document' | null;
    q: string | null;
    page: number;
    limit: number;
  }): Promise<{
    rows: any[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, args.page);
    const limit = Math.min(Math.max(1, args.limit), 100);
    const where: any = {
      source_type: { in: ['platform_invoice', 'platform_support_document'] },
      accounting_entity_id: args.accountingEntityId,
    };
    if (args.status) where.transmission_status = args.status;
    if (args.documentType) where.document_type = args.documentType;
    if (args.q?.trim()) {
      const q = args.q.trim();
      where.OR = [
        { document_number: { contains: q, mode: 'insensitive' } },
        { cufe: { contains: q, mode: 'insensitive' } },
        { error_message: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prismaClient.fiscal_transmissions.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          document_type: true,
          source_type: true,
          document_number: true,
          transmission_status: true,
          dian_status: true,
          accounting_status: true,
          retry_count: true,
          cufe: true,
          sent_at: true,
          accepted_at: true,
          rejected_at: true,
          error_message: true,
          created_at: true,
          organization_id: true,
          accounting_entity_id: true,
        },
      }),
      this.prismaClient.fiscal_transmissions.count({ where }),
    ]);
    return { rows, total, page, limit };
  }

  /**
   * Retry sobre transmision platform. Ademas del caso platform_invoice
   * ya implemented (PR #636), cubre platform_support_document.
   */
  async retryTransmission(args: {
    organizationId: number;
    transmissionId: number;
    actorUserId: number;
  }) {
    const transmission = await this.prismaClient.fiscal_transmissions.findFirst({
      where: {
        id: args.transmissionId,
        source_type: { in: ['platform_invoice', 'platform_support_document'] },
      },
      select: { id: true, source_type: true },
    });
    if (!transmission) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_FIND_001,
        `No se encontro transmision con id=${args.transmissionId}`,
      );
    }
    // Delegamos al reuso del riel tienda `resendPlatformTransmission`
    // ya operational (PR #636). El envia el invoice desde el snapshot
    // persistido; no necesita re-asignar numero.
    return this.subscriptionFiscalService.resendPlatformTransmission(
      args.transmissionId,
    );
  }

  /**
   * Lista los conceptos de retención activos de la organización de la
   * plataforma (organization_id resuelto por `resolvePlatformIdentity`).
   *
   * Los conceptos con `accounting_entity_id` NULL son los "compartidos"
   * a nivel organización: aplican a cualquier entidad contable que la org
   * plataforma cree. El selector de retenciones del wizard los consume
   * con `concept_id` numérico (entero), NO con `code` tipo 'RCO01'.
   *
   * Devuelve un envelope plano `{ data: WithholdingConceptDto[] }` que
   * el controller mete dentro de `responseService.success(...)` igual que
   * el resto de listados del rail.
   */
  async listWithholdingConceptsForPlatform(organizationId: number): Promise<{
    data: Array<{
      id: number;
      code: string;
      name: string;
      rate: number;
      withholding_type: string;
      account_code: string | null;
      min_uvt_threshold: number;
    }>;
  }> {
    const rows = await this.prismaClient.withholding_concepts.findMany({
      where: {
        organization_id: organizationId,
        accounting_entity_id: null,
        is_active: true,
      },
      orderBy: [{ withholding_type: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        rate: true,
        withholding_type: true,
        account_code: true,
        min_uvt_threshold: true,
      },
    });
    return {
      data: rows.map((row: any) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        // Decimal → number: la regla DIAN no exige mas de 4 decimales y el
        // campo se persiste como Decimal(7,4) en schema. El frontend opera
        // en fracción (0..1), consistente con `MvpV1InvoiceWithholdingInputDto.rate`.
        rate: Number(row.rate),
        withholding_type: row.withholding_type,
        account_code: row.account_code ?? null,
        min_uvt_threshold: Number(row.min_uvt_threshold),
      })),
    };
  }

  /* ── Mapper: V1 DTO → CreateInvoiceDto del riel tienda ──────────── */

  /**
   * Construye el `customer_*` snapshot fields del rail tienda desde el
   * tenant (ADR-7). El rail tienda acepta `customer_name`,
   * `customer_tax_id`, `customer_verification_digit`, etc., SIN FK a `users`
   * — son columnas planas del model `invoices` (ver schema.prisma:5370-5379).
   *
   * Las `fiscal_responsibilities` y el `tax_regime` no son columnas
   * del invoice; viven en el snapshot `platform_acquirer_snapshot`
   * que captura la identidad completa del destinatario al emitir.
   */
  private mapTenantToCustomerFields(tenant: any, dto: any) {
    return {
      // legal_name es la razon social; si el tenant no tiene,
      // usamos `name` (el "alias"). Validamos al persistir el snapshot.
      customer_name: tenant.legal_name ?? tenant.name,
      customer_tax_id: tenant.tax_id,
      customer_verification_digit: tenant.tax_id_dv,
      customer_address: tenant.address
        ? {
            line: tenant.address.line ?? undefined,
            city: tenant.address.city ?? undefined,
            department_code: tenant.address.department_code ?? undefined,
            country_code: 'CO',
          }
        : undefined,
      customer_email: tenant.email ?? undefined,
      customer_phone: tenant.phone ?? undefined,
      // DIAN document_type + person_type NO viven en `stores` (gap).
      // Las organizations SI; si la fuente lo trae, lo plasma,
      // si no, queda `null` y el form ya lo pidio antes de submit.
      customer_document_type: tenant.document_type ?? undefined,
      customer_person_type: tenant.person_type ?? undefined,
      // regimen + responsabilidades viven unicamente en el snapshot;
      // NO entran al invoice row del rail tienda.
      customer_tax_regime: undefined,
      customer_fiscal_responsibilities: undefined,
    };
  }

  /**
   * Convierte `MvpV1InvoiceLineDto` (V1) al shape de `CreateInvoiceItemDto`
   * del rail tienda (`apps/backend/src/domains/store/invoicing/dto/create-invoice.dto.ts`).
   *
   * El rail tienda usa:
   *   taxes[] (CreateInvoiceTaxDto[] con tax_name / tax_rate /
   *   taxable_amount / tax_amount / is_inclusive)
   *   discount_amount (line)
   *   is_inclusive (line)
   *   unit_code (UN/ECE)
   *   aiu_component (administracion/imprevistos/utilidad)
   *   account_code (PUC)
   *
   * Aqui se mapea cada `MvpV1InvoiceLineTaxDto` a `CreateInvoiceTaxDto`
   * usando `tax_type='IVA'|'INC'|'ICUI'|...` para resolver `tax_name`.
   */
  private mapLineToStoreLine(line: any, taxCatalog: any) {
    const taxes = (line.taxes ?? []).map((t: any) => {
      const taxName = taxCatalog[t.tax_type] ?? t.tax_type;
      return {
        tax_name: taxName,
        tax_rate: t.rate * 100, // V1 rate es fraccion (0..1); el riel espera percent (0..100)
        taxable_amount: t.taxable_amount ?? null,
        tax_amount: t.tax_amount ?? null,
        is_inclusive: t.is_inclusive ?? false,
      };
    });
    return {
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unit_price,
      discount_amount: line.discount_amount ?? 0,
      taxes,
      is_inclusive: false,
      unit_code: line.unit_code ?? 'EA',
      account_code: line.account_code ?? undefined,
      aiu_component: line.aiu_component ?? undefined,
    };
  }

  /**
   * Construye el `CreateInvoiceDto` que el rail tienda acepta para un
   * `sales_invoice`. El operador que reciba la response UBL vera los
   * valores que el riel tienda computa en `acceptance` (decimal totals).
   */
  private mapToStoreCreateInvoiceDto(dto: any, tenant: any): any {
    const customer = this.mapTenantToCustomerFields(tenant, dto);

    // El riel tienda exige `customer_tax_id` y `customer_verification_digit`
    // SIEMPRE para `document_type='sales_invoice'` (cliente nominativo).
    // Validamos aca (no en DTO) por consistencia con `INVOICING_VALIDATE_001`
    // que es el tipo de error que veria el operador.
    if (!customer.customer_tax_id || !customer.customer_verification_digit) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_TENANT_FISCAL_DATA_INCOMPLETE,
        `El destinatario ${tenant.kind}:${tenant.tenant_id ?? tenant.id} no tiene tax_id+DV en la base de datos. Captura los campos faltantes en el formulario antes de emitir.`,
      );
    }

    const lines = (dto.items ?? []).map((line: any) =>
      this.mapLineToStoreLine(line, this.taxNameCatalog()),
    );

    return {
      invoice_type: 'sales_invoice',
      document_type: 'sales_invoice',
      customer,
      issue_date: new Date().toISOString().slice(0, 10),
      currency: dto.currency?.iso_4217 ?? 'COP',
      exchange_rate: dto.currency?.exchange_rate ?? undefined,
      exchange_rate_date: dto.currency?.exchange_rate_date ?? undefined,
      foreign_currency: dto.currency?.iso_4217 ?? undefined,
      foreign_total_amount: undefined, // se computa al cierre
      items: lines,
      payment_form: dto.payment_form ?? '1',
      payment_means_code: dto.payment_means_code ?? '10',
      due_date: dto.due_date ?? undefined,
      notes: dto.notes ?? undefined,
      operation_type: dto.operation_type,
      aiur_contract_object: dto.aiu_contract_object ?? undefined,
      global_discount_amount: dto.global_discount_amount ?? 0,
      withholdings: (dto.withholdings ?? []).map((w: any) => ({
        role: w.role,
        concept_id: w.concept_id,
        base_amount: w.base_amount,
        rate: w.rate,
        amount: w.amount ?? undefined,
      })),
      // Source: discriminator — ADR-7 + persistencia limpia.
      source_type: 'platform_invoice',
      // resolution_id opcional. Si no, `InvoicingService.create`
      // selecciona la resolucion mas reciente vigente del accounting
      // entity (regla que ya existe en el rail tienda).
      resolution_id: dto.resolution_id ?? undefined,
    };
  }

  private mapToStoreSupportDocDto(dto: any, tenant: any): any {
    const customer = this.mapTenantToCustomerFields(tenant, dto);
    if (!customer.customer_tax_id) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_TENANT_FISCAL_DATA_INCOMPLETE,
        `El supplier ${tenant.kind}:${tenant.tenant_id ?? tenant.id} no tiene tax_id. Captura los campos faltantes antes de emitir el documento soporte.`,
      );
    }
    const lines = (dto.items ?? []).map((line: any) =>
      this.mapLineToStoreLine(line, this.taxNameCatalog()),
    );
    return {
      invoice_type: 'support_document',
      document_type: 'support_document',
      customer, // el riel usa `customer_*` para ambos
      supplier_id: undefined, // el rail tienda ya infiere supplier del flow
      issue_date: new Date().toISOString(),
      currency: dto.currency?.iso_4217 ?? 'COP',
      exchange_rate: dto.currency?.exchange_rate ?? undefined,
      exchange_rate_date: dto.currency?.exchange_rate_date ?? undefined,
      items: lines,
      payment_means_code: dto.payment_means_code ?? undefined,
      due_date: dto.due_date ?? undefined,
      notes: dto.notes ?? undefined,
      operation_type: dto.operation_type,
      global_discount_amount: dto.global_discount_amount ?? 0,
      source_type: 'platform_support_document',
      resolution_id: dto.resolution_id ?? undefined,
    };
  }

  /** Mapa tax_type → tax_name que el rail tienda acepta. */
  private taxNameCatalog(): Record<string, string> {
    return {
      IVA: 'IVA',
      INC: 'INC',
      ICUI: 'ICUI',
      RETE_FUENTE: 'ReteFuente',
      RETE_IVA: 'ReteIVA',
      RETE_ICA: 'ReteICA',
    };
  }

  /**
   * Mapea el MvpV1 DTO (customer.kind+tenant_id) al legacy
   * `CreatePlatformInvoiceDto` (customer.legal_name+tax_id+tax_id_dv).
   *
   * La tax del tenant YA fue validada como `fiscal_data_complete` por
   * `PlatformTenantsService.getTenantByKindAndId`. Si por algun motivo
   * falta tax_id o DV, el legacy `createPlatformInvoice` rechaza con
   * 400 BadRequest — el facade NO vuelve a validar para evitar drift.
   *
   * Propaga TODO lo que el V1 trae al DTO legacy extendido (cabecera y
   * línea) con fallbacks seguros para que las llamadas legacy existentes
   * sigan funcionando idéntico:
   *   - `unit_code ?? 'NIU'` (NO `'EA'` — no existe en UN/ECE Rec. 20)
   *   - `discount_amount ?? 0`
   *   - `taxes ?? []` (vacío = línea exenta, igual que antes)
   *   - `withholdings ?? []`
   *   - `rate` se mantiene en FRACCIÓN (0..1) — la conversión a porcentaje
   *     la hace el provider UNA sola vez; nunca recalcular base×tarifa
   *     en el mapper (FAS02).
   */
  private mapMvpV1ToLegacyCreateDto(dto: any, tenant: any): any {
    return {
      customer: {
        legal_name: tenant.legal_name ?? `Tenant ${tenant.tenant_id}`,
        tax_id: tenant.tax_id ?? '',
        tax_id_dv: tenant.tax_id_dv ?? '',
        email: tenant.email ?? undefined,
        address_line: tenant.address?.line ?? undefined,
        city: tenant.address?.city ?? undefined,
        department_code: tenant.address?.department_code ?? undefined,
        document_type: tenant.document_type ?? undefined,
        person_type: tenant.person_type ?? undefined,
        tax_regime_code: tenant.tax_regime_code ?? undefined,
        // Stores (la mitad del caso del módulo) devuelven `fiscal_responsibilities: []`
        // explícitamente, NO `null`. `??` no atrapa `[]`, así que el fallback
        // `['O-13']` del legacy nunca entra y la DIAN rechaza el `cac:PartyTaxScheme`
        // sin responsabilidades. Forzamos `undefined` cuando el arreglo está vacío
        // para que el legacy use su propio default.
        fiscal_responsibilities:
          Array.isArray(tenant.fiscal_responsibilities) &&
          tenant.fiscal_responsibilities.length > 0
            ? tenant.fiscal_responsibilities
            : undefined,
      },
      items: (dto.items ?? []).map((line: any) => ({
        description: line.description,
        quantity: Number(line.quantity) || 1,
        unit_price: Number(line.unit_price) || 0,
        unit_code: line.unit_code ?? 'NIU',
        discount_amount: line.discount_amount ?? 0,
        account_code: line.account_code ?? undefined,
        taxes: (line.taxes ?? []).map((t: any) => ({
          tax_type: t.tax_type,
          rate: t.rate,           // fracción 0..1 — NO convertir acá
          taxable_amount: t.taxable_amount ?? undefined,
          tax_amount: t.tax_amount ?? undefined,
          is_inclusive: t.is_inclusive ?? false,
        })),
      })),
      period_start: dto.period_start ?? undefined,
      period_end: dto.period_end ?? undefined,
      // `currency` queda como string ISO 4217 para el snapshot y para
      // callers legacy que ya mandaban `currency: 'USD'` plano — el cambio
      // a objeto rompería ambos lectores.
      currency: dto.currency?.iso_4217 ?? 'COP',
      // `exchange_rate_payload` viaja APARTE con el objeto completo para que
      // el legacy `buildExchangeRate` (subscription-fiscal.service.ts:2482)
      // emita `cac:PaymentAlternativeExchangeRate` cuando hay TRM. Sin este
      // campo, el grupo nunca se emite y la sección «Divisa extranjera» del
      // wizard queda decorativa (el operador marca la casilla, teclea la
      // TRM y nada de eso llega al XML firmado).
      exchange_rate_payload: dto.currency ?? undefined,
      resolution_id: dto.resolution_id ?? undefined,
      issue_date: dto.issue_date ?? undefined,
      due_date: dto.due_date ?? undefined,
      payment_form: dto.payment_form ?? undefined,
      payment_means_code: dto.payment_means_code ?? undefined,
      notes: dto.notes ?? undefined,
      counterpart_account_code: dto.counterpart_account_code ?? undefined,
      withholdings: (dto.withholdings ?? []).map((w: any) => ({
        role: w.role,
        concept_id: w.concept_id,
        base_amount: w.base_amount,
        rate: w.rate,
        amount: w.amount ?? undefined,
      })),
      // C.1: profile_id se propaga al legacy DTO para que cuando
      // createPlatformInvoice extienda su create-data (siguiente slice), las
      // columnas invoices.profile_id/profile_version/profile_snapshot
      // queden alimentadas. La validación operation_type-match YA corre
      // antes (assertPlatformProfileMatchesOperation) — propagar no es un
      // segundo gate, es la preparación de la persistencia.
      profile_id: dto.profile_id ?? undefined,
    };
  }

  /** Snapshot del destinatario para persistir en `fiscal_evidences`. */
  private tenantToAcquirerSnapshot(tenant: any, dto: any): any {
    return {
      legal_name: dto.customer?.legal_name_override ?? tenant.legal_name ?? tenant.name,
      tax_id: tenant.tax_id,
      tax_id_dv: tenant.tax_id_dv,
      person_type:
        dto.customer?.person_type_override ?? tenant.person_type ?? '2',
      tax_regime_code: dto.customer?.tax_regime_code_override ?? tenant.tax_regime_code ?? null,
      fiscal_responsibilities: tenant.fiscal_responsibilities ?? [],
      address: {
        line: tenant.address?.line ?? null,
        city: tenant.address?.city ?? null,
        department_code: tenant.address?.department_code ?? null,
      },
      email: tenant.email ?? null,
    };
  }

  /**
   * Validaciones tempranas (A.1 expone la mayoria via decorators, pero
   * los chequeos cross-field que no caben en DTO van aca).
   */
  private validateCreateInput(dto: any, _storeDto: any): string | null {
    if (!dto.items || dto.items.length === 0) return 'El invoice debe tener al menos una linea.';
    for (const [i, line] of dto.items.entries()) {
      if (!line.description || line.description.trim() === '') {
        return `Linea ${i + 1}: descripcion requerida.`;
      }
      if (!(line.quantity > 0)) return `Linea ${i + 1}: cantidad debe ser > 0.`;
      if (!(line.unit_price >= 0)) return `Linea ${i + 1}: precio unitario debe ser >= 0.`;
    }
    if (dto.operation_type === '09') {
      if (
        !dto.aiu_contract_object ||
        dto.aiu_contract_object.length < 4900
      ) {
        return `Regimen AIU (operation_type=09) requiere contrato AIU de al menos 4900 caracteres (DIAN).`;
      }
    }
    return null;
  }

  /**
   * C.1 — Validación de paridad perfil↔documento para el riel plataforma.
   *
   * El perfil pertenece a UN `operation_type` y el snapshot que congela
   * (`invoices.profile_id/profile_version/profile_snapshot`) sólo tiene
   * sentido para ese tipo. Si el caller envía `profile_id` con un
   * `operation_type` distinto del perfil, el documento sale firmado bajo
   * una configuración que NO es la que gobernó el cálculo — la
   * reproducibilidad fiscal por versión se rompe, y eso es exactamente la
   * clase de fallo silencioso que `PLATFORM_PROFILE_008` existe para
   * impedir.
   *
   * Mismo argumento que `INVOICING_PROFILE_008` del riel tienda (FB-15
   * del plan hermano); con prefijo PLATFORM para que el frontend pueda
   * enrutar el mensaje sin mapear códigos entre namespaces disjuntos.
   */
  private async assertPlatformProfileMatchesOperation(
    profile_id: number,
    operation_type: string,
    organization_id: number,
  ): Promise<void> {
    const profile = await this.prismaService.withoutScope().invoice_profiles.findFirst({
      where: {
        id: profile_id,
        organization_id,
        store_id: null,
      },
      select: {
        id: true,
        name: true,
        operation_type: true,
        state: true,
        current_version: true,
      },
    });
    if (!profile) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_PROFILE_001,
        `El perfil ${profile_id} no existe en la organización ${organization_id} del riel plataforma.`,
        { profile_id, organization_id },
      );
    }
    if (profile.operation_type !== operation_type) {
      throw new VendixHttpException(
        ErrorCodes.PLATFORM_PROFILE_008,
        `El perfil «${profile.name}» (operation_type=${profile.operation_type}) no corresponde al operation_type=${operation_type} del documento.`,
        {
          profile_id,
          profile_operation_type: profile.operation_type,
          document_operation_type: operation_type,
        },
      );
    }
    if (profile.state !== 'active') {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_PROFILE_006,
        `El perfil «${profile.name}» está inactivo y no puede usarse para emitir.`,
        { profile_id, state: profile.state },
      );
    }
  }
}
