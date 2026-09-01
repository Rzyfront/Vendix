import { Injectable, Logger } from '@nestjs/common';
import { Prisma, tax_type_enum } from '@prisma/client';

/**
 * Los valores de `aiu_component_enum` viven en `prisma/schema.prisma`
 * (administracion / imprevistos / utilidad) pero el cliente Prisma
 * generado no los exporta como tipo top-level en este momento — sólo
 * como columna. Mantener la unión ACÁ, calcada del schema, evita
 * depender de la regeneración del cliente y mantiene un solo sitio de
 * verdad para los strings del dominio.
 */
type AiuComponentValue = 'administracion' | 'imprevistos' | 'utilidad';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcrypt';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import {
  FiscalInvoiceThresholdService,
  POS_EQUIVALENT_DOCUMENT_UVT_LIMIT,
} from '@common/services/fiscal-invoice-threshold.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { FiscalGateService } from '@common/services/fiscal-gate.service';
import { InvoiceEmissionGateService } from './services/invoice-emission-gate.service';
import {
  CreateInvoiceDto,
  CreateInvoiceItemDto,
  CreateInvoiceTaxDto,
} from './dto/create-invoice.dto';
import { TaxFiscalType } from '../taxes/dto';
import { CreateCustomerDto } from '../customers/dto/create-customer.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { QueryInvoiceDto } from './dto/query-invoice.dto';
import { InvoiceNumberGenerator } from './utils/invoice-number-generator';
import { RESOLUTION_PUBLIC_SELECT } from './utils/technical-key.util';
import { InvoiceRetryQueueService } from './services/invoice-retry-queue.service';
import {
  CalculatedLine,
  CalculatedTax,
  DEFAULT_AIU_MINIMUM_PERCENT,
  InvoiceCalculatorAiuInput,
  InvoiceCalculatorResult,
  InvoiceCalculatorService,
  InvoiceCalculatorTaxInput,
} from './services/invoice-calculator.service';
import { TrmService } from './services/trm.service';
import {
  localDateString,
  resolveOrganizationTimezone,
  resolveStoreTimezone,
} from '../../../common/utils/store-timezone.util';
import { resolveUneceUnitCode } from '../products/services/uom-uncefact.util';
import {
  AiuSettings,
  DEFAULT_POS_AUTO_EMIT,
  DEFAULT_POS_DIAN_FAILURE_POLICY,
  PosInvoicingSettings,
} from '../settings/interfaces/store-settings.interface';
import { DIAN_INVOICE_OPERATION_TYPES } from './providers/dian-direct/constants/dian-document-types';
import {
  regimeFromTaxableBasis,
  resolveAiuTaxableBasis,
  validateInvoiceProfileConfig,
} from './profiles/invoice-profile-config.contract';
import type {
  AiuComponentsBasis,
  AiuTaxableBasis,
  AiuVatRegimeLiteral,
  InvoiceProfileConfig,
  ProfileAiuConfig,
} from './profiles/invoice-profile-config.contract';
import { buildProfileConfigException } from './profiles/invoice-profile-config.validator';
import { profileNotFound } from './profiles/profile-errors';
import { WithholdingFlowService } from '../withholding-tax/withholding-flow.service';
import {
  buildWithholdingAccountRole,
  WithholdingLine,
  WithholdingTypeValue,
} from 'src/common/interfaces/withholding-breakdown.interface';
import {
  buildAiuNote,
  DIAN_AIU_NOTE_MAX_LENGTH,
  DIAN_AIU_NOTE_MIN_LENGTH,
  DIAN_AIU_NOTE_PREFIX,
} from './providers/dian-direct/xml/ubl-common.builder';
import { InvoiceWithholdingInputDto } from './dto/invoice-withholding-input.dto';

/**
 * Listing rows whose send/transmission state is an error or a pending send get
 * their `retry_status` resolved from invoice_retry_queue (batch, no N+1).
 */
const RETRY_ELIGIBLE_SEND_STATUSES = ['pending', 'sending', 'sent_error'];
const RETRY_ELIGIBLE_TRANSMISSION_STATUSES = [
  'queued',
  'signing',
  'signed',
  'submitted',
  'rejected',
  'error',
];

// `RESOLUTION_PUBLIC_SELECT` (proyección pública de `invoice_resolutions`,
// SIN `technical_key`/`technical_key_encrypted`/`technical_key_fingerprint`)
// se importa de `./utils/technical-key.util` en vez de declararse aquí (E.9,
// 2026-08-25). Estaba declarada dos veces —ésta y la de `technical-key.util.ts:60`,
// que ya la exporta y ya documenta el porqué de cada columna excluida—,
// idénticas hoy campo por campo pero sin nada que lo garantizara: el mismo
// patrón de espejo a mano que este plan corrige en otros lados. Un solo
// sitio, un solo criterio.

const INVOICE_INCLUDE = {
  invoice_items: true,
  invoice_taxes: true,
  resolution: { select: RESOLUTION_PUBLIC_SELECT },
  customer: {
    select: { id: true, first_name: true, last_name: true, email: true },
  },
  supplier: {
    select: {
      id: true,
      name: true,
      tax_id: true,
      document_type: true,
      tax_regime: true,
      verification_digit: true,
      addresses: {
        select: {
          address_line1: true,
          address_line2: true,
          city: true,
          state_province: true,
          country_code: true,
          postal_code: true,
          municipality_code: true,
          phone_number: true,
        },
      },
    },
  },
  created_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  related_invoice: {
    select: {
      id: true,
      invoice_number: true,
      invoice_type: true,
      accounting_entity_id: true,
      status: true,
      cufe: true,
      issue_date: true,
    },
  },
  /**
   * IDENTIDAD del perfil congelado — no su configuración.
   *
   * Sin esto la factura devolvía `profile_id: 7, profile_version: 2` y ninguna
   * pantalla podía decir de QUÉ perfil se trata: dos números que sólo alguien
   * con acceso a la base puede resolver. La trazabilidad DIAN exige poder
   * responder «con qué reglas salió este documento» desde el documento mismo.
   *
   * Se trae `profile.name` y nada más del contenido: `config` es el JSON de las
   * 7 secciones del editor y este `include` lo usan también los caminos de
   * escritura (`create`, `update`, `send`), donde arrastrarlo sería peso puro.
   * Y no hace falta: la verdad fiscal EMITIDA no vive en el perfil sino en las
   * columnas `aiu_regime` / `aiu_minimum_percent` / `aiu_taxable_matrix` de la
   * propia factura, que es justo el punto de congelarlas. El perfil sólo dice
   * de dónde vinieron.
   */
  profile_snapshot: {
    select: {
      profile_id: true,
      version: true,
      created_at: true,
      profile: {
        select: {
          id: true,
          name: true,
          operation_type: true,
          state: true,
          current_version: true,
        },
      },
    },
  },
};

/**
 * Lo mínimo que hace falta para escribir una fila de `invoice_taxes`.
 *
 * Existe como tipo con nombre —y no inline en `buildInvoiceTaxCreateInput`—
 * porque ahora hay TRES productores que tienen que encajar en el mismo molde:
 * el motor de cálculo (`CalculatedTax`), el camino legacy de `dto.taxes[]`, y
 * la agregación de `order_item_taxes` que hace `createFromOrder`. Un molde
 * compartido es lo que impide que uno de los tres vuelva a olvidar `tax_type`
 * —con el que el CUFE arma `ValImp1/2/3`— como ya pasó con `update()`.
 */
export interface InvoiceTaxRowInput {
  tax_rate_id?: number | null;
  tax_name: string;
  /**
   * `string | number` porque las filas que salen del motor vienen ya
   * formateadas a 2 decimales truncados; el DTO legacy sigue mandando `number`.
   * `Prisma.Decimal` acepta ambos sin pérdida.
   */
  tax_rate: number | string;
  /**
   * Base gravable afirmada por el llamador. **Opcional** porque la fuente de
   * verdad es `InvoiceCalculatorService`: si llega vacía, `buildInvoiceTaxCreateInput`
   * persiste 0 y el reconciliador la reescribe tras la aceptación.
   */
  taxable_amount?: number | string;
  /**
   * Cuota afirmada por el llamador. Misma lógica que `taxable_amount`: si llega
   * vacía, persiste 0; la fuente de verdad sigue siendo server-side.
   */
  tax_amount?: number | string;
  tax_type?: TaxFiscalType | string | null;
  is_inclusive?: boolean;
}

/**
 * El desglose de tributos de UN documento, ya listo para persistir, indexado
 * por posición de línea: `line_taxes[i]` son los tributos de la i-ésima línea
 * creada. Se resuelve ANTES de escribir y se consume DESPUÉS, cuando ya existen
 * los `invoice_items.id` a los que apuntar.
 */
type DocumentLineTaxes = InvoiceTaxRowInput[][];

@Injectable()
export class InvoicingService {
  private readonly logger = new Logger(InvoicingService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly invoice_number_generator: InvoiceNumberGenerator,
    private readonly event_emitter: EventEmitter2,
    private readonly fiscalScope: FiscalScopeService,
    private readonly retry_queue: InvoiceRetryQueueService,
    private readonly fiscalGate: FiscalGateService,
    private readonly emissionGate: InvoiceEmissionGateService,
    private readonly fiscalInvoiceThreshold: FiscalInvoiceThresholdService,
    private readonly calculator: InvoiceCalculatorService,
    // TRM oficial para las operaciones pactadas en divisa. NUNCA tumba la
    // emisión: cuando la fuente externa no responde, `resolveExchangeRate`
    // devuelve `null` y el documento sigue si trae tasa manual.
    private readonly trm: TrmService,
    // Resolutor de retenciones. Acá se usa SÓLO para CALCULAR el agregado que
    // va en `invoices.withholding_amount` al crear; la PERSISTENCIA de
    // `withholding_calculations` sigue siendo de `InvoiceFlowService` en la
    // aceptación. Ver la nota de `resolveWithholdingAmount`.
    private readonly withholdingFlow: WithholdingFlowService,
  ) {}

  /**
   * Estado del límite 5 UVT para el documento equivalente POS en la tienda
   * actual (Art. 616-1 ET / Res. 000165 de 2023).
   *
   * Devuelve `enforced: false` cuando el área fiscal de facturación está
   * inactiva o cuando no hay UVT configurada para el año: son exactamente los
   * dos casos en que la venta de la transacción tampoco se bloquea, así que el
   * aviso del POS y el bloqueo real no pueden desalinearse.
   */
  async getPosUvtThreshold(): Promise<{
    enforced: boolean;
    uvt_value: number | null;
    uvt_limit: number;
    limit_cop: number | null;
    year: number;
  }> {
    const context = RequestContextService.getContext();
    const organization_id = Number(context?.organization_id ?? 0);
    const year = new Date().getFullYear();

    if (!organization_id) {
      return {
        enforced: false,
        uvt_value: null,
        uvt_limit: POS_EQUIVALENT_DOCUMENT_UVT_LIMIT,
        limit_cop: null,
        year,
      };
    }

    const evaluation = await this.fiscalInvoiceThreshold.evaluate({
      organization_id,
      store_id: context?.store_id ?? null,
      // Amount 0 with no customer: we only want the resolved limit, not a verdict.
      total_amount: 0,
      has_customer: false,
      year,
    });

    return {
      enforced: evaluation.enforced,
      uvt_value: evaluation.uvt_value,
      uvt_limit: POS_EQUIVALENT_DOCUMENT_UVT_LIMIT,
      limit_cop: evaluation.limit_cop,
      year: evaluation.year,
    };
  }

  /**
   * Defensa en profundidad del gate fiscal de FACTURACIÓN a nivel servicio.
   *
   * El ModuleFlowGuard bloquea la entrada HTTP y send()/accept() ya validan en
   * InvoiceFlowService, pero create()/createFromOrder()/createFromSalesOrder()
   * también son invocados por rutas internas que NO pasan por el controller
   * (invoice-data-requests, remisiones de despacho, futura auto-emisión POS).
   * Sin este gate esos callers crearían facturas saltándose el master switch
   * `fiscal_status.invoicing`. Fail-closed ante área inactiva.
   *
   * Usa el MISMO criterio (ACTIVE || LOCKED, vía FiscalGateService.isAreaEnabled)
   * y el MISMO error que InvoiceFlowService.assertInvoicingAreaActive
   * (invoice-flow.service.ts) para no divergir del gate de send/accept.
   *
   * Encima de eso aplica `assertElectronicEmissionLive`: el área activa no basta
   * cuando el tenant ya configuró FE y su habilitación sigue en trámite.
   */
  private async assertInvoicingAreaActive(context: {
    organization_id?: number;
    store_id?: number;
  }): Promise<void> {
    // Delega en `InvoiceEmissionGateService`. Los dos criterios vivían aquí como
    // métodos privados, y por eso el carril de notas de crédito —que está en
    // otro servicio— no los cruzaba: medido el 2026-08-24, la misma tienda daba
    // 403 al crear factura y 201 al crear nota de crédito, gastando consecutivo.
    // El nombre del método se conserva para no tocar los tres sitios de llamada.
    await this.emissionGate.assertAreaActive(context);
  }

  /**
   * ¿Puede esta tienda emitir un documento electrónico AHORA MISMO?
   *
   * Es exactamente la compuerta de `assertInvoicingAreaActive` —área fiscal
   * activa + habilitación DIAN viva en producción— pero preguntada en vez de
   * impuesta. Existe para el carril del POS: allí la venta ya está cobrada, así
   * que hay que saber si vale la pena intentar la emisión ANTES de consumir un
   * consecutivo, y una excepción no es forma de preguntar.
   *
   * NO reimplementa el criterio: llama al mismo método privado. Una segunda
   * copia de la regla se desincroniza el primer día y dejaría al POS emitiendo
   * donde el carril fiscal bloquea, o al revés.
   */
  async getElectronicEmissionEligibility(): Promise<{
    eligible: boolean;
    reason: string | null;
  }> {
    try {
      await this.assertInvoicingAreaActive(this.getContext());
      return { eligible: true, reason: null };
    } catch (error) {
      return {
        eligible: false,
        reason:
          error instanceof Error && error.message.trim()
            ? error.message
            : 'Esta tienda no puede emitir documentos electrónicos todavía.',
      };
    }
  }

