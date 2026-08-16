import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
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
import { InvoiceRetryQueueService } from './services/invoice-retry-queue.service';
import {
  CalculatedLine,
  CalculatedTax,
  InvoiceCalculatorAiuInput,
  InvoiceCalculatorResult,
  InvoiceCalculatorService,
} from './services/invoice-calculator.service';
import { TrmService } from './services/trm.service';
import { resolveUneceUnitCode } from '../products/services/uom-uncefact.util';
import {
  AiuSettings,
  DEFAULT_POS_AUTO_EMIT,
  DEFAULT_POS_DIAN_FAILURE_POLICY,
  PosInvoicingSettings,
} from '../settings/interfaces/store-settings.interface';
import { DIAN_INVOICE_OPERATION_TYPES } from './providers/dian-direct/constants/dian-document-types';
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

/**
 * LA RESOLUCIÓN SIN SU CLAVE TÉCNICA.
 *
 * `resolution: true` arrastraba la fila `invoice_resolutions` COMPLETA hasta el
 * navegador en toda respuesta de facturación —`GET /store/invoicing`,
 * `GET :id`, y todo lo que devuelva una factura—, y esa fila lleva tres
 * columnas que no pueden salir del servidor:
 *
 *   · `technical_key` — la ClTec en claro. Es la 14.ª entrada del hash del CUFE
 *     (`cufe-calculator.ts`): quien la tiene puede recomputar el CUFE de
 *     cualquier documento emitido bajo esa resolución, que es exactamente la
 *     prueba de integridad que la DIAN confronta.
 *   · `technical_key_encrypted` — la misma clave sellada. Sin la llave maestra
 *     no se abre, pero publicar el ciphertext regala el material para atacarlo
 *     fuera de línea sin límite de intentos.
 *   · `technical_key_fingerprint` — SHA-256 pelado, SIN llave a propósito (ver
 *     su nota en `schema.prisma`). Es un índice ciego: publicarlo permite
 *     correlacionar qué resoluciones de qué tenants comparten ClTec, que es
 *     justo lo que `findResolutionsSharingTechnicalKey` detecta como
 *     contaminación, y además admite ataque por diccionario contra un valor de
 *     formato conocido.
 *
 * Se enumeran las columnas PÚBLICAS en vez de excluir las tres sensibles porque
 * `select` es una lista blanca: una columna secreta que se añada mañana a
 * `invoice_resolutions` no se publica sola. El precedente correcto ya estaba en
 * el repo — `domains/organization/invoicing/invoicing.service.ts` — y esto lo
 * generaliza a la ruta de tienda, que es la que sirve el panel.
 *
 * ESTE SERVICIO NO NECESITA LA ClTec: no calcula CUFE ni arma XML. Quien sí la
 * necesita es el emisor, y la carga aparte y en el punto de uso —ver
 * `revealResolutionTechnicalKey` en `invoice-flow.service.ts`—.
 */
