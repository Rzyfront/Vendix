import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
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
    const tenant = await this.tenants.getTenantByKindAndId(this.prismaClient, {
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

    const storeCreateDto = this.mapToStoreCreateInvoiceDto(args.dto, tenant);
    const validationError = this.validateCreateInput(args.dto, storeCreateDto);
    if (validationError) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        validationError,
      );
    }

    // Atomico: la creacion de `invoices` + `fiscal_transmissions` + snapshot
    // viven en una sola transaccion. Si algo falla, hacemos rollback
    // y la UI reintentara con un nuevo idempotency_key.
    const result = await this.prismaClient.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // Persistir el snapshot ANTES del create violaba la FK de
        // fiscal_evidences.fiscal_transmission_id. Skip pre-create: ahora
        // el snapshot se persiste DESPUES del create con el transmissionId
        // real. El registro de intento se conserva en los logs de Nest.
        // Si `InvoicingService.create` falla por validacion DIAN, el
        // rollback de la Tx limpia cualquier evidencia parcial.

        // Delegar al riel tienda. La shadow-write a `invoices` +
        // `fiscal_transmissions` ocurre dentro del Tx que inyectamos.
        const storeResult = await this.invoicingService.create(
          {
            organization_id: args.organizationId,
            store_id: null,
            accounting_entity_id: args.accountingEntityId,
            dian_configuration_id: args.dianConfigurationId,
            actor_user_id: args.actorUserId,
            source_type: 'platform_invoice',
            // resolution_id queda para la emission (allocateFiscalNumber
            // lo asigna bajo lock); en la V1 la facade acepta `resolution_id`
            // opcional y el motor asigna automáticamente si falta.
            resolution_id: storeCreateDto.resolution_id,
            payload: storeCreateDto,
          },
          tx,
        );

        if (!storeResult || !storeResult.invoice) {
          throw new VendixHttpException(
            ErrorCodes.INVOICING_STATUS_001,
            'InvoicingService.create devolvio sin invoice',
          );
        }

        // Persistir el snapshot del invoice con el id de transmision.
        // Reusar `transmissionId = 0` que es la transmision que el riel
        // tienda acaba de crear (su `source_id` de `fiscal_transmissions`
        // apunta a `invoices.id`).
        const transmission = await tx.fiscal_transmissions.findFirst({
          where: {
            source_type: 'platform_invoice',
            source_id: storeResult.invoice.id,
          },
          orderBy: { created_at: 'desc' },
          select: { id: true },
        });
        if (!transmission) {
          throw new VendixHttpException(
            ErrorCodes.INVOICING_FIND_001,
            'No se encontro la fiscal_transmission asociada al invoice recien creado',
          );
        }

        // Re-persistir el snapshot del destinatario con el transmissionId real.
        // La fase 1 (overwrite in-place) del helper hace idempotente el doble insert.
        await this.persistence.persistAcquirerSnapshot(tx, {
          organizationId: args.organizationId,
          accountingEntityId: args.accountingEntityId,
          transmissionId: transmission.id,
          acquirer: this.tenantToAcquirerSnapshot(tenant, args.dto),
        });

        await this.persistence.persistInvoiceSnapshot(tx, {
          organizationId: args.organizationId,
          accountingEntityId: args.accountingEntityId,
          transmissionId: transmission.id,
          idempotencyKey: storeResult.idempotency_key ?? `platform_invoice:${transmission.id}`,
          payload: {
            customer: storeCreateDto.customer,
            items: storeCreateDto.items,
            totals: storeResult.totals ?? { subtotal: 0, tax_amount: 0, total: 0 },
            period_start: args.dto.period_start ?? null,
            period_end: args.dto.period_end ?? null,
            currency: storeCreateDto.currency ?? 'COP',
            withholdings: storeCreateDto.withholdings ?? [],
            global_discount_amount: storeCreateDto.global_discount_amount ?? 0,
            operation_type: args.dto.operation_type,
          },
        });

        return {
          invoice_id: transmission.id,
          transmission_id: transmission.id,
          fiscal_number: storeResult.invoice.invoice_number,
          transmission_status: 'queued',
          dian_status: 'pending',
          cufe: null,
        };
      },
    );

    return result;
  }

  /**
   * Crea una `support_document` (DSA) del rail super-admin. Diferencias
   * con sales: sin AIU, sin withholding, `supplier_id` en lugar de
   * `customer_id`, y la ClTec no es necesaria (CUDS en lugar de CUFE).
   *
   * El riel tienda ya tiene un flujo de vendor support document; esta
   * facade lo invoca via el mismo `InvoicingService.create` pero
   * pasando `document_type='support_document'`. La persona natural/Juridica
   * laxa del DSA NO exige `tax_regime_code` tan estricto como una
   * venta — el snapshot captura lo que el operador indico en el form.
   */
  async createSupportDocument(args: {
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
    const tenant = await this.tenants.getTenantByKindAndId(this.prismaClient, {
      organizationId: args.organizationId,
      kind: args.dto.supplier.kind,
      id: args.dto.supplier.tenant_id,
    });
    if (!tenant) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_TENANT_NOT_FOUND,
        `No se encontro el supplier ${args.dto.supplier.kind}:${args.dto.supplier.tenant_id} en la plataforma.`,
      );
    }
    const storeCreateDto = this.mapToStoreSupportDocDto(args.dto, tenant);
    // Misma transaccion, mismo patron de snapshots.
    const result = await this.prismaClient.$transaction(
      async (tx: Prisma.TransactionClient) => {
        await this.persistence.persistAcquirerSnapshot(tx, {
          organizationId: args.organizationId,
          accountingEntityId: args.accountingEntityId,
          transmissionId: 0,
          acquirer: this.tenantToAcquirerSnapshot(tenant, args.dto),
        });
        const storeResult = await this.invoicingService.create(
          {
            organization_id: args.organizationId,
            store_id: null,
            accounting_entity_id: args.accountingEntityId,
            dian_configuration_id: args.dianConfigurationId,
            actor_user_id: args.actorUserId,
            source_type: 'platform_support_document',
            resolution_id: storeCreateDto.resolution_id,
            payload: storeCreateDto,
          },
          tx,
        );
        if (!storeResult || !storeResult.invoice) {
          throw new VendixHttpException(
            ErrorCodes.INVOICING_STATUS_001,
            'InvoicingService.create devolvio sin invoice',
          );
        }
        const transmission = await tx.fiscal_transmissions.findFirst({
          where: {
            source_type: 'platform_support_document',
            source_id: storeResult.invoice.id,
          },
          orderBy: { created_at: 'desc' },
          select: { id: true },
        });
        if (!transmission) {
          throw new VendixHttpException(
            ErrorCodes.INVOICING_FIND_001,
            'No se encontro la fiscal_transmission del support_document',
          );
        }
        await this.persistence.persistAcquirerSnapshot(tx, {
          organizationId: args.organizationId,
          accountingEntityId: args.accountingEntityId,
          transmissionId: transmission.id,
          acquirer: this.tenantToAcquirerSnapshot(tenant, args.dto),
        });
        await this.persistence.persistInvoiceSnapshot(tx, {
          organizationId: args.organizationId,
          accountingEntityId: args.accountingEntityId,
          transmissionId: transmission.id,
          idempotencyKey: storeResult.idempotency_key ?? `platform_support_doc:${transmission.id}`,
          payload: {
            customer: storeCreateDto.customer,
            items: storeCreateDto.items,
            totals: storeResult.totals ?? { subtotal: 0, tax_amount: 0, total: 0 },
            period_start: args.dto.period_start ?? null,
            period_end: args.dto.period_end ?? null,
            currency: storeCreateDto.currency ?? 'COP',
            withholdings: [],
            global_discount_amount: storeCreateDto.global_discount_amount ?? 0,
            operation_type: args.dto.operation_type,
          },
        });
        return {
          invoice_id: transmission.id,
          transmission_id: transmission.id,
          fiscal_number: storeResult.invoice.invoice_number,
          transmission_status: 'queued',
          dian_status: 'pending',
          cufe: null,
        };
      },
    );
    return result;
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
    // Resolver transmision_id desde invoice_id (rail plataforma guarda
    // el id de transmision en `source_id` para source_type='platform_invoice'|'platform_support_document').
    // Si pasamos el invoice_id directo, `InvoiceFlowService.send`
    // buscaria un subscription_invoice — no lo que queremos.
    const transmission = await this.prismaClient.fiscal_transmissions.findFirst({
      where: {
        id: args.invoiceId,
        source_type: { in: ['platform_invoice', 'platform_support_document'] },
      },
      select: { id: true, source_id: true },
    });
    if (!transmission) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_FIND_001,
        `No se encontro transmision platform_invoice/platform_support_document con id=${args.invoiceId}`,
      );
    }
    return this.invoiceFlowService.send({
      invoice_id: transmission.source_id,
      manual: true,
      source: 'platform',
      force: args.force,
    });
  }

  /**
   * Cancela un documento platform en estado draft/validated. Reusa
   * `InvoiceFlowService.cancel`. El id es el de transmision (viene del
   * detail endpoint del rail plataforma).
   */
  async cancelInvoice(args: { invoiceId: number; actorUserId: number; reason?: string }) {
    // mismo resolve que sendInvoice
    const transmission = await this.prismaClient.fiscal_transmissions.findFirst({
      where: {
        id: args.invoiceId,
        source_type: { in: ['platform_invoice', 'platform_support_document'] },
      },
      select: { id: true, source_id: true },
    });
    if (!transmission) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_FIND_001,
        `No se encontro transmision con id=${args.invoiceId}`,
      );
    }
    return this.invoiceFlowService.cancel({
      invoice_id: transmission.source_id,
      reason: args.reason,
    });
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
    const transmission = await this.prismaClient.fiscal_transmissions.findFirst({
      where: {
        id: args.invoiceId,
        source_type: { in: ['platform_invoice', 'platform_support_document'] },
      },
      select: { id: true, source_id: true },
    });
    if (!transmission) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_FIND_001,
        `No se encontro transmision con id=${args.invoiceId}`,
      );
    }
    return this.invoiceFlowService.getEmitReadiness(transmission.source_id);
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
        ErrorCodes.INVOICING_PROVIDER_002,
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
    return this.invoiceFlowService.resendPlatformTransmission(
      args.transmissionId,
    );
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
      issue_date: new Date().toISOString().slice(0, 10),
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

  /** Snapshot del destinatario para persistir en `fiscal_evidences`. */
  private tenantToAcquirerSnapshot(tenant: any, dto: any): any {
    return {
      kind: tenant.kind,
      tenant_id: tenant.tenant_id ?? tenant.id,
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
}