  /**
   * `store_settings.invoicing.pos` de la tienda en contexto, con sus defaults ya
   * aplicados.
   *
   * ## Por qué vive acá y no en el carril del POS
   *
   * Para que el dominio de facturación tenga UN solo sitio donde se decide qué
   * se asume cuando el comerciante no configuró nada. El otro lector es
   * `payments.service.ts`, que resuelve `auto_emit` en línea porque ya tiene los
   * settings en memoria dentro del camino del cobro y una segunda consulta ahí
   * se paga en cada venta; lo que NO hace es tener su propio criterio: importa
   * la misma constante `DEFAULT_POS_AUTO_EMIT` de este archivo de interfaces.
   * La regla es esa —una constante compartida, no dos defaults escritos a
   * mano—, y romperla dejaría la emisión automática encendida para quien la
   * dispara y apagada para quien la ejecuta.
   *
   * Nunca lanza: sus dos llamadores están en el camino de una venta YA cobrada,
   * y quedarse sin poder leer una preferencia no puede ser peor que la
   * preferencia misma. Ante cualquier fallo devuelve los defaults, que son los
   * conservadores.
   */
  async getPosInvoicingSettings(): Promise<Required<PosInvoicingSettings>> {
    const fallback: Required<PosInvoicingSettings> = {
      auto_emit: DEFAULT_POS_AUTO_EMIT,
      on_failure: DEFAULT_POS_DIAN_FAILURE_POLICY,
    };

    try {
      const store_id = this.getContext().store_id;
      if (typeof store_id !== 'number') return fallback;

      const row = await this.prisma.store_settings.findFirst({
        where: { store_id },
        select: { settings: true },
      });

      const pos = (row?.settings as Record<string, any> | null)?.invoicing?.pos;
      if (!pos || typeof pos !== 'object') return fallback;

      return {
        auto_emit:
          typeof pos.auto_emit === 'boolean' ? pos.auto_emit : fallback.auto_emit,
        // Sólo se acepta un valor del dominio. Una cadena arbitraria escrita a
        // mano en el JSON no puede desactivar el registro del fallo por la
        // puerta de atrás: cae al default, que es el que sí lo registra.
        on_failure:
          pos.on_failure === 'queue' || pos.on_failure === 'ignore'
            ? pos.on_failure
            : fallback.on_failure,
      };
    } catch (error) {
      this.logger.warn(
        `No se pudieron leer los ajustes de facturación del POS; se usan los defaults: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return fallback;
    }
  }

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  private async resolveAccountingEntityIdForContext(context: {
    organization_id?: number;
    store_id?: number;
  }): Promise<number> {
    if (
      typeof context.organization_id !== 'number' ||
      typeof context.store_id !== 'number'
    ) {
      throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
    }

    const entity = await this.fiscalScope.resolveAccountingEntityForFiscal({
      organization_id: context.organization_id,
      store_id: context.store_id,
    });

    return entity.id;
  }

  private async assertFiscalPeriodOpen(
    accounting_entity_id: number,
    issue_date: Date,
    action: string,
  ): Promise<void> {
    const fiscal_date = new Date(
      Date.UTC(
        issue_date.getUTCFullYear(),
        issue_date.getUTCMonth(),
        issue_date.getUTCDate(),
      ),
    );
    const closed = await this.prisma.fiscal_close_sessions.findFirst({
      where: {
        accounting_entity_id,
        status: 'closed',
        period_start: { lte: fiscal_date },
        period_end: { gte: fiscal_date },
      },
      select: {
        id: true,
        period_year: true,
        period_month: true,
        closed_at: true,
      },
    });

    if (!closed) return;

    throw new VendixHttpException(
      ErrorCodes.FISCAL_ACCOUNTING_BLOCKED,
      `Cannot ${action} fiscal document because the fiscal period is closed.`,
      {
        accounting_entity_id,
        fiscal_close_session_id: closed.id,
        period_year: closed.period_year,
        period_month: closed.period_month,
        issue_date: fiscal_date.toISOString().split('T')[0],
        closed_at: closed.closed_at,
      },
    );
  }

  private toFiscalDocumentType(invoice_type: string) {
    if (invoice_type === 'purchase_invoice') return 'support_document';
    if (invoice_type === 'export_invoice') return 'sales_invoice';
    return invoice_type as
      | 'sales_invoice'
      | 'credit_note'
      | 'debit_note'
      | 'support_document'
      | 'support_adjustment_note';
  }

  private isSupportDocumentType(invoice_type: string): boolean {
    return (
      invoice_type === 'purchase_invoice' ||
      invoice_type === 'support_document' ||
      invoice_type === 'support_adjustment_note'
    );
  }

  private async loadSupportDocumentSupplier(dto: CreateInvoiceDto) {
    if (!this.isSupportDocumentType(dto.invoice_type)) return null;
    if (!dto.supplier_id) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_CONFIG_INCOMPLETE,
        'Support documents require a supplier.',
      );
    }

    // Sin filtro de `state` a propósito: el documento soporte se emite sobre
    // una compra que ya ocurrió, y su plazo de radicación ante la DIAN puede
    // vencer después de que el proveedor haya sido inactivado o archivado.
    // Los pickers son los que restringen a `active`; esto solo copia los datos
    // fiscales de la contraparte al documento.
    const supplier = await this.prisma.suppliers.findFirst({
      where: { id: dto.supplier_id },
      select: {
        id: true,
        name: true,
        tax_id: true,
        document_type: true,
        tax_regime: true,
        verification_digit: true,
        addresses: {
          select: {
            address_line1: true,
            address_line2: true,
            city: true,
            state_province: true,
            country_code: true,
            postal_code: true,
            municipality_code: true,
            phone_number: true,
          },
        },
      },
    });

    if (!supplier?.tax_id) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_CONFIG_INCOMPLETE,
        'Support document supplier requires tax_id.',
        { supplier_id: dto.supplier_id },
      );
    }

    return supplier;
  }

  /**
   * `customer_id` que no existe, o que pertenece a OTRA organización.
   *
   * Se comprueba a mano porque `users` es el único de los tres identificadores
   * de una factura que `StorePrismaService` NO scopea: su getter devuelve el
   * `baseClient` (ver el comentario «Organization-scoped models (accessible but
   * not scoped in store service)» en `store-prisma.service.ts`), así que un
   * `findFirst` por id a secas ve la tabla entera.
   *
   * Los dos modos de fallo que cierra son distintos y los dos reales:
   *  · id inexistente ⇒ `invoices_customer_id_fkey` rechazaba el INSERT y el
   *    filtro global lo degradaba a `SYS_INTERNAL_001` / 500, con el
   *    consecutivo autorizado ya consumido por `generateNextNumber`.
   *  · id de otra organización ⇒ la FK lo ACEPTA, así que entraba en silencio y
   *    la factura quedaba apuntando al cliente de otro tenant.
   *
   * 422 y no 404 por la misma razón que `INVOICING_CALC_002`: no falta el
   * recurso que se pidió (la factura), sino que el cuerpo referencia uno que no
   * es de quien escribe.
   */
  private async assertCustomerResolvable(
    customer_id: number | null | undefined,
  ): Promise<void> {
    if (customer_id == null) return;
    const context = this.getContext();
    const customer = await this.prisma.users.findFirst({
      where: {
        id: customer_id,
        organization_id: Number(context.organization_id),
      },
      select: { id: true },
    });
    if (!customer) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_CALC_004,
        `El cliente ${customer_id} no existe en esta organización. Selecciónalo desde el buscador de clientes, o créalo antes de facturar.`,
        { customer_id },
      );
    }
  }

  private async loadSupportAdjustmentOriginal(
    dto: CreateInvoiceDto,
    accounting_entity_id: number,
  ) {
    if (dto.invoice_type !== 'support_adjustment_note') return null;
    if (!dto.related_invoice_id) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_VALIDATE_001,
        'Support adjustment notes require the original support document.',
      );
    }

    return this.findAcceptedSupportDocumentOriginal(
      dto.related_invoice_id,
      accounting_entity_id,
    );
  }

  private async findAcceptedSupportDocumentOriginal(
    related_invoice_id: number,
    accounting_entity_id: number,
  ) {
    const original = await this.prisma.invoices.findFirst({
      where: {
        id: related_invoice_id,
        accounting_entity_id,
        invoice_type: { in: ['purchase_invoice', 'support_document'] as any },
      },
      select: {
        id: true,
        invoice_number: true,
        invoice_type: true,
        status: true,
        cufe: true,
      },
    });

    if (!original) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_VALIDATE_001,
        'Original support document was not found in this fiscal entity.',
        { related_invoice_id },
      );
    }

    if (original.status !== 'accepted' || !original.cufe) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_STATUS_002,
        'Original support document must be accepted by DIAN before creating an adjustment note.',
        {
          related_invoice_id: original.id,
          status: original.status,
          has_cuds: Boolean(original.cufe),
        },
      );
    }

    return original;
  }

  async findAll(query: QueryInvoiceDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'created_at',
      sort_order = 'desc',
      status,
      invoice_type,
      date_from,
      date_to,
      customer_id,
      cuds,
      supplier_id,
    } = query;

    const skip = (page - 1) * limit;

    // Lookup por CUDS: el CUDS vive en `invoices.cufe` (misma columna física
    // que carga CUFE/CUDE/CUDS). Coincidencia EXACTA — la búsqueda parcial
    // por un substring de 5 chars gasta un índice inútil y nunca trae la fila
    // que el usuario quiere. Un CUDS inexistente devuelve 200 con `data:[]`.
    const trimmed_cuds = cuds?.trim();

    const where: Prisma.invoicesWhereInput = {
      ...(search && {
        OR: [
          {
            invoice_number: { contains: search, mode: 'insensitive' as const },
          },
          { customer_name: { contains: search, mode: 'insensitive' as const } },
          {
            customer_tax_id: { contains: search, mode: 'insensitive' as const },
          },
          { notes: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(status && { status: status as any }),
      ...(invoice_type && { invoice_type: invoice_type as any }),
      ...(customer_id && { customer_id }),
      ...(supplier_id && { supplier_id }),
      ...(trimmed_cuds && { cufe: trimmed_cuds }),
      ...(date_from && {
        issue_date: {
          gte: new Date(date_from),
          ...(date_to && { lte: new Date(date_to) }),
        },
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.invoices.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: {
          customer: {
            select: { id: true, first_name: true, last_name: true },
          },
          resolution: {
            select: { id: true, prefix: true, resolution_number: true },
          },
          created_by_user: {
            select: { id: true, first_name: true, last_name: true },
          },
        },
      }),
      this.prisma.invoices.count({ where }),
    ]);

    // Paso 13 — retry_status: resolve queue state for invoices in an error or
    // pending-send state with ONE batch query over the page IDs (no N+1).
    const retry_candidate_ids = data
      .filter(
        (invoice: any) =>
          RETRY_ELIGIBLE_SEND_STATUSES.includes(invoice.send_status) ||
          RETRY_ELIGIBLE_TRANSMISSION_STATUSES.includes(
            invoice.transmission_status,
          ),
      )
      .map((invoice: any) => invoice.id);

    const retry_status_map =
      await this.retry_queue.getRetryStatusByInvoiceIds(retry_candidate_ids);

    const data_with_retry = data.map((invoice: any) => ({
      ...invoice,
      retry_status: retry_status_map.get(invoice.id) ?? null,
    }));

    return {
      data: data_with_retry,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * El detalle devuelve `retry_status` con el MISMO criterio que `findAll`.
   *
   * No es simetría por gusto: el panel de reintentos del detalle nacía leyendo
   * el `retry_status` que venía en la fila del listado, así que sólo aparecía si
   * el usuario había pasado por la tabla. Abrir la factura por enlace directo
   * —o recargar con el detalle abierto— la dejaba sin panel, y una factura en
   * cola de reintento se veía igual que una abandonada. El dato existía; lo que
   * faltaba era que este endpoint lo publicara.
   *
   * Se reutiliza `getRetryStatusByInvoiceIds` en vez de escribir una consulta
   * por id para que las dos superficies no puedan divergir: si mañana cambia qué
   * cuenta como «en cola», cambia en un solo sitio.
   */
  async findOne(id: number) {
    const invoice = await this.prisma.invoices.findFirst({
      where: { id },
      include: INVOICE_INCLUDE,
    });

    if (!invoice) {
      throw new VendixHttpException(ErrorCodes.INVOICING_FIND_001);
    }

    const retry_eligible =
      RETRY_ELIGIBLE_SEND_STATUSES.includes((invoice as any).send_status) ||
      RETRY_ELIGIBLE_TRANSMISSION_STATUSES.includes(
        (invoice as any).transmission_status,
      );

    // Una factura que no está en estado de error ni pendiente de envío no se
    // consulta contra la cola: sería una consulta garantizada a vacío en el
    // camino más transitado del módulo.
    const retry_status = retry_eligible
      ? ((
          await this.retry_queue.getRetryStatusByInvoiceIds([invoice.id])
        ).get(invoice.id) ?? null)
      : null;

    return { ...invoice, retry_status };
  }

  async create(dto: CreateInvoiceDto) {
    const context = this.getContext();
    await this.assertInvoicingAreaActive(context);
    const accounting_entity_id =
      await this.resolveAccountingEntityIdForContext(context);
    const issue_date = new Date(dto.issue_date);
    await this.assertFiscalPeriodOpen(
      accounting_entity_id,
      issue_date,
      'create',
    );
    const support_supplier = await this.loadSupportDocumentSupplier(dto);
    const support_adjustment_original =
      await this.loadSupportAdjustmentOriginal(dto, accounting_entity_id);

    // QUI-690 Step 3 — Inline customer creation. When the user picks "Crear
    // cliente desde la factura" in the XXL modal, the frontend posts
    // `inline_customer` (full CreateCustomerDto). We materialize the
    // `users.role='customer'` row here, in the same tenant scope as the
    // invoice, and feed the resulting `customer_id` into the invoice. When
    // both `customer_id` and `inline_customer` are sent, `customer_id` wins
    // (matches the rule documented in `CreateInvoiceDto`).
    let resolved_customer_id = dto.customer_id;
    if (resolved_customer_id == null && dto.inline_customer) {
      resolved_customer_id = await this.createInlineCustomer(
        context,
        dto.inline_customer,
      );
    } else {
      // Sólo el id que llegó del cliente necesita puerta: el creado en línea
      // acaba de nacer en este mismo tenant.
      await this.assertCustomerResolvable(resolved_customer_id);
    }

    // QUI-690 Step 3 — Inline product creation per line. NOT YET IMPLEMENTED:
    // ProductsService.create is 150+ lines (variants, stock_levels, images,
    // dedup, pricing rules) and refactoring it into a transaction-safe
    // variant is out of scope for this QUI. We accept `inline_product` in
    // the DTO so the frontend contract is stable, but reject at runtime with
    // a clear error so the user knows to create the product first via the
    // products module.
    if (dto.items.some((it) => it.inline_product && !it.product_id)) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'La creación inline de productos desde la factura aún no está implementada. Crea el producto primero en el módulo de productos y luego agrégalo por product_id.',
      );
    }

    // ORDEN DELIBERADO: recalcular ANTES de tomar el consecutivo.
    //
    // `recalculateDocument` puede rechazar el documento, y `generateNextNumber`
    // consume un número del rango autorizado por la DIAN que no se recupera ni
    // se reutiliza. Calcular después dejaba un hueco en la numeración cada vez
    // que la aritmética no cuadraba. Todo lo que pueda fallar por datos del
    // request tiene que fallar por encima de esta línea.
    const line_snapshots = await this.resolveLinePricingSnapshots(dto.items);
    // Las tarifas referenciadas TIENEN que existir y ser de este tenant, y se
    // resuelven ANTES del recálculo porque el catálogo es quien manda sobre la
    // tarifa y el tipo fiscal. Ver `resolveTenantTaxRateCatalog`.
    const tax_catalog = await this.resolveTenantTaxRateCatalog(dto.items);
    // PERFIL CONGELADO. Por encima del consecutivo por la misma razón que todo
    // lo demás en este bloque: sus cuatro puertas (no existe, inactivo, tipo de
    // operación distinto, sin versión) pueden rechazar, y un rechazo por debajo
    // de `generateNextNumber` dejaría un hueco permanente en la numeración
    // autorizada por la DIAN. `null` cuando el documento va por el flujo manual.
    const profile_snapshot = await this.resolveProfileSnapshot(
      dto.profile_id,
      dto.operation_type,
    );
    // Régimen de AIU y validación del objeto del contrato. Por encima del
    // consecutivo por la misma razón que el recálculo: puede rechazar.
    const aiu_context = await this.resolveAiuContext(
      dto.operation_type,
      dto.items,
      dto.aiu_contract_object,
      // Con perfil, el régimen sale de la versión congelada y `store_settings`
      // no se consulta. Sin perfil, `undefined` y el flujo manual queda igual.
      profile_snapshot?.config.aiu,
      // C.7 — los tres controles que ESTA factura puede apartar del perfil.
      {
        taxable_basis: dto.aiu_taxable_basis,
        enforce_minimum_base: dto.aiu_enforce_minimum_base,
        minimum_base_percent: dto.aiu_minimum_base_percent,
      },
    );
    // C.7 — la MISMA compuerta que corre al guardar el perfil
    // (`TAX_MATRIX_CONTRADICTS_REGIME`), reusada acá porque el documento
    // pudo apartarse de la base que el perfil declaró. Ver
    // `assertAiuBaseMatchesProfileMatrix`.
    this.assertAiuBaseMatchesProfileMatrix(
      profile_snapshot?.config,
      aiu_context.aiu,
      dto.operation_type,
      profile_snapshot?.profile_id,
    );
    const calculated = this.recalculateDocument(
      dto.items,
      line_snapshots,
      'invoice:create',
      aiu_context.aiu,
      tax_catalog,
    );

    // Tasa de cambio: sólo cuando el documento declara divisa y no trae tasa.
    // Nunca bloquea — ver `resolveExchangeRateForDocument`.
    const exchange_rate = await this.resolveExchangeRateForDocument({
      foreign_currency: dto.foreign_currency,
      exchange_rate: dto.exchange_rate,
      exchange_rate_date: dto.exchange_rate_date,
      issue_date: dto.issue_date,
    });

    // Retención resuelta desde la configuración fiscal de las dos partes.
    // Sólo para documentos de VENTA: en el documento soporte el tenant es el
    // comprador y el rol es `practiced`, que `InvoiceFlowService` ya resuelve
    // al aceptar. `null` ⇒ manda lo que declaró el cliente.
    const is_purchase_side =
      dto.invoice_type === 'support_document' ||
      dto.invoice_type === 'support_adjustment_note';
    const resolved_withholding = is_purchase_side
      ? null
      : await this.resolveWithholdingAmount({
          organization_id: context.organization_id,
          store_id: context.store_id,
          customer_id: resolved_customer_id,
          base: calculated.totals.total_before_tax,
          iva_amount: calculated.totals.tax_amount,
          issue_date,
        });

    // Generate invoice number from resolution
    const { invoice_number, resolution_id } =
      await this.invoice_number_generator.generateNextNumber({
        resolution_id: dto.resolution_id,
        document_type: this.toFiscalDocumentType(dto.invoice_type),
        accounting_entity_id,
      });

    // Documento con DOS O MÁS tributos distintos: sus filas de `invoice_taxes`
    // se escriben APARTE, una por (línea × tributo) y apuntando a la línea. No
    // pueden ir en este `create` anidado porque los `invoice_items.id` a los que
    // apuntan todavía no existen. Ver `needsPersistedLineTaxes` para por qué el
    // documento de un solo tributo NO se parte.
    const split_line_taxes = this.needsPersistedLineTaxes(
      calculated.header_taxes,
    );

    const invoice = await this.prisma.invoices.create({
      data: {
        organization_id: context.organization_id,
        store_id: context.store_id,
        accounting_entity_id,
        fiscal_document_type: this.toFiscalDocumentType(dto.invoice_type),
        invoice_number,
        invoice_type: dto.invoice_type,
        status: 'draft',
        customer_id: resolved_customer_id,
        supplier_id: dto.supplier_id,
        customer_name: dto.customer_name ?? support_supplier?.name,
        customer_tax_id: dto.customer_tax_id ?? support_supplier?.tax_id,
        customer_address: dto.customer_address ?? support_supplier?.addresses,
        // Identidad fiscal del adquiriente — SNAPSHOT de la emisión.
        //
        // Hasta la migración `20260815120000_dian_invoice_contract` estos datos
        // no tenían columna: se resolvían desde la ficha viva del cliente en
        // CADA envío a la DIAN. Eso rompe dos cosas. Una, el reenvío de un
        // documento antiguo recalculaba su CUFE con los datos de hoy y ya no
        // reproducía el hash que la DIAN validó. Dos, `customer_document_type`
        // decide si al número se le recorta el dígito de verificación
        // (`dianPartyId()`), así que perderlo es perder la capacidad de
        // recalcular la huella correcta.
        //
        // Persistirlos aquí congela lo que valió al emitir, igual que
        // `customer_address`, que ya seguía este patrón.
        customer_email: dto.customer_email,
        customer_phone: dto.customer_phone,
        customer_document_type: dto.customer_document_type,
        customer_verification_digit: dto.customer_verification_digit,
        customer_tax_regime: dto.customer_tax_regime,
        customer_fiscal_responsibilities:
          dto.customer_fiscal_responsibilities ?? undefined,
        // Forma ('1' contado / '2' crédito) y medio de pago DIAN.
        payment_form: dto.payment_form,
        payment_means_code: dto.payment_means_code,
        // `cbc:CustomizationID`. Se persiste crudo: NULL equivale a '10'
        // (estándar) y esa equivalencia vive en un solo sitio, el builder UBL.
        // Escribir '10' aquí crearía dos representaciones del mismo valor.
        operation_type: dto.operation_type,
        // SNAPSHOT del objeto del contrato AIU con el que se validó la nota
        // CAV03, sea el del documento o el de la tienda. Persistirlo es lo que
        // impide que un cambio de configuración entre la captura y el envío
        // haga que el XML describa un contrato distinto del que se facturó.
        // `undefined` en un documento no-AIU: la columna queda NULL.
        aiu_contract_object: aiu_context.contract_object,
        // SNAPSHOT DEL RÉGIMEN. Misma razón que la línea de arriba, y más
        // grave: el régimen no describe el documento, DECIDE qué parte del
        // contrato es base gravable, y los dos son incompatibles —E.T. art.
        // 462-1 grava A+I+U completo, Decreto 1372/1992 grava sólo la
        // Utilidad—. En emisión el régimen es lo que decide `omit_tax_total`
        // por línea, mientras los importes salen de los tributos persistidos:
        // si el ajuste de la tienda cambia entre la captura y la firma, el XML
        // declara una gravabilidad que no corresponde a los importes que lleva
        // dentro. Eso es rechazo por FAU04 con el consecutivo ya gastado, o
        // peor, aceptación con el IVA equivocado.
        //
        // `undefined` en documentos no-AIU: `resolveAiuContext` devuelve `{}` y
        // las tres columnas quedan NULL.
        aiu_regime: aiu_context.aiu
          ? this.regimeStringFromTaxableBasis(aiu_context.aiu.taxable_basis)
          : undefined,
        // El porcentaje EFECTIVO, no el declarado: bajo `et_462_1` el piso rige
        // aunque la tienda no lo escriba, así que NULL habría significado «no
        // hay piso» en una factura que sí lo tiene. Ausente solo cuando de
        // verdad no aplica: régimen del Decreto 1372, o piso apagado explícito.
        aiu_minimum_percent: aiu_context.aiu
          ? this.resolveAiuMinimumPercent(aiu_context.aiu)
          : undefined,
        aiu_taxable_matrix: aiu_context.aiu
          ? this.buildAiuTaxableMatrix(
              calculated.lines,
              aiu_context.aiu,
              'invoice:create',
            )
          : undefined,
        // PROCEDENCIA CONGELADA — las dos columnas van JUNTAS o ninguna.
        //
        // Apuntan a `invoice_profile_versions` por su único
        // `(profile_id, version)`, no al perfil: lo que la factura debe poder
        // reproducir es la CONFIGURACIÓN con la que se calculó, y esa vive en la
        // versión. El perfil es un puntero móvil; la versión es inmutable.
        //
        // La FK compuesta admite NULL si CUALQUIERA de las dos lo es, así que
        // `(profile_id = 5, profile_version = NULL)` pasaría la FK. El «ambas o
        // ninguna» lo impone el CHECK de la tabla — ver el docblock de las
        // columnas en `schema.prisma`. Escribirlas del mismo objeto, como acá,
        // es lo que hace que el CHECK nunca se ejerza en la práctica.
        profile_id: profile_snapshot?.profile_id,
        profile_version: profile_snapshot?.version,
        // Divisa extranjera: SOLO declara la conversión. El documento se emite
        // siempre en COP (Res. DIAN 000042/2020 art. 73) y el importe legal
        // sigue siendo `total_amount`.
        foreign_currency: dto.foreign_currency,
        foreign_total_amount:
          dto.foreign_total_amount != null
            ? new Prisma.Decimal(dto.foreign_total_amount)
            : null,
        // Tasa manual si la hay; si no, la TRM oficial del día de la operación.
        // `null` cuando ninguna de las dos existe: el builder omite entonces
        // `cac:PaymentExchangeRate`, que es preferible a declararlo con una
        // tasa inventada.
        exchange_rate: exchange_rate ?? null,
        // La fecha de la tasa se congela aunque el usuario no la mande: sin
        // ella, un reenvío no sabría contra qué TRM se convirtió.
        exchange_rate_date: dto.exchange_rate_date
          ? new Date(dto.exchange_rate_date)
          : dto.foreign_currency
            ? issue_date
            : null,
        related_invoice_id: support_adjustment_original?.id,
        resolution_id,
        // `subtotal_amount` es la BASE GRAVABLE, no el bruto capturado.
        //
        // Antes se persistía `Σ quantity × unit_price`, que en una línea con el
        // impuesto incluido en el precio lleva el IVA dentro: la factura
        // declaraba una base inflada y el asiento contable arrancaba
        // descuadrado. `total_before_tax` es la Σ de los
        // `cbc:LineExtensionAmount` que salen al XML — el mismo valor que la
        // DIAN recomputa como `ValFac` del CUFE.
        subtotal_amount: new Prisma.Decimal(calculated.totals.total_before_tax),
        discount_amount: new Prisma.Decimal(calculated.totals.discount_amount),
        tax_amount: new Prisma.Decimal(calculated.totals.tax_amount),
        // Retención resuelta por configuración fiscal; el valor del cliente
        // sólo sobrevive cuando no hay nada que resolver. NO se resta de
        // `total_amount` (§11.9.1).
        withholding_amount:
          resolved_withholding ?? new Prisma.Decimal(dto.withholding_amount || 0),
        // `PayableAmount`. NO resta la retención (Anexo 1.9 §11.9.1: la DIAN
        // valida el total sin mirar `cac:WithholdingTaxTotal`) ni el anticipo.
        total_amount: new Prisma.Decimal(calculated.totals.total_amount),
        currency: dto.currency || 'COP',
        issue_date,
        due_date: this.resolveDueDate(dto, issue_date),
        created_by_user_id: context.user_id,
        notes: dto.notes,
        invoice_items: {
          create: dto.items.map((item, index) =>
            this.buildInvoiceItemCreateInput(
              item,
              calculated.lines[index],
              line_snapshots[index],
            ),
          ),
        },
        // Filas de `invoice_taxes` agregadas por el motor desde los impuestos
        // de línea. El `dto.taxes[]` de cabecera sólo sobrevive como camino
        // legacy para documentos sin impuestos tipados por línea: es la única
        // fuente que no se puede recalcular, porque no está atada a ninguna
        // base concreta.
        //
        // `split_line_taxes` corta acá a propósito: ese documento escribe sus
        // tributos después, ya vinculados a la línea. Escribirlos también aquí
        // los DUPLICARÍA —agregado + desglose en la misma tabla— y todo
        // consumidor suma sin filtrar, así que el impuesto del documento saldría
        // al doble.
        ...(split_line_taxes
          ? {}
          : calculated.header_taxes.length > 0
            ? {
                invoice_taxes: {
                  create: calculated.header_taxes.map((t) =>
                    this.buildInvoiceTaxCreateInput(t),
                  ),
                },
              }
            : dto.taxes && dto.taxes.length > 0
              ? {
                  invoice_taxes: {
                    create: this.buildDocumentLevelTaxRows(dto.taxes),
                  },
                }
              : {}),
      },
      include: INVOICE_INCLUDE,
    });

    // Segunda escritura: el desglose por línea. Sólo para el documento
    // multi-tributo, y sólo porque los ids de las líneas no existían antes.
    let created = invoice;
    if (split_line_taxes) {
      await this.persistLineTaxes(
        invoice.id,
        calculated.lines.map((line) => line.taxes),
        calculated.header_taxes,
      );
      // Se recarga para que el documento devuelto incluya las filas de impuesto
      // recién escritas: sin esto el llamador vería `invoice_taxes: []` y
      // concluiría que la factura nació sin tributos.
      created =
        (await this.prisma.invoices.findFirst({
          where: { id: invoice.id },
          include: INVOICE_INCLUDE,
        })) ?? invoice;
    }

    // Retenciones declaradas por el cliente: si llegan, se validan, se
    // persisten en `withholding_calculations` y el agregado reemplaza al
    // auto-resuelto del tenant (que también queda disponible vía
    // `accepted` para facturas SIN desglose). Vacío o ausente ⇒ sin cambio.
    if (dto.withholdings && dto.withholdings.length > 0) {
      // Resolver el contexto de tienda/organización desde el ALS — `create()`
      // ya validó que existe vía `assertInvoicingAreaActive`, así que aquí basta
      // con derivar los ids que `applyClientDeclaredWithholdings` exige para
      // abrir su propia transacción.
      const ctx = this.getContext();
      const organization_id = Number(ctx.organization_id);
      const store_id = ctx.store_id != null ? Number(ctx.store_id) : null;

      const aggregated = await this.applyClientDeclaredWithholdings({
        organization_id,
        store_id,
        accounting_entity_id: invoice.accounting_entity_id ?? null,
        invoice_id: invoice.id,
        customer_id:
          invoice.customer_id != null ? Number(invoice.customer_id) : null,
        declared: dto.withholdings,
        year: new Date(issue_date).getFullYear(),
      });

      // Se actualiza `withholding_amount` con el agregado de lo declarado y se
      // recarga el documento para que el llamador lo vea reflejado. El
      //   recalculo automático en `accepted` queda como FALLBACK para facturas
      //   sin desglose explícito: declarado gana sobre auto cuando coexisten.
      if (!aggregated.isZero()) {
        await this.prisma.invoices.update({
          where: { id: invoice.id },
          data: { withholding_amount: aggregated },
        });
        created =
          (await this.prisma.invoices.findFirst({
            where: { id: invoice.id },
            include: INVOICE_INCLUDE,
          })) ?? created;
      }
    }

    this.event_emitter.emit('invoice.created', {
      invoice_id: created.id,
      invoice_number: created.invoice_number,
      invoice_type: created.invoice_type,
    });

    this.logger.log(
      `Invoice ${created.invoice_number} created (ID: ${created.id})`,
    );
    return created;
  }

  /**
   * QUI-690 — Inline customer creation for the XXL invoice-create modal.
   *
   * Mirrors a subset of `CustomersService.create()`:
   *   - Normalize persona (JURIDICA → first/last forced null, legal_name kept).
   *   - Generate unique username seed + temporary password.
   *   - Assign the `customer` system role via `user_roles`.
   *
   * Deliberately simpler than `CustomersService.create()`:
   *   - Skips email/document dedup queries (DTO validators + DB unique
   *     constraints catch duplicates and surface as P2002 → controller maps
   *     to SYS_CONFLICT_001).
   *   - Skips store existence check (the caller's ALS context already
   *     guarantees a valid store; an invalid context would fail elsewhere).
   *
   * Trade-off: this path produces a customer row that the bulk-edit and
   * dedup flows don't know about until the next request re-queries. For
   * the XXL modal flow (single user, single invoice) this is acceptable.
   */
  private async createInlineCustomer(
    context: {
      organization_id?: number;
      store_id?: number;
    },
    dto: CreateCustomerDto,
  ): Promise<number> {
    const organization_id = Number(context.organization_id);
    const store_id = Number(context.store_id);

    if (!organization_id || !store_id) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'Contexto de tienda requerido para crear cliente inline',
      );
    }

    const customerRole = await this.prisma.roles.findFirst({
      where: { name: 'customer', is_system_role: true },
    });
    if (!customerRole) {
      throw new VendixHttpException(
        ErrorCodes.CUST_CREATE_001,
        'El rol de sistema "customer" no existe — seed requerido',
      );
    }

    const isJuridica = dto.person_type === 'JURIDICA';
    const effectiveEmail = dto.email?.trim() || null;

    // Username: email → document_number → first_name → synthetic. Uniqueness
    // enforced by a small loop with a numeric suffix. Inline-only path; the
    // full `CustomersService.create()` uses a more robust generator.
    const baseUsername =
      effectiveEmail?.split('@')[0] ??
      dto.document_number ??
      dto.first_name ??
      `customer-${Date.now()}`;
    let username = baseUsername.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!username) username = `customer-${Date.now()}`;
    let attempt = 0;
    while (
      await this.prisma.users.findFirst({
        where: { username, organization_id },
        select: { id: true },
      })
    ) {
      attempt += 1;
      username = `${baseUsername}-${attempt}`;
    }

    const tempPassword = `tmp-${Math.random().toString(36).slice(2, 12)}`;
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    const created = await this.prisma.users.create({
      data: {
        organization_id,
        main_store_id: store_id,
        username,
        email: effectiveEmail,
        first_name: (isJuridica ? null : (dto.first_name ?? '')) as string,
        last_name: (isJuridica ? null : (dto.last_name ?? '')) as string,
        legal_name: dto.legal_name ?? null,
        document_type: (dto.document_type ?? null) as any,
        document_number: dto.document_number ?? null,
        verification_digit: dto.verification_digit ?? null,
        phone: dto.phone ?? null,
        tax_regime: (dto.tax_regime ?? null) as any,
        person_type: (dto.person_type ?? null) as any,
        fiscal_responsibilities: dto.fiscal_responsibilities ?? [],
        ciiu_code: dto.ciiu_code ?? null,
        is_withholding_agent: dto.is_withholding_agent ?? false,
        password: hashedPassword,
        state: 'active',
        email_verified: false,
      },
      select: { id: true },
    });

    // `user_roles` sólo tiene `user_id`, `role_id` y `store_id`; el tenant se
    // deriva del usuario y de la tienda. Pasar `organization_id` hacía que
    // Prisma rechazara el `data` completo, así que el cliente inline se creaba
    // sin rol y la factura fallaba después con «Error interno».
    await this.prisma.user_roles.create({
      data: {
        user_id: created.id,
        role_id: customerRole.id,
        store_id,
      },
    });

    return created.id;
  }

  /**
   * NINGÚN DOCUMENTO DE ORIGEN SE FACTURA DOS VECES.
   *
   * Va **antes** de `generateNextNumber()`, y el orden no es estilístico: ese
   * generador toma el consecutivo bajo `pg_advisory_xact_lock` e incrementa
   * `invoice_resolutions.current_number` en el acto. Un consecutivo tomado y no
   * usado es un hueco en la numeración autorizada de la DIAN, y los huecos no
   * se recuperan. Validar después de numerar sería validar tarde.
   *
   * ## Qué cuenta como «ya facturado»
   *
   * Todo lo que no esté `voided` ni `cancelled`. Una factura anulada libera el
   * documento de origen —esa es exactamente la razón de ser de la anulación—,
   * pero un `draft` NO: el draft ya consumió su consecutivo, así que permitir
   * una segunda emisión sobre una orden con draft pendiente quemaría un segundo
   * número para el mismo hecho económico.
   *
   * El `where` NO filtra por tenant a mano: `this.prisma` es el cliente scoped
   * y ya inyecta `organization_id`/`store_id` (ver `vendix-prisma-scopes`).
   */
  private async assertNotAlreadyInvoiced(
    where: { order_id: number } | { sales_order_id: number },
  ): Promise<void> {
    const existing = await this.prisma.invoices.findFirst({
      where: {
        ...where,
        invoice_type: 'sales_invoice',
        status: { notIn: ['voided', 'cancelled'] },
      },
      select: { id: true, invoice_number: true, status: true },
      orderBy: { id: 'desc' },
    });

    if (!existing) {
      return;
    }

    throw new VendixHttpException(
      ErrorCodes.INVOICING_CREATE_002,
      `Este documento ya tiene la factura ${existing.invoice_number}. ` +
        'Anúlala antes de emitir una nueva: cada emisión consume un ' +
        'consecutivo autorizado por la DIAN que no se puede recuperar.',
      {
        invoice_id: existing.id,
        invoice_number: existing.invoice_number,
        invoice_status: existing.status,
      },
    );
  }

  async createFromOrder(order_id: number) {
    const context = this.getContext();
    await this.assertInvoicingAreaActive(context);
    const accounting_entity_id =
      await this.resolveAccountingEntityIdForContext(context);

    const order = await this.prisma.orders.findFirst({
      where: { id: order_id },
      include: {
        // [print-fiscal-gate / resid-fiscal] — Filtramos líneas canceladas
        // (soft cancel de lina, D2) antes de armar las líneas de la factura.
        // `orders.subtotal_amount`/`tax_amount`/`grand_total` ya excluyen
        // cancelados, pero este `include` relee las líneas y las vuelve a
        // sumar — sin el filtro, el plato cancelado salía como línea
        // fantasma en el XML DIAN y rompía la igualdad header tax = Σ
        // line taxes. Una factura así o se rechaza o se emite con un
        // documento legalmente incorrecto que YA consumió consecutivo de
        // resolución — irreversible ante la DIAN. Filtrar aquí evita
        // ambos escenarios. `order_item_taxes` viaja colgado de la línea
        // cancelada, así que el filtro en cascada es correcto: ningún
        // impuesto de línea cancelada entra al cálculo.
        order_items: {
          where: { cancelled_at: null },
          include: {
            products: true,
            product_variants: true,
            order_item_taxes: true,
          },
        },
        // Step 8 — invoice-flow wiring. `legal_name`, `verification_digit`,
        // `tax_regime`, `person_type`, `fiscal_responsibilities`, `ciiu_code`
        // and `is_withholding_agent` were added to `users` by Steps 1-2;
        // pulling them here lets `customer_name` use the JURIDICA razon
        // social when applicable. The full UBL-relevant row reaches the
        // provider at `send()` time via `INVOICE_INCLUDE` in
        // `invoice-flow.service.ts`.
        users: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            legal_name: true,
            email: true,
            phone: true,
            document_type: true,
            document_number: true,
            verification_digit: true,
            tax_regime: true,
            person_type: true,
            fiscal_responsibilities: true,
            ciiu_code: true,
            is_withholding_agent: true,
          },
        },
        invoice_data_requests: {
          orderBy: { created_at: 'desc' },
          take: 1,
        },
      },
    });

    if (!order) {
      throw new VendixHttpException(ErrorCodes.INVOICING_FIND_003);
    }

    await this.assertNotAlreadyInvoiced({ order_id: order.id });

    const { invoice_number, resolution_id } =
      await this.invoice_number_generator.generateNextNumber({
        document_type: 'sales_invoice',
        accounting_entity_id,
      });

    const productItems = (order.order_items || []).map((item: any) => {
      const description =
        item.description ||
        item.product_name ||
        item.products?.name ||
        'Product';
      const quantity = Number(item.quantity || 1);
      const unit_price = Number(item.unit_price || 0);
      const discount = Number(item.discount_amount || 0);
      const tax = Number(item.tax_amount_item || 0) * quantity;
      const total_amount =
        Number(item.total_price || quantity * unit_price - discount) + tax;
      return {
        product_id: item.product_id,
        product_variant_id: item.product_variant_id,
        description,
        quantity: new Prisma.Decimal(quantity),
        unit_price: new Prisma.Decimal(unit_price),
        discount_amount: new Prisma.Decimal(discount),
        tax_amount: new Prisma.Decimal(tax),
        total_amount: new Prisma.Decimal(total_amount),
        // "Empaque por tarifa" snapshot propagated from the order line so the
        // invoice mirrors the order PDF (tier label + packaging units consumed).
        applied_price_tier_name:
          item.applied_price_tier_name_snapshot ?? null,
        stock_units_consumed:
          typeof item.stock_units_consumed === 'number'
            ? item.stock_units_consumed
            : null,
        // Serial number(s) snapshot (CSV) copied from the order line so the
        // invoice carries the same serials at emission time (QUI-431).
        serial_numbers_snapshot: item.serial_numbers_snapshot ?? null,
      };
    });
    const shippingCost = Number(order.shipping_cost || 0);
    const items =
      shippingCost > 0
        ? [
            ...productItems,
            {
              product_id: null,
              product_variant_id: null,
              description: 'Envio',
              quantity: new Prisma.Decimal(1),
              unit_price: new Prisma.Decimal(shippingCost),
              discount_amount: new Prisma.Decimal(0),
              tax_amount: new Prisma.Decimal(0),
              total_amount: new Prisma.Decimal(shippingCost),
              applied_price_tier_name: null,
              stock_units_consumed: null,
              serial_numbers_snapshot: null,
            },
          ]
        : productItems;

    const subtotal = items.reduce(
      (acc: number, item: any) =>
        acc + Number(item.quantity) * Number(item.unit_price),
      0,
    );
    const discount = items.reduce(
      (acc: number, item: any) => acc + Number(item.discount_amount),
      0,
    );
    const tax = items.reduce(
      (acc: number, item: any) => acc + Number(item.tax_amount),
      0,
    );
    const total = subtotal - discount + tax;

    // Aggregate the order's per-line typed taxes (order_item_taxes) into invoice
    // header-level invoice_taxes, one row per (name, rate, fiscal type). Without
    // this, invoices created from an order reached DIAN with NO taxes and fell
    // back to a default 19% IVA. order_item_taxes.tax_rate is a fraction (0.19);
    // invoice_taxes.tax_rate is a percentage (19.00) as DIAN UBL expects.
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const taxGroups = new Map<
      string,
      {
        tax_rate_id: number | null;
        tax_name: string;
        tax_rate: number;
        tax_type: string;
        taxable_amount: number;
        tax_amount: number;
      }
    >();
    /**
     * El MISMO desglose, pero sin agregar: `orderLineTaxes[i]` son los tributos
     * de la i-ésima línea de producto. Es el caso que motiva toda esta columna —
     * una cuenta de restaurante donde unos platos llevan INC y otros IVA nace
     * justamente por acá, desde `order_item_taxes`.
     *
     * La línea de ENVÍO, cuando existe, se añade al final de `items` y no lleva
     * tributos: se representa como un arreglo vacío para que el alineamiento por
     * posición contra `invoice_items` siga siendo cierto.
     */
    const orderLineTaxes: DocumentLineTaxes = [];
    for (const item of order.order_items || []) {
      const lineNet = Number(item.total_price || 0);
      const lineTaxes: InvoiceTaxRowInput[] = [];
      for (const t of (item as any).order_item_taxes || []) {
        const ratePct = round2(Number(t.tax_rate || 0) * 100);
        const type = (t.tax_type as string) || 'iva';
        const key = `${t.tax_name}|${ratePct}|${type}|${t.tax_rate_id ?? ''}`;
        const group = taxGroups.get(key) || {
          tax_rate_id: t.tax_rate_id ?? null,
          tax_name: t.tax_name,
          tax_rate: ratePct,
          tax_type: type,
          taxable_amount: 0,
          tax_amount: 0,
        };
        group.taxable_amount += lineNet;
        group.tax_amount += Number(t.tax_amount || 0);
        taxGroups.set(key, group);

        // La fila POR LÍNEA lleva la base de SU línea, no la acumulada. Sumadas
        // reproducen exactamente el agregado de arriba, que es lo que permite
        // que el `cac:TaxTotal` de cabecera no se mueva un centavo.
        lineTaxes.push({
          tax_rate_id: t.tax_rate_id ?? null,
          tax_name: t.tax_name,
          tax_rate: ratePct,
          taxable_amount: round2(lineNet),
          tax_amount: round2(Number(t.tax_amount || 0)),
          tax_type: type,
        });
      }
      orderLineTaxes.push(lineTaxes);
    }
    if (shippingCost > 0) orderLineTaxes.push([]);

    const invoiceTaxRows: InvoiceTaxRowInput[] = Array.from(
      taxGroups.values(),
    ).map((g) => ({
      tax_rate_id: g.tax_rate_id,
      tax_name: g.tax_name,
      tax_rate: g.tax_rate,
      taxable_amount: round2(g.taxable_amount),
      tax_amount: round2(g.tax_amount),
      tax_type: g.tax_type,
    }));
    // Se pasa por el mapeador compartido en vez de armar el input a mano: es lo
    // único que garantiza que `tax_type` —la clave con la que el CUFE arma
    // ValImp1/2/3— nunca quede ausente, que es como ya se rompió `update()`.
    const invoiceTaxes = invoiceTaxRows.map((tax_item) =>
      this.buildInvoiceTaxCreateInput(tax_item),
    );

    // Mismo criterio que `create()`: sólo el documento MULTI-TRIBUTO parte sus
    // filas por línea. Con un solo tributo el emisor ya produce el mismo XML
    // heredándolo, así que partirlo sería ruido puro. Ver
    // `needsPersistedLineTaxes`.
    const split_order_line_taxes = taxGroups.size >= 2;

    const invoiceDataRequest = order.invoice_data_requests?.[0];
    const guest_customer_name = invoiceDataRequest
      ? `${invoiceDataRequest.first_name || ''} ${invoiceDataRequest.last_name || ''}`.trim()
      : '';
    // Step 8 — for a JURIDICA the RUT razón social is the canonical name to
    // persist on the invoice; for a persona natural (or when `person_type`
    // is null) concatenate first/last. Falls back to the order's guest data
    // request when there is no `users` row, then to 'Consumidor Final'.
    const customer_name = order.users
      ? (order.users.legal_name?.trim() ||
        `${order.users.first_name || ''} ${order.users.last_name || ''}`.trim())
      : guest_customer_name || 'Consumidor Final';

    const invoice = await this.prisma.invoices.create({
      data: {
        organization_id: context.organization_id,
        store_id: context.store_id,
        accounting_entity_id,
        fiscal_document_type: 'sales_invoice',
        invoice_number,
        invoice_type: 'sales_invoice',
        status: 'draft',
        customer_id: order.customer_id,
        customer_name,
        customer_tax_id:
          order.users?.document_number ||
          invoiceDataRequest?.document_number ||
          undefined,
        order_id: order.id,
        resolution_id,
        subtotal_amount: new Prisma.Decimal(subtotal),
        discount_amount: new Prisma.Decimal(discount),
        tax_amount: new Prisma.Decimal(tax),
        // Plan Despacho Economía — FASE 4 paso 13. Persistir el monto del flete
        // separado del subtotal de productos. El asiento diferenciará producto
        // (4135) vs flete (414505) al validar la factura.
        shipping_amount: new Prisma.Decimal(shippingCost),
        total_amount: new Prisma.Decimal(total),
        currency: 'COP',
        issue_date: new Date(),
        created_by_user_id: context.user_id,
        invoice_items: {
          create: items,
        },
        // Igual que en `create()`: el documento multi-tributo escribe sus
        // tributos DESPUÉS, ya vinculados a la línea. Dejarlos también acá los
        // duplicaría y el impuesto del documento saldría al doble.
        ...(split_order_line_taxes || invoiceTaxes.length === 0
          ? {}
          : { invoice_taxes: { create: invoiceTaxes } }),
      },
      include: INVOICE_INCLUDE,
    });

    let created = invoice;
    if (split_order_line_taxes) {
      await this.persistLineTaxes(invoice.id, orderLineTaxes, invoiceTaxRows);
      created =
        (await this.prisma.invoices.findFirst({
          where: { id: invoice.id },
          include: INVOICE_INCLUDE,
        })) ?? invoice;
    }

    this.event_emitter.emit('invoice.created', {
      invoice_id: created.id,
      invoice_number: created.invoice_number,
      invoice_type: 'sales_invoice',
      source: 'order',
      order_id,
    });

    this.logger.log(
      `Invoice ${created.invoice_number} created from order #${order_id}`,
    );
    return created;
  }

  async createFromSalesOrder(sales_order_id: number) {
    const context = this.getContext();
    await this.assertInvoicingAreaActive(context);
    const accounting_entity_id =
      await this.resolveAccountingEntityIdForContext(context);

    const sales_order = await this.prisma.sales_orders.findFirst({
      where: { id: sales_order_id },
      include: {
        sales_order_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
    });

    if (!sales_order) {
      throw new VendixHttpException(ErrorCodes.INVOICING_FIND_004);
    }

    await this.assertNotAlreadyInvoiced({ sales_order_id: sales_order.id });

    /**
     * EL PEDIDO DE VENTA NO LLEVA IMPUESTOS, Y ESO NO SE PUEDE FACTURAR.
     *
     * Abajo, la construcción de líneas fijaba `const tax = 0` con el comentario
     * «sales_order_items don't have tax_amount». Es cierto —la tabla no tiene
     * columna de impuesto, no existe una `sales_order_item_taxes` hermana de
     * `order_item_taxes`, y `products` tampoco enlaza una `tax_rates`—, pero la
     * conclusión que se sacaba de ese hecho era emitir con IVA cero.
     *
     * Una factura con IVA cero sobre líneas gravadas no es un número feo en
     * pantalla: el `ValImp1` incorrecto entra en el hash del CUFE, la DIAN lo
     * recomputa desde el XML recibido, los hashes difieren y el documento se
     * rechaza — después de haber quemado el consecutivo. Es el mismo modo de
     * fallo que costó la factura FVJL1.
     *
     * Se rechaza acá, antes de tomar numeración. La ruta no tiene clientes hoy
     * (no hay controlador que cree `sales_orders` ni módulo que las muestre;
     * ver el docblock de `createFromSalesOrder` en el servicio del frontend),
     * así que la guarda no le quita capacidad a nadie: le quita la capacidad de
     * emitir en silencio un documento fiscalmente inválido. El día que exista
     * el módulo de pedidos de venta con su desglose tributario, se retira.
     */
    // `boolean` anotado a mano y no el literal `false`: con el tipo literal
    // TypeScript daría por inalcanzable todo el resto del método, y el cuerpo
    // que sigue es precisamente lo que se quiere conservar intacto para el día
    // que los pedidos de venta sí traigan tributos.
    const salesOrdersCarryTaxBreakdown: boolean = false;
    if (!salesOrdersCarryTaxBreakdown) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_CREATE_003,
        'Los pedidos de venta no registran el desglose de impuestos, así que ' +
          'la factura saldría con IVA en cero y la DIAN la rechazaría. Crea ' +
          'la factura desde la orden o captúrala manualmente.',
        { sales_order_id: sales_order.id },
      );
    }

    // Fetch customer info separately. Step 8 — select now carries the
    // JURIDICA/legal_name fields so `customer_name` resolves correctly when
    // the sales order's customer is a `legal_name`-bearing entity.
    const customer = await this.prisma.users.findFirst({
      where: { id: sales_order.customer_id },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        legal_name: true,
        email: true,
        phone: true,
        document_type: true,
        document_number: true,
        verification_digit: true,
        tax_regime: true,
        person_type: true,
        fiscal_responsibilities: true,
        ciiu_code: true,
        is_withholding_agent: true,
      },
    });