const RESOLUTION_PUBLIC_SELECT = {
  id: true,
  organization_id: true,
  store_id: true,
  accounting_entity_id: true,
  document_type: true,
  resolution_number: true,
  resolution_date: true,
  prefix: true,
  range_from: true,
  range_to: true,
  current_number: true,
  valid_from: true,
  valid_to: true,
  is_active: true,
  created_at: true,
  updated_at: true,
} as const;

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
    const enabled = await this.fiscalGate.isAreaEnabled(
      Number(context.organization_id),
      context.store_id != null ? Number(context.store_id) : null,
      'invoicing',
    );
    if (!enabled) {
      throw new ForbiddenException(
        'Fiscal area "invoicing" is inactive for this tenant',
      );
    }

    await this.assertElectronicEmissionLive(context);
  }

  /**
   * Segunda compuerta: si el tenant SÍ configuró facturación electrónica, crear
   * facturas exige que la habilitación esté viva (producción + enabled).
   *
   * `fiscal_status.invoicing` sólo afirma que el área fiscal está activa, y se
   * pone ACTIVE al terminar el wizard fiscal. Una tienda en set de pruebas la
   * pasaba y creaba facturas que consumen numeración: InvoiceNumberGenerator
   * elige la resolución por `accounting_entity_id` + `document_type` con
   * `is_active`, sin distinguir ambiente, así que los números que gastara un
   * trámite salían del rango que la tienda usará en producción, y la DIAN
   * rechaza numeración duplicada o con huecos que no puede explicar.
   *
   * NO se exige a quien no tiene configuración DIAN: la facturación de Vendix
   * también emite documentos para comercios sin habilitación, y bloquearlos
   * convertiría una compuerta en una pérdida de función. El criterio es "si
   * configuraste FE, no emites hasta estar habilitado".
   *
   * El set de pruebas no pasa por aquí: DianTestService reserva su bloque
   * directamente sobre `invoice_resolutions`, sin crear facturas.
   */
  private async assertElectronicEmissionLive(context: {
    organization_id?: number;
    store_id?: number;
  }): Promise<void> {
    const organization_id = Number(context.organization_id);
    if (!Number.isFinite(organization_id)) return;

    const scope = await this.fiscalScope.requireFiscalScope(organization_id);

    // Same resolution as DianConfigService.getEmissionStatus: the habilitación
    // belongs to the scope that owns the NIT.
    const config = await this.prisma
      .withoutScope()
      .dian_configurations.findFirst({
        where: {
          ...(scope === 'ORGANIZATION'
            ? { organization_id, store_id: null }
            : { store_id: context.store_id }),
          configuration_type: 'invoicing',
        },
        orderBy: [{ is_default: 'desc' }, { id: 'asc' }],
        select: { environment: true, enablement_status: true },
      });

    if (!config) return;

    const is_live =
      config.environment === 'production' &&
      config.enablement_status === 'enabled';

    if (!is_live) {
      throw new ForbiddenException(
        'La facturación electrónica de esta tienda aún no está habilitada en producción ante la DIAN, así que no puede emitir facturas que consuman la numeración de la resolución. Completa el set de pruebas y activa producción.',
      );
    }
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
    // Régimen de AIU y validación del objeto del contrato. Por encima del
    // consecutivo por la misma razón que el recálculo: puede rechazar.
    const aiu_context = await this.resolveAiuContext(
      dto.operation_type,
      dto.items,
    );
    const calculated = this.recalculateDocument(
      dto.items,
      line_snapshots,
      'invoice:create',
      aiu_context.aiu,
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
      const aggregated = await this.applyClientDeclaredWithholdings({
        organization_id: organization_id!,
        store_id: store_id ?? null,
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

    await this.prisma.user_roles.create({
      data: {
        user_id: created.id,
        role_id: customerRole.id,
        organization_id,
        store_id,
      },
    });

    return created.id;
  }

  async createFromOrder(order_id: number) {
    const context = this.getContext();
    await this.assertInvoicingAreaActive(context);
    const accounting_entity_id =
      await this.resolveAccountingEntityIdForContext(context);

    const order = await this.prisma.orders.findFirst({
      where: { id: order_id },
      include: {
        order_items: {
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
      const tax = 0; // sales_order_items don't have tax_amount
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
      // Mismo régimen de AIU que la creación. El tipo de operación es el que
      // trae el PATCH si lo cambia, y el persistido si no: editar un borrador
      // no puede convertir un contrato AIU en una venta estándar por omisión.
      const aiu_context = await this.resolveAiuContext(
        dto.operation_type ?? invoice.operation_type,
        dto.items,
      );
      const calculated = this.recalculateDocument(
        dto.items,
        line_snapshots,
        `invoice:update:${id}`,
        aiu_context.aiu,
      );
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
  private async resolveAiuContext(
    operation_type: string | null | undefined,
    items: Array<{ aiu_component?: string | null }>,
  ): Promise<{ aiu?: InvoiceCalculatorAiuInput; note?: string }> {
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
    const settings = await this.loadAiuSettings(context.store_id);

    // MISMA función que usa la emisión: lo que se valida acá es exactamente la
    // cadena que va a viajar en `cbc:Note`. Ver `buildAiuNote`.
    const contract_object = (settings.contract_object || '').trim();
    const note = buildAiuNote(contract_object);

    if (
      note.length < DIAN_AIU_NOTE_MIN_LENGTH ||
      note.length > DIAN_AIU_NOTE_MAX_LENGTH
    ) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_AIU_002,
        `El objeto del contrato AIU falta o no tiene la longitud que exige la DIAN: la nota de la ` +
          `línea de Administración debe medir entre ${DIAN_AIU_NOTE_MIN_LENGTH} y ${DIAN_AIU_NOTE_MAX_LENGTH} ` +
          `caracteres contando el prefijo obligatorio «${DIAN_AIU_NOTE_PREFIX}». ` +
          `Descríbelo en la configuración de facturación de la tienda.`,
        { note_length: note.length, has_contract_object: !!contract_object },
      );
    }

    return {
      note,
      aiu: {
        // Default explícito y conservador: bajo `et_462_1` tributa el AIU
        // completo. Una tienda que no configuró nada declara de más, no de
        // menos.
        regime: settings.regime ?? 'et_462_1',
        enforce_minimum_base: settings.enforce_minimum_base,
        minimum_base_percent: settings.minimum_base_percent,
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
    const conceptById = new Map(concepts.map((c) => [c.id, c]));

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
        taxes: item.taxes?.map((tax) => ({
          tax_rate_id: tax.tax_rate_id,
          tax_name: tax.tax_name,
          tax_rate: tax.tax_rate,
          tax_type: tax.tax_type,
          taxable_amount: tax.taxable_amount,
          tax_amount: tax.tax_amount,
          is_inclusive: tax.is_inclusive,
        })),
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