    const { invoice_number, resolution_id } =
      await this.invoice_number_generator.generateNextNumber({
        document_type: 'sales_invoice',
        accounting_entity_id,
      });

    const items = (sales_order.sales_order_items || []).map((item: any) => {
      const description =
        item.products?.name || item.product_variants?.name || 'Product';
      const quantity = Number(item.quantity || 1);
      const unit_price = Number(item.unit_price || 0);
      const discount = Number(item.discount || 0);
      // Cero porque `sales_order_items` no tiene columna de impuesto. NO es un
      // valor aceptable para facturar: la guarda `INVOICING_CREATE_003` de
      // arriba corta el método antes de llegar acá. Si algún día se retira esa
      // guarda, esta línea debe reemplazarse por el desglose real, nunca
      // dejarse como está.
      const tax = 0;
      const total_amount = quantity * unit_price - discount + tax;
      return {
        product_id: item.product_id,
        product_variant_id: item.product_variant_id,
        description,
        quantity: new Prisma.Decimal(quantity),
        unit_price: new Prisma.Decimal(unit_price),
        discount_amount: new Prisma.Decimal(discount),
        tax_amount: new Prisma.Decimal(tax),
        total_amount: new Prisma.Decimal(total_amount),
      };
    });

    const subtotal = items.reduce(
      (acc: number, item: any) =>
        acc + Number(item.quantity) * Number(item.unit_price),
      0,
    );
    const discount = items.reduce(
      (acc: number, item: any) => acc + Number(item.discount_amount),
      0,
    );
    const tax = items.reduce(
      (acc: number, item: any) => acc + Number(item.tax_amount),
      0,
    );
    const total = subtotal - discount + tax;

    // Step 8 — mirror of `createFromOrder`: prefer `legal_name` for JURIDICA,
    // concat first/last otherwise. Falls back to undefined when no row.
    const customer_name = customer
      ? (customer.legal_name?.trim() ||
        `${customer.first_name || ''} ${customer.last_name || ''}`.trim())
      : undefined;

    const invoice = await this.prisma.invoices.create({
      data: {
        organization_id: context.organization_id,
        store_id: context.store_id,
        accounting_entity_id,
        fiscal_document_type: 'sales_invoice',
        invoice_number,
        invoice_type: 'sales_invoice',
        status: 'draft',
        customer_id: sales_order.customer_id,
        customer_name,
        customer_tax_id: customer?.document_number || undefined,
        sales_order_id: sales_order.id,
        resolution_id,
        subtotal_amount: new Prisma.Decimal(subtotal),
        discount_amount: new Prisma.Decimal(discount),
        tax_amount: new Prisma.Decimal(tax),
        total_amount: new Prisma.Decimal(total),
        currency: 'COP',
        issue_date: new Date(),
        created_by_user_id: context.user_id,
        invoice_items: {
          create: items,
        },
      },
      include: INVOICE_INCLUDE,
    });

    this.event_emitter.emit('invoice.created', {
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      invoice_type: 'sales_invoice',
      source: 'sales_order',
      sales_order_id,
    });

    this.logger.log(
      `Invoice ${invoice.invoice_number} created from sales order #${sales_order_id}`,
    );
    return invoice;
  }

  async update(id: number, dto: UpdateInvoiceDto) {
    const invoice = await this.findOne(id);

    // Only allow editing invoices in draft state
    if (invoice.status !== 'draft') {
      throw new VendixHttpException(ErrorCodes.INVOICING_STATUS_002);
    }

    await this.assertFiscalPeriodOpen(
      invoice.accounting_entity_id,
      invoice.issue_date,
      'update',
    );

    if (dto.issue_date) {
      await this.assertFiscalPeriodOpen(
        invoice.accounting_entity_id,
        new Date(dto.issue_date),
        'update',
      );
    }

    if (
      invoice.invoice_type === 'support_adjustment_note' &&
      dto.related_invoice_id !== undefined
    ) {
      await this.findAcceptedSupportDocumentOriginal(
        dto.related_invoice_id,
        invoice.accounting_entity_id,
      );
    }

    // Misma puerta que en `create`: el PATCH escribe la MISMA columna por otra
    // puerta, y sin esto seguía siendo la vía barata para meter en una factura
    // el cliente de otra organización — o un id inexistente y su 500.
    if (dto.customer_id !== undefined) {
      await this.assertCustomerResolvable(dto.customer_id);
    }

    // If items are provided, recalculate amounts and replace
    const update_data: any = {
      ...(dto.customer_id !== undefined && { customer_id: dto.customer_id }),
      ...(dto.supplier_id !== undefined && { supplier_id: dto.supplier_id }),
      ...(dto.customer_name !== undefined && {
        customer_name: dto.customer_name,
      }),
      ...(dto.customer_tax_id !== undefined && {
        customer_tax_id: dto.customer_tax_id,
      }),
      ...(dto.customer_address !== undefined && {
        customer_address: dto.customer_address,
      }),
      // Identidad fiscal del adquiriente. Se mapea campo a campo y no con un
      // spread del DTO a propósito: un spread arrastraría cualquier clave que
      // el DTO gane mañana hacia un `prisma.update`, y una clave que no sea
      // columna revienta en runtime — que es justo el modo de fallo que esta
      // fase viene a cerrar.
      ...(dto.customer_email !== undefined && {
        customer_email: dto.customer_email,
      }),
      ...(dto.customer_phone !== undefined && {
        customer_phone: dto.customer_phone,
      }),
      ...(dto.customer_document_type !== undefined && {
        customer_document_type: dto.customer_document_type,
      }),
      ...(dto.customer_verification_digit !== undefined && {
        customer_verification_digit: dto.customer_verification_digit,
      }),
      ...(dto.customer_tax_regime !== undefined && {
        customer_tax_regime: dto.customer_tax_regime,
      }),
      ...(dto.customer_fiscal_responsibilities !== undefined && {
        customer_fiscal_responsibilities: dto.customer_fiscal_responsibilities,
      }),
      ...(dto.payment_form !== undefined && {
        payment_form: dto.payment_form,
      }),
      ...(dto.payment_means_code !== undefined && {
        payment_means_code: dto.payment_means_code,
      }),
      ...(dto.operation_type !== undefined && {
        operation_type: dto.operation_type,
      }),
      ...(dto.aiu_contract_object !== undefined && {
        aiu_contract_object: dto.aiu_contract_object,
      }),
      ...(dto.foreign_currency !== undefined && {
        foreign_currency: dto.foreign_currency,
      }),
      ...(dto.foreign_total_amount !== undefined && {
        foreign_total_amount: new Prisma.Decimal(dto.foreign_total_amount),
      }),
      ...(dto.exchange_rate !== undefined && {
        exchange_rate: new Prisma.Decimal(dto.exchange_rate),
      }),
      ...(dto.exchange_rate_date !== undefined && {
        exchange_rate_date: new Date(dto.exchange_rate_date),
      }),
      ...(dto.related_invoice_id !== undefined && {
        related_invoice_id: dto.related_invoice_id,
      }),
      ...(dto.withholding_amount !== undefined && {
        withholding_amount: new Prisma.Decimal(dto.withholding_amount),
      }),
      ...(dto.issue_date && { issue_date: new Date(dto.issue_date) }),
      // Se pasa por el mismo resolutor que la creación en vez de escribir la
      // fecha cruda: editar un borrador no puede dejarlo con un vencimiento
      // anterior a su emisión, ni marcarlo a crédito sin plazo. La emisión de
      // referencia es la nueva si el PATCH la cambia, y la vigente si no.
      ...(dto.due_date !== undefined || dto.payment_form !== undefined
        ? {
            due_date: this.resolveDueDate(
              {
                due_date: dto.due_date,
                payment_form: dto.payment_form ?? invoice.payment_form ?? undefined,
              },
              dto.issue_date ? new Date(dto.issue_date) : invoice.issue_date,
            ),
          }
        : {}),
      ...(dto.currency && { currency: dto.currency }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
    };

    /**
     * Cabecera de impuestos recalculada desde las líneas nuevas. Se resuelve
     * junto con los ítems porque `invoice_taxes` es un AGREGADO de
     * `invoice_items`: reemplazar las líneas y dejar la cabecera vieja produce
     * exactamente el descuadre que la DIAN rechaza.
     */
    let recalculated_header_taxes: InvoiceCalculatorResult['header_taxes'] = [];

    /**
     * Desglose por línea del documento reeditado, en el mismo orden en que se
     * van a recrear las líneas. Vacío = este PATCH no parte los tributos por
     * línea (documento de un solo tributo, o edición que no toca las líneas).
     * Ver `needsPersistedLineTaxes`.
     */
    let recalculated_line_taxes: DocumentLineTaxes = [];

    if (dto.items && dto.items.length > 0) {
      // Mismo motor y misma política que `create()`. Editar un borrador no
      // puede ser una vía para persistir aritmética que la creación rechaza.
      const line_snapshots = await this.resolveLinePricingSnapshots(dto.items);
      // Mismo catálogo y misma autoridad que en `create()`: editar un borrador
      // no puede ser la vía para meter una tarifa que la creación corrige.
      const tax_catalog = await this.resolveTenantTaxRateCatalog(dto.items);
      // Mismo régimen de AIU que la creación. El tipo de operación es el que
      // trae el PATCH si lo cambia, y el persistido si no: editar un borrador
      // no puede convertir un contrato AIU en una venta estándar por omisión.
      // La factura que YA congeló un perfil sigue leyendo ESA versión, no la
      // vigente del perfil.
      //
      // Es la mitad que hace cierta la promesa de F.3: «editar el perfil después
      // no altera el XML proyectado de la factura ya creada». Si el PATCH
      // volviera a resolver el perfil por su `current_version`, editar el perfil
      // y luego tocar una línea del borrador migraría el documento a un régimen
      // distinto en silencio — y `profile_version` seguiría diciendo la versión
      // vieja, con lo cual la procedencia declarada sería falsa. Peor que no
      // tener las columnas.
      //
      // Cambiar de perfil NO es una edición: `UpdateInvoiceDto` no acepta
      // `profile_id` a propósito. Quien quiera otro perfil descarta el borrador
      // y lo crea de nuevo, que es la única forma de que los importes y la
      // procedencia se recalculen juntos.
      // C.7 — se necesita la CONFIG completa (no sólo `.aiu`) para poder
      // reusar la compuerta base↔matriz del perfil; `loadFrozenProfileAiu`
      // sólo devolvía la sección AIU porque antes de C.7 nadie más la
      // necesitaba. Una sola consulta: `frozen_profile_aiu` se deriva de
      // `frozen_profile_config`, no se vuelve a leer la tabla.
      const frozen_profile_config = await this.loadFrozenProfileConfig(
        invoice.profile_id,
        invoice.profile_version,
      );
      const frozen_profile_aiu = frozen_profile_config?.aiu ?? null;
      const aiu_context = await this.resolveAiuContext(
        dto.operation_type ?? invoice.operation_type,
        dto.items,
        // Mismo criterio que el tipo de operación: el del PATCH si lo trae, el
        // persistido si no. Editar un borrador no puede borrar por omisión el
        // objeto del contrato con el que se validó la nota CAV03.
        dto.aiu_contract_object ?? invoice.aiu_contract_object,
        frozen_profile_aiu,
        // C.7 — mismo criterio: el del PATCH si lo trae, el persistido si no.
        // Editar un borrador no puede borrar por omisión un control que la
        // factura ya tenía apartado del perfil.
        //
        // `invoice.aiu_regime` NO es una `AiuTaxableBasis`: es lo que
        // `regimeStringFromTaxableBasis` escribió al crear (un régimen legal
        // —'et_462_1'/'decreto_1372_1992'— o, si la base fue 'subtotal', esa
        // misma palabra porque no tiene régimen). Invertirlo a mano sería el
        // 4º sitio que decide lo mismo. En vez de eso se reusa
        // `resolveAiuTaxableBasis` pasándole el string crudo en LAS DOS
        // posiciones que acepta: si es una base válida ('subtotal') gana esa
        // rama; si no, la función la interpreta como régimen y la traduce
        // igual que en la creación. `enforce_minimum_base` no tiene columna
        // propia —nunca la tuvo, ni antes de C.7— así que su ausencia en el
        // PATCH siempre cae en `source` dentro de `resolveAiuContext`.
        {
          taxable_basis:
            dto.aiu_taxable_basis ??
            (invoice.aiu_regime
              ? resolveAiuTaxableBasis({
                  regime: invoice.aiu_regime as AiuVatRegimeLiteral,
                  taxable_basis: invoice.aiu_regime as AiuTaxableBasis,
                })
              : undefined),
          enforce_minimum_base: dto.aiu_enforce_minimum_base,
          minimum_base_percent:
            dto.aiu_minimum_base_percent ??
            (invoice.aiu_minimum_percent != null
              ? Number(invoice.aiu_minimum_percent)
              : undefined),
        },
      );
      // C.7 — la MISMA compuerta que corre al guardar el perfil, reusada acá.
      this.assertAiuBaseMatchesProfileMatrix(
        frozen_profile_config,
        aiu_context.aiu,
        dto.operation_type ?? invoice.operation_type,
        invoice.profile_id,
      );
      const calculated = this.recalculateDocument(
        dto.items,
        line_snapshots,
        `invoice:update:${id}`,
        aiu_context.aiu,
        tax_catalog,
      );
      // EL SNAPSHOT SE REFRESCA EN CADA EDICIÓN QUE TOCA LÍNEAS.
      //
      // Dejarlo quieto sería peor que no tenerlo: los importes de abajo se
      // reescriben con el régimen que acaba de resolver `resolveAiuContext`, y
      // un snapshot viejo describiría una gravabilidad que ya no es la de los
      // importes que quedan persistidos. El snapshot vale por coincidir con los
      // números del documento, no por ser antiguo.
      //
      // El caso no-AIU no se resuelve acá sino en la puerta de más abajo, que
      // corre aunque el PATCH no traiga líneas.
      if (aiu_context.aiu) {
        update_data.aiu_regime = this.regimeStringFromTaxableBasis(
          aiu_context.aiu.taxable_basis,
        );
        update_data.aiu_minimum_percent =
          this.resolveAiuMinimumPercent(aiu_context.aiu) ?? null;
        update_data.aiu_taxable_matrix = this.buildAiuTaxableMatrix(
          calculated.lines,
          aiu_context.aiu,
          `invoice:update:${id}`,
        );
        // Se persiste el objeto RESUELTO, no el crudo del PATCH, que es lo que
        // ya hace `create()`. Sin esto las dos puntas divergían: crear con el
        // objeto de la tienda lo congelaba en la columna, y editar la misma
        // factura sin mandarlo la dejaba con el crudo —o con nada—.
        update_data.aiu_contract_object = aiu_context.contract_object;
      }

      recalculated_header_taxes = calculated.header_taxes;
      recalculated_line_taxes = this.needsPersistedLineTaxes(
        calculated.header_taxes,
      )
        ? calculated.lines.map((line) => line.taxes)
        : [];

      update_data.subtotal_amount = new Prisma.Decimal(
        calculated.totals.total_before_tax,
      );
      update_data.discount_amount = new Prisma.Decimal(
        calculated.totals.discount_amount,
      );
      update_data.tax_amount = new Prisma.Decimal(calculated.totals.tax_amount);
      update_data.total_amount = new Prisma.Decimal(
        calculated.totals.total_amount,
      );

      // Delete existing items and create new ones
      await this.prisma.invoice_items.deleteMany({
        where: { invoice_id: id },
      });

      // Mismo mapeo que `create()`, a propósito: ver la nota de
      // `buildInvoiceItemCreateInput`. Aquí se perdían `is_inclusive` y el
      // agregado de `taxes[]` por línea al editar un borrador.
      update_data.invoice_items = {
        create: dto.items.map((item, index) =>
          this.buildInvoiceItemCreateInput(
            item,
            calculated.lines[index],
            line_snapshots[index],
          ),
        ),
      };
    }

    // La cabecera se reescribe cuando la recalculó el motor O cuando el cliente
    // mandó `dto.taxes` explícitamente. El primer caso es nuevo y necesario:
    // antes, editar las líneas dejaba intacta la cabecera de impuestos vieja.
    if (recalculated_header_taxes.length > 0 || dto.taxes) {
      await this.prisma.invoice_taxes.deleteMany({
        where: { invoice_id: id },
      });

      // `recalculated_line_taxes` no vacío = documento multi-tributo: sus filas
      // se escriben DESPUÉS del update, cuando las líneas recreadas ya tienen
      // id. Acá no se escribe nada a propósito — hacerlo dejaría el agregado Y
      // el desglose en la misma tabla, y todo consumidor suma sin filtrar.
      const write_header_rows = recalculated_line_taxes.length === 0;

      if (write_header_rows && recalculated_header_taxes.length > 0) {
        update_data.invoice_taxes = {
          create: recalculated_header_taxes.map((tax_item) =>
            this.buildInvoiceTaxCreateInput(tax_item),
          ),
        };
      } else if (write_header_rows && dto.taxes && dto.taxes.length > 0) {
        // Aquí se perdía `tax_type`, con el que el CUFE arma ValImp1/2/3: una
        // factura editada y luego emitida producía una huella distinta de la
        // misma factura emitida sin editar.
        update_data.invoice_taxes = {
          create: dto.taxes.map((tax_item) =>
            this.buildInvoiceTaxCreateInput(tax_item),
          ),
        };
      }
    }

    // PUERTA: un documento que NO es AIU no puede quedarse con datos AIU.
    //
    // Corre fuera del bloque de líneas a propósito: un PATCH puede cambiar
    // `operation_type` sin mandar `items`, y por ese camino el recálculo ni se
    // ejecuta. Las cuatro columnas describen un contrato AIU —el régimen de
    // base gravable, su piso, la matriz de gravabilidad y el objeto del
    // contrato—; en una venta estándar ninguna aplica, y dejarlas es dejar
    // datos fiscales que contradicen el documento que los lleva. Hoy la emisión
    // no los lee (`resolveAiuEmissionContext` corta antes en todo documento
    // no-AIU), pero eso es una salvaguarda del lector, no una razón para
    // persistir basura: cualquier reporte, exportación o auditoría que lea la
    // columna directamente vería un contrato AIU donde no hay ninguno.
    //
    // `Prisma.DbNull` y no `undefined`: en una columna JSON `undefined` significa
    // "no la toques", que es exactamente el bug.
    const resulting_operation_type =
      dto.operation_type ?? invoice.operation_type;
    if (
      (resulting_operation_type || '').trim() !==
      DIAN_INVOICE_OPERATION_TYPES.AIU
    ) {
      update_data.aiu_regime = null;
      update_data.aiu_minimum_percent = null;
      update_data.aiu_taxable_matrix = Prisma.DbNull;
      update_data.aiu_contract_object = null;
    }

    const updated = await this.prisma.invoices.update({
      where: { id },
      data: update_data,
      include: INVOICE_INCLUDE,
    });

    // Desglose por línea del documento reeditado. Va después del update porque
    // las líneas se borraron y se recrearon dentro de él: los ids anteriores ya
    // no existen. El borrado previo no choca contra la FK porque es
    // `ON DELETE SET NULL` — con RESTRICT, borrar las líneas antes que los
    // tributos habría devuelto P2003 en TODA edición de borrador.
    let refreshed = updated;
    if (recalculated_line_taxes.length > 0) {
      await this.persistLineTaxes(
        id,
        recalculated_line_taxes,
        recalculated_header_taxes,
      );
      refreshed =
        (await this.prisma.invoices.findFirst({
          where: { id },
          include: INVOICE_INCLUDE,
        })) ?? updated;
    }

    this.logger.log(`Invoice #${id} (${refreshed.invoice_number}) updated`);
    return refreshed;
  }

  async remove(id: number) {
    const invoice = await this.findOne(id);

    // Only allow deleting invoices in draft state
    if (invoice.status !== 'draft') {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_STATUS_002,
        'Only draft invoices can be deleted',
      );
    }

    await this.assertFiscalPeriodOpen(
      invoice.accounting_entity_id,
      invoice.issue_date,
      'delete',
    );

    await this.prisma.invoices.delete({
      where: { id },
    });

    this.logger.log(`Invoice #${id} (${invoice.invoice_number}) deleted`);
  }

  async getStats(date_from?: string, date_to?: string) {
    const where: Prisma.invoicesWhereInput = {
      // Exclude credit/debit notes from main stats
      invoice_type: {
        in: ['sales_invoice', 'purchase_invoice', 'export_invoice'],
      },
      ...(date_from && {
        issue_date: {
          gte: new Date(date_from),
          ...(date_to && { lte: new Date(date_to) }),
        },
      }),
    };

    const [countsByStatus, totalAmount, pendingAmount] = await Promise.all([
      this.prisma.invoices.groupBy({
        by: ['status'],
        where,
        _count: { id: true },
        _sum: { total_amount: true },
      }),
      this.prisma.invoices.aggregate({
        where: {
          ...where,
          status: { in: ['accepted'] },
        },
        _sum: { total_amount: true },
        _count: { id: true },
      }),
      this.prisma.invoices.aggregate({
        where: {
          ...where,
          status: { in: ['draft', 'validated', 'sent'] },
        },
        _sum: { total_amount: true },
        _count: { id: true },
      }),
    ]);

    const counts_by_status: Record<string, { count: number; amount: number }> =
      {
        draft: { count: 0, amount: 0 },
        validated: { count: 0, amount: 0 },
        sent: { count: 0, amount: 0 },
        accepted: { count: 0, amount: 0 },
        rejected: { count: 0, amount: 0 },
        cancelled: { count: 0, amount: 0 },
        voided: { count: 0, amount: 0 },
      };

    for (const row of countsByStatus) {
      if (row.status) {
        counts_by_status[row.status] = {
          count: row._count.id,
          amount: Number(row._sum.total_amount || 0),
        };
      }
    }

    return {
      total_accepted_amount: Number(totalAmount._sum.total_amount || 0),
      total_accepted_count: totalAmount._count.id,
      total_pending_amount: Number(pendingAmount._sum.total_amount || 0),
      total_pending_count: pendingAmount._count.id,
      counts_by_status,
    };
  }

  /**
   * QUI-690 — Aggregates per-line `taxes[]` into header `invoice_taxes` rows
   * keyed by `(tax_name, tax_rate, tax_type, is_inclusive)`. Each unique
   * bucket gets a single row with summed `taxable_amount` and `tax_amount`.
   * Items without `taxes[]` fall back to legacy single `tax_amount`. The
   * `is_inclusive` flag travels with each bucket so the UBL builder can emit
   * `TaxInclusiveIndicator` correctly.
   */
  /**
   * Mapeadores de persistencia compartidos por `create()` y `update()`.
   *
   * POR QUÉ EXISTEN
   * ---------------
   * Las dos rutas escriben las MISMAS tablas y habían divergido en tres puntos,
   * todos silenciosos:
   *
   *   1. `invoice_items.is_inclusive` — la creación lo persistía, la
   *      actualización no. Editar un borrador borraba la marca de precio con
   *      IVA incluido y la línea pasaba a facturarse como si el impuesto fuera
   *      adicional.
   *   2. Los `taxes[]` por línea — la creación los agregaba en
   *      `line_tax_amount`, la actualización sólo miraba el `tax_amount` plano.
   *      Un borrador con impuestos tipados perdía su importe al editarse.
   *   3. `invoice_taxes.tax_type` — la creación escribía el tipo fiscal, la
   *      actualización lo dejaba en NULL. **Éste es el peor**: el CUFE clasifica
   *      los impuestos por `tax_type` para armar `ValImp1/2/3` (IVA/INC/ICA del
   *      Anexo Técnico 1.9 §11.2). Con el tipo en NULL, la misma factura emitida
   *      tras editarse producía una huella distinta de la que producía sin
   *      editarse — y la DIAN rechaza por CUFE incorrecto habiendo gastado ya el
   *      consecutivo.
   *
   * Ninguna de las tres daba error al guardar. Por eso el mapeo vive en un solo
   * sitio: no es limpieza, es la única forma de que no vuelvan a separarse.
   *
   * LOS IMPORTES YA NO SE LEEN DEL DTO
   * ----------------------------------
   * Este mapeador recibe la línea YA RECALCULADA por `InvoiceCalculatorService`
   * y la escribe tal cual. Antes derivaba el impuesto de línea sumando lo que
   * mandara el cliente, y el formulario del panel manda literalmente
   * `tax_amount: 0` confiando en que el backend recalcula. No recalculaba: la
   * factura se persistía con IVA cero, el asiento salía descuadrado y el
   * `ValImp1` del hash CUFE —que la DIAN recomputa desde el XML recibido—
   * quedaba mal, con el consecutivo ya gastado.
   */
  private buildInvoiceItemCreateInput(
    item: CreateInvoiceItemDto,
    line: CalculatedLine,
    snapshot: InvoiceLinePricingSnapshot,
  ) {
    return {
      product_id: item.product_id,
      product_variant_id: item.product_variant_id,
      description: item.description,
      quantity: new Prisma.Decimal(item.quantity),
      unit_price: new Prisma.Decimal(item.unit_price),
      // Los cuatro importes salen del MOTOR, no del cliente. `line.*` ya viene
      // truncado a 2 decimales (Anexo 1.9 §11.2) y con la base despejada
      // cuando el precio lleva el impuesto dentro.
      discount_amount: new Prisma.Decimal(line.discount_amount),
      tax_amount: new Prisma.Decimal(line.tax_amount),
      is_inclusive: line.is_inclusive,
      total_amount: new Prisma.Decimal(line.total_amount),
      // A cuántas unidades de `quantity` corresponde `unit_price`. NO se acepta
      // del cliente —no está en el DTO a propósito—: es un atributo del
      // producto, y dejarlo entrar por el request permitiría facturar un queso
      // de $28.000/kg como $28.000/gramo. Snapshot para que un reenvío años
      // después reproduzca el mismo importe de línea.
      price_unit_quantity: snapshot.price_unit_quantity,
      // Unidad de medida UN/ECE rec. 20 (`@unitCode`). Se resolvía en cada
      // envío y, al fallar, caía a 'EA' EN SILENCIO: tres metros declarados
      // como 'EA' le dicen a la DIAN "tres unidades". NULL conserva ese
      // comportamiento histórico; un valor explícito lo congela para que un
      // reenvío emita la misma unidad.
      unit_code: snapshot.unit_code,
      // Snapshot de la cuenta PUC de ingreso, ya resuelto por la cascada
      // línea → variante → producto (ver `resolveLinePricingSnapshots`). Se
      // congela acá y no al contabilizar porque entre crear y aceptar la factura
      // el producto puede remaparse: el asiento cuadraría igual, contra otra
      // subcuenta, y nada lo delataría. NULL ⇒ mapping por defecto.
      account_code: snapshot.account_code,
      // Componente AIU. NULL = línea normal, que es el 100% del histórico. El
      // régimen que decide la base gravable (E.T. art. 462-1 vs Decreto
      // 1372/1992) es configuración de la tienda, no se deduce de esta columna.
      aiu_component: item.aiu_component as AiuComponentValue | undefined,
    };
  }

  /**
   * Impuestos declarados A NIVEL DE DOCUMENTO (`dto.taxes`), y sólo cuando el
   * calculador no produjo ninguno de línea. Es el carril heredado: aquí no hay
   * base de la que derivar nada, así que los importes que manda el cliente son
   * la única fuente que existe.
   *
   * Por eso ESTE es el punto donde `taxable_amount` y `tax_amount` vuelven a ser
   * obligatorios, aunque el DTO los declare opcionales: en el carril normal —el
   * de impuestos por línea— los deriva `InvoiceCalculatorService` a partir de
   * precio, cantidad, descuento e `is_inclusive`; aquí no hay línea a la que
   * mirar.
   *
   * Falla en vez de rellenar con cero. Un cero inventado aquí no se nota: se
   * persiste, viaja al XML como `cbc:TaxAmount`, entra en el `ValImp1` del CUFE
   * y sale a la DIAN como la afirmación de que la operación no causó impuesto.
   * El descuadre aparece cuando la DIAN recalcula, y para entonces el
   * consecutivo autorizado ya está gastado.
   */
  private buildDocumentLevelTaxRows(taxes: CreateInvoiceTaxDto[]) {
    return taxes.map((tax_item, index) => {
      const missing = [
        tax_item.taxable_amount === undefined || tax_item.taxable_amount === null
          ? 'taxable_amount'
          : null,
        tax_item.tax_amount === undefined || tax_item.tax_amount === null
          ? 'tax_amount'
          : null,
      ].filter((field): field is string => field !== null);

      if (missing.length > 0) {
        throw new VendixHttpException(
          ErrorCodes.INVOICING_CALC_001,
          `El impuesto «${tax_item.tax_name}» se declaró a nivel de documento sin ${missing.join(' ni ')}. ` +
            'Los impuestos de documento no tienen línea de la que derivar la base, así que hay que enviarlos ' +
            'calculados. Si lo que quieres es que el servidor los calcule, declara el impuesto dentro de la ' +
            'línea (`items[].taxes[]`) en vez de en `taxes[]` del documento.',
          { tax_index: index, tax_name: tax_item.tax_name, missing },
        );
      }

      return this.buildInvoiceTaxCreateInput({
        ...tax_item,
        taxable_amount: tax_item.taxable_amount as number,
        tax_amount: tax_item.tax_amount as number,
      });
    });
  }

  private buildInvoiceTaxCreateInput(tax: InvoiceTaxRowInput) {
    return {
      // `?? undefined`: la columna es opcional, y un `null` explícito y un
      // campo ausente no son lo mismo para el input de Prisma.
      tax_rate_id: tax.tax_rate_id ?? undefined,
      tax_name: tax.tax_name,
      tax_rate: new Prisma.Decimal(tax.tax_rate),
      // `?? 0`: la fila puede llegar sin `taxable_amount`/`tax_amount` cuando
      // el DTO omitió lo que el servidor recalcula de todas formas. Persistir 0
      // es seguro: el reconciliador de aceptación reescribe el valor real.
      taxable_amount: new Prisma.Decimal(tax.taxable_amount ?? 0),
      tax_amount: new Prisma.Decimal(tax.tax_amount ?? 0),
      // El default 'iva' es el histórico y se mantiene, pero NUNCA puede
      // quedar ausente: es la clave con la que el CUFE arma ValImp1/2/3.
      //
      // El puente entre los dos enums es por VALOR, no por tipo: `TaxFiscalType`
      // (enum nominal de TS) y `tax_type_enum` (unión de literales de Prisma)
      // declaran exactamente los mismos seis — iva, inc, ica, withholding,
      // reteiva, reteica— pero TS los trata como incompatibles. Si alguien
      // añade un valor a uno solo, este cast lo deja pasar y revienta en el
      // INSERT: mantenerlos en paridad es responsabilidad de quien los edite.
      tax_type: (tax.tax_type ?? 'iva') as unknown as tax_type_enum,
      is_inclusive: tax.is_inclusive ?? false,
    };
  }

  /**
   * ¿Este documento tiene que persistir su desglose de tributos POR LÍNEA?
   *
   * ## El problema que resuelve
   *
   * El emisor UBL escribe un `cac:TaxSubtotal` por cada tributo DE LA LÍNEA.
   * `invoice_taxes` guardaba los tributos AGREGADOS por cabecera, así que el
   * emisor no tenía de dónde sacar ese desglose y caía al camino histórico:
   * heredarle a TODA línea el PRIMER tributo del documento. En una cuenta mixta
   * IVA + INC eso hace que todas las líneas declaren el esquema de la primera —
   * la cuenta de restaurante sale entera como IVA 19 % o entera como INC 8 %— y
   * la DIAN recompone los impuestos desde lo que recibe.
   *
   * ## La decisión de modelado, y por qué NO es "siempre por línea"
   *
   * Un documento usa UNA sola forma, nunca las dos:
   *
   * · **Un solo tributo ⇒ fila agregada de cabecera** (`invoice_item_id` NULL),
   *   exactamente como hasta hoy. Con un único tributo el camino histórico del
   *   emisor produce EXACTAMENTE el mismo XML —misma base, mismo importe, mismo
   *   esquema—, así que partirlo por línea no cambiaría un byte del documento y
   *   sí multiplicaría por N las filas que leen el PDF (`invoice-pdf.builder`
   *   imprime una línea por fila), el detalle del panel y los reportes. Cero
   *   beneficio a cambio de ruido en todo lo demás.
   *
   * · **Dos o más tributos ⇒ una fila por (línea × tributo)** y ninguna fila
   *   agregada. La cabecera no desaparece: se DERIVA sumando, que es
   *   literalmente lo que ya hacen todos los consumidores de esta tabla
   *   (`buildTaxTotals` agrupa por esquema DIAN y suma; el prevalidador suma;
   *   la exógena, el ICA y las declaraciones de IVA/INC suman). Como se suman
   *   valores YA truncados —los mismos que `aggregateHeaderTaxes` sumaba— el
   *   `cac:TaxTotal` de cabecera sale idéntico al centavo y la regla FAS01b
   *   sigue cuadrando.
   *
   * ## Lo que se descartó
   *
   * Conservar las filas agregadas Y añadir además las de línea. Ningún
   * consumidor filtra por `invoice_item_id`, así que el impuesto del documento
   * saldría al DOBLE: `cac:TaxTotal` duplicado (rechazo DIAN inmediato),
   * `HEADER_TAX_TOTAL_MISMATCH` en el prevalidador y declaraciones fiscales
   * infladas. No es una opción "más segura", es la única que rompe todo.
   */
  private needsPersistedLineTaxes(header_taxes: CalculatedTax[]): boolean {
    return header_taxes.length >= 2;
  }

  /**
   * Escribe las filas de `invoice_taxes` DESPUÉS de que existan los ids de las
   * líneas, que es la única forma de poder apuntarles.
   *
   * ## Por qué esto no va dentro del `create` anidado
   *
   * `invoices.create({ data: { invoice_items: { create: [...] } } })` no
   * devuelve los ids de las líneas hasta que el INSERT termina, y
   * `invoice_taxes.invoice_item_id` los necesita. De ahí la segunda escritura.
   *
   * NO se envuelve en `$transaction`: el cliente de Prisma que entrega
   * `$transaction` es el BASE, sin la extensión de scoping, y `invoices` es un
   * modelo store-scoped cuyo `store_id` inyecta precisamente esa extensión.
   * Meter la creación del documento en una transacción lo escribiría sin
   * tenant. El riesgo que queda —fallar entre las dos escrituras y dejar un
   * BORRADOR sin filas de impuesto— es acotado y recuperable: el documento
   * todavía no tiene CUFE ni se transmitió, y volver a guardarlo recalcula y
   * reescribe los tributos por completo.
   *
   * ## El alineamiento por posición
   *
   * `orderBy: { id: 'asc' }` reproduce el orden en que Prisma insertó las
   * líneas del `create` anidado, que es el orden de `dto.items`. Si los conteos
   * no coinciden —única forma de que el alineamiento sea mentira— NO se
   * inventa un vínculo: se escriben las filas agregadas de cabecera, que es el
   * comportamiento histórico y deja el documento fiscalmente correcto aunque
   * pierda el desglose.
   */
  private async persistLineTaxes(
    invoice_id: number,
    line_taxes: DocumentLineTaxes,
    fallback_header_taxes: InvoiceTaxRowInput[],
  ): Promise<void> {
    const items = await this.prisma.invoice_items.findMany({
      where: { invoice_id },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    const aligned = items.length === line_taxes.length;

    if (!aligned) {
      this.logger.warn(
        `Invoice #${invoice_id}: persisted ${items.length} items for ${line_taxes.length} calculated lines; ` +
          `falling back to header-aggregated invoice_taxes (the emitter will reconstruct the per-line breakdown)`,
      );
    }

    // Una sola forma de fila para los dos caminos: `invoice_item_id: undefined`
    // es exactamente "columna no informada" para Prisma, o sea la fila de
    // cabecera de siempre.
    const rows = aligned
      ? line_taxes.flatMap((taxes, index) =>
          taxes.map((tax) => ({
            ...this.buildInvoiceTaxCreateInput(tax),
            invoice_id,
            invoice_item_id: items[index].id as number | undefined,
          })),
        )
      : fallback_header_taxes.map((tax) => ({
          ...this.buildInvoiceTaxCreateInput(tax),
          invoice_id,
          invoice_item_id: undefined as number | undefined,
        }));

    if (rows.length === 0) return;

    // `createMany` y no `create` anidado: `invoice_taxes` es un modelo
    // RELACIONAL en el scoping de tienda (se filtra por `invoice.store_id` en
    // lectura), así que el create pasa sin que la extensión le inyecte nada.
    await this.prisma.invoice_taxes.createMany({ data: rows });
  }

  /**
   * Fecha de vencimiento del documento.
   *
   * Dejaba de existir cuando el usuario no la escribía (`due_date: null`), y en
   * una factura de contado eso no es "sin vencimiento": es que vence el mismo
   * día en que se emite. La columna en NULL rompe dos cosas aguas abajo — el
   * cálculo de cartera vencida no tiene contra qué comparar, y
   * `cac:PaymentMeans/cbc:PaymentDueDate` queda sin valor que emitir.
   *
   * Tres casos:
   * · Fecha explícita ⇒ se respeta, venga de donde venga.
   * · Crédito (`payment_form = '2'`) sin fecha ⇒ **error**. Una venta a crédito
   *   sin plazo no es una omisión de captura, es una contradicción: el plazo es
   *   precisamente lo que la distingue de una de contado.
   * · Todo lo demás (contado, o forma de pago sin declarar) ⇒ `issue_date`.
   *   El default DIAN de la forma de pago es contado, así que un documento que
   *   no dice nada vence al emitirse.
   */
  private resolveDueDate(
    dto: { due_date?: string; payment_form?: string },
    issue_date: Date,
  ): Date {
    const is_credit = dto.payment_form === '2';

    if (!dto.due_date) {
      if (is_credit) {
        throw new VendixHttpException(
          ErrorCodes.SYS_VALIDATION_001,
          'La factura está marcada como venta a crédito pero no tiene fecha de vencimiento. Indica el plazo de pago o cambia la forma de pago a contado.',
        );
      }
      return issue_date;
    }

    const due_date = new Date(dto.due_date);
    if (due_date < issue_date) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        `La fecha de vencimiento (${dto.due_date}) es anterior a la fecha de emisión. Corrige una de las dos.`,
      );
    }
    return due_date;
  }

  /**
   * Lee `store_settings.invoicing.aiu` de la tienda en contexto.
   *
   * Devuelve `{}` cuando la tienda no tiene la sección: los defaults viven en
   * `resolveAiuContext`, no acá, para que exista un solo sitio donde consultar
   * qué se asume cuando el comerciante no ha configurado nada.
   *
   * La sección se escribe por `PATCH /store/settings`: está registrada en
   * `KNOWN_SECTIONS` (`settings.service.ts`) **y** declarada como
   * `InvoicingSettingsDto` en `UpdateSettingsDto`. Hacen falta las dos — el
   * sanitizador descarta lo que no esté en la lista respondiendo 200 igual, y el
   * `ValidationPipe` corre con `whitelist: true` y borra lo que el DTO no
   * declare. Si alguien quita cualquiera de las dos, el régimen AIU vuelve a ser
   * inescribible sin que ningún error lo delate.
   */
  /**
   * Que toda tarifa referenciada EXISTA y sea de este tenant — antes de tomar
   * el consecutivo.
   *
   * ## Por qué acá y no en el DTO
   *
   * `@IsNumber()` sólo dice que es un número. La existencia es una pregunta a
   * la base de datos, y `invoice_taxes.tax_rate_id` tiene FK a `tax_rates(id)`:
   * un identificador que no existe lo rechaza Postgres, pero lo rechaza en el
   * INSERT, y para ese momento `InvoiceNumberGenerator.generateNextNumber()` ya
   * corrió y `invoice_resolutions.current_number` ya avanzó. El resultado
   * medido era un `SYS_INTERNAL_001` sin campo culpable, con un consecutivo
   * autorizado gastado en una factura que nunca llegó a existir.
   *
   * ## Por qué el error es fácil de cometer
   *
   * `GET /store/taxes` devuelve `tax_categories` con sus `tax_rates` ANIDADAS.
   * Las dos filas tienen `id`, y `89` puede ser una categoría y `72` su tarifa.
   * Mandar el de la categoría es un error de una línea que ninguna capa de
   * tipos ataja.
   *
   * ## Por qué también se comprueba la pertenencia
   *
   * El FK acepta cualquier `tax_rates.id` del sistema, incluido el de otra
   * organización. Una tarifa ajena entraría al documento y a su XML sin que
   * nada la marcara. Se acepta cuando la tarifa cuelga de una categoría de la
   * organización, o cuando la propia tarifa apunta a esta tienda: las tarifas
   * de alcance ORGANIZACIÓN viven con `store_id = NULL`, así que exigir la
   * tienda a secas dejaría fuera al catálogo compartido.
   *
   * ## Por qué además DEVUELVE el catálogo
   *
   * Validar la pertenencia y luego calcular con la tarifa que mandó el cliente
   * deja abierta la mitad del hueco que este dominio vino a cerrar. Medido con
   * `curl` contra la tienda 3: un cuerpo con `tax_rate_id: 1` —«IVA General»,
   * 19 % en el catálogo— y `tax_rate: 0` persistía una factura con IVA CERO,
   * exactamente el mismo desenlace que el `tax_amount: 0` que motivó
   * `InvoiceCalculatorService`, sólo que un nivel más arriba: no se falsea la
   * cuota, se falsea la tarifa de la que la cuota se deriva.
   *
   * Por eso, cuando la línea SEÑALA una fila del catálogo, la tarifa y la
   * clasificación fiscal salen de esa fila y no del cuerpo del request. El
   * identificador es la afirmación fuerte —«este es el impuesto que el
   * comerciante creó»—; `tax_rate` y `tax_type` que lo acompañan son la copia
   * que el formulario arrastra, y una copia sólo puede estar rancia.
   *
   * Sin `tax_rate_id` no hay nada que consultar y manda el cuerpo: es el camino
   * del impuesto puntual (`curl`, importaciones, herramientas de IA), y
   * bloquearlo obligaría a dar de alta en el catálogo cada tributo de una sola
   * vez.
   */
  private async resolveTenantTaxRateCatalog(
    items: CreateInvoiceItemDto[],
  ): Promise<Map<number, TenantTaxRateSnapshot>> {
    const referenced = new Set<number>();
    for (const item of items ?? []) {
      for (const tax of item.taxes ?? []) {
        if (typeof tax.tax_rate_id === 'number') referenced.add(tax.tax_rate_id);
      }
    }
    const catalog = new Map<number, TenantTaxRateSnapshot>();
    if (referenced.size === 0) return catalog;

    const context = this.getContext();
    const organization_id = Number(context.organization_id);
    const store_id =
      context.store_id != null ? Number(context.store_id) : null;

    const rows = await this.prisma.withoutScope().tax_rates.findMany({
      where: { id: { in: [...referenced] } },
      select: {
        id: true,
        store_id: true,
        rate: true,
        name: true,
        is_inclusive: true,
        tax_categories: {
          select: {
            organization_id: true,
            store_id: true,
            tax_type: true,
            is_inclusive: true,
          },
        },
      },
    });

    const owned = rows.filter((row) => {
      const category = row.tax_categories;
      if (category?.organization_id === organization_id) return true;
      if (store_id != null && row.store_id === store_id) return true;
      return store_id != null && category?.store_id === store_id;
    });

    const rejected = [...referenced].filter(
      (id) => !owned.some((row) => row.id === id),
    );
    if (rejected.length > 0) {
      const found = new Set(rows.map((row) => row.id));
      const missing = rejected.filter((id) => !found.has(id));

      throw new VendixHttpException(
        ErrorCodes.INVOICING_CALC_002,
        missing.length === rejected.length
          ? `El documento referencia ${rejected.length === 1 ? 'una tarifa de impuesto que no existe' : 'tarifas de impuesto que no existen'}: ` +
              `${rejected.join(', ')}. Si tomaste el identificador del catálogo de impuestos, revisa que sea el de la TARIFA y no el de la categoría que la contiene.`
          : `El documento referencia ${rejected.length === 1 ? 'una tarifa de impuesto que no pertenece a esta organización' : 'tarifas de impuesto que no pertenecen a esta organización'}: ` +
              `${rejected.join(', ')}. Selecciona el impuesto desde el catálogo de la tienda.`,
        { rejected_tax_rate_ids: rejected, missing_tax_rate_ids: missing },
      );
    }

    for (const row of owned) {
      catalog.set(row.id, {
        // `tax_rates.rate` es `Decimal(6,5)` y guarda una FRACCIÓN (0.19). La
        // columna no podría siquiera representar `19`: con escala 5 su máximo
        // es 9,99999. `CreateInvoiceTaxDto.tax_rate` y `invoice_taxes.tax_rate`
        // hablan en PORCENTAJE, así que la conversión va acá, una sola vez, en
        // espacio Decimal — que es donde ya se rompió una vez esta frontera.
        tax_rate: new Prisma.Decimal(row.rate).times(100),
        // El tipo fiscal es de la CATEGORÍA: es la columna con la que
        // `UblCommonBuilder.resolveTaxCodeFromTax` reparte ValImp1/2/3 y los
        // `cac:TaxSubtotal`. Tomarlo del catálogo es lo que hace que un
        // impuesto que el comerciante llamó «Tributo municipal propio» se
        // clasifique por lo que ES y no por cómo se llama.
        tax_type: row.tax_categories?.tax_type ?? null,
        tax_name: row.name,
        is_inclusive: row.is_inclusive ?? row.tax_categories?.is_inclusive ?? null,
      });
    }

    return catalog;
  }

  /**
   * Aplica el catálogo sobre los impuestos declarados en una línea.
   *
   * Devuelve la entrada del motor aritmético ya con la verdad del comerciante
   * dentro. Registra —sin bloquear— cuando el cuerpo del request afirmaba otra
   * tarifa u otro tipo: el formulario del panel arrastra una copia del catálogo
   * y quedarse rancia es su modo normal de fallar, no un intento de fraude.
   */
  private applyTaxCatalogToLine(
    taxes: CreateInvoiceTaxDto[] | undefined,
    catalog: Map<number, TenantTaxRateSnapshot>,
    label: string,
    line_index: number,
  ): InvoiceCalculatorTaxInput[] | undefined {
    if (!taxes) return undefined;

    return taxes.map((tax) => {
      const known =
        typeof tax.tax_rate_id === 'number'
          ? catalog.get(tax.tax_rate_id)
          : undefined;

      if (!known) {
        return {
          tax_rate_id: tax.tax_rate_id,
          tax_name: tax.tax_name,
          tax_rate: tax.tax_rate,
          tax_type: tax.tax_type,
          taxable_amount: tax.taxable_amount,
          tax_amount: tax.tax_amount,
          is_inclusive: tax.is_inclusive,
        };
      }

      if (!known.tax_rate.equals(new Prisma.Decimal(tax.tax_rate ?? 0))) {
        this.logger.warn(
          `[${label}] Tarifa divergente en línea ${line_index + 1} para tax_rate_id=${tax.tax_rate_id}: ` +
            `cliente=${tax.tax_rate} catálogo=${known.tax_rate.toString()} (gana el catálogo)`,
        );
      }
      const declared_type = (tax.tax_type ?? '').trim().toLowerCase();
      const catalog_type = (known.tax_type ?? '').trim().toLowerCase();
      if (catalog_type && declared_type && declared_type !== catalog_type) {
        this.logger.warn(
          `[${label}] Tipo fiscal divergente en línea ${line_index + 1} para tax_rate_id=${tax.tax_rate_id}: ` +
            `cliente=${declared_type} catálogo=${catalog_type} (gana el catálogo)`,
        );
      }

      return {
        tax_rate_id: tax.tax_rate_id,
        // El nombre del catálogo es el que el comerciante ve en su pantalla de
        // impuestos; el del request es el que tenía cuando se cargó el modal.
        tax_name: known.tax_name || tax.tax_name,
        tax_rate: known.tax_rate,
        tax_type: known.tax_type ?? tax.tax_type,
        taxable_amount: tax.taxable_amount,
        tax_amount: tax.tax_amount,
        // `is_inclusive` SÍ admite el override explícito de la línea: el mismo
        // impuesto se cobra por dentro o por fuera del precio según cómo se
        // capturó la venta, y `schema.prisma` ya lo documenta así sobre
        // `tax_rates.is_inclusive`. El catálogo sólo pone el valor por defecto.
        is_inclusive: tax.is_inclusive ?? known.is_inclusive,
      };
    });
  }

  /**
   * Vista de SÓLO LECTURA de la configuración AIU efectiva, para que el
   * formulario instruya al comerciante con la regla que de verdad se le va a
   * aplicar.
   *
   * Devuelve los valores YA RESUELTOS con los mismos defaults del motor
   * (`resolveAiuContext` + `InvoiceCalculatorService`), no lo crudo del JSON:
   * una tienda que nunca tocó la sección debe ver `et_462_1` con piso del 10 %,
   * que es lo que efectivamente va a calcular, y no tres campos vacíos que
   * sugieren que el AIU no está configurado.
   *
   * `note_valid` anticipa la única validación que hoy bloquea la emisión sin
   * que el usuario pueda adivinarla desde el modal: la regla CAV03 exige que la
   * nota de la línea de Administración —prefijo obligatorio incluido— mida
   * entre 20 y 5.000 caracteres, y el objeto del contrato vive en la
   * configuración de la tienda, no en el documento. Sin este dato el usuario
   * captura la factura completa y sólo descubre el problema al validar.
   *
   * No expone nada sensible: el objeto del contrato es un texto que viaja en el
   * XML público de la factura.
   */
  async getAiuSettingsView(): Promise<{
    regime: 'et_462_1' | 'decreto_1372_1992';
    contract_object: string;
    enforce_minimum_base: boolean;
    minimum_base_percent: number;
    /** Cadena exacta que iría en `cbc:Note` de la línea de Administración. */
    note: string;
    note_length: number;
    note_valid: boolean;
    note_min_length: number;
    note_max_length: number;
    note_prefix: string;
    /** `true` cuando la tienda nunca guardó la sección `invoicing.aiu`. */
    is_default: boolean;
  }> {
    const context = this.getContext();
    const settings = await this.loadAiuSettings(context.store_id);

    const regime = settings.regime ?? 'et_462_1';
    const contract_object = (settings.contract_object || '').trim();
    const note = buildAiuNote(contract_object);

    return {
      regime,
      contract_object,
      // `!== false` y no `?? true`: replica literalmente la condición del
      // calculador (`aiu.enforce_minimum_base !== false`), donde cualquier
      // valor distinto de `false` explícito activa el piso.
      enforce_minimum_base: settings.enforce_minimum_base !== false,
      minimum_base_percent: Number(settings.minimum_base_percent ?? 10),
      note,
      note_length: note.length,
      note_valid:
        note.length >= DIAN_AIU_NOTE_MIN_LENGTH &&
        note.length <= DIAN_AIU_NOTE_MAX_LENGTH,
      note_min_length: DIAN_AIU_NOTE_MIN_LENGTH,
      note_max_length: DIAN_AIU_NOTE_MAX_LENGTH,
      note_prefix: DIAN_AIU_NOTE_PREFIX,
      is_default: settings.regime === undefined,
    };
  }

  private async loadAiuSettings(store_id?: number): Promise<AiuSettings> {
    if (typeof store_id !== 'number') return {};

    const row = await this.prisma.store_settings.findUnique({
      where: { store_id },
      select: { settings: true },
    });

    const settings = row?.settings as Record<string, any> | null;
    const aiu = settings?.invoicing?.aiu;
    return aiu && typeof aiu === 'object' ? (aiu as AiuSettings) : {};
  }

  /**
   * Resuelve TODO lo que el AIU cambia en un documento: el régimen de base
   * gravable que usa el motor y la nota legal que va en la línea de
   * Administración.
   *
   * ## Por qué el régimen es configuración y no una constante
   *
   * Hay dos bases gravables incompatibles y NINGUNA se puede deducir del
   * producto facturado:
   *
   * · **E.T. art. 462-1** (aseo y cafetería, vigilancia, servicios temporales
   *   de empleo): la base es el AIU COMPLETO (A+I+U) y no puede ser menor al
   *   10 % del valor del contrato.
   * · **Decreto 1372/1992 art. 3** (construcción de bien inmueble): la base es
   *   SÓLO la Utilidad.
   *
   * La misma empresa de servicios puede tener contratos de los dos tipos. Elegir
   * el equivocado no produce ningún error visible: la DIAN acepta el documento
   * y la factura declara menos IVA del debido, corregible sólo con nota crédito
   * y ya con la sanción corriendo. Por eso la elección es explícita del
   * comerciante, con default `et_462_1` — el que declara MÁS IVA, porque
   * sobre-declarar se recupera y sub-declarar se sanciona.
   *
   * ## Y por qué se valida el objeto del contrato acá
   *
   * La regla CAV03 exige que la nota de la línea de Administración empiece por
   * el literal `DIAN_AIU_NOTE_PREFIX` y mida entre 20 y 5.000 caracteres. Es un
   * dato de negocio que no está en el documento sino en el contrato, así que
   * vive en la configuración de la tienda y se valida antes de tomar el
   * consecutivo.
   *
   * ## Qué devuelve, y qué hace cada cosa
   *
   * · `aiu` — entra al motor y decide qué líneas gravan.
   * · `note` — la cadena YA COMPUESTA que la línea de Administración debe
   *   llevar en `cbc:Note`. Acá sólo se VALIDA (fallar temprano es lo que
   *   ahorra el consecutivo); quien la escribe en el XML es la capa de emisión,
   *   que la recompone con la misma `buildAiuNote` desde la misma
   *   configuración, así que las dos no pueden divergir.
   */
  /**
   * Matriz de gravabilidad AIU que se CONGELA en el documento.
   *
   * No es telemetría: es el dato que faltaba. `InvoiceCalculatorService` sabe
   * qué componentes entran a la base gravable del régimen —eso lo decide
   * `isAiuTaxable`— pero **no sabe a qué tarifa**, porque la tarifa depende del
   * bien o servicio y ese servicio no tiene el catálogo. Por eso, ante una
   * línea gravable que llegó SIN impuesto, lo único que podía hacer era
   * reportar el hecho con los tres importes en cero: no podía afirmar cuánto
   * debía. El resultado es una factura que sale sub-declarada y que la DIAN
   * ACEPTA, porque un XML internamente consistente con menos IVA del debido es
   * un XML válido — el error solo se corrige después con nota crédito.
   *
   * Esta matriz deja ese hueco por escrito y legible por máquina en
   * `taxable_without_rate`, en vez de dejarlo en una línea de log. Es lo que
   * consume el rechazo `INVOICING_AIU_004` y lo que la versión del perfil de
   * facturación va a poder completar con la tarifa que hoy nadie aporta.
   *
   * Se congela junto al régimen por la misma razón que `aiu_contract_object`:
   * lo que se declaró tiene que quedar legible tal como se declaró, aunque la
   * configuración cambie entre la captura y la firma.
   */
  /**
   * Porcentaje del piso legal que rige para ESTE documento, o `undefined` cuando
   * no rige ninguno.
   *
   * Un solo sitio para la regla, consumido por la creación, la edición y la
   * matriz. Tenerla escrita tres veces es cómo `enforce_minimum_base !== false`
   * se convierte en `?? false` en una de las tres y la factura queda declarando
   * un piso que no es el que se le aplicó.
   */
  /**
   * `taxable_basis` → cadena que se persiste en `invoices.aiu_regime`.
   *
   * La columna es libre (`String? @db.VarChar(30)`, no un enum de Postgres) y
   * hoy guarda literales de régimen legal (`'et_462_1'`, `'decreto_1372_1992'`)
   * más el literal nuevo `'subtotal'` — que no tiene régimen, así que
   * `regimeFromTaxableBasis` devuelve `null` y se usa `basis` tal cual.
   * `InvoiceFlowService.resolveAiuRegimeForEmission` es quien vuelve a leer
   * esta misma columna al emitir.
   */
  private regimeStringFromTaxableBasis(basis: AiuTaxableBasis): string {
    return regimeFromTaxableBasis(basis) ?? basis;
  }

  private resolveAiuMinimumPercent(
    aiu: InvoiceCalculatorAiuInput,
  ): Prisma.Decimal | undefined {
    if (aiu.taxable_basis !== 'aiu' || aiu.enforce_minimum_base === false) {
      return undefined;
    }
    return aiu.minimum_base_percent != null
      ? new Prisma.Decimal(String(aiu.minimum_base_percent))
      : DEFAULT_AIU_MINIMUM_PERCENT;
  }

  private buildAiuTaxableMatrix(
    lines: CalculatedLine[],
    aiu: InvoiceCalculatorAiuInput,
    stage: string,
  ): Prisma.InputJsonValue {
    const by_component = new Map<
      string,
      {
        component: string;
        taxable: boolean;
        lines: number;
        taxable_amount: Prisma.Decimal;
        tax_amount: Prisma.Decimal;
        rates: Array<Record<string, string>>;
      }
    >();

    for (const line of lines) {
      const component = line.aiu_component;
      // Una línea SIN componente en un documento AIU es la porción de COSTO
      // reembolsable del contrato. La matriz está indexada POR COMPONENTE, así
      // que no tiene casilla donde ponerla y se omite.
      //
      // Bajo `'aiu'` y `'utilidad'` la omisión además es correcta de fondo: esa
      // línea no grava. Bajo `'subtotal'` sí grava —el contrato entero es la
      // base— y entonces la matriz describe sólo el A+I+U del documento, no toda
      // su base gravable. No es un hueco de control: la única casilla con
      // consecuencia, `taxable_without_rate`, alimenta `INVOICING_AIU_004`, y
      // ese caso —línea en la base sin tarifa— ya no llega hasta acá porque
      // `recalculateDocument` lo rechaza ANTES de persistir. Cuando la matriz
      // necesite declarar el costo habrá que darle un bucket `'costo'`, que es
      // el que `AIU_TAXABLE_BUCKETS_BY_BASIS.subtotal` ya contempla.
      if (!component) continue;

      const entry =
        by_component.get(component) ??
        {
          component,
          // `omit_tax_total` es el flag que el calculador YA derivó del
          // régimen. Se lee de ahí en vez de recalcularlo: dos derivaciones
          // del mismo hecho es exactamente cómo se desincronizan.
          taxable: !line.omit_tax_total,
          lines: 0,
          taxable_amount: new Prisma.Decimal(0),
          tax_amount: new Prisma.Decimal(0),
          rates: [],
        };

      entry.lines += 1;
      entry.taxable_amount = entry.taxable_amount.plus(
        new Prisma.Decimal(line.line_extension_amount),
      );
      entry.tax_amount = entry.tax_amount.plus(
        new Prisma.Decimal(line.tax_amount),
      );

      for (const tax of line.taxes) {
        const key = `${tax.tax_type}|${tax.dian_tax_code}|${tax.tax_rate}|${tax.rate_basis}`;
        if (entry.rates.some((r) => r.key === key)) continue;
        entry.rates.push({
          key,
          tax_type: tax.tax_type,
          dian_tax_code: tax.dian_tax_code,
          tax_rate: tax.tax_rate,
          rate_basis: tax.rate_basis,
        });
      }

      by_component.set(component, entry);
    }

    const components = Array.from(by_component.values()).map((entry) => ({
      component: entry.component,
      taxable: entry.taxable,
      lines: entry.lines,
      taxable_amount: entry.taxable_amount.toFixed(2),
      tax_amount: entry.tax_amount.toFixed(2),
      // `key` era solo para deduplicar; no viaja al documento.
      rates: entry.rates.map(({ key: _key, ...rate }) => rate),
    }));

    // ESPEJO EXACTO de `InvoiceCalculatorService.summarizeAiu`. Las dos
    // condiciones importan y no son las obvias:
    //
    // · `!== false`, no `=== true`: el piso está activo POR DEFECTO bajo
    //   `et_462_1`. Solo se apaga declarándolo explícitamente. Escribirlo como
    //   `?? false` registraba «piso apagado» en documentos donde el motor SÍ lo
    //   aplicó — la matriz afirmaba lo contrario de lo que pasó.
    // · Bajo `decreto_1372_1992` NUNCA aplica: el Decreto no fija piso sobre la
    //   utilidad del constructor y trasplantarle el 10 % del 462-1 rechazaría
    //   facturas de construcción legales.
    //
    // El porcentaje se guarda ya resuelto, con el default aplicado, para que la
    // re-verificación antes de firmar lea el mismo número y no vuelva a
    // derivarlo.
    const minimum_enforced =
      aiu.taxable_basis === 'aiu' && aiu.enforce_minimum_base !== false;
    const minimum_percent =
      aiu.minimum_base_percent != null
        ? new Prisma.Decimal(String(aiu.minimum_base_percent))
        : DEFAULT_AIU_MINIMUM_PERCENT;

    return {
      taxable_basis: aiu.taxable_basis,
      /**
       * VENTANA DE TRANSICIÓN — la matriz escribe las DOS claves.
       *
       * `taxable_basis` es la nueva y la que manda: es la pregunta que la UI le
       * hace al operador y la única que puede expresar `'subtotal'`. `regime` es
       * la vieja, y se sigue escribiendo porque `aiu_taxable_matrix` es un
       * `jsonb` con FILAS YA ESCRITAS y con lectores vivos: el panel de
       * trazabilidad de la factura (`invoice-detail`) lee `matrix.regime`, y al
       * quitarla leía `undefined` — o sea que un documento emitido, que sí dejó
       * constancia de su base gravable, aparecía en pantalla como si no la
       * hubiera dejado. Eso es peor que un dato viejo: es un dato ausente sobre
       * un hecho fiscal que ocurrió.
       *
       * Se deriva con `regimeFromTaxableBasis`, NO con
       * `regimeStringFromTaxableBasis`: acá `'subtotal'` tiene que salir como
       * `null` explícito y no colapsado al literal. `null` dice la verdad —esa
       * base no tiene régimen legal al que citar— mientras que escribir
       * `'subtotal'` en un campo llamado `regime` haría que un lector viejo lo
       * tratara como un régimen desconocido y cayera a su rama por defecto.
       *
       * `regime` se retira cuando no queden lectores, y sólo entonces: primero
       * los consumidores pasan a `taxable_basis`, después se deja de escribir.
       * Al revés —que es lo que pasó— el dato desaparece de la pantalla antes de
       * que nadie note que lo estaba usando.
       */
      regime: regimeFromTaxableBasis(aiu.taxable_basis),
      stage,
      minimum: {
        enforced: minimum_enforced,
        percent: minimum_enforced ? minimum_percent.toFixed(2) : null,
      },
      components,
      /**
       * Componentes que el régimen SÍ grava y que aun así no declararon
       * ninguna tarifa. Cada uno es IVA que el documento debía declarar y no
       * declara. Vacío es lo correcto; no vacío es la brecha de ADR-3.
       */
      taxable_without_rate: components
        .filter((c) => c.taxable && c.rates.length === 0)
        .map((c) => c.component),
    } as Prisma.InputJsonValue;
  }

  /**
   * PERFIL CONGELADO — resuelve la versión vigente de un perfil de facturación
   * y la devuelve para que la factura la persista en
   * `(profile_id, profile_version)`.
   *
   * ## Qué problema cierra
   *
   * Sin esto, la configuración fiscal de un documento se lee de
   * `store_settings.invoicing.aiu` en CADA paso: al calcular, al validar, y otra
   * vez al construir el XML días después. Entre la captura y la transmisión la
   * tienda puede cambiar de régimen, y entonces el XML declara una gravabilidad
   * que contradice los importes que lleva dentro — rechazo por FAU04 con el
   * consecutivo ya gastado, o peor, aceptación con el IVA equivocado.
   *
   * Con un perfil, la configuración sale de `invoice_profile_versions.config`,
   * que es **append-only**: `commitVersion` inserta la versión N+1 y no toca la
   * N. Editar el perfil mañana no altera ninguna factura ya emitida, y
   * reconstruir el documento desde su versión reproduce exactamente el XML que
   * la DIAN validó. Eso es el objetivo del plan, y estas dos columnas son
   * dónde vive.
   *
   * ## Por qué se lee por `current_version` y no por `orderBy version desc`
   *
   * `current_version` es el puntero que `commitVersion` mantiene dentro de la
   * misma transacción que inserta la fila, así que es lo que «vigente»
   * SIGNIFICA. Un `orderBy desc` devolvería la fila más alta que exista, que en
   * una transacción a medias puede no ser la publicada. La diferencia sólo se
   * nota en el caso raro, y en el caso raro es la que congela la configuración
   * equivocada.
   *
   * ## Por qué las cuatro puertas rechazan en vez de caer al flujo manual
   *
   * Caer a `store_settings` cuando el usuario pidió un perfil es la opción
   * cómoda y la peligrosa: las TRES bases gravables del AIU gravan porciones
   * INCOMPATIBLES del contrato (`'aiu'` / E.T. 462-1 grava A+I+U completo;
   * `'utilidad'` / Decreto 1372/1992 grava sólo la Utilidad; `'subtotal'`
   * declina el tratamiento AIU y grava el contrato ENTERO, costo reembolsable
   * incluido), así que la sustitución cambia el IVA declarado sin dejar rastro
   * de que hubo sustitución. Entre la primera y la tercera la diferencia es de
   * un orden de magnitud —el 10 % del contrato contra el 100 %— y el usuario
   * vería un 201. Ver `INVOICING_PROFILE_006`, `_008` y `_009`.
   *
   * ## Aislamiento
   *
   * El `findFirst` va por el cliente SCOPEADO (`StorePrismaService` lista
   * `invoice_profiles` en sus modelos por tienda), así que un id de otro tenant
   * no encuentra fila y sale por el 404 idéntico de `profileNotFound` — el mismo
   * que devuelve un id inexistente, para que el endpoint no sea un oráculo de
   * enumeración.
   */
  /**
   * Configuración COMPLETA de una versión YA congelada en una factura.
   *
   * Distinta de `resolveProfileSnapshot` en lo único que importa: aquí NO se
   * consulta el estado del perfil ni su `current_version`. La versión ya está
   * elegida y es inmutable, así que desactivar el perfil, renombrarlo o
   * publicarle diez versiones nuevas no puede cambiar lo que esta factura
   * reproduce. Aplicar las puertas de la emisión acá haría que desactivar un
   * perfil rompiera la edición de borradores que ya lo referencian, que es
   * exactamente lo contrario de lo que el congelado promete.
   *
   * Devuelve `null` cuando la factura no tiene perfil (flujo manual) o cuando la
   * versión referenciada no aparece. Este segundo caso no puede ocurrir por la
   * API —la FK compuesta con `onDelete: Restrict` lo impide— y por eso NO se
   * convierte en excepción: si alguien lo produjera por SQL, fallar acá dejaría
   * la factura inservible para siempre. Se devuelve `null` y el documento cae al
   * flujo manual, que es degradación visible en las columnas `aiu_*` y no
   * pérdida de acceso al documento.
   *
   * C.7 — devuelve la config ENTERA, no sólo `.aiu` (que es todo lo que hacía
   * falta antes de este paso): `assertAiuBaseMatchesProfileMatrix` necesita
   * también `taxes.rules`, congelado en la misma fila. `.aiu` se sigue
   * derivando en el call site con `frozen_profile_config?.aiu ?? null` — una
   * sola consulta, un solo sitio que lee `invoice_profile_versions`.
   */
  private async loadFrozenProfileConfig(
    profile_id: number | null | undefined,
    profile_version: number | null | undefined,
  ): Promise<InvoiceProfileConfig | null> {
    if (profile_id == null || profile_version == null) return null;

    const row = await this.prisma.invoice_profile_versions.findFirst({
      where: { profile_id, version: profile_version },
      select: { config: true },
    });
    if (!row) return null;

    return row.config as unknown as InvoiceProfileConfig;
  }

  /**
   * C.7 — compuerta base↔matriz en la ESCRITURA del documento, con el MISMO
   * código que usa el perfil.
   *
   * ## Por qué existe
   *
   * Antes de C.7 la base gravable (`taxable_basis`) de un documento AIU era
   * EXACTAMENTE la que declaraba el perfil o la tienda que lo emite —
   * `resolveAiuContext` la copiaba, nunca la recibía del documento—. La tabla
   * de tributos por bucket del perfil (`config.taxes.rules`) se valida
   * CONTRA esa base al guardar el perfil (`TAX_MATRIX_CONTRADICTS_REGIME`,
   * en `validateTaxSection`), así que mientras el documento no podía
   * apartarse de la base, esa validación de guardado bastaba: la base del
   * documento y la de la matriz SIEMPRE coincidían por construcción.
   *
   * C.7 rompe esa garantía: el documento ahora puede declarar una base
   * distinta de la que el perfil congeló. Si lo hace, la matriz del perfil
   * —pensada para OTRA base— puede quedar contradiciendo la base real de
   * ESTE documento sin que nada lo note; es la misma contradicción que
   * `TAX_MATRIX_CONTRADICTS_REGIME` existe para atajar, sólo que en el
   * momento equivocado (guardado del perfil, no emisión del documento).
   *
   * ## Por qué se reusa `validateInvoiceProfileConfig` entero, filtrado
   *
   * No se escribe una segunda regla que decida lo mismo. Se arma un
   * `InvoiceProfileConfig` idéntico al congelado salvo por `aiu.taxable_basis`
   * —que pasa a ser la base EFECTIVA de este documento, ya resuelta por
   * `resolveAiuContext`— y se corre el validador COMPLETO del perfil sobre
   * él. El resultado trae issues de OTRAS secciones (formato, DIAN, retención,
   * moneda…) que no describen nada de este documento —haber estado bien al
   * congelar el perfil no cambia con la base—, así que se descartan: sólo
   * `TAX_MATRIX_CONTRADICTS_REGIME` importa acá. Filtrar es más seguro que
   * exportar y llamar sólo `validateTaxSection`: esa función NO está
   * exportada porque el archivo se espeja byte a byte al frontend
   * (`invoice-profile-config.contract.spec.ts`), y exportarla obligaría a
   * copiar el archivo mirror en este mismo commit. `validateInvoiceProfileConfig`
   * ya está exportada para el editor del perfil — no hace falta tocar el
   * archivo espejado en absoluto.
   *
   * `undefined`/sin perfil/perfil sin `taxes.rules`: no hay matriz que pueda
   * contradecir nada, y el flujo manual (o un perfil sin tributos declarados)
   * queda idéntico a como estaba antes de C.7 — la puerta 4 del checklist.
   */
  private assertAiuBaseMatchesProfileMatrix(
    profile_config: InvoiceProfileConfig | null | undefined,
    effective_aiu: InvoiceCalculatorAiuInput | undefined,
    operation_type: string | null | undefined,
    profile_id: number | null | undefined,
  ): void {
    if (!profile_config?.aiu || !profile_config.taxes?.rules?.length) return;
    if (!effective_aiu) return;

    const merged_config: InvoiceProfileConfig = {
      ...profile_config,
      aiu: {
        ...profile_config.aiu,
        taxable_basis: effective_aiu.taxable_basis,
      },
    };
    const issues = validateInvoiceProfileConfig(merged_config, {
      operation_type: operation_type ?? '',
    });
    const matrix_issues = issues.filter(
      (issue) => issue.code === 'TAX_MATRIX_CONTRADICTS_REGIME',
    );
    if (matrix_issues.length === 0) return;

    throw buildProfileConfigException(matrix_issues, {
      profile_id,
      operation_type: operation_type ?? '',
    });
  }

  private async resolveProfileSnapshot(
    profile_id: number | null | undefined,
    operation_type: string | null | undefined,
  ): Promise<{
    profile_id: number;
    version: number;
    config: InvoiceProfileConfig;
  } | null> {
    if (profile_id == null) return null;

    const profile = await this.prisma.invoice_profiles.findFirst({
      where: { id: profile_id },
      select: {
        id: true,
        name: true,
        operation_type: true,
        state: true,
        current_version: true,
      },
    });
    if (!profile) throw profileNotFound(profile_id);

    if (profile.state !== 'active') {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_PROFILE_006,
        `El perfil «${profile.name}» está inactivo y no puede usarse para emitir. ` +
          `Actívalo, o elige otro perfil del catálogo.`,
        {
          profile_id,
          state: profile.state,
          operation_type: profile.operation_type,
        },
      );
    }

    // El tipo de operación del DOCUMENTO. `undefined` equivale a '10'
    // (estándar) — la misma equivalencia que aplica el builder UBL, donde NULL
    // en `invoices.operation_type` significa CustomizationID '10'. Resolverla
    // acá evita que una factura estándar sin el campo explícito choque contra
    // un perfil estándar por una diferencia que no existe.
    const document_operation_type =
      (operation_type || '').trim() || DIAN_INVOICE_OPERATION_TYPES.STANDARD;

    if (profile.operation_type !== document_operation_type) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_PROFILE_008,
        `El perfil «${profile.name}» es para operaciones de tipo ` +
          `${profile.operation_type} y esta factura declara tipo ` +
          `${document_operation_type}. Cambia el tipo de operación de la ` +
          `factura, o elige un perfil de tipo ${document_operation_type}.`,
        {
          profile_id,
          profile_operation_type: profile.operation_type,
          invoice_operation_type: document_operation_type,
        },
      );
    }

    const version = await this.prisma.invoice_profile_versions.findFirst({
      where: { profile_id, version: profile.current_version },
      select: { version: true, config: true },
    });

    if (!version) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_PROFILE_009,
        `El perfil «${profile.name}» todavía no tiene una versión guardada, así ` +
          `que no hay configuración que congelar en la factura. Abre el perfil ` +
          `y guárdalo una vez.`,
        { profile_id, current_version: profile.current_version },
      );
    }

    return {
      profile_id,
      version: version.version,
      config: version.config as unknown as InvoiceProfileConfig,
    };
  }

  private async resolveAiuContext(
    operation_type: string | null | undefined,
    items: Array<{ aiu_component?: string | null }>,
    /**
     * Objeto del contrato declarado en ESTE documento. Gana sobre el de la
     * tienda, que pasa a ser el valor por defecto. Una empresa de servicios
     * tiene varios contratos AIU y hasta ahora sólo podía describir uno.
     */
    invoice_contract_object?: string | null,
    /**
     * Configuración AIU de la VERSIÓN del perfil bajo el que se timbra. Cuando
     * llega, `store_settings.invoicing.aiu` NO se lee: la configuración de un
     * documento fiscal sale de lo que quedó congelado, nunca de configuración
     * viva. Ausente ⇒ flujo manual, idéntico a antes de los perfiles.
     */
    profile_aiu?: ProfileAiuConfig | null,
    /**
     * C.7 — los TRES controles que el perfil/tienda congelan pero que ESTE
     * documento puede apartar: base gravable, exigencia del piso y su
     * porcentaje. MISMA precedencia que `invoice_contract_object`: ganan
     * sobre `profile_aiu`/`store_settings`, que pasan a ser el default.
     * Ausencia de cualquiera de los tres ⇒ lo que diga la fuente, NUNCA un
     * valor fijo — ver `resolveAiuTaxableBasis`, la única función que decide
     * la ausencia de `taxable_basis` en todo el archivo.
     */
    invoice_aiu_overrides?: {
      taxable_basis?: AiuTaxableBasis | null;
      enforce_minimum_base?: boolean | null;
      minimum_base_percent?: number | null;
    },
  ): Promise<{
    aiu?: InvoiceCalculatorAiuInput;
    note?: string;
    /** El objeto que ganó, ya normalizado. Es lo que se persiste. */
    contract_object?: string;
  }> {
    const is_aiu =
      (operation_type || '').trim() === DIAN_INVOICE_OPERATION_TYPES.AIU;

    if (!is_aiu) {
      // Un componente AIU en un documento que no es AIU no es inofensivo: la
      // columna se persistiría, nadie la leería, y la línea saldría gravada
      // como una venta normal. Quien la marcó cree que está facturando un
      // contrato AIU. Se corta explícito en vez de ignorarla.
      const marked = items.findIndex((item) => item.aiu_component);
      if (marked >= 0) {
        throw new VendixHttpException(
          ErrorCodes.INVOICING_AIU_003,
          `La línea ${marked + 1} está marcada como componente AIU pero el documento no es un contrato AIU. ` +
            `Cambia el tipo de operación a AIU (código ${DIAN_INVOICE_OPERATION_TYPES.AIU}) o quita la marca de la línea.`,
          { line_index: marked, operation_type: operation_type ?? null },
        );
      }
      return {};
    }

    const context = this.getContext();

    // FUENTE DE LA CONFIGURACIÓN — el perfil gana, y cuando gana la tienda no
    // se consulta.
    //
    // El `??` corta el `await`: con perfil NO hay lectura de `store_settings`,
    // ni como respaldo. Es deliberado y es el punto entero del congelado. Un
    // merge «perfil sobre tienda» sería peor que no tener perfiles: un campo que
    // el perfil no declare se rellenaría con configuración VIVA, así que el
    // documento quedaría mitad congelado y mitad no, sin que nada lo indique.
    // Si a la configuración del perfil le falta algo que la emisión necesita,
    // eso es un defecto del contrato `InvoiceProfileConfig` y se arregla ahí
    // —con su validador y su versión de contrato—, no tapándolo acá.
    const source: {
      regime?: ProfileAiuConfig['regime'];
      taxable_basis?: AiuTaxableBasis | null;
      contract_object?: string;
      enforce_minimum_base?: boolean;
      minimum_base_percent?: number | string;
      /**
       * D.4 — sólo `ProfileAiuConfig` los declara. `AiuSettings` (el ajuste de
       * tienda, sin perfil) sigue siendo de 2 valores —ver el comentario de
       * arriba— y no tiene sección de reparto A/I/U: no se le puede añadir acá
       * sin tocar `store-settings.interface.ts`, fuera de mi territorio esta
       * sesión. Por eso `components`/`components_basis` sólo llegan al motor
       * cuando el documento se emite bajo un perfil (`profile_aiu` presente);
       * sin perfil, `explodeAiuContratoLine` cae en su fallback conservador
       * (todo Utilidad) y una línea 'contrato' manual sigue tributando de más,
       * nunca de menos.
       */
      components?: ProfileAiuConfig['components'];
      components_basis?: AiuComponentsBasis | null;
    } = profile_aiu ?? (await this.loadAiuSettings(context.store_id));

    // `loadAiuSettings` (ajuste de tienda) es de 2 valores y nunca declara
    // `taxable_basis`: «subtotal» sólo llega vía perfil, nunca como default de
    // tienda — ver el docblock de `getAiuSettingsView`. Con perfil, si éste no
    // trae `taxable_basis` (snapshot de antes de este campo), se deriva de su
    // `regime` sin reescribir nada.
    // Precedencia documento → perfil/tienda, MISMA regla que `contract_object`
    // dos líneas más abajo. `resolveAiuTaxableBasis` es la MISMA función que
    // usa el perfil para resolver su propia ausencia — no se escribe un
    // cuarto punto de decisión: si el documento no manda `taxable_basis`, se
    // le pasa `undefined` y la función cae en `source.taxable_basis` tal como
    // hacía antes de C.7.
    const taxable_basis = resolveAiuTaxableBasis({
      regime: source.regime ?? 'et_462_1',
      taxable_basis:
        invoice_aiu_overrides?.taxable_basis ?? source.taxable_basis,
    });

    // Precedencia documento → perfil/tienda. El objeto de la fuente no
    // desaparece: es el DEFAULT, para que quien factura un solo contrato no
    // tenga que reescribirlo en cada documento.
    const contract_object =
      (invoice_contract_object || '').trim() ||
      (source.contract_object || '').trim();
    // MISMA función que usa la emisión: lo que se valida acá es exactamente la
    // cadena que va a viajar en `cbc:Note`. Ver `buildAiuNote`.
    const note = buildAiuNote(contract_object);

    if (
      note.length < DIAN_AIU_NOTE_MIN_LENGTH ||
      note.length > DIAN_AIU_NOTE_MAX_LENGTH
    ) {
      // EL CONSEJO DEPENDE DE QUIÉN MANDA, y por eso el mensaje se bifurca.
      //
      // Con perfil, `store_settings` NO se lee —ver la fuente de configuración
      // más arriba—, así que mandar al usuario a «la configuración de
      // facturación de la tienda» sería un consejo FALSO: puede escribirlo ahí,
      // guardar, reintentar, y recibir el mismo 422 sin entender por qué. El
      // objeto vacío en un perfil es legítimo (`AIU_CONTRACT_OBJECT_EMPTY` es un
      // aviso, no un bloqueo, justo para que una empresa con varios contratos lo
      // declare por factura), así que las dos salidas reales son: escribirlo en
      // ESTA factura, o ponérselo al perfil.
      const guidance = profile_aiu
        ? `Descríbelo en el campo «Objeto del contrato» de esta factura, o edita el perfil ` +
          `de facturación para que lo traiga. La configuración de la tienda NO se usa cuando ` +
          `la factura se emite bajo un perfil: lo que gobierna es la versión congelada del perfil.`
        : `Descríbelo en el campo «Objeto del contrato» de esta factura o, si es siempre el mismo, ` +
          `en la configuración de facturación de la tienda.`;
      throw new VendixHttpException(
        ErrorCodes.INVOICING_AIU_002,
        `El objeto del contrato AIU falta o no tiene la longitud que exige la DIAN: la nota de la ` +
          `línea de Administración debe medir entre ${DIAN_AIU_NOTE_MIN_LENGTH} y ${DIAN_AIU_NOTE_MAX_LENGTH} ` +
          `caracteres contando el prefijo obligatorio «${DIAN_AIU_NOTE_PREFIX}». ` +
          guidance,
        {
          note_length: note.length,
          has_contract_object: !!contract_object,
          // Qué fuente gobernó. Sin esto el frontend no puede saber a qué
          // pantalla mandar al usuario, y adivinarlo es la mitad del defecto.
          config_source: profile_aiu ? 'profile' : 'store_settings',
        },
      );
    }

    return {
      note,
      contract_object,
      aiu: {
        // Default explícito y conservador: bajo `'aiu'` tributa el AIU
        // completo. Una tienda que no configuró nada declara de más, no de
        // menos.
        taxable_basis,
        // Precedencia, no sustitución: `?? ` sólo entra si el documento NO
        // mandó el campo. Un `false` explícito del documento SÍ tiene que
        // ganar, por eso se compara contra `null`/`undefined`, no con
        // falsy — ver el tipo de `invoice_aiu_overrides` arriba.
        enforce_minimum_base:
          invoice_aiu_overrides?.enforce_minimum_base ??
          source.enforce_minimum_base,
        // Se pasa TAL CUAL, sin convertir a `number`. El calculador acepta
        // `DianNumericInput`, así que el porcentaje del perfil —un `string`
        // decimal exacto, por diseño del contrato— llega intacto. Convertirlo a
        // float acá reintroduciría el error binario que el contrato evita
        // guardando los porcentajes como cadena. El del documento SÍ es
        // `number` (el DTO lo valida como tal, ver `create-invoice.dto.ts`);
        // el calculador acepta ambos por `DianNumericInput`.
        minimum_base_percent:
          invoice_aiu_overrides?.minimum_base_percent ??
          source.minimum_base_percent,
        // D.4 — sólo presentes con perfil (ver el comentario de `source`
        // arriba). El calculador ya sabe leerlos ausentes.
        components: source.components,
        components_basis: source.components_basis,
      },
    };
  }

  /**
   * Retención total del documento, resuelta automáticamente desde la
   * configuración fiscal de LAS DOS PARTES al crear la factura.
   *
   * ## Qué se evalúa
   *
   * · **suffered** — el adquiriente, si es agente retenedor, retiene al emisor.
   *   Depende del cliente (`users.is_withholding_agent`, régimen, tipo de
   *   persona) Y del emisor (un autorretenedor no se deja retener).
   * · **self** — AUTORRETENCIÓN. Nace de una calidad del EMISOR
   *   (`is_self_withholder`, Decreto 2201/2016), así que aplica igual en una
   *   venta anónima de mostrador. No es un caso de `practiced`: no hay menor
   *   salida de caja hacia nadie — el cliente paga el 100 % del documento y la
   *   tienda reconoce a la vez un gasto y un pasivo propios.
   *
   * Las dos son mutuamente excluyentes por construcción: ambas leen
   * `tenant.is_self_withholder` con signo opuesto, así que un concepto no puede
   * salir por los dos caminos.
   *
   * ## Por qué acá NO se persiste `withholding_calculations`
   *
   * Esas filas ya las escribe `InvoiceFlowService.resolveWithholdingForInvoice`
   * al ACEPTAR el documento, y `persistWithholdingLines` no es idempotente
   * («Idempotency is the caller's responsibility»). Escribirlas también acá
   * duplicaría cada retención de toda factura que se cree y se acepte, que es
   * el camino normal. Este método sólo CALCULA el agregado que va en
   * `invoices.withholding_amount` —el dato que la factura necesita mostrar y
   * declarar antes de ser aceptada—.
   *
   * ## Degrada siempre
   *
   * Cualquier fallo devuelve `null` y la creación continúa con el
   * `withholding_amount` que mandó el cliente. Una factura no se cae porque el
   * catálogo de conceptos esté incompleto.
   *
   * ⚠️ La retención NO se resta de `total_amount` (Anexo 1.9 §11.9.1): la DIAN
   * valida `cbc:PayableAmount` sin mirar `cac:WithholdingTaxTotal`, y restarla
   * descuadra el documento. Vale para los tres roles.
   */
  private async resolveWithholdingAmount(params: {
    organization_id?: number;
    store_id?: number;
    customer_id?: number | null;
    base: string;
    iva_amount: string;
    issue_date: Date;
  }): Promise<Prisma.Decimal | null> {
    if (typeof params.organization_id !== 'number') return null;

    try {
      const base = Number(params.base);
      const ivaAmount = Number(params.iva_amount);
      const year = params.issue_date.getFullYear();

      const [suffered, self] = await Promise.all([
        this.withholdingFlow.resolveSuffered({
          organization_id: params.organization_id,
          store_id: params.store_id ?? null,
          customer_id: params.customer_id ?? null,
          base,
          ivaAmount,
          year,
        }),
        this.withholdingFlow.resolveSelf({
          organization_id: params.organization_id,
          store_id: params.store_id ?? null,
          base,
          year,
        }),
      ]);

      const lines = [...suffered.lines, ...self.lines];
      if (lines.length === 0) return null;

      return lines.reduce(
        (total, line) => total.plus(new Prisma.Decimal(line.amount)),
        new Prisma.Decimal(0),
      );
    } catch (error) {
      this.logger.error(
        `Resolución automática de retenciones falló al crear la factura; se conserva el valor declarado: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * Valida y persiste retenciones DECLARADAS POR EL CLIENTE al crear la factura.
   *
   * ## Por qué existe y no basta el cálculo automático
   *
   * El cálculo automático (`resolveWithholdingAmount` → `WithholdingFlowService`)
   * corre al ACEPTAR el documento y mira la configuración del tenant: si la
   * tienda es retenedor, retiene automáticamente lo que el catálogo del
   * contribuyente diga. Eso es lo correcto para el 95 % de los casos, pero NO
   * cuando el cliente ya hizo el cálculo en su sistema contable y declara
   * explícitamente cuánto retuvo, contra qué concepto, y con qué tarifa. Esa
   * declaración es la que este método honra.
   *
   * ## Por qué se valida y se persiste, no se persiste y se valida
   *
   * El `concept_id` que llega del cliente puede ser:
   *   - correcto y del tenant → se persiste tal cual, con el `withholding_type`
   *     y `concept_code` del catálogo, y el `account_role` calculado.
   *   - de otro tenant → se rechaza con `INVOICING_WITHHOLDING_002` y nombre del
   *     concepto, NO un 400 genérico de class-validator que lo deja sin saber
   *     qué concepto está mal.
   *   - inexistente → mismo error, distinto mensaje. Dos errores distintos para
   *     dos modos de fallo distintos: el cliente depura uno y otro.
   *
   * ## Por qué se valida la aritmética
   *
   * `amount` puede venir del cliente o se recalcula server-side (mismo
   * truncado ROUND_DOWN que `dian-money.util.ts`). Si viene y difiere más de un
   * centavo del producto `base × rate`, se rechaza: una diferencia mayor ya no
   * es truncado, es un dato mal capturado. Esa diferencia es la que un
   * comerciante puede ver entre lo que su sistema de contabilidad dice y lo
   * que el documento declara.
   *
   * ## Por qué NO se resta de `PayableAmount`
   *
   * §11.9.1 del Anexo 1.9: la DIAN valida `cbc:PayableAmount` sin mirar
   * `cac:WithholdingTaxTotal`. Restarla descuadra el documento. Vale para los
   * tres roles.
   */
  private async applyClientDeclaredWithholdings(params: {
    organization_id: number;
    store_id?: number | null;
    accounting_entity_id?: number | null;
    invoice_id: number;
    customer_id?: number | null;
    declared: InvoiceWithholdingInputDto[];
    year: number;
  }): Promise<Prisma.Decimal> {
    if (params.declared.length === 0) {
      return new Prisma.Decimal(0);
    }

    // Una sola lectura para todos los conceptos declarados: deduplicar por id,
    //   pedir `with { tenant_scope }`, y fallar entero si ALGUNO no pertenece.
    const conceptIds = [...new Set(params.declared.map((w) => w.concept_id))];
    const concepts = await this.prisma.withholding_concepts.findMany({
      where: {
        id: { in: conceptIds },
        organization_id: params.organization_id,
        is_active: true,
      },
      select: {
        id: true,
        code: true,
        withholding_type: true,
        account_code: true,
        name: true,
      },
    });
    const conceptById = new Map<
      number,
      {
        id: number;
        code: string;
        withholding_type: string;
        account_code: string | null;
        name: string;
      }
    >(concepts.map((c) => [c.id, c]));

    const missing = conceptIds.filter((id) => !conceptById.has(id));
    if (missing.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_WITHHOLDING_002,
        `Las siguientes retenciones referencian conceptos que no existen, están inactivos o pertenecen a otra tienda: ${missing.join(', ')}. Revisa la lista de conceptos en Contabilidad → Retenciones.`,
        { missing_concept_ids: missing, invoice_id: params.invoice_id },
      );
    }

    const lines: WithholdingLine[] = [];
    let aggregated = new Prisma.Decimal(0);

    for (const w of params.declared) {
      const concept = conceptById.get(w.concept_id)!;
      const rate = new Prisma.Decimal(w.rate);
      const base = new Prisma.Decimal(w.base_amount);
      const computed = base.times(rate).toDP(2, Prisma.Decimal.ROUND_DOWN);

      if (w.amount != null) {
        const declared = new Prisma.Decimal(w.amount);
        if (!declared.minus(computed).abs().lessThanOrEqualTo('0.01')) {
          throw new VendixHttpException(
            ErrorCodes.INVOICING_WITHHOLDING_003,
            `La retención del concepto «${concept.code}» (${concept.name}) declara ${declared.toFixed(2)} sobre una base de ${base.toFixed(2)} al ${rate.times(100).toFixed(2)} %, pero esa base y esa tarifa dan ${computed.toFixed(2)}. La diferencia mayor a 1 centavo ya no es truncado: revisa la captura.`,
            {
              invoice_id: params.invoice_id,
              concept_id: concept.id,
              declared: declared.toFixed(2),
              computed: computed.toFixed(2),
            },
          );
        }
      }

      const amount = computed;
      aggregated = aggregated.plus(amount);

      lines.push({
        withholding_type: concept.withholding_type as WithholdingTypeValue,
        concept_code: concept.code,
        concept_id: concept.id,
        rate: rate.toNumber(),
        base: base.toNumber(),
        amount: amount.toNumber(),
        role: w.role,
        account_role: buildWithholdingAccountRole(
          w.role,
          concept.withholding_type as WithholdingTypeValue,
        ),
        account_code: concept.account_code ?? null,
      });
    }

    // Separar practiced y suffered en dos batches: `persistWithholdingLines`
    // escribe UNA de las dos columnas por batch (`supplier_id` o
    // `customer_id`), y mezclarlas en una sola llamada deja la mitad sin la
    // contraparte.
    const practiced = lines.filter((l) => l.role === 'practiced');
    const suffered = lines.filter((l) => l.role === 'suffered');
    const selfLines = lines.filter((l) => l.role === 'self');

    // La factura es el documento del cliente (no documento soporte), así que
    //   - practiced: la tienda RETUVO al CLIENTE → el cliente es la contraparte.
    //   - suffered:  la tienda FUE RETENIDA por el cliente → el cliente es la
    //     contraparte también, pero se anota en `customer_id` que es el camino
    //     que el flujo de aceptación ya usa para este rol.
    // El `client` (transacción) NO se pasa porque `prisma.invoices.create`
    // corre fuera de `$transaction`: persistir las retenciones dentro de la
    // misma escritura atómica exigiría refactor mayor y, sobre todo, no
    // resuelve ningún caso real (un fallo del pool después del commit
    // simplemente deja la retención huérfana, situación que `accepted`
    // reintenta desde `resolveWithholdingForInvoice`).
    if (practiced.length > 0) {
      await this.withholdingFlow.persistWithholdingLines({
        organization_id: params.organization_id,
        store_id: params.store_id ?? null,
        accounting_entity_id: params.accounting_entity_id ?? null,
        invoice_id: params.invoice_id,
        customer_id: params.customer_id ?? null,
        role: 'practiced',
        uvt_value_used: 0,
        year: params.year,
        lines: practiced,
      });
    }
    if (suffered.length > 0) {
      await this.withholdingFlow.persistWithholdingLines({
        organization_id: params.organization_id,
        store_id: params.store_id ?? null,
        accounting_entity_id: params.accounting_entity_id ?? null,
        invoice_id: params.invoice_id,
        customer_id: params.customer_id ?? null,
        role: 'suffered',
        uvt_value_used: 0,
        year: params.year,
        lines: suffered,
      });
    }
    // self no entra al DTO por ahora; el motor de aceptación lo cubre.
    if (selfLines.length > 0) {
      await this.withholdingFlow.persistWithholdingLines({
        organization_id: params.organization_id,
        store_id: params.store_id ?? null,
        accounting_entity_id: params.accounting_entity_id ?? null,
        invoice_id: params.invoice_id,
        role: 'self',
        uvt_value_used: 0,
        year: params.year,
        lines: selfLines,
      });
    }

    return aggregated;
  }

  /**
   * Completa la tasa de cambio cuando el documento declara divisa y no trae
   * tasa, consultando la TRM oficial.
   *
   * DEGRADA SIEMPRE. Si la fuente externa no responde, `resolveExchangeRate`
   * devuelve `null` y este método devuelve `undefined`: la emisión continúa con
   * lo que el usuario haya escrito. Una factura NO se cae por una llamada HTTP
   * a un portal de datos abiertos; el error sólo lo lanza quien necesite la
   * tasa para emitir (el builder omite `cac:PaymentExchangeRate` sin ella).
   *
   * La divisa NO cambia la moneda del documento: la factura se emite siempre en
   * COP (Res. DIAN 000042/2020 art. 73; Oficios 901544 y 903436 de 2020;
   * Concepto 1509 de 2024).
   */
  private async resolveExchangeRateForDocument(dto: {
    foreign_currency?: string;
    exchange_rate?: number;
    exchange_rate_date?: string;
    issue_date: string;
  }): Promise<Prisma.Decimal | undefined> {
    if (dto.exchange_rate != null) return new Prisma.Decimal(dto.exchange_rate);
    if (!dto.foreign_currency) return undefined;

    const resolved = await this.trm.resolveExchangeRate({
      currency: dto.foreign_currency,
      // La fecha de la tasa es la de la operación cuando no se declara otra:
      // la TRM del día en que se causó, no la de hoy.
      date: dto.exchange_rate_date || dto.issue_date,
    });

    return resolved?.rate;
  }

  /**
   * Tasa de cambio para la UI — la MISMA resolución que usa la creación.
   *
   * ## Por qué existe
   *
   * `TrmService` resolvía la TRM oficial desde el primer día, pero ningún
   * controlador lo exponía: el formulario de factura pedía la tasa a mano, así
   * que el comerciante tenía que ir a buscarla a `datos.gov.co` y transcribirla.
   * Una tasa transcrita mal produce una `cbc:CalculationRate` (FAR06) mal
   * declarada, y la DIAN valida el grupo `cac:PaymentExchangeRate` completo.
   *
   * ## Por qué devuelve `null` en vez de lanzar
   *
   * Tres casos legítimos responden «no hay tasa» y ninguno es un error del
   * request: divisa COP (no hay conversión que declarar, y la DIAN RECHAZA un
   * `SourceCurrencyBaseRate` de 1,00 — FAR03), divisa distinta de USD sin
   * cotización cruzada, y una caída momentánea de `datos.gov.co`. El formulario
   * necesita distinguirlos de un fallo suyo: con `null` ofrece el campo
   * editable y explica por qué está vacío; con una excepción pintaría un toast
   * rojo sobre una consulta auxiliar que no bloquea nada.
   *
   * NO se cachea aquí: `TrmService` ya cachea por día y sin TTL, porque la TRM
   * de una fecha publicada es inmutable.
   */
  async getExchangeRateQuote(query: {
    currency: string;
    date?: string;
    usd_cross_rate?: number;
  }): Promise<{
    currency: string;
    date: string;
    rate: string | null;
    source: string | null;
    trm: { value: string; valid_from: string; valid_to: string } | null;
  }> {
    const currency = (query.currency || '').trim().toUpperCase();
    // Sin fecha, la de hoy EN LA ZONA DE LA TIENDA: la TRM es un dato con
    // calendario colombiano, y resolverla en UTC adelanta el día a partir de
    // las 19:00 hora local, pidiendo la tasa de mañana —que aún no existe—.
    const context = this.getContext();
    const timezone =
      context.store_id != null
        ? await resolveStoreTimezone(this.prisma, Number(context.store_id))
        : await resolveOrganizationTimezone(
            this.prisma.withoutScope(),
            Number(context.organization_id),
          );
    const date = query.date || localDateString(new Date(), timezone);

    const resolved = await this.trm.resolveExchangeRate({
      currency,
      date,
      ...(query.usd_cross_rate != null
        ? { usd_cross_rate: query.usd_cross_rate }
        : {}),
    });

    return {
      currency,
      date,
      rate: resolved ? resolved.rate.toString() : null,
      source: resolved?.source ?? null,
      trm: resolved?.trm
        ? {
            value: resolved.trm.value.toString(),
            valid_from: resolved.trm.valid_from,
            valid_to: resolved.trm.valid_to,
          }
        : null,
    };
  }

  /**
   * Recalcula el documento entero y decide qué divergencias bloquean.
   *
   * Sustituye al viejo `calculateAmounts`, que sumaba en coma flotante y
   * persistía el impuesto que mandara el cliente. Toda la aritmética vive ahora
   * en `InvoiceCalculatorService` —`Prisma.Decimal`, truncado hoja por hoja,
   * base despejada en precios inclusivos— y acá sólo queda la POLÍTICA: qué se
   * hace con la diferencia entre lo que afirmó el cliente y lo que calculó el
   * servidor.
   *
   * ## La política, en tres niveles
   *
   * · `untaxed_line_with_amount` ⇒ **bloquea**. Es el único caso irrecuperable:
   *   la línea declara importe de impuesto y ninguna tarifa de la que
   *   derivarlo. No hay nada que recalcular, y un importe suelto no puede
   *   producir un `cac:TaxSubtotal` válido (la DIAN exige `cbc:Percent`). Se
   *   corta acá, antes de que se gaste numeración autorizada.
   *
   * · `line_tax` ⇒ **gana el servidor, sin bloquear**. El contrato declara el
   *   `tax_amount` del cliente como informativo, y el formulario del panel manda
   *   `tax_amount: 0` a propósito esperando el recálculo: bloquear haría fallar
   *   toda factura del módulo. Se registra en el log con la línea y ambos
   *   valores, que es lo que hace auditable el recálculo.
   *
   * · `withholding_as_tax` / `withholding_amount` ⇒ **se registran**. La
   *   retención llegó infiltrada en `items[].taxes[]`; el motor ya la sacó del
   *   cálculo del documento para que un "ReteICA" no contamine el `ValImp3` del
   *   CUFE clasificándose como ICA.
   */
  private recalculateDocument(
    items: CreateInvoiceItemDto[],
    snapshots: InvoiceLinePricingSnapshot[],
    label: string,
    /**
     * Régimen de base gravable del AIU, resuelto por `resolveAiuContext` desde
     * la configuración de la tienda. Ausente ⇒ documento normal: el motor no
     * mira `aiu_component` y toda línea tributa como siempre.
     */
    aiu?: InvoiceCalculatorAiuInput,
    /**
     * Catálogo `tax_rates` de la tienda, ya validado por
     * `resolveTenantTaxRateCatalog`. Cuando una línea señala una de sus filas,
     * la tarifa y el tipo fiscal salen de ahí y no del cuerpo del request.
     * Vacío ⇒ ninguna línea referenció el catálogo y manda lo declarado.
     */
    tax_catalog: Map<number, TenantTaxRateSnapshot> = new Map(),
  ): InvoiceCalculatorResult {
    const result = this.calculator.calculate({
      ...(aiu ? { aiu } : {}),
      items: items.map((item, index) => ({
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_amount: item.discount_amount,
        aiu_component: item.aiu_component,
        // La *price unit* entra al cálculo, no sólo al snapshot. Si el motor
        // ignorara el divisor, `invoices.total_amount` saldría N veces mayor
        // que el `cbc:PayableAmount` que emite el XML —que sí divide— y la
        // diferencia viajaría además dentro del `ValTot` del CUFE.
        price_unit_quantity: snapshots[index]?.price_unit_quantity,
        is_inclusive: item.is_inclusive,
        tax_amount: item.tax_amount,
        taxes: this.applyTaxCatalogToLine(
          item.taxes,
          tax_catalog,
          label,
          index,
        ),
      })),
    });

    const orphan = result.divergences.find(
      (divergence) => divergence.scope === 'untaxed_line_with_amount',
    );
    if (orphan) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_CALC_001,
        `La línea ${orphan.line_index + 1}${
          orphan.line_description ? ` («${orphan.line_description}»)` : ''
        } declara un impuesto de ${orphan.received} pero no declara ninguna tarifa. Agrega el impuesto con su tarifa (por ejemplo IVA 19%) o deja el importe en cero: sin tarifa la DIAN no puede validar el documento.`,
        { line_index: orphan.line_index, received: orphan.received },
      );
    }

    // D.4 — Modelo 1 (`'contrato'`) mezclado con Modelo 2 (líneas por
    // componente), o dos líneas `'contrato'` en el mismo documento ⇒
    // **bloquea**, ANTES del piso legal: ese chequeo necesita un AIU único y
    // bien formado, y esta divergencia dice precisamente que no lo hay.
    const contrato_conflict = result.divergences.find(
      (divergence) => divergence.scope === 'aiu_contrato_mutually_exclusive',
    );
    if (contrato_conflict) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_AIU_007,
        `La línea ${contrato_conflict.line_index + 1} mezcla el Modelo 1 (componente «contrato», que ` +
          `declara el AIU completo del contrato) con el Modelo 2 (líneas por componente ` +
          `administración/imprevistos/utilidad), o el documento declara más de una línea «contrato». ` +
          `Las dos formas son mutuamente excluyentes: una línea «contrato» YA ES el AIU completo, así que ` +
          `cualquiera de las dos combinaciones deja sin definir cuánto vale el AIU que el piso legal del ` +
          `10% necesita comparar contra el contrato. Usa una sola línea «contrato» sola, o las tres líneas ` +
          `por componente sin ninguna «contrato».`,
        { line_index: contrato_conflict.line_index },
      );
    }

    // AIU por debajo del piso legal ⇒ **bloquea**.
    //
    // No se infla la base en silencio: el AIU es un valor PACTADO en el
    // contrato, y subirlo por cuenta propia cambiaría la cifra que el cliente
    // firmó. Tampoco se deja pasar: bajo el art. 462-1 del E.T. el AIU no puede
    // ser menor al 10 % del valor del contrato, y una factura que lo incumple la
    // DIAN la ACEPTA —declara menos IVA del debido y el faltante aparece
    // después, con sanción e intereses—. El único desenlace correcto es parar
    // acá, antes de gastar numeración, y decir cuál de las dos cosas corregir.
    const aiu_floor = result.divergences.find(
      (divergence) => divergence.scope === 'aiu_base_below_minimum',
    );
    if (aiu_floor) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_AIU_001,
        `El AIU declarado (${aiu_floor.received}) es menor al mínimo legal de ${aiu_floor.expected}, ` +
          `que es el 10% del valor del contrato exigido por el artículo 462-1 del Estatuto Tributario ` +
          `para aseo y cafetería, vigilancia y servicios temporales de empleo. Sube el AIU o, si el ` +
          `contrato es de construcción de bien inmueble, cambia el régimen de AIU en la configuración ` +
          `de facturación de la tienda: ahí la base gravable es sólo la utilidad y este piso no aplica.`,
        {
          aiu_value: aiu_floor.received,
          minimum_base: aiu_floor.expected,
          difference: aiu_floor.difference,
        },
      );
    }

    // Componente AIU que el régimen GRAVA y que llegó sin ningún impuesto
    // declarado ⇒ **bloquea**.
    //
    // Es el caso simétrico del piso legal y hace exactamente el mismo daño, por
    // la misma vía: la DIAN ACEPTA el documento. Un XML que declara menos IVA
    // del debido pero es internamente consistente pasa la validación, y el
    // faltante sólo se corrige después con nota crédito, o aparece en una
    // fiscalización con sanción e intereses. Nada de eso es recuperable
    // cambiando el borrador: la numeración ya se gastó.
    //
    // Y a diferencia de `line_tax`, acá el servidor NO puede ganar: la tarifa
    // depende del bien o servicio y `InvoiceCalculatorService` no tiene el
    // catálogo, así que lo único que podía hacer era reportar el hecho con los
    // tres importes en cero —no puede afirmar CUÁNTO faltaba—. Entre emitir
    // sub-declarando y no emitir, no emitir es la única opción defendible.
    //
    // Esto NO rompe el formulario del panel, que es lo que hacía inviable
    // bloquear el caso simétrico: el panel pone IVA en TODAS las líneas por
    // defecto, así que el motor le quita el impuesto a las que el régimen no
    // grava (`aiu_untaxable_line_declares_tax`, que sigue sin bloquear) y
    // ninguna línea gravable se queda sin tarifa. Lo que este bloqueo corta es
    // el cliente que declara IVA sólo en Administración y deja Imprevistos y
    // Utilidad limpios: la factura 83 en producción, corta por 95.000 COP.
    //
    // Un servicio realmente exento o excluido se declara con tarifa 0, no
    // omitiendo el impuesto. La DIAN distingue las dos cosas —exento emite
    // `cac:TaxTotal` con `cbc:Percent` en 0,00, excluido no lo emite— y
    // colapsarlas borraría la diferencia justo donde cambia el resultado.
    const aiu_untaxed = result.divergences.find(
      (divergence) => divergence.scope === 'aiu_taxable_line_without_tax',
    );
    if (aiu_untaxed) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_AIU_004,
        `La línea ${aiu_untaxed.line_index + 1}${
          aiu_untaxed.line_description
            ? ` («${aiu_untaxed.line_description}»)`
            : ''
        } ${
          // Sin componente la línea es la porción de COSTO reembolsable, y sólo
          // llega acá bajo la base `'subtotal'`, que grava el contrato entero.
          // Llamarla «el componente AIU» —como hacía el `?? 'AIU'`— mandaba al
          // operador a buscar un componente que la línea no tiene.
          aiu_untaxed.tax_type
            ? `es el componente «${aiu_untaxed.tax_type}» del contrato`
            : `es la porción de costo reembolsable del contrato (sin componente AIU)`
        }, que bajo la base gravable configurada ` +
          `SÍ hace parte de la base del IVA, y no declara ningún impuesto. ` +
          `No se emite el documento: la DIAN lo aceptaría declarando menos IVA del debido y el ` +
          `faltante sólo se corregiría después con nota crédito. Declara el impuesto de esta línea ` +
          `con su tarifa (por ejemplo IVA 19%); si el servicio es exento o excluido, declárala con ` +
          `tarifa 0 —no la dejes sin impuesto—. Si lo que no corresponde es que esta porción ` +
          `grave, cambia la base gravable de AIU en la configuración de facturación de la tienda: ` +
          `bajo el Decreto 1372/1992 sólo la Utilidad hace parte de la base, y la base Subtotal ` +
          `grava el contrato completo incluido el costo reembolsable.`,
        {
          line_index: aiu_untaxed.line_index,
          aiu_component: aiu_untaxed.tax_type ?? null,
        },
      );
    }

    for (const divergence of result.divergences) {
      this.logger.warn(
        `[${label}] Divergencia ${divergence.scope} en línea ${divergence.line_index + 1}: ` +
          `cliente=${divergence.received} servidor=${divergence.expected} (gana el servidor)`,
      );
    }

    return result;
  }

  /**
   * Resuelve, por línea, los atributos que describen QUÉ se vendió, en qué
   * escala y contra qué cuenta se contabiliza: la *price unit*, el código de
   * unidad UN/ECE y la cuenta PUC de ingreso.
   *
   * Los dos primeros no se aceptan del request. `price_unit_quantity` no está
   * siquiera en el DTO: es un atributo del producto, y permitir que entre por el
   * cuerpo del request dejaría facturar un producto de $28.000 el kilo como
   * $28.000 el gramo. `unit_code` sí está en el DTO —hay casos legítimos de
   * override— pero sólo se respeta si el cliente lo declaró explícitamente; si
   * no, se deriva de la unidad de stock del producto.
   *
   * ## Por qué la cuenta se CONGELA acá y no se resuelve al contabilizar
   *
   * `AutoEntryService.resolveInvoiceRevenueLines` sabe resolver la cascada
   * `línea → variante → producto → mapping`, así que dejar la columna en NULL
   * «funciona». Lo que no funciona es la promesa: entre CREAR la factura y
   * ACEPTARLA (que es cuando nace el asiento) el producto puede remaparse, y el
   * asiento saldría contra una cuenta distinta de la que el operador vio al
   * facturar, sin que nada lo delate — el asiento cuadra igual, sólo que el
   * ingreso quedó en otra subcuenta. Congelarla acá cierra esa ventana.
   *
   * La cascada de `resolveInvoiceRevenueLines` NO cambia: para las filas
   * históricas —donde la columna es NULL— sigue resolviendo en vivo, que es
   * exactamente lo que documenta el schema.
   *
   * Una sola consulta por tabla para toda la factura. Sin producto (líneas
   * libres, que el módulo permite) los tres quedan en `undefined`, que es el
   * comportamiento histórico: divisor 1, `EA` al emitir y mapping por defecto.
   */
  private async resolveLinePricingSnapshots(
    items: CreateInvoiceItemDto[],
  ): Promise<InvoiceLinePricingSnapshot[]> {
    const product_ids = Array.from(
      new Set(
        items
          .map((item) => item.product_id)
          .filter((id): id is number => typeof id === 'number'),
      ),
    );
    const variant_ids = Array.from(
      new Set(
        items
          .map((item) => item.product_variant_id)
          .filter((id): id is number => typeof id === 'number'),
      ),
    );

    const products = product_ids.length
      ? await this.prisma.products.findMany({
          where: { id: { in: product_ids } },
          select: {
            id: true,
            price_unit_quantity: true,
            account_code: true,
            stock_uom: { select: { code: true } },
          },
        })
      : [];
    const product_by_id = new Map<
      number,
      {
        id: number;
        price_unit_quantity: number | null;
        account_code: string | null;
        stock_uom: { code: string } | null;
      }
    >(products.map((p) => [p.id, p]));

    // La variante es la unidad realmente vendida, así que su cuenta gana sobre
    // la del producto. Consulta aparte y sólo si alguna línea la usa: la
    // mayoría de facturas no lleva variantes.
    const variants = variant_ids.length
      ? await this.prisma.product_variants.findMany({
          where: { id: { in: variant_ids } },
          select: { id: true, account_code: true },
        })
      : [];
    const variant_by_id = new Map<
      number,
      { id: number; account_code: string | null }
    >(variants.map((v) => [v.id, v]));

    // Artículo que el catálogo de ESTA tienda no devuelve ⇒ no sigue.
    //
    // Las dos consultas de arriba van por `this.prisma`, que scopea `products`
    // por tienda y `product_variants` por relación, así que "no está en el
    // mapa" significa a la vez «no existe» y «es de otra tienda». Antes de esta
    // puerta las dos cosas se colaban por caminos distintos y ambas malas: el
    // id inexistente reventaba en la FK de `invoice_items` como un 500 —después
    // de que `generateNextNumber` ya hubiera gastado el consecutivo—, y el id
    // de otra tienda satisfacía la FK y quedaba escrito en la factura.
    //
    // Se lanza aquí y no en el `create` porque este resolutor es el único punto
    // por el que pasan LOS DOS carriles de escritura (`create` y `update`), que
    // es el mismo motivo por el que `UpdateInvoiceDto` deriva de `CreateInvoiceDto`.
    const rejected_products = product_ids.filter((id) => !product_by_id.has(id));
    const rejected_variants = variant_ids.filter((id) => !variant_by_id.has(id));
    if (rejected_products.length > 0 || rejected_variants.length > 0) {
      const parts = [
        rejected_products.length
          ? `producto(s) ${rejected_products.join(', ')}`
          : null,
        rejected_variants.length
          ? `variante(s) ${rejected_variants.join(', ')}`
          : null,
      ].filter(Boolean);
      throw new VendixHttpException(
        ErrorCodes.INVOICING_CALC_003,
        `El documento referencia ${parts.join(' y ')} que no existen en el catálogo de esta tienda. ` +
          'Selecciónalos desde el buscador de productos, o deja la línea sin producto si es un ítem libre.',
        {
          rejected_product_ids: rejected_products,
          rejected_product_variant_ids: rejected_variants,
        },
      );
    }

    return items.map((item) => {
      const product =
        item.product_id != null
          ? product_by_id.get(item.product_id)
          : undefined;
      const variant =
        item.product_variant_id != null
          ? variant_by_id.get(item.product_variant_id)
          : undefined;

      // `1` es el default de la columna y significa "precio por unidad": no
      // aporta nada guardarlo y NULL ya es esa misma semántica en el snapshot.
      const price_unit = product?.price_unit_quantity ?? null;

      // Misma precedencia que aplica `resolveInvoiceRevenueLines`, en el mismo
      // orden y a propósito: si las dos difirieran, congelar acá cambiaría la
      // cuenta en vez de sólo fijarla. El override explícito de la línea manda
      // sobre el catálogo — es el único de los tres que el usuario declaró para
      // ESTA factura.
      const account_code = (
        item.account_code ??
        variant?.account_code ??
        product?.account_code ??
        ''
      ).trim();

      return {
        price_unit_quantity:
          price_unit != null && price_unit > 1 ? price_unit : undefined,
        unit_code:
          item.unit_code ??
          (product?.stock_uom?.code
            ? resolveUneceUnitCode(product.stock_uom.code)
            : undefined),
        account_code: account_code || undefined,
      };
    });
  }
}

/**
 * Lo que se congela de cada línea: la escala del precio, la unidad vendida y la
 * cuenta PUC de ingreso. Se resuelve del catálogo al facturar —`account_code`
 * admite además el override explícito de la línea—, nunca del request a secas.
 */
interface InvoiceLinePricingSnapshot {
  price_unit_quantity?: number;
  unit_code?: string;
  /** Cuenta ya resuelta: línea → variante → producto. `undefined` ⇒ mapping. */
  account_code?: string;
}

/**
 * Una fila del catálogo `tax_rates` de la tienda, ya normalizada al vocabulario
 * del documento fiscal. Es la VERDAD del impuesto que el comerciante creó.
 *
 * Se construye en `resolveTenantTaxRateCatalog`, que además comprueba la
 * pertenencia al tenant. Sólo entran filas ya validadas.
 */
interface TenantTaxRateSnapshot {
  /**
   * Tarifa en PORCENTAJE (19 = 19 %), convertida desde la fracción que guarda
   * `tax_rates.rate`. En `Decimal` para que la conversión ×100 no herede el
   * error de coma flotante que el resto del dominio se esmera en no tener.
   */
  tax_rate: Prisma.Decimal;
  /** `tax_categories.tax_type` — la clasificación con la que se arman ValImp1/2/3. */
  tax_type: string | null;
  tax_name: string;
  /** Default del catálogo; la línea puede sobrescribirlo. */
  is_inclusive: boolean | null;
}
