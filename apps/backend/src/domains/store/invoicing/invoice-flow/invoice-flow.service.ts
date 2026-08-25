import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { FiscalGateService } from '../../../../common/services/fiscal-gate.service';
import { TechnicalKeyVaultService } from '../../../../common/services/technical-key-vault.service';
import {
  VendixHttpException,
  ErrorCodes,
  ErrorCodeEntry,
} from 'src/common/errors';
import { buildTaxBreakdown } from 'src/common/interfaces/tax-breakdown.interface';
import {
  ProviderInvoiceData,
  ProviderInvoiceTax,
  ProviderResponse,
} from '../providers/invoice-provider.interface';
import {
  clearInclusiveLine,
  dianAmount,
  dianLineExtension,
  dianRate,
  dianSum,
  toDecimal,
} from '../utils/dian-money.util';
import type { DianClearedLineAmounts } from '../utils/dian-money.util';
import {
  buildAiuNote,
  DIAN_AIU_NOTE_MAX_LENGTH,
  DIAN_AIU_NOTE_MIN_LENGTH,
  DIAN_AIU_NOTE_PREFIX,
  UblCommonBuilder,
} from '../providers/dian-direct/xml/ubl-common.builder';
import type {
  DianDocumentExtras,
  DianExchangeRateDeclaration,
  ProviderInvoiceWithholding,
  UblDocumentLine,
} from '../providers/dian-direct/xml/ubl-common.builder';
import { DIAN_INVOICE_OPERATION_TYPES } from '../providers/dian-direct/constants/dian-document-types';
import { DIAN_TAX_CODES } from '../providers/dian-direct/constants/dian-tax-codes';
import type {
  AiuSettings,
  AiuVatRegime,
} from '../../settings/interfaces/store-settings.interface';
import {
  isAiuLineTaxable,
  taxableBasisFromRegime,
} from '../profiles/invoice-profile-config.contract';
import type {
  AiuLineComponent,
  AiuTaxableBasis,
} from '../profiles/invoice-profile-config.contract';
import { InvoiceProviderResolver } from '../providers/invoice-provider-resolver.service';
import { InvoiceRetryQueueService } from '../services/invoice-retry-queue.service';
import { FiscalTransmissionLedgerService } from '../services/fiscal-transmission-ledger.service';
import {
  WithholdingFlowService,
  WithholdingResolution,
} from '../../withholding-tax/withholding-flow.service';
import {
  WithholdingLine,
  WithholdingRoleValue,
} from 'src/common/interfaces/withholding-breakdown.interface';
import {
  DEFAULT_STORE_TIMEZONE,
  localDateString,
  localOffsetString,
  localTimeString,
  resolveOrganizationTimezone,
  resolveStoreTimezone,
} from '../../../../common/utils/store-timezone.util';
import { resolveInvoiceControl } from '../../../../common/helpers/invoice-control.helper';
// `Strict`, no la tolerante: acá el valor viaja a la DIAN y un `EA` de relleno
// declara piezas donde hubo kilos. La versión que devuelve `null` permite
// rechazar el documento en vez de emitirlo con una unidad inventada.
import { resolveUneceUnitCodeStrict } from '../../products/services/uom-uncefact.util';
import { toCustomerInvoiceData } from '../utils/customer-invoice-data.adapter';
import {
  AcquirerIdentificationMode,
  CustomerFiscalIdentityFinding,
  CustomerFiscalIdentityInput,
  CustomerFiscalIdentityReport,
  CustomerFiscalIdentityValidator,
} from '../validators/customer-fiscal-identity.validator';
import {
  FiscalDocumentFinding,
  FiscalDocumentFindingCategory,
  FiscalDocumentReport,
  FiscalDocumentValidationInput,
  FiscalDocumentValidator,
} from '../validators/fiscal-document.validator';
import {
  FiscalDocumentType,
  isFiscalDocumentType,
  toFiscalDocumentType,
} from '../fiscal-document-requirements';

/**
 * Un hallazgo de `emit-readiness`, venga de la puerta que venga.
 *
 * Las dos puertas producen la MISMA forma útil para la pantalla —`code`,
 * `severity`, `field`, `problem`, `fix`— y difieren sólo en el universo de
 * `code` y en que el fiscal añade `category` y la regla del Anexo. La unión se
 * declara para que las listas aplanadas de {@link EmitReadinessReport} puedan
 * llevar los dos sin que ninguna se quede fuera por tipo.
 */
export type EmitReadinessFinding =
  | CustomerFiscalIdentityFinding
  | FiscalDocumentFinding;

/**
 * Lo que responde `GET /store/invoicing/:id/emit-readiness`.
 *
 * `findings`/`blockers`/`warnings` en la raíz llevan la UNIÓN de las dos
 * puertas —identidad del adquiriente y prevalidación fiscal— porque `emittable`
 * también es el AND de las dos: publicar un `emittable:false` cuya lista de
 * requisitos sólo mira una de ellas deja al usuario sin nada que corregir.
 * `identity` y `fiscal_document` conservan cada informe entero para quien
 * necesite saber de qué puerta salió cada hallazgo.
 */
export type EmitReadinessReport = Omit<
  CustomerFiscalIdentityReport,
  'findings' | 'blockers' | 'warnings'
> & {
  findings: EmitReadinessFinding[];
  blockers: EmitReadinessFinding[];
  warnings: EmitReadinessFinding[];
  invoice_id: number;
  invoice_number: string;
  status: string;
  has_items: boolean;
  /** El informe de identidad SIN aplanar, para leerlo sin ambigüedad. */
  identity: CustomerFiscalIdentityReport;
  /**
   * El veredicto de prevalidación fiscal, o `null` cuando el `invoice_type` no
   * se emite a la DIAN y por tanto no hay nada que prevalidar.
   */
  fiscal_document: FiscalDocumentReport | null;
  /**
   * Las transiciones legales desde el estado actual — lo mismo que aplica
   * `validateTransition`.
   *
   * Se publica porque hasta ahora `getValidTransitions()` existía y NADIE lo
   * exponía: el panel deducía qué botones pintar y acertaba a medias, que es
   * como «Anular» acabó ofreciéndose sobre borradores para que el backend
   * contestara 400 al pulsarlo.
   */
  valid_transitions: InvoiceStatus[];
  /**
   * Cómo se deshace ESTE documento ahora mismo. La respuesta a «ya no quiero
   * esta factura», que es distinta de «¿puedo emitirla?» y es la que faltaba.
   */
  discard_route: InvoiceDiscardRoute;
};

type InvoiceStatus =
  | 'draft'
  | 'validated'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'voided';

const VALID_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ['validated', 'cancelled'],
  validated: ['sent', 'cancelled'],
  sent: ['accepted', 'rejected'],
  // Un documento ACEPTADO por la DIAN no se anula: se corrige con una nota
  // crédito. `void()` ya lo rechazaba sin excepción, así que declarar aquí
  // `['voided']` no habilitaba nada — sólo mentía. Y la mentira sí tenía
  // consecuencia: esta tabla es lo que `getValidTransitions` publica como
  // «acciones disponibles», y el frontend pintaba «Anular» sobre una factura
  // aceptada para que el backend contestara 409 al pulsarla.
  accepted: [],
  rejected: ['sent', 'voided'],
  cancelled: [],
  voided: [],
};

/**
 * CÓMO SE DESHACE ESTE DOCUMENTO — la pregunta que el operador hace de verdad.
 *
 * `VALID_TRANSITIONS` responde «¿qué transiciones existen?», que es la pregunta
 * del diseñador. Quien está frente a la pantalla pregunta otra cosa: «esta
 * factura me está estorbando, ¿cómo la quito para volver a facturar la orden?».
 * Traducir una a otra a ojo es lo que produjo el atasco reportado —«me dice que
 * primero debo cancelarla, pero no hay forma de cancelarla»—: el panel ofrecía
 * «Anular» sobre un BORRADOR, cuya salida real se llama `cancel`, y el backend
 * contestaba «transición inválida» sin decir cuál era la buena.
 *
 * Las tres salidas NO son sinónimos, y confundirlas tiene consecuencia fiscal:
 *
 * - `cancel` — el documento nunca se transmitió. Se descarta y ya. Su
 *   consecutivo queda como hueco en la numeración autorizada (se tomó al
 *   CREAR), y eso es irreversible: por eso descartar es barato en trámite pero
 *   nunca gratis.
 * - `void` — la DIAN lo recibió y lo RECHAZÓ. No existe fiscalmente, así que se
 *   anula sin nota, pero se conserva la evidencia del rechazo.
 * - `credit_note` — la DIAN lo ACEPTÓ. Existe. No se borra ni se anula: se
 *   reversa con una nota crédito, que es un documento nuevo con su propio
 *   consecutivo. Ver la guarda explícita al principio de `void()`.
 */
export interface InvoiceDiscardRoute {
  /**
   * La acción que SÍ funciona sobre este documento ahora mismo, o `null` cuando
   * el estado es terminal y no hay nada que deshacer.
   */
  action: 'cancel' | 'void' | 'credit_note' | null;
  /** Rótulo exacto que el panel debe pintar en el botón. */
  label: string;
  /** Por qué ésa y no otra, en español y sin nombres de enum. */
  reason: string;
  /**
   * ¿Descartarlo libera la orden de origen para volver a facturarla?
   *
   * Es la única propiedad que le importa a quien llegó aquí por el 409 de
   * `INVOICING_CREATE_002`. `true` sólo para `cancel` y `void`, que son los dos
   * estados que `assertNotAlreadyInvoiced` excluye de «ya facturado»
   * (`invoicing.service.ts`). La nota crédito NO libera la orden: la factura
   * aceptada sigue existiendo y la orden sigue facturada.
   */
  releases_source_document: boolean;
}

/** La salida de cada estado. Derivada de `VALID_TRANSITIONS`, no paralela a ella. */
const DISCARD_ROUTES: Record<InvoiceStatus, InvoiceDiscardRoute> = {
  draft: {
    action: 'cancel',
    label: 'Descartar borrador',
    reason:
      'El borrador nunca se transmitió a la DIAN, así que se descarta sin nota. El consecutivo que ya tomó queda como hueco en la numeración autorizada y no se recupera.',
    releases_source_document: true,
  },
  validated: {
    action: 'cancel',
    label: 'Descartar documento',
    reason:
      'El documento está validado pero todavía no se transmitió a la DIAN, así que se descarta sin nota.',
    releases_source_document: true,
  },
  sent: {
    action: null,
    label: 'Esperando respuesta de la DIAN',
    reason:
      'El documento ya salió hacia la DIAN y su respuesta aún no llega. No se descarta mientras esté en tránsito: hasta saber si lo aceptó o lo rechazó, anularlo por nuestra cuenta dejaría la contabilidad diciendo una cosa y la DIAN otra.',
    releases_source_document: false,
  },
  accepted: {
    action: 'credit_note',
    label: 'Emitir nota crédito',
    reason:
      'La DIAN aceptó este documento, así que existe fiscalmente y no se anula ni se borra: se reversa con una nota crédito, que consume su propio consecutivo.',
    releases_source_document: false,
  },
  rejected: {
    action: 'void',
    label: 'Anular',
    reason:
      'La DIAN rechazó el documento, así que no existe fiscalmente y se anula sin nota crédito. Corrige lo que la DIAN señaló y reintenta el envío: reintentar reutiliza el MISMO consecutivo, no toma uno nuevo.',
    releases_source_document: true,
  },
  cancelled: {
    action: null,
    label: 'Ya descartado',
    reason:
      'El documento ya fue descartado. La orden de origen quedó libre para volver a facturarse.',
    releases_source_document: true,
  },
  voided: {
    action: null,
    label: 'Ya anulado',
    reason:
      'El documento ya fue anulado. La orden de origen quedó libre para volver a facturarse.',
    releases_source_document: true,
  },
};

/**
 * Un motivo de rechazo tal como lo publica la DIAN: el código de la regla
 * (`FAB10a`, `FAU01`…) y su texto. El proveedor los deja en
 * `provider_response.provider_data.dian_errors[]`.
 *
 * Se declara aquí, estructuralmente, en vez de importar `DianValidationError` de
 * `providers/dian-direct/`: `provider_data` es la bolsa libre de CADA proveedor,
 * así que este flujo no puede depender del tipo de uno solo. Lee lo que reconoce
 * y descarta el resto.
 */
interface DianRejectionReason {
  code?: string;
  message: string;
  severity?: string;
}

/** Lo que la DIAN dijo del documento, listo para viajar en `details`. */
interface DianRejectionEvidence {
  dian_errors: DianRejectionReason[];
  dian_status_code?: string;
  dian_status_description?: string;
}

/**
 * Tope del mensaje del proveedor que se devuelve al cliente. Un `Error` de
 * transporte trae una línea; uno de una librería XML puede traer el documento
 * entero, y el `message` de la respuesta HTTP no es sitio para eso.
 */
const PROVIDER_MESSAGE_MAX_LENGTH = 500;

/**
 * El payload del proveedor MÁS lo que la Fase 6 declara: tipo de operación,
 * tasa de cambio, retenciones y los tributos POR LÍNEA.
 *
 * Los tres bloques viven en `DianDocumentExtras` / `UblLineTaxExtras` y no en
 * `ProviderInvoiceData` porque el contrato base es el de CUALQUIER proveedor,
 * mientras que estos campos describen exigencias del Anexo Técnico DIAN. Todos
 * son opcionales, así que un proveedor que los ignore recibe exactamente el
 * mismo payload de antes.
 */
type DianProviderInvoiceData = ProviderInvoiceData &
  DianDocumentExtras & { items: UblDocumentLine[] };

/**
 * Una resolución de retenciones junto con el rol que la produjo.
 *
 * Existe porque el XML y la contabilidad tienen que declarar EXACTAMENTE las
 * mismas retenciones. La resolución corre UNA vez, antes de transmitir —el
 * `cac:WithholdingTaxTotal` la necesita para armar el documento— y las mismas
 * líneas se persisten después de la aceptación. Resolver dos veces (una para el
 * XML y otra para el asiento) permitiría que el documento emitido y el asiento
 * contable declararan retenciones distintas si la configuración fiscal cambiara
 * entre ambos instantes.
 */
interface WithholdingBatch {
  role: WithholdingRoleValue;
  resolution: WithholdingResolution;
}

/**
 * Valor persistido en `invoices.aiu_regime`. Espejo local de `AiuVatRegime`
 * (`settings/interfaces/store-settings.interface.ts`) con `'subtotal'`
 * agregado: la tercera base gravable, que declina el tratamiento AIU y no
 * tiene régimen legal asociado. No se amplía `AiuVatRegime` en su archivo de
 * origen porque esa interfaz sólo describe el AJUSTE DE TIENDA (2 valores,
 * `'subtotal'` nunca es un default de tienda, ver
 * `InvoicingService.getAiuSettingsView`) — el tercer valor sólo llega vía
 * snapshot de perfil o de factura, nunca vía ajuste vivo.
 */
type AiuRegimeSnapshot = AiuVatRegime | 'subtotal';

/** Texto legible de {@link AiuRegimeSnapshot} para mensajes al operador. */
function describeAiuRegime(regime: AiuRegimeSnapshot): string {
  switch (regime) {
    case 'et_462_1':
      return 'el régimen E.T. art. 462-1 (AIU completo)';
    case 'decreto_1372_1992':
      return 'el régimen Decreto 1372/1992 (sólo la utilidad)';
    case 'subtotal':
      return 'la base Subtotal (sin tratamiento AIU)';
  }
}

/**
 * Lo que el AIU cambia en la EMISIÓN: la base gravable declarada que decide
 * qué líneas gravan, y la nota legal de la línea de Administración.
 *
 * Se recompone acá, desde la misma configuración y con la misma `buildAiuNote`
 * que usó `InvoicingService` al crear el documento, porque la nota no se
 * persiste en ninguna columna. Ver la nota de `resolveAiuContext` allá.
 */
interface AiuEmissionContext {
  /**
   * Sigue llamándose `regime` porque así se llama la columna que lo persiste
   * (`invoices.aiu_regime`), pero desde que existe `'subtotal'` ya no es
   * siempre un régimen legal: puede ser la ausencia deliberada de uno.
   */
  regime: AiuRegimeSnapshot;
  /** Cadena YA COMPUESTA para `cbc:Note` de la línea de Administración. */
  note: string;
  /**
   * De dónde salió el régimen. No es adorno de log: `settings` significa que el
   * XML se está construyendo con configuración VIVA que pudo cambiar después de
   * que se calcularon los importes que el documento lleva dentro. Cuando la
   * DIAN rechaza por descuadre de base gravable, esto es lo que dice si el
   * documento se emitió con su propio régimen o con el que la tienda tenía en
   * ese instante.
   */
  regime_source: 'snapshot' | 'settings' | 'default';
  /**
   * Piso legal que rige para ESTE documento, ya resuelto: el porcentaje si
   * aplica, `null` si no aplica ninguno. Viene del snapshot de la factura
   * cuando existe, para que la re-verificación antes de firmar compare contra
   * el mismo número con el que se calculó y no contra el ajuste de hoy.
   */
  minimum_percent: Prisma.Decimal | null;
}

/**
 * Tope de tributos de cabecera sobre los que se intenta reconstruir el desglose
 * por línea. La reconstrucción enumera subconjuntos (2^n), así que un documento
 * con muchos tributos distintos se deja en el camino histórico en vez de gastar
 * tiempo exponencial en el envío.
 */
const LINE_TAX_MAX_CANDIDATES = 6;

/** Tolerancia de un centavo al contrastar el impuesto reconstruido de una línea. */
const ONE_CENT = '0.01';

/**
 * LA RESOLUCIÓN SIN SU CLAVE TÉCNICA.
 *
 * Gemela de la de `invoicing.service.ts` — la misma lista, a propósito: las dos
 * alimentan las mismas pantallas y una que se quede corta reabriría la fuga por
 * el otro lado. Si se añade una columna pública a `invoice_resolutions`, va en
 * las dos.
 *
 * `resolution: true` publicaba la fila entera en toda respuesta de este
 * servicio (`PATCH :id/validate`, `PATCH :id/send`, `accept`, `void`,
 * contingencia, rechazo…), y con ella las TRES columnas de clave técnica:
 * `technical_key` (la ClTec en claro, 14.ª entrada del hash del CUFE),
 * `technical_key_encrypted` (ciphertext atacable fuera de línea) y
 * `technical_key_fingerprint` (SHA-256 sin llave — índice ciego que correlaciona
 * resoluciones entre tenants).
 *
 * Es lista BLANCA, no exclusión: lo que se añada mañana a la tabla no se
 * publica solo.
 *
 * A DIFERENCIA DE `invoicing.service.ts`, ESTE SERVICIO SÍ NECESITA LA ClTec —
 * sin ella no hay CUFE—. No viaja acá: se lee aparte, por su id y sólo con las
 * dos columnas del vault, en `revealResolutionTechnicalKey()`, que es el único
 * punto del archivo donde el secreto entra en memoria.
 *
 * Lo que el emisor SÍ resuelve desde estos campos públicos es el bloque
 * `sts:InvoiceControl` (`resolveInvoiceControl`, que consume `resolution_number`,
 * `prefix`, `range_from`, `range_to`, `valid_from`, `valid_to` e `is_active`) y
 * el `resolution_number` de `provider_data`. Todos están abajo: un `undefined`
 * silencioso en cualquiera de ellos vuelve a producir el bloque de autorización
 * vacío del 14/08/2026, que quemó un consecutivo autorizado irrecuperable.
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
    // Step 8 — Anexo 19 wiring. The customer fields here are the contract the
    // customer-invoice-data.adapter consumes; `person_type`, `tax_regime`,
    // `fiscal_responsibilities`, `ciiu_code`, `verification_digit`, `legal_name`
    // and `is_withholding_agent` were added by Steps 1–2 of the plan so the
    // UBL builder can emit the structural / catalogue fields Anexo 19 expects.
    //
    // `addresses` returns the primary address only — the adapter copies
    // `addresses[0]` into `customer_address`, and pulling any more rows would
    // be wasted scope on every `send()` / `accept()` call.
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
      addresses: { take: 1, orderBy: { is_primary: 'desc' } },
    },
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
      issue_date: true,
      accounting_entity_id: true,
      cufe: true,
      status: true,
    },
  },
};

@Injectable()
export class InvoiceFlowService {
  private readonly logger = new Logger(InvoiceFlowService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly resolver: InvoiceProviderResolver,
    private readonly event_emitter: EventEmitter2,
    private readonly retry_queue: InvoiceRetryQueueService,
    private readonly fiscal_ledger: FiscalTransmissionLedgerService,
    private readonly fiscal_gate: FiscalGateService,
    private readonly withholdingFlow: WithholdingFlowService,
    private readonly acquirerIdentity: CustomerFiscalIdentityValidator,
    private readonly fiscalDocument: FiscalDocumentValidator,
    private readonly technicalKeyVault: TechnicalKeyVaultService,
  ) {}

  /**
   * Familia de hallazgo → código de error. Es todo el cableado HTTP de la
   * prevalidación, y vive AQUÍ y no en el validador a propósito: aquel es puro y
   * no conoce transporte, igual que `CustomerFiscalIdentityValidator`.
   *
   * Cuatro códigos para ~30 hallazgos porque lo que el operador necesita saber es
   * a qué pantalla ir; el hallazgo exacto viaja completo en `details.blockers[]`.
   */
  private static readonly PREVALIDATION_ERROR_CODES: Record<
    FiscalDocumentFindingCategory,
    ErrorCodeEntry
  > = {
    arithmetic: ErrorCodes.INVOICING_PREVALIDATION_001,
    resolution: ErrorCodes.INVOICING_PREVALIDATION_002,
    technical_key: ErrorCodes.INVOICING_PREVALIDATION_003,
    content: ErrorCodes.INVOICING_PREVALIDATION_004,
  };

  /**
   * Con qué bloqueante se redacta el mensaje cuando hay varios.
   *
   * No es el primero de la lista: el orden lo decide QUÉ HAY QUE ARREGLAR
   * ANTES. Una resolución vencida invalida el documento entero, así que mandar
   * a corregir el descuadre de una línea sería mandar a corregir lo que no
   * importa todavía. La aritmética va última porque suele ser consecuencia del
   * contenido (una línea sin cantidad descuadra el total), no su causa.
   *
   * Los demás bloqueantes NO se pierden: viajan completos en `details.blockers`.
   */
  private static readonly PREVALIDATION_CATEGORY_PRECEDENCE: FiscalDocumentFindingCategory[] =
    ['resolution', 'technical_key', 'content', 'arithmetic'];

  /**
   * Resuelve el desglose de retenciones (Bloque C) SIN persistir nada.
   *
   * - documento soporte → CASO 1 `practiced`: el tenant compró y puede retener
   *   al proveedor (pasivo 2365/2367/2368).
   * - documento de venta → CASO 2 `suffered` (el cliente, si es agente
   *   retenedor, retiene al tenant — activo 1355xx) **y** CASO 3 `self`
   *   (AUTORRETENCIÓN, pasivo propio 2365/2368).
   *
   * ## Por qué `self` va acá y no era opcional añadirlo
   *
   * La autorretención nace de una calidad del EMISOR (Decreto 2201/2016 para
   * renta; régimen municipal para ICA), no de la contraparte: aplica igual en
   * una venta de mostrador anónima. `InvoicingService.resolveWithholdingAmount`
   * YA la sumaba al crear la factura, así que `invoices.withholding_amount`
   * incluía la autorretención mientras que este flujo —el único que persiste
   * `withholding_calculations` y el único que alimenta el asiento— sólo resolvía
   * `suffered`. Resultado: un agregado que nadie podía descomponer, sin fila de
   * cálculo y sin asiento del pasivo frente a la DIAN.
   *
   * ## Degrada, nunca lanza
   *
   * Cualquier fallo devuelve `[]` para NUNCA romper la emisión ni la aceptación
   * (contrato cero-regresión). Una retención que no se pudo resolver deja el
   * documento SIN `cac:WithholdingTaxTotal`, que es exactamente el
   * comportamiento histórico y no es motivo de rechazo: la DIAN valida
   * `cbc:PayableAmount` sin mirar ese grupo (Anexo 1.9 §11.9.1).
   */
  private async resolveWithholdingBatches(
    invoice: any,
    is_support_document: boolean,
  ): Promise<WithholdingBatch[]> {
    try {
      const organization_id = Number(invoice.organization_id);
      const store_id =
        invoice.store_id != null ? Number(invoice.store_id) : null;
      const base = Number(invoice.subtotal_amount);
      const ivaAmount = Number(invoice.tax_amount);

      if (is_support_document) {
        const supplier_id =
          invoice.supplier_id != null ? Number(invoice.supplier_id) : null;
        const practiced = await this.withholdingFlow.resolvePracticed({
          organization_id,
          store_id,
          supplier_id,
          base,
          ivaAmount,
        });
        return [{ role: 'practiced', resolution: practiced }];
      }

      // El cliente sale directo de `invoices.customer_id` (cargado en
      // INVOICE_INCLUDE). Si la venta es de mostrador/anónima → null →
      // `resolveSuffered` devuelve []. `resolveSelf` NO recibe contraparte a
      // propósito: ver arriba.
      const customer_id =
        invoice.customer_id != null ? Number(invoice.customer_id) : null;
      const [suffered, self] = await Promise.all([
        this.withholdingFlow.resolveSuffered({
          organization_id,
          store_id,
          customer_id,
          base,
          ivaAmount,
        }),
        this.withholdingFlow.resolveSelf({
          organization_id,
          store_id,
          base,
        }),
      ]);

      return [
        { role: 'suffered', resolution: suffered },
        { role: 'self', resolution: self },
      ];
    } catch (error) {
      this.logger.error(
        `Withholding resolution failed for invoice #${invoice.id}; degrading to empty breakdown: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  /**
   * Persiste las filas `withholding_calculations` de cada lote y devuelve las
   * líneas que quedaron efectivamente registradas, para adjuntarlas como
   * `withholding_breakdown` en el evento contable.
   *
   * Un lote cuya persistencia falle NO aporta sus líneas al desglose: el asiento
   * automático posteará una línea por retención, y hacerlo sin la fila de
   * cálculo que la respalda dejaría un saldo en la declaración sin nada detrás.
   * El fallo se registra y la aceptación del documento continúa.
   */
  private async persistWithholdingBatches(
    invoice: any,
    batches: WithholdingBatch[],
  ): Promise<WithholdingLine[]> {
    const organization_id = Number(invoice.organization_id);
    const store_id = invoice.store_id != null ? Number(invoice.store_id) : null;
    const accounting_entity_id =
      invoice.accounting_entity_id != null
        ? Number(invoice.accounting_entity_id)
        : null;
    const invoice_id = Number(invoice.id);
    const supplier_id =
      invoice.supplier_id != null ? Number(invoice.supplier_id) : null;
    const customer_id =
      invoice.customer_id != null ? Number(invoice.customer_id) : null;

    const persisted: WithholdingLine[] = [];

    for (const batch of batches) {
      if (batch.resolution.lines.length === 0) continue;

      try {
        await this.withholdingFlow.persistWithholdingLines({
          organization_id,
          store_id,
          accounting_entity_id,
          invoice_id,
          // `persistWithholdingLines` ya decide por rol cuál de las dos columnas
          // escribe; se le pasan las dos y él descarta la que no aplica. `self`
          // no escribe ninguna: la autorretención no tiene contraparte.
          supplier_id,
          customer_id,
          role: batch.role,
          counterparty_type: batch.resolution.counterparty_type,
          uvt_value_used: batch.resolution.uvt_value_used ?? 0,
          lines: batch.resolution.lines,
        });
        persisted.push(...batch.resolution.lines);
      } catch (error) {
        this.logger.error(
          `Failed to persist '${batch.role}' withholding lines for invoice #${invoice.id}; they are dropped from the accounting breakdown: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return persisted;
  }

  /**
   * Resuelve Y persiste el desglose de retenciones en un solo paso.
   *
   * Es el camino de `accept()`, que no transmite y por tanto no necesita las
   * líneas antes de armar el XML. `send()` NO usa este método: allí la
   * resolución tiene que ocurrir ANTES de transmitir, porque el
   * `cac:WithholdingTaxTotal` del documento se construye con ella.
   */
  private async resolveWithholdingForInvoice(
    updated: any,
    is_support_document: boolean,
  ): Promise<WithholdingLine[]> {
    const batches = await this.resolveWithholdingBatches(
      updated,
      is_support_document,
    );
    return this.persistWithholdingBatches(updated, batches);
  }

  /**
   * Traduce las líneas resueltas al contrato que el builder UBL escribe en
   * `cac:WithholdingTaxTotal`.
   *
   * ## ⚠️ LAS DOS TARIFAS NO ESTÁN EN LA MISMA UNIDAD
   *
   * `WithholdingLine.rate` es una **fracción** (`0.025`) — así la guarda
   * `withholding_concepts.rate` y así la multiplica el calculador
   * (`amount = base × rate`). `ProviderInvoiceWithholding.rate` es un
   * **porcentaje formateado** (`'2.50'`), porque va directo a `cbc:Percent`.
   *
   * Sin el `× 100` la DIAN recibe una retención del **0,025 %** donde hubo una
   * del 2,5 %. Y el documento es sintácticamente válido —el importe retenido va
   * aparte y es correcto—, así que nada lo rechaza: la tarifa equivocada sólo
   * aparece al cruzar la declaración, meses después.
   *
   * Las retenciones en cero se descartan: `cbc:Percent` sin importe no declara
   * nada y el builder las filtraría igual.
   */
  private toProviderWithholdings(
    lines: WithholdingLine[],
  ): ProviderInvoiceWithholding[] {
    return lines
      .filter((line) => Number(line.amount) > 0)
      .map((line) => ({
        withholding_type: line.withholding_type,
        concept_code: line.concept_code,
        // FRACCIÓN → PORCENTAJE. Ver el bloque de arriba antes de tocar esto.
        rate: dianRate(toDecimal(line.rate).times(100)),
        base: dianAmount(line.base),
        amount: dianAmount(line.amount),
      }));
  }

  /**
   * Defensa en profundidad del gate fiscal de FACTURACIÓN.
   *
   * El ModuleFlowGuard ya bloquea la entrada HTTP, pero send()/accept()
   * también pueden ser invocados por rutas internas (reintentos en cola,
   * futura auto-emisión desde POS) que no pasan por el controller. Solo
   * responsables fiscales con `fiscal_status.invoicing` ACTIVE/LOCKED
   * pueden transmitir/aceptar; fail-closed ante área inactiva.
   */
  private async assertInvoicingAreaActive(invoice: {
    organization_id: number | null;
    store_id: number | null;
  }): Promise<void> {
    const enabled = await this.fiscal_gate.isAreaEnabled(
      Number(invoice.organization_id),
      invoice.store_id != null ? Number(invoice.store_id) : null,
      'invoicing',
    );
    if (!enabled) {
      throw new ForbiddenException(
        'Fiscal area "invoicing" is inactive for this tenant',
      );
    }
  }

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  private async getInvoice(id: number) {
    const invoice = await this.prisma.invoices.findFirst({
      where: { id },
      include: INVOICE_INCLUDE,
    });

    if (!invoice) {
      throw new VendixHttpException(ErrorCodes.INVOICING_FIND_001);
    }

    return invoice;
  }

  private validateTransition(
    currentStatus: string,
    targetStatus: InvoiceStatus,
  ): void {
    const valid_targets =
      VALID_TRANSITIONS[currentStatus as InvoiceStatus] || [];
    if (!valid_targets.includes(targetStatus)) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_STATUS_001,
        `Invalid state transition: cannot change from '${currentStatus}' to '${targetStatus}'. ` +
          `Valid transitions from '${currentStatus}': [${valid_targets.join(', ') || 'none (terminal state)'}]`,
      );
    }
  }

  private toProviderEvidence(response: ProviderResponse): Record<string, any> {
    return {
      success: response.success,
      tracking_id: response.tracking_id,
      cufe: response.cufe ?? null,
      cude: response.cude ?? null,
      cuds: response.cuds ?? null,
      cune: response.cune ?? null,
      qr_code: response.qr_code ?? null,
      xml_document: response.xml_document ?? null,
      pdf_url: response.pdf_url ?? null,
      message: response.message ?? null,
      provider_data: response.provider_data ?? null,
    };
  }

  /**
   * Extrae de la respuesta del proveedor lo que la DIAN dijo del documento.
   *
   * POR QUÉ EXISTE. El motivo real del rechazo —«Valor del CUFE no está calculado
   * correctamente», medido en producción— SÍ llegaba y SÍ quedaba guardado en
   * `invoices.provider_response.provider_data.dian_errors[]`. Lo que no llegaba
   * era al operador: la excepción viajaba con `details` de dos campos
   * (`invoice_id`, `tracking_id`) y el texto se quedaba en la fila. Quien emitía
   * leía «documento rechazado» y no tenía nada que corregir, mientras la causa
   * estaba escrita a un JOIN de distancia.
   *
   * `provider_data` es la bolsa libre del proveedor, así que se lee a la
   * defensiva: lo que no tenga la forma esperada se descarta en vez de romper la
   * ruta de error, que es el peor sitio donde puede fallar algo.
   */
  private extractDianRejection(
    response: ProviderResponse,
  ): DianRejectionEvidence {
    const data = (response.provider_data ?? null) as Record<
      string,
      unknown
    > | null;
    if (!data || typeof data !== 'object') return { dian_errors: [] };

    const raw: unknown[] = Array.isArray(data.dian_errors)
      ? (data.dian_errors as unknown[])
      : [];

    const dian_errors = raw.reduce<DianRejectionReason[]>((acc, entry) => {
      if (!entry || typeof entry !== 'object') return acc;
      const row = entry as Record<string, unknown>;
      const message = typeof row.message === 'string' ? row.message.trim() : '';
      // Un motivo sin texto no le dice nada a nadie; el código solo no basta.
      if (!message) return acc;

      const reason: DianRejectionReason = { message };
      if (typeof row.code === 'string' && row.code) reason.code = row.code;
      if (typeof row.severity === 'string' && row.severity) {
        reason.severity = row.severity;
      }
      acc.push(reason);
      return acc;
    }, []);

    const evidence: DianRejectionEvidence = { dian_errors };
    if (typeof data.dian_status_code === 'string') {
      evidence.dian_status_code = data.dian_status_code;
    }
    if (typeof data.dian_status_description === 'string') {
      evidence.dian_status_description = data.dian_status_description;
    }
    return evidence;
  }

  /**
   * Mensaje del rechazo, en orden de fidelidad decreciente: el que compuso el
   * proveedor (ya trae los motivos de la DIAN concatenados), los motivos crudos,
   * la descripción del estado, y solo al final la frase genérica del catálogo.
   */
  private dianRejectionMessage(
    response: ProviderResponse,
    evidence: DianRejectionEvidence,
  ): string {
    const provider_message = response.message?.trim();
    if (provider_message) return provider_message;

    // Las advertencias no rechazan un documento: si hay motivos bloqueantes, el
    // mensaje habla de ellos y no de una nota al margen.
    const blocking = evidence.dian_errors.filter(
      (reason) => reason.severity !== 'warning',
    );
    const reasons = (blocking.length ? blocking : evidence.dian_errors).map(
      (reason) => (reason.code ? `${reason.code}: ${reason.message}` : reason.message),
    );
    if (reasons.length) {
      return `La DIAN rechazó el documento — ${reasons.join(' | ')}`;
    }

    if (evidence.dian_status_description) {
      return `La DIAN rechazó el documento (${
        evidence.dian_status_code ?? 'sin código'
      }): ${evidence.dian_status_description}`;
    }

    return ErrorCodes.INVOICING_PROVIDER_004.devMessage;
  }

  private fiscalDocumentType(invoice_type: string) {
    if (invoice_type === 'purchase_invoice') return 'support_document';
    if (invoice_type === 'export_invoice') return 'sales_invoice';
    return invoice_type as any;
  }

  private configurationType(invoice_type: string) {
    if (
      invoice_type === 'purchase_invoice' ||
      invoice_type === 'support_document' ||
      invoice_type === 'support_adjustment_note'
    ) {
      return 'support_document';
    }
    // The DIAN habilita the software per document type, each with its own set de
    // pruebas and its own `enablement_status`. Falling back to 'invoicing' here
    // would let a store habilitado only for FEV appear ready to emit DE.
    if (this.isEquivalentDocumentType(invoice_type)) {
      return 'equivalent_document';
    }
    return 'invoicing';
  }

  private isSupportDocumentType(invoice_type: string): boolean {
    return (
      invoice_type === 'purchase_invoice' ||
      invoice_type === 'support_document' ||
      invoice_type === 'support_adjustment_note'
    );
  }

  private isEquivalentDocumentType(invoice_type: string): boolean {
    return (
      invoice_type === 'pos_equivalent_document' ||
      invoice_type === 'equivalent_adjustment_note'
    );
  }

  private assertSupportDocumentReady(invoice: any): void {
    if (
      invoice.invoice_type === 'purchase_invoice' ||
      invoice.invoice_type === 'support_document' ||
      invoice.invoice_type === 'support_adjustment_note'
    ) {
      if (!invoice.supplier_id || !invoice.supplier) {
        throw new VendixHttpException(
          ErrorCodes.FISCAL_CONFIG_INCOMPLETE,
          'Support documents require a supplier.',
          { invoice_id: invoice.id },
        );
      }
      if (!invoice.supplier.tax_id && !invoice.customer_tax_id) {
        throw new VendixHttpException(
          ErrorCodes.FISCAL_CONFIG_INCOMPLETE,
          'Support document supplier requires tax_id.',
          { invoice_id: invoice.id, supplier_id: invoice.supplier_id },
        );
      }
    }
  }

  private assertProviderSupports(provider: any, invoice_type: string): void {
    if (
      (invoice_type === 'purchase_invoice' ||
        invoice_type === 'support_document') &&
      typeof provider.sendSupportDocument !== 'function'
    ) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_DOCUMENT_UNSUPPORTED,
        'The resolved fiscal provider cannot send support documents.',
        { invoice_type },
      );
    }

    if (
      invoice_type === 'support_adjustment_note' &&
      typeof provider.sendSupportAdjustmentNote !== 'function'
    ) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_DOCUMENT_UNSUPPORTED,
        'The resolved fiscal provider cannot send support adjustment notes.',
        { invoice_type },
      );
    }

    // Refused BEFORE a consecutive is spent: a DE number the provider cannot
    // transmit is a hole in an authorized range that the DIAN never lets us
    // reuse. Cheaper to fail loudly here than to burn the number.
    if (
      invoice_type === 'pos_equivalent_document' &&
      typeof provider.sendEquivalentDocument !== 'function'
    ) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_DOCUMENT_UNSUPPORTED,
        'The resolved fiscal provider cannot send POS equivalent documents.',
        { invoice_type },
      );
    }

    if (
      invoice_type === 'equivalent_adjustment_note' &&
      typeof provider.sendEquivalentAdjustmentNote !== 'function'
    ) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_DOCUMENT_UNSUPPORTED,
        'The resolved fiscal provider cannot send equivalent adjustment notes.',
        { invoice_type },
      );
    }
  }

  /**
   * DIAN reads `IssueDate` + `IssueTime` as one local instant, and both feed the
   * CUFE. Deriving them from `toISOString()` names the UTC wall clock while the
   * appended offset claims it is local — the document then declares an instant
   * hours away from the real one, and rolls a whole day between 00:00Z and the
   * offset. Both fields must come from the same tz-aware conversion.
   */
  /**
   * `issue_date` / `due_date` NO guardan un instante: guardan una fecha civil
   * escrita a medianoche UTC (verificado en dev — las 120 facturas de la tienda
   * 3 tienen `2026-08-16 00:00:00` exacto). Aplicarle a ese valor la conversión
   * instante→hora local lo empuja al día ANTERIOR: `2026-08-15 19:00-05:00`.
   *
   * Es decir, cada factura le declaraba a la DIAN una fecha un día antes de la
   * capturada, en `cbc:IssueDate` y en el `FecFac` del CUFE a la vez. Como los
   * dos salían del mismo error, eran coherentes entre sí y el hash no fallaba
   * — por eso nadie lo vio: el documento se aceptaba, sólo que fechado mal.
   *
   * La fecha civil se lee por sus componentes UTC, que es como el resto de la
   * app trata esta columna (`dateOnlyPeriodSql`). Corregir en cambio lo que se
   * ESCRIBE movería los cubos de analítica de toda factura creada de noche.
   *
   * PERO LA COLUMNA NO ES HOMOGÉNEA. En dev, 22 de 80 facturas SÍ guardan una
   * hora real, y una de ellas (id 81, `2026-08-16 00:01:09`) cae en la ventana
   * en que el día UTC y el civil de Bogotá difieren: ese instante son las 19:01
   * del día 15. Leerla por componentes UTC declararía el 16 mientras
   * `formatIssueTime` —que para ese caso sí convierte a hora local— declararía
   * las 19:01-05:00. El par quedaría contradiciéndose a sí mismo dentro del
   * mismo documento, y ambos campos entran al CUFE.
   *
   * Por eso la bifurcación es la MISMA que la de `formatIssueTime`, y tiene que
   * seguir siéndolo: si el valor trae hora real es un instante y se convierte a
   * la fecha civil de la zona; si es medianoche UTC es una fecha de calendario
   * y se lee tal cual. Sin `timezone` no hay conversión posible, así que la
   * ausencia del parámetro mantiene la lectura UTC.
   */
  private formatIssueDate(value: Date, timezone?: string): string {
    const has_real_time =
      value.getUTCHours() !== 0 ||
      value.getUTCMinutes() !== 0 ||
      value.getUTCSeconds() !== 0;
    if (has_real_time && timezone) return localDateString(value, timezone);

    return [
      String(value.getUTCFullYear()).padStart(4, '0'),
      String(value.getUTCMonth() + 1).padStart(2, '0'),
      String(value.getUTCDate()).padStart(2, '0'),
    ].join('-');
  }

  /**
   * `HorFac` sí exige una hora real, y la columna de fecha no la tiene. El
   * instante honesto es el de creación de la factura — pero sólo vale si cae en
   * la MISMA fecha civil que se declara; en una factura con fecha retroactiva
   * tomaría la hora de otro día. Ahí se emite `00:00:00` con el desfase real de
   * esa fecha, que es lo único que el dato respalda.
   *
   * Si algún día la columna llega a guardar una hora de verdad, la primera rama
   * la usa tal cual y esto deja de aplicar solo.
   */
  private formatIssueTime(
    value: Date,
    timezone: string,
    created_at?: Date | null,
  ): string {
    const has_real_time =
      value.getUTCHours() !== 0 ||
      value.getUTCMinutes() !== 0 ||
      value.getUTCSeconds() !== 0;
    if (has_real_time) return localTimeString(value, timezone);

    const civil_date = this.formatIssueDate(value);
    if (created_at && localDateString(created_at, timezone) === civil_date) {
      return localTimeString(created_at, timezone);
    }

    // Mediodía UTC como sonda del desfase: evita que un cambio de horario de
    // verano en la medianoche misma etiquete la hora con el desfase del día
    // contiguo. Colombia no lo tiene, pero el emisor no siempre será Colombia.
    const probe = new Date(
      Date.UTC(
        value.getUTCFullYear(),
        value.getUTCMonth(),
        value.getUTCDate(),
        12,
      ),
    );
    return `00:00:00${localOffsetString(probe, timezone)}`;
  }

  /** Timezone of the emitting tenant: store first, organization as fallback. */
  private async resolveTimezone(invoice: {
    store_id: number | bigint | null;
    organization_id: number | bigint | null;
  }): Promise<string> {
    if (invoice.store_id != null) {
      return resolveStoreTimezone(this.prisma, Number(invoice.store_id));
    }
    if (invoice.organization_id != null) {
      return resolveOrganizationTimezone(
        this.prisma.withoutScope(),
        Number(invoice.organization_id),
      );
    }
    return DEFAULT_STORE_TIMEZONE;
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

  private async resolveTransmissionConfigId(
    invoice: any,
  ): Promise<number | null> {
    if (!invoice.accounting_entity_id) return null;
    const allowed_statuses = ['testing', 'test_set_passed', 'enabled'] as const;
    const config = await this.prisma
      .withoutScope()
      .dian_configurations.findFirst({
        where: {
          organization_id: invoice.organization_id,
          accounting_entity_id: invoice.accounting_entity_id,
          configuration_type: this.configurationType(invoice.invoice_type),
          operation_mode: 'own_software',
          enablement_status: { in: [...allowed_statuses] },
        },
        select: { id: true },
        orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
      });
    return config?.id ?? null;
  }

  private async ensureSupportDocumentAccountsPayable(invoice: any) {
    if (!invoice.supplier_id) return null;

    const net_payable = Math.max(
      0,
      Number(invoice.total_amount || 0) -
        Number(invoice.withholding_amount || 0),
    );
    const issue_date = invoice.issue_date
      ? new Date(invoice.issue_date)
      : new Date();
    const due_date = invoice.due_date ? new Date(invoice.due_date) : issue_date;

    const existing = await this.prisma.accounts_payable.findFirst({
      where: {
        organization_id: invoice.organization_id,
        source_type: 'support_document',
        source_id: invoice.id,
      },
      select: { id: true },
    });

    const data = {
      organization_id: invoice.organization_id,
      store_id: invoice.store_id,
      supplier_id: invoice.supplier_id,
      source_type: 'support_document',
      source_id: invoice.id,
      document_number: invoice.invoice_number,
      original_amount: net_payable,
      balance: net_payable,
      currency: invoice.currency || 'COP',
      issue_date,
      due_date,
      status: net_payable > 0 ? 'open' : 'paid',
      notes: 'Generated from accepted electronic support document',
    };

    if (existing) {
      return this.prisma.accounts_payable.update({
        where: { id: existing.id },
        data,
      });
    }

    return this.prisma.accounts_payable.create({ data });
  }

  async validate(id: number) {
    const invoice = await this.getInvoice(id);
    this.validateTransition(invoice.status, 'validated');
    await this.assertFiscalPeriodOpen(
      invoice.accounting_entity_id,
      invoice.issue_date,
      'validate',
    );

    if (!invoice.invoice_items || invoice.invoice_items.length === 0) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_VALIDATE_001,
        'La factura no tiene ninguna línea. Agrega al menos un producto o servicio antes de validarla.',
      );
    }

    // PUERTA DE IDENTIDAD FISCAL DEL ADQUIRIENTE.
    //
    // Hasta acá `validate()` sólo contaba ítems: el módulo entero no tenía UNA
    // sola verificación del adquiriente, y los huecos los tapaban los builders
    // inventando `Consumidor Final` / `222222222222` / `Bogotá`. Eso no produce
    // un error, produce un documento legalmente emitido que declara datos que
    // nadie verificó.
    //
    // Se corta acá y no en `send()` porque `validated` es el último estado en
    // que el documento todavía se puede corregir sin nota. Los avisos NO
    // bloquean: son ausencias que hacen al documento decir menos, no decir algo
    // falso (ver la regla de severidad del validador).
    const identity = this.acquirerIdentity.validate(
      this.buildAcquirerIdentityInput(invoice),
    );

    if (!identity.emittable) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_VALIDATE_001,
        `No se puede validar el documento: ${identity.blockers[0].problem} ${identity.blockers[0].fix}`,
        {
          blockers: identity.blockers,
          warnings: identity.warnings,
        },
      );
    }

    for (const warning of identity.warnings) {
      this.logger.warn(
        `Invoice #${id} — ${warning.code} (${warning.field}): ${warning.problem}`,
      );
    }

    // PREVALIDACIÓN FISCAL — la segunda mitad de la misma puerta.
    //
    // La identidad juzga a QUIÉN se le factura; esto juzga QUÉ se declara: que
    // las cuentas cuadren como las recompone la DIAN (FAU14, TaxSubtotal,
    // PayableAmount), que la resolución respalde el consecutivo y que la ClTec
    // esté completa. Va DESPUÉS de la identidad a propósito: un adquiriente sin
    // identificar es el defecto más barato de corregir de los dos.
    //
    // Y va acá y no en `send()` porque después de `send()` el consecutivo ya se
    // gastó: el 14/08/2026 una ClTec de 38 caracteres hizo rechazar una factura
    // real y quemó un consecutivo autorizado que no se recupera.
    await this.assertFiscalDocumentEmittable(invoice);

    const updated = await this.prisma.invoices.update({
      where: { id },
      data: { status: 'validated' },
      include: INVOICE_INCLUDE,
    });

    this.logger.log(`Invoice #${id} (${updated.invoice_number}) validated`);
    return updated;
  }

  /**
   * Qué le falta a este documento para poder emitirse — SIN cambiar nada.
   *
   * Existe para que el usuario vea el problema mientras todavía está en el
   * formulario, en vez de descubrirlo al pulsar «Validar» o, peor, en el
   * rechazo de la DIAN. Es exactamente el mismo veredicto que aplica
   * `validate()`, producido por el mismo validador: una segunda lista de
   * requisitos escrita aparte se desincroniza el primer día.
   */
  async getEmitReadiness(id: number): Promise<EmitReadinessReport> {
    const invoice = await this.getInvoice(id);
    const identity = this.acquirerIdentity.validate(
      this.buildAcquirerIdentityInput(invoice),
    );
    const fiscal_document = await this.runFiscalDocumentPrevalidation(invoice);

    return {
      // Los campos de identidad siguen aplanados en la raíz: es el contrato que
      // ya consume el formulario y romperlo no aporta nada.
      ...identity,
      // …pero `emittable` pasa a ser el AND de las DOS puertas. Si sólo
      // reflejara la identidad, la pantalla diría «listo para emitir» sobre un
      // documento que `validate()` va a rechazar un clic después — que es
      // exactamente la desincronización que este endpoint existe para evitar.
      emittable: identity.emittable && (fiscal_document?.emittable ?? true),
      // Y las LISTAS aplanadas se unen por la misma razón. Aplanar sólo la
      // identidad mientras `emittable` mira las dos puertas produce el peor
      // desenlace posible para el usuario: «no se puede emitir» con la lista de
      // requisitos VACÍA, porque el bloqueante real (ClTec, aritmética,
      // resolución) vive en `fiscal_document` y el modal lee la raíz. Se
      // conservan `identity` y `fiscal_document` intactos abajo para quien
      // necesite distinguir de qué puerta vino cada hallazgo.
      findings: [...identity.findings, ...(fiscal_document?.findings ?? [])],
      blockers: [...identity.blockers, ...(fiscal_document?.blockers ?? [])],
      warnings: [...identity.warnings, ...(fiscal_document?.warnings ?? [])],
      identity,
      fiscal_document,
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      status: invoice.status,
      has_items: (invoice.invoice_items?.length ?? 0) > 0,
      valid_transitions: this.getValidTransitions(invoice.status),
      discard_route: DISCARD_ROUTES[invoice.status as InvoiceStatus],
    };
  }

  /**
   * ÚNICO PUNTO DE ESTE ARCHIVO DONDE LA ClTec ENTRA EN MEMORIA.
   *
   * `INVOICE_INCLUDE` ya NO la trae: publicarla en toda respuesta de facturación
   * la ponía en el navegador, y con la 14.ª entrada del hash del CUFE en la mano
   * se puede recomputar el fiscal key de cualquier documento emitido bajo esa
   * resolución. Pero el emisor sí la necesita —sin ella no hay CUFE—, así que en
   * vez de arrastrarla «por si acaso» se lee AQUÍ, donde se usa, y sólo con las
   * dos columnas que el vault necesita para abrirla.
   *
   * SE LEE POR LA FACTURA, NO POR `invoice_resolutions` DIRECTAMENTE, y eso es
   * deliberado: `invoices` es store-scoped y `invoice_resolutions` es
   * fiscal-entity-scoped, dos filtros de tenant DISTINTOS. Consultando por el
   * mismo `where: { id }` y el mismo accessor con el que ya se cargó el
   * documento, la fila que devuelve esta lectura es por construcción la misma
   * resolución que `resolveInvoiceControl` va a declarar. Preguntarle a la otra
   * tabla abriría la posibilidad de que un scope resolviera y el otro no, y una
   * ClTec `null` donde había una produce un CUFE mal calculado — el fallo del
   * 14/08/2026, que quema un consecutivo autorizado irrecuperable.
   *
   * NUNCA se registra el valor: los diagnósticos de este dominio reportan su
   * LONGITUD (ver `assertTechnicalKeyShape` y el rechazo de
   * `dian-direct.provider.ts`), nunca el secreto.
   *
   * @returns la ClTec en claro, o `null` si el documento no cuelga de una
   *   resolución o la resolución no tiene clave. `null` NO se disfraza de cadena
   *   vacía: quien la exige tiene que poder distinguir «no hay» de «hay pero
   *   está mal formada».
   */
  private async revealResolutionTechnicalKey(
    invoice_id: number,
  ): Promise<string | null> {
    const row = await this.prisma.invoices.findFirst({
      where: { id: invoice_id },
      select: {
        resolution: {
          select: {
            // Sólo las dos que el vault abre. La huella NO se lee: no sirve para
            // revelar y su única función es la correlación entre filas, que vive
            // en `fiscal-production-readiness.service.ts`.
            technical_key: true,
            technical_key_encrypted: true,
          },
        },
      },
    });

    // Por el vault, no por la columna: la copia cifrada es la que se escribe
    // hoy, y el emisor tiene que hashear la MISMA clave que el prevalidador
    // juzgó. Leer una y hashear la otra es el desajuste que rechazó una factura
    // en producción.
    return this.technicalKeyVault.reveal(row?.resolution);
  }

  /**
   * Corre el prevalidador fiscal sobre una factura ya cargada con
   * `INVOICE_INCLUDE`. Devuelve `null` cuando el `invoice_type` no tiene
   * traducción a documento fiscal: no hay nada que prevalidar contra la DIAN, y
   * dejar escapar el `Error` de `toFiscalDocumentType` lo degradaría a un
   * `SYS_INTERNAL_001` ("Error interno del servidor") delante del comerciante.
   */
  private async runFiscalDocumentPrevalidation(
    invoice: any,
  ): Promise<FiscalDocumentReport | null> {
    const document_type = this.resolveFiscalDocumentType(invoice);
    if (!document_type) return null;

    const timezone = await this.resolveTimezone(invoice);
    // MISMO resolutor de unidades que `send()`. Si el prevalidador juzgara una
    // unidad distinta de la que se va a emitir, aprobaría documentos que la
    // DIAN rechaza y al revés.
    const unit_code_by_item = await this.resolveLineUnitCodes(
      invoice.invoice_items || [],
    );
    // La ClTec ya no viaja en `INVOICE_INCLUDE` (ver `RESOLUTION_PUBLIC_SELECT`).
    // El prevalidador la exige: su regla `technical_key` es la que atrapó la
    // clave de 38 caracteres antes de gastar el consecutivo, y sin cargarla acá
    // esa regla se apagaría en silencio contra un `undefined` — el peor de los
    // desenlaces, porque el documento pasaría la puerta y lo rechazaría la DIAN.
    const technical_key = await this.revealResolutionTechnicalKey(invoice.id);

    return this.fiscalDocument.validate(
      this.buildFiscalDocumentInput(
        invoice,
        document_type,
        timezone,
        unit_code_by_item,
        technical_key,
      ),
    );
  }

  /**
   * Prevalidación como PUERTA: el mismo informe, pero lanzando.
   *
   * Los avisos no bloquean —son ausencias que hacen al documento decir menos,
   * no decir algo falso— pero sí se registran: son la lista de lo que hoy se
   * emite a medias.
   */
  private async assertFiscalDocumentEmittable(invoice: any): Promise<void> {
    const report = await this.runFiscalDocumentPrevalidation(invoice);
    if (!report) return;

    if (!report.emittable) {
      const blocker = this.pickLeadingBlocker(report.blockers);
      const error_code =
        InvoiceFlowService.PREVALIDATION_ERROR_CODES[blocker.category];

      throw new VendixHttpException(
        error_code,
        `No se puede validar el documento: ${blocker.problem} ${blocker.fix}`,
        {
          invoice_id: invoice.id,
          document_type: report.document_type,
          blockers: report.blockers,
          warnings: report.warnings,
          // Los importes que el XML REALMENTE va a declarar. Sin ellos, un
          // descuadre obliga a reconstruir a mano la aritmética del emisor.
          computed: report.computed,
        },
      );
    }

    for (const warning of report.warnings) {
      this.logger.warn(
        `Invoice #${invoice.id} — ${warning.code} (${warning.field}): ${warning.problem}`,
      );
    }
  }

  /** El bloqueante que redacta el mensaje (ver PREVALIDATION_CATEGORY_PRECEDENCE). */
  private pickLeadingBlocker(
    blockers: FiscalDocumentFinding[],
  ): FiscalDocumentFinding {
    for (const category of InvoiceFlowService.PREVALIDATION_CATEGORY_PRECEDENCE) {
      const match = blockers.find((finding) => finding.category === category);
      if (match) return match;
    }
    return blockers[0];
  }

  /**
   * `invoices.fiscal_document_type` manda; el `invoice_type` es el fallback
   * histórico (las filas anteriores a la columna no lo tienen). `null` = este
   * documento no se emite a la DIAN.
   */
  private resolveFiscalDocumentType(invoice: {
    fiscal_document_type?: string | null;
    invoice_type: string;
  }): FiscalDocumentType | null {
    if (
      invoice.fiscal_document_type &&
      isFiscalDocumentType(invoice.fiscal_document_type)
    ) {
      return invoice.fiscal_document_type;
    }
    try {
      return toFiscalDocumentType(invoice.invoice_type);
    } catch {
      return null;
    }
  }

  /**
   * Traduce la fila persistida al contrato del prevalidador, con la MISMA
   * precedencia con la que `send()` arma `provider_data`.
   *
   * Dos cosas que NO son cosméticas:
   *
   * - `price_unit_quantity` se gatea igual que en `send()`: sólo viaja cuando la
   *   cantidad está en unidad mínima. Si la línea se vendió por presentación,
   *   `unit_price` ya es el precio del paquete y volver a dividir declararía un
   *   importe N veces menor — y el prevalidador vería un descuadre inventado.
   * - `unit_code` se deja en `null` cuando no hay ninguno, en vez de rellenarlo
   *   con `EA`: el validador distingue «no declara unidad» (aviso, el emisor
   *   caerá a `EA` y eso en una línea por pieza es correcto) de «declara una
   *   unidad que no existe» (bloqueante, se emitiría `EA` tapando metros).
   */
  private buildFiscalDocumentInput(
    invoice: any,
    document_type: FiscalDocumentType,
    timezone: string,
    unit_code_by_item: Map<number, string>,
    /**
     * ClTec EN CLARO, ya revelada por el vault. Llega como parámetro y no se
     * lee de `invoice.resolution` porque esa relación ya no la trae: se carga
     * aparte, en el punto de uso (`revealResolutionTechnicalKey`). Obligatorio
     * a propósito —sin valor por defecto— para que un llamador nuevo no pueda
     * omitirla y apagar la regla `technical_key` del prevalidador sin notarlo.
     */
    technical_key: string | null,
  ): FiscalDocumentValidationInput {
    // El validador tiene que juzgar la MISMA línea que se va a emitir. Si el
    // emisor despeja el precio de una línea inclusiva y el validador no, el
    // gate aprueba un documento distinto del que viaja —o bloquea uno sano— y
    // deja de ser una puerta.
    const inclusive_overrides = this.resolveInclusiveLineOverrides(invoice);

    return {
      document_type,
      invoice_number: invoice.invoice_number,
      issue_date: invoice.issue_date,
      timezone,
      currency: invoice.currency,
      operation_type: invoice.operation_type,
      subtotal_amount: invoice.subtotal_amount,
      discount_amount: invoice.discount_amount,
      tax_amount: invoice.tax_amount,
      withholding_amount: invoice.withholding_amount,
      total_amount: invoice.total_amount,
      items: (invoice.invoice_items || []).map((item: any, index: number) => ({
        line_number: index + 1,
        description: item.description,
        quantity: item.quantity,
        unit_price:
          inclusive_overrides.get(item.id)?.unit_price ?? item.unit_price,
        discount_amount:
          inclusive_overrides.get(item.id)?.discount_amount ??
          item.discount_amount,
        tax_amount: item.tax_amount,
        price_unit_quantity: this.resolveEmittedPriceUnitQuantity(item),
        unit_code: item.unit_code ?? unit_code_by_item.get(item.id) ?? null,
        aiu_component: item.aiu_component ?? null,
      })),
      taxes: (invoice.invoice_taxes || []).map((tax: any) => ({
        tax_name: tax.tax_name,
        tax_type: tax.tax_type,
        tax_rate: tax.tax_rate,
        taxable_amount: tax.taxable_amount,
        tax_amount: tax.tax_amount,
      })),
      resolution: invoice.resolution
        ? {
            id: invoice.resolution.id,
            resolution_number: invoice.resolution.resolution_number,
            prefix: invoice.resolution.prefix,
            range_from: invoice.resolution.range_from,
            range_to: invoice.resolution.range_to,
            current_number: invoice.resolution.current_number,
            valid_from: invoice.resolution.valid_from,
            valid_to: invoice.resolution.valid_to,
            is_active: invoice.resolution.is_active,
            // La REVELADA por el vault, no `invoice.resolution.technical_key`:
            // esa propiedad ya no existe en el objeto cargado —
            // `RESOLUTION_PUBLIC_SELECT` la excluye a propósito para que el
            // secreto no viaje en ninguna respuesta— y leerla devuelve
            // `undefined`, con lo que la regla `technical_key` del prevalidador
            // bloqueaba TODA factura de venta con `TECHNICAL_KEY_REQUIRED`
            // aunque la resolución tuviera su clave de 40 hex bien guardada.
            technical_key,
          }
        : null,
    };
  }

  /**
   * Arma lo que el validador va a juzgar, con la MISMA precedencia con la que
   * `send()` arma `provider_data`: ficha viva del cliente → snapshot de la
   * factura → proveedor (documento soporte). Si el gate juzgara otros datos que
   * los que se emiten, aprobaría documentos que la DIAN rechaza y viceversa.
   *
   * ## De dónde sale `identification_mode`
   *
   * El validador lo exige sin valor por defecto, a propósito: es la pieza que
   * convierte al Consumidor Final en una decisión en vez de un fallback. Hoy la
   * factura no tiene columna donde declararlo, así que la decisión se deriva
   * acá, explícita y en un solo sitio: un documento SIN cliente asociado y SIN
   * identificación persistida es una venta de mostrador —el carril legítimo del
   * POS (§D del plan)—; cualquier otra cosa es nominativa y tiene que
   * identificar a su adquiriente.
   *
   * La derivación es correcta pero implícita: mientras el emisor no pueda
   * declarar el modo, no hay forma de distinguir «venta a consumidor final» de
   * «se me olvidó poner el cliente». Una columna `invoices.acquirer_mode`
   * cerraría esa ambigüedad; queda anotada, no adivinada.
   */
  private buildAcquirerIdentityInput(
    invoice: any,
  ): CustomerFiscalIdentityInput {
    const customer = invoice.customer
      ? toCustomerInvoiceData(invoice.customer)
      : undefined;

    const document_number =
      customer?.customer_tax_id ??
      invoice.customer_tax_id ??
      invoice.supplier?.tax_id ??
      null;

    const mode: AcquirerIdentificationMode =
      !invoice.customer_id && !document_number && !invoice.supplier_id
        ? 'final_consumer'
        : 'nominative';

    // `invoice.customer_address` es JSONB y el histórico guardó ahí tanto un
    // objeto como una cadena suelta. Una cadena es la línea de dirección y nada
    // más: no trae municipio ni país, y hay que dejar que el validador lo
    // reporte en vez de leer propiedades de un `string` y obtener `undefined`
    // silencioso en cada campo.
    const raw_address =
      customer?.customer_address ??
      invoice.customer_address ??
      invoice.supplier?.addresses?.[0] ??
      null;
    const address =
      typeof raw_address === 'string'
        ? { address_line: raw_address }
        : (raw_address as Record<string, any> | null);

    return {
      identification_mode: mode,
      document_type:
        customer?.customer_document_type ??
        invoice.customer_document_type ??
        invoice.supplier?.document_type ??
        null,
      document_number,
      verification_digit:
        customer?.customer_verification_digit ??
        invoice.customer_verification_digit ??
        invoice.supplier?.verification_digit ??
        null,
      person_type: customer?.customer_person_type ?? null,
      legal_name:
        customer?.customer_name ??
        invoice.customer_name ??
        invoice.supplier?.name ??
        null,
      first_name: invoice.customer?.first_name ?? null,
      last_name: invoice.customer?.last_name ?? null,
      tax_regime:
        customer?.customer_regime ??
        invoice.customer_tax_regime ??
        invoice.supplier?.tax_regime ??
        null,
      tax_responsibilities:
        customer?.customer_tax_responsibilities ??
        (Array.isArray(invoice.customer_fiscal_responsibilities)
          ? (invoice.customer_fiscal_responsibilities as string[])
          : null),
      email: customer?.customer_email ?? invoice.customer_email ?? null,
      phone: customer?.customer_phone ?? invoice.customer_phone ?? null,
      address: address
        ? {
            address_line: address.address_line1 ?? address.address_line ?? null,
            // `municipality_code` es el DANE de 5 dígitos; el departamento son
            // sus dos primeros. No se inventa: si el municipio no está, el
            // departamento tampoco, y el validador lo reporta.
            city_code: address.municipality_code ?? address.city_code ?? null,
            city_name: address.city ?? address.city_name ?? null,
            department_code:
              address.department_code ??
              (address.municipality_code
                ? String(address.municipality_code).slice(0, 2)
                : null),
            department_name:
              address.state_province ?? address.department_name ?? null,
            country_code: address.country_code ?? null,
            postal_code: address.postal_code ?? null,
          }
        : null,
    };
  }

  /**
   * Código UN/ECE por línea, resuelto contra la ESCALA de la cantidad que la
   * línea declara — no contra la unidad de stock del producto.
   *
   * La distinción no es cosmética: la DIAN valida la coherencia entre cantidad
   * y unidad. Un cable cuyo stock vive en milímetros vendido como "3 metros"
   * lleva `quantity = 3`; declararlo con la unidad de stock diría "3
   * milímetros" y describiría una venta 1.000 veces menor que la real.
   *
   * Tres casos, en este orden:
   * 1. Línea vendida por presentación (`stock_units_consumed` presente): la
   *    cantidad cuenta presentaciones. Si el factor de la presentación coincide
   *    con una unidad del catálogo en la misma dimensión —"Metro" = 1.000 mm—
   *    se declara esa unidad (`MTR`). Si no coincide con ninguna —"Caja x12" de
   *    un producto contable, "Rollo 20 m"— se declara `EA`: son 3 paquetes, y
   *    ningún código de longitud describe eso sin mentir.
   * 2. Sin presentación: la cantidad ya está en la unidad mínima, así que la
   *    unidad de stock es coherente (`3000` + `MMT`).
   * 3. Producto sin unidad de stock declarada: `EA`, y es CORRECTO — el producto
   *    se cuenta por unidades. Se escribe en el mapa EXPLÍCITAMENTE, no se deja
   *    ausente: es la diferencia entre "resolví que son unidades" y "no pude
   *    resolverlo", que es justo lo que el emisor necesita distinguir.
   *
   * Dos consultas para toda la factura —productos y catálogo— en vez de una
   * por línea.
   *
   * ═══ QUÉ SIGNIFICA UNA LÍNEA AUSENTE DEL MAPA ═══
   * Que NO se pudo resolver, y entonces el emisor rechaza el documento
   * (`DIAN_UNIT_CODE_001`) en vez de rellenar con `EA`. Sólo ocurre en dos
   * casos, ambos anómalos:
   *   · el producto de la línea no es legible desde el documento (fila ausente
   *     o fuera del alcance del tenant), luego su unidad es desconocida;
   *   · la unidad SÍ existe en `units_of_measure` pero no tiene equivalencia
   *     UN/ECE en `uom-uncefact.util.ts` — un catálogo que creció sin actualizar
   *     la tabla. Antes eso se emitía como `EA` en silencio.
   * La línea SIN producto (texto libre) ni siquiera entra aquí: el emisor le
   * pone `EA`, que para ella es la unidad correcta.
   *
   * ═══ POR QUÉ YA NO HAY `catch {}` ═══
   * Había uno, vacío, con el argumento de que "la factura se emite con `EA` en
   * vez de no emitirse". Pero `@unitCode` es un campo que la DIAN valida contra
   * catálogo y contra la cantidad: un fallo de lectura convertía TODA la factura
   * en un documento que declara piezas donde hubo kilos, aceptado e
   * irreversible. Y al tragarse el error, impedía siquiera diagnosticarlo. Ahora
   * se registra con `logger.error` y se lanza `DIAN_UNIT_CODE_002` (503): la
   * emisión es reintentable, un documento falso ante la DIAN no.
   */
  private async resolveLineUnitCodes(
    items: Array<{
      id: number;
      product_id?: number | null;
      quantity?: any;
      stock_units_consumed?: number | null;
    }>,
  ): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    const productIds = Array.from(
      new Set(
        items
          .map((i) => i.product_id)
          .filter((id): id is number => typeof id === 'number'),
      ),
    );
    if (productIds.length === 0) return out;

    try {
      const products = await this.prisma.products.findMany({
        where: { id: { in: productIds } },
        select: { id: true, stock_uom_id: true },
      });

      /**
       * Productos LEÍDOS que no declaran unidad de stock. Se cuentan por
       * unidades, así que su `EA` está resuelto, no inventado. El conjunto se
       * construye antes de cualquier otra lectura porque es la respuesta
       * completa cuando NINGÚN producto de la factura tiene unidad — el caso de
       * la inmensa mayoría del histórico.
       */
      const productsWithoutUnit = new Set<number>(
        products
          .filter((p: any) => p.stock_uom_id == null)
          .map((p: any) => Number(p.id)),
      );

      const uomIds: number[] = Array.from(
        new Set(
          products
            .map((p: any) => p.stock_uom_id)
            .filter((id: any): id is number => typeof id === 'number'),
        ),
      );
      if (uomIds.length === 0) {
        for (const item of items) {
          if (item.product_id == null) continue;
          if (productsWithoutUnit.has(item.product_id)) out.set(item.id, 'EA');
        }
        return out;
      }

      const stockUnits = await this.prisma.units_of_measure.findMany({
        where: { id: { in: uomIds } },
        select: { id: true, code: true, dimension: true, factor_to_base: true },
      });
      const stockUnitById = new Map<
        number,
        { code: string; dimension: string; factor: number }
      >(
        stockUnits.map((u: any) => [
          Number(u.id),
          {
            code: String(u.code),
            dimension: String(u.dimension),
            // El factor de la unidad de STOCK, que es lo que traduce la escala
            // de la presentación a unidades BASE de la dimensión.
            factor: Number(u.factor_to_base ?? 1) || 1,
          },
        ]),
      );

      // El catálogo de una dimensión son unas pocas filas; traerlo entero
      // evita una consulta por escala distinta dentro de la misma factura.
      const dimensions = Array.from(
        new Set(Array.from(stockUnitById.values()).map((u) => u.dimension)),
      );
      const siblings = await this.prisma.units_of_measure.findMany({
        where: { dimension: { in: dimensions as any } },
        select: { code: true, dimension: true, factor_to_base: true },
      });
      /** `dimension|factor` → código del catálogo con ese factor exacto. */
      const codeByScale = new Map<string, string>(
        siblings.map((u: any) => [
          `${u.dimension}|${Number(u.factor_to_base)}`,
          String(u.code),
        ]),
      );

      const stockUnitByProduct = new Map<
        number,
        { code: string; dimension: string; factor: number } | null
      >(
        products.map((p: any) => [
          p.id,
          p.stock_uom_id != null
            ? (stockUnitById.get(p.stock_uom_id) ?? null)
            : null,
        ]),
      );

      for (const item of items) {
        if (item.product_id == null) continue;

        // Producto legible pero SIN unidad de stock: se cuenta por unidades y
        // `EA` es la declaración correcta. Se escribe en el mapa para que el
        // emisor sepa que está resuelto y no lo confunda con un fallo.
        if (productsWithoutUnit.has(item.product_id)) {
          out.set(item.id, 'EA');
          continue;
        }

        const stockUnit = stockUnitByProduct.get(item.product_id);
        // Ausente ⇒ el producto no se pudo leer, o su unidad no tiene código
        // UN/ECE. No se inventa: la línea queda fuera del mapa y el emisor
        // rechaza el documento nombrándola.
        if (!stockUnit) continue;

        const quantity = Number(item.quantity ?? 0);
        const consumed = item.stock_units_consumed;
        if (consumed != null && quantity > 0) {
          // `consumed / quantity` da la escala en unidades de STOCK; el catálogo
          // indexa por `factor_to_base`, que está en unidades BASE. Multiplicar
          // por el factor de la unidad de stock es lo que hace conmensurables
          // las dos: con la unidad mínima como unidad de stock (factor 1) la
          // conversión es la identidad, pero con `cm` como unidad de stock una
          // presentación de 3 m daba `300 / 3 = 100`, ninguna unidad de longitud
          // tiene factor 100, y la línea caía a `EA` — "3 unidades" donde se
          // vendieron 3 metros, justo el error que este resolutor evita.
          const scale = (Number(consumed) / quantity) * stockUnit.factor;
          const scaleCode = codeByScale.get(`${stockUnit.dimension}|${scale}`);
          if (!scaleCode) {
            // La escala no corresponde a ninguna unidad del catálogo: son N
            // paquetes ("Caja x12", "Rollo 20 m") y `EA` los describe sin
            // mentir. Resuelto, no inventado.
            out.set(item.id, 'EA');
            continue;
          }
          // `Strict`: si la unidad del catálogo no tiene equivalencia UN/ECE se
          // deja la línea SIN resolver en vez de degradarla a `EA`.
          const scaleUnece = resolveUneceUnitCodeStrict(scaleCode);
          if (scaleUnece) out.set(item.id, scaleUnece);
          continue;
        }
        const unece = resolveUneceUnitCodeStrict(stockUnit.code);
        if (unece) out.set(item.id, unece);
      }
    } catch (error) {
      // Ya NO se traga el error. Ver el bloque "POR QUÉ YA NO HAY `catch {}`"
      // de la cabecera: emitir toda la factura con `EA` porque falló una
      // lectura produce un documento falso ante la DIAN, e irreversible.
      this.logger.error(
        `resolveLineUnitCodes: fallo al leer el catálogo de unidades para ${productIds.length} producto(s) ` +
          `de ${items.length} línea(s). El documento NO se emite con unidades inventadas.`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new VendixHttpException(
        ErrorCodes.DIAN_UNIT_CODE_002,
        'No se pudo consultar el catálogo de unidades de medida para determinar la unidad (unitCode) de las líneas del documento. ' +
          'Es un fallo temporal de lectura, no un dato mal capturado: vuelve a intentar el envío en unos segundos. ' +
          'Si persiste, repórtalo — el documento no se emite con unidades inventadas.',
        { product_count: productIds.length, item_count: items.length },
      );
    }
    return out;
  }

  /**
   * PUERTA: ninguna línea con producto puede llegar al XML con una unidad
   * inventada.
   *
   * Es la contraparte de `resolveLineUnitCodes`. Aquella devuelve un mapa donde
   * la AUSENCIA significa "no se pudo resolver"; ésta convierte esa ausencia en
   * un rechazo con nombre y apellido en vez de dejar que el `?? 'EA'` del
   * armador la tape.
   *
   * TRES fuentes se consideran resueltas, en este orden:
   *   1. `invoice_items.unit_code` — el SNAPSHOT persistido al crear el
   *      documento. Manda sobre todo lo demás y cubre el histórico reciente.
   *   2. la resolución en vivo contra el catálogo (el mapa).
   *   3. la línea SIN `product_id` — texto libre, flete, ajuste: `EA` es su
   *      unidad correcta, no un relleno.
   *
   * ═══ POR QUÉ ESTO NO ROMPE FACTURAS HISTÓRICAS LEGÍTIMAS ═══
   * Se pensó como alternativa a fallar siempre, y es deliberadamente estrecha.
   * Una factura anterior al snapshot sigue emitiéndose sin fricción: su producto
   * se lee, y tenga unidad de stock o no (la mayoría del histórico no la tiene)
   * el resolutor le escribe un valor. Sólo se rechaza lo que de verdad no se
   * puede declarar sin mentir:
   *   · el producto de la línea no es legible desde el documento;
   *   · su unidad de catálogo no tiene equivalencia UN/ECE.
   * Ambas son anomalías de datos que exigen intervención humana, y ninguna se
   * arregla emitiendo `EA`.
   *
   * El error nombra las líneas afectadas —no "una línea"— porque el operador
   * necesita saber cuál producto revisar.
   */
  private assertLineUnitCodesResolved(
    invoice: { id: number; invoice_items?: any[] | null },
    unitCodeByItem: Map<number, string>,
  ): void {
    const unresolved = (invoice.invoice_items || []).filter(
      (item: any) =>
        item?.product_id != null &&
        !item?.unit_code &&
        !unitCodeByItem.has(item.id),
    );
    if (unresolved.length === 0) return;

    const labels = unresolved
      .slice(0, 5)
      .map(
        (item: any) =>
          `"${item.description ?? `línea #${item.id}`}" (producto #${item.product_id})`,
      )
      .join(', ');
    const overflow =
      unresolved.length > 5 ? ` y ${unresolved.length - 5} más` : '';

    this.logger.error(
      `Invoice #${invoice.id}: ${unresolved.length} línea(s) sin unidad de medida resoluble ` +
        `(ids ${unresolved.map((i: any) => i.id).join(', ')}). Emisión bloqueada.`,
    );

    throw new VendixHttpException(
      ErrorCodes.DIAN_UNIT_CODE_001,
      `No se puede determinar la unidad de medida (unitCode) de ${unresolved.length} línea(s) del documento: ` +
        `${labels}${overflow}. La DIAN valida esa unidad contra su catálogo y contra la cantidad, así que el ` +
        `documento no se emite con una unidad de relleno. Revisa en Productos que cada uno de esos artículos ` +
        `exista en esta tienda y tenga una unidad de stock válida, y vuelve a enviar.`,
      {
        invoice_id: invoice.id,
        unresolved_item_ids: unresolved.map((item: any) => item.id),
        unresolved_product_ids: unresolved.map((item: any) => item.product_id),
      },
    );
  }

  /**
   * `store_settings.settings.invoicing.aiu` — la MISMA lectura que hace
   * `InvoicingService.loadAiuSettings`. Se duplica en vez de compartirse porque
   * importar `InvoicingService` desde aquí cierra un ciclo de módulos
   * (`InvoicingService` ya depende de este flujo).
   */
  private async loadAiuSettings(
    store_id: number | bigint | null,
  ): Promise<AiuSettings> {
    if (store_id == null) return {};

    // `findFirst`, no `findUnique`: la extensión de scoping mezcla el filtro de
    // tenant y un WhereUnique no admite el `AND` resultante.
    const row = await this.prisma.store_settings.findFirst({
      where: { store_id: Number(store_id) },
      select: { settings: true },
    });

    const settings = row?.settings as Record<string, any> | null;
    const aiu = settings?.invoicing?.aiu;
    return aiu && typeof aiu === 'object' ? (aiu as AiuSettings) : {};
  }

  /**
   * Contexto AIU del documento que se va a emitir, o `null` cuando no es un
   * contrato AIU — que es el 100 % del histórico y no cuesta ninguna lectura.
   *
   * LANZA si el objeto del contrato falta o no cabe en la cota de CAV03. No es
   * una omisión cosmética: la regla valida el `cbc:Note` de la línea de
   * Administración y un documento AIU sin esa nota se rechaza CON el consecutivo
   * ya gastado. `InvoicingService` valida lo mismo al crear; acá se vuelve a
   * comprobar porque la configuración pudo cambiar entre la creación y el envío,
   * y porque la nota no se persiste en ninguna columna del documento.
   */
  private async resolveAiuEmissionContext(invoice: {
    id: number;
    store_id: number | bigint | null;
    operation_type?: string | null;
    aiu_contract_object?: string | null;
    aiu_regime?: string | null;
    aiu_minimum_percent?: Prisma.Decimal | null;
  }): Promise<AiuEmissionContext | null> {
    const operation_type = (invoice.operation_type || '').trim();
    if (operation_type !== DIAN_INVOICE_OPERATION_TYPES.AIU) return null;

    const settings = await this.loadAiuSettings(invoice.store_id);
    // EL SNAPSHOT DEL DOCUMENTO MANDA.
    //
    // `invoices.aiu_contract_object` guarda el objeto con el que se validó la
    // nota al capturar. Leer sólo la configuración de la tienda hacía que un
    // cambio de configuración entre la captura y el envío emitiera un documento
    // describiendo un contrato distinto del que se facturó — y con varios
    // contratos AIU vivos, que es el caso normal de una empresa de servicios,
    // TODOS salían con la misma descripción.
    //
    // La configuración sigue siendo el respaldo: cubre las facturas anteriores
    // a la columna y a quien factura un único contrato.
    const contract_object =
      (invoice.aiu_contract_object || '').trim() ||
      (settings.contract_object || '').trim();
    // MISMA función que usó la creación: las dos cadenas no pueden divergir.
    const note = buildAiuNote(contract_object);

    if (
      note.length < DIAN_AIU_NOTE_MIN_LENGTH ||
      note.length > DIAN_AIU_NOTE_MAX_LENGTH
    ) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_AIU_002,
        `No se puede emitir el contrato AIU: el objeto del contrato falta o no tiene la longitud que ` +
          `exige la DIAN. La nota de la línea de Administración debe medir entre ` +
          `${DIAN_AIU_NOTE_MIN_LENGTH} y ${DIAN_AIU_NOTE_MAX_LENGTH} caracteres contando el prefijo ` +
          `obligatorio «${DIAN_AIU_NOTE_PREFIX}». Descríbelo en el campo «Objeto del contrato» de la ` +
          `factura o, si es siempre el mismo, en la configuración de facturación de la tienda.`,
        {
          invoice_id: invoice.id,
          note_length: note.length,
          has_contract_object: !!contract_object,
        },
      );
    }

    const regime = this.resolveAiuRegimeForEmission(invoice, settings);

    // EL PISO SALE DEL SNAPSHOT, con la misma precedencia y por la misma razón
    // que el régimen. Sólo rige bajo `et_462_1` —el Decreto 1372/1992 no fija
    // ninguno sobre la utilidad del constructor— y el default es ACTIVO: en el
    // ajuste de la tienda sólo se apaga declarando `false`, así que la ausencia
    // no significa "sin piso".
    const minimum_percent =
      regime.regime !== 'et_462_1'
        ? null
        : invoice.aiu_minimum_percent != null
          ? new Prisma.Decimal(invoice.aiu_minimum_percent)
          : settings.enforce_minimum_base === false
            ? null
            : new Prisma.Decimal(settings.minimum_base_percent ?? 10);

    return { ...regime, minimum_percent, note };
  }

  /**
   * Régimen con el que se va a construir el XML, y de dónde salió.
   *
   * EL SNAPSHOT DEL DOCUMENTO MANDA, por la misma razón que manda para el
   * objeto del contrato, y con más consecuencia. El régimen no describe el
   * documento: decide, línea por línea, cuál emite `cac:TaxTotal` y cuál no
   * (`attachAiuLineExtras` → `omit_tax_total`). Los IMPORTES, en cambio, salen
   * de los tributos ya persistidos. Las dos mitades tienen que venir del mismo
   * régimen o el XML declara una gravabilidad que no corresponde a los números
   * que lleva dentro: una línea con impuesto persistido a la que se le suprime
   * el `cac:TaxTotal` descuadra el total contra la suma de líneas (FAU04), y
   * una línea sin impuesto a la que se le permite emitirlo hereda el `Percent`
   * de la cabecera (FAX01). Los dos son rechazo, y el consecutivo ya se gastó.
   *
   * Orden de precedencia y por qué:
   *
   *   1. `invoices.aiu_regime` — el régimen con el que se calcularon estos
   *      importes. Es el único dato que no puede contradecirlos.
   *   2. `store_settings.invoicing.aiu.regime` — respaldo para las facturas
   *      anteriores a la columna. Se avisa en el log, porque es precisamente la
   *      lectura viva que el snapshot vino a reemplazar.
   *   3. `'et_462_1'` — el MISMO default que usa la creación. Que las dos
   *      puntas caigan al mismo valor es lo que hace consistente a la tienda
   *      que nunca configuró AIU; cambiarlo por un rechazo acá rompería un
   *      camino que hoy funciona y funciona bien, porque `et_462_1` declara MÁS
   *      IVA: de más es recuperable, de menos es sanción.
   *
   * La columna se sigue llamando `aiu_regime` por compatibilidad, pero lo que
   * guarda es la BASE GRAVABLE declarada, y `'subtotal'` es un valor legal en
   * ella: es la base que declina el tratamiento AIU y no tiene régimen legal al
   * que colapsar. El nombre de la columna es exactamente la confusión que
   * produjo los defectos de esta ventana —código que preguntaba «¿qué régimen?»
   * donde la pregunta ya era «¿qué porción del contrato grava?»—, así que leer
   * `aiu_regime` como si sólo pudiera contener un régimen es el error a no
   * repetir. `KNOWN`, abajo, es la lista completa y son TRES.
   *
   * Un valor desconocido en la columna NO cae al default: se rechaza. Es el
   * único caso realmente irresoluble —el documento afirma una base y ninguna de
   * las tres conocidas es— y adivinar entre tres bases incompatibles cambia el
   * IVA declarado sin dejar rastro de que se adivinó. Entre `'aiu'` y
   * `'subtotal'` la diferencia es de un orden de magnitud: el 10 % del contrato
   * contra el 100 %.
   */
  private resolveAiuRegimeForEmission(
    invoice: { id: number; aiu_regime?: string | null },
    settings: AiuSettings,
  ): Pick<AiuEmissionContext, 'regime' | 'regime_source'> {
    const KNOWN: readonly AiuRegimeSnapshot[] = [
      'et_462_1',
      'decreto_1372_1992',
      'subtotal',
    ];
    const frozen = (invoice.aiu_regime || '').trim();

    if (frozen) {
      if (!KNOWN.includes(frozen as AiuRegimeSnapshot)) {
        throw new VendixHttpException(
          ErrorCodes.INVOICING_AIU_006,
          `La factura declara una base gravable AIU que el sistema no reconoce ` +
            `(«${frozen}»). No se emite: las tres bases válidas gravan partes distintas del ` +
            `contrato —E.T. art. 462-1 grava Administración + Imprevistos + Utilidad, Decreto ` +
            `1372/1992 grava sólo la Utilidad, Subtotal declina el AIU y grava el contrato ` +
            `completo— y elegir una por defecto cambiaría el IVA declarado. Corrige la base en ` +
            `la configuración de facturación de la tienda y vuelve a guardar la factura.`,
          { invoice_id: invoice.id, declared_regime: frozen, known: KNOWN },
        );
      }
      return { regime: frozen as AiuRegimeSnapshot, regime_source: 'snapshot' };
    }

    if (settings.regime) {
      this.logger.warn(
        `Factura ${invoice.id}: contrato AIU sin régimen congelado. Se usa el ajuste VIVO de la ` +
          `tienda («${settings.regime}») para decidir qué líneas emiten cac:TaxTotal. Es una ` +
          `factura anterior a invoices.aiu_regime: si el ajuste cambió después de que se ` +
          `calcularon sus importes, la gravabilidad del XML puede no corresponder a los tributos ` +
          `persistidos.`,
      );
      return { regime: settings.regime, regime_source: 'settings' };
    }

    this.logger.warn(
      `Factura ${invoice.id}: contrato AIU sin régimen congelado y sin configuración AIU en la ` +
        `tienda. Se usa el default conservador «et_462_1», el mismo que aplicó la creación, que ` +
        `grava el AIU completo y por tanto declara de más antes que de menos.`,
    );
    return { regime: 'et_462_1', regime_source: 'default' };
  }

  /**
   * ¿La línea entra a la base gravable del IVA bajo el régimen declarado?
   *
   * D.9 — deja de tener lógica propia: convierte `regime` a
   * `AiuTaxableBasis` (`taxableBasisFromRegime`, o `'subtotal'` directo,
   * que no es un régimen) y delega en `isAiuLineTaxable`
   * (`invoice-profile-config.contract.ts`), la MISMA función que usa
   * `InvoiceCalculatorService.isAiuTaxable` —el que produjo los importes
   * persistidos que este método verifica al emitir.
   *
   * Este docblock decía «espeja» al calculador cuando en realidad era una
   * segunda implementación escrita a mano: D.4 corrigió el calculador para
   * `component === 'contrato'` bajo `'utilidad'` y esta función se quedó
   * atrás, devolviendo `false` para el mismo caso. La factura entraba
   * correctamente gravada (impuesto persistido) y este método, en la última
   * compuerta antes de firmar, la rechazaba con `INVOICING_AIU_005` — un
   * ciclo irrompible porque el defecto estaba en la LECTURA, no en el dato.
   * Con una sola función no hay una segunda lectura que pueda quedarse atrás.
   */
  private isAiuComponentTaxable(
    component: string | null,
    regime: AiuRegimeSnapshot,
  ): boolean {
    const basis: AiuTaxableBasis =
      regime === 'subtotal' ? 'subtotal' : taxableBasisFromRegime(regime);
    return isAiuLineTaxable(component as AiuLineComponent | null, basis);
  }

  /**
   * Marca las líneas del payload con lo que el AIU cambia en el XML.
   *
   * · `omit_tax_total` — la línea NO emite `cac:TaxTotal` (regla CAX01). Es
   *   distinto de «no tiene impuestos»: un bien EXENTO sí lo emite, con
   *   `cbc:Percent` en 0,00. Por eso viaja como bandera y no se deduce de que el
   *   importe sea cero.
   * · `note` — sólo la línea de ADMINISTRACIÓN, y con el literal exacto de
   *   CAV03.
   *
   * `aiu_component` NO viaja crudo: `UblDocumentLine` no lo declara y ningún
   * builder lo lee. Su única función en la emisión es decidir estas dos cosas,
   * que son las que el documento realmente declara.
   */
  private attachAiuLineExtras(
    lines: UblDocumentLine[],
    rows: any[],
    aiu: AiuEmissionContext,
  ): void {
    lines.forEach((line, index) => {
      const component = (rows[index]?.aiu_component ?? null) as string | null;
      line.omit_tax_total = !this.isAiuComponentTaxable(component, aiu.regime);
      if (component === 'administracion') {
        line.note = aiu.note;
      }
    });
  }

  /**
   * ¿Dice el XML lo mismo que los importes que lleva dentro?
   *
   * Es la última compuerta antes de firmar, y cubre el descuadre que ninguna de
   * las dos mitades puede ver sola. La gravabilidad por línea la acaba de
   * decidir el RÉGIMEN (`attachAiuLineExtras` → `omit_tax_total`); los IMPORTES
   * salen de los tributos PERSISTIDOS al crear el documento. Cada mitad es
   * internamente coherente, así que ni el calculador ni el builder detectan que
   * se contradicen entre sí:
   *
   * · Línea que CALLA su grupo pero trae impuesto persistido ⇒ el
   *   `cac:TaxTotal` de línea desaparece del XML mientras el importe sigue
   *   dentro del `cac:TaxTotal` de cabecera y del `cbc:PayableAmount`. FAU04
   *   contrasta el total contra la suma de las líneas: descuadre, rechazo.
   *
   * · Línea que EMITE su grupo —o sea que ENTRA a la base gravable, tenga
   *   componente AIU o sea el costo reembolsable bajo `subtotal`— y no trae
   *   impuesto ⇒ es la sub-declaración que `INVOICING_AIU_004` corta al
   *   capturar. Acá se
   *   vuelve a comprobar porque las facturas creadas ANTES de ese bloqueo
   *   siguen en la base —la 83 entre ellas— y emitirlas ahora produciría
   *   exactamente el documento que la DIAN acepta con menos IVA del debido.
   *
   * Se rechaza en vez de corregir por la misma razón que en el piso legal: los
   * importes ya están persistidos y son los que el cliente vio y firmó. Cambiar
   * uno en el camino a la firma emitiría un documento distinto del que existe en
   * la base, y el descuadre reaparecería entre la factura y su contabilidad.
   */
  private assertAiuLineTaxCoherence(
    invoice: { id: number; invoice_number?: string | null },
    lines: UblDocumentLine[],
    aiu: AiuEmissionContext,
  ): void {
    lines.forEach((line, index) => {
      const declared = (line.taxes ?? []).length > 0;
      const amount = new Prisma.Decimal(line.tax_amount ?? 0);

      if (line.omit_tax_total && (declared || !amount.isZero())) {
        throw new VendixHttpException(
          ErrorCodes.INVOICING_AIU_005,
          `No se puede emitir la factura ${invoice.invoice_number ?? invoice.id}: la línea ` +
            `${index + 1} («${line.description}») lleva un impuesto de ${amount.toFixed(2)} ` +
            `persistido, pero bajo ${describeAiuRegime(aiu.regime)}, con el que se emite ` +
            `(tomado ${
              aiu.regime_source === 'snapshot'
                ? 'de la propia factura'
                : `del ajuste de la tienda por procedencia «${aiu.regime_source}»`
            }) ese componente NO hace parte de la base gravable, así que la línea no puede ` +
            `declarar su impuesto en el XML. El importe quedaría en el total del documento sin ` +
            `respaldo en ninguna línea y la DIAN rechaza el descuadre. Los importes de la factura ` +
            `se calcularon con un régimen distinto del que se está usando ahora: recalcula la ` +
            `factura guardándola de nuevo, o corrige el régimen de AIU antes de emitir.`,
          {
            invoice_id: invoice.id,
            line_index: index,
            regime: aiu.regime,
            regime_source: aiu.regime_source,
            persisted_tax_amount: amount.toFixed(2),
          },
        );
      }

      // `!omit_tax_total` es el ÚNICO predicado, y significa «esta línea entra a
      // la base gravable» — no «esta línea es un componente A/I/U».
      //
      // La distinción dejó de ser académica con la base `'subtotal'`: ahí
      // `isAiuComponentTaxable(null, …)` devuelve **true**, así que la línea SIN
      // componente —el costo reembolsable, que suele ser el 90 % del contrato—
      // SÍ emite su grupo y SÍ tiene que declarar impuesto. Bajo `et_462_1` y
      // `decreto_1372_1992` esa misma línea calla, y entonces `omit_tax_total`
      // ya la excluye de esta comprobación sin necesidad de preguntar por el
      // componente. Un segundo predicado (`component !== null`) sería una
      // segunda derivación del mismo hecho, y es exactamente la que se separó de
      // la primera en el calculador: allí la divergencia de captura lo exigía y
      // por eso el documento de 100 M bajo `'subtotal'` se capturaba sin una
      // sola divergencia y moría acá, con el consecutivo ya gastado.
      if (!line.omit_tax_total && !declared) {
        throw new VendixHttpException(
          ErrorCodes.INVOICING_AIU_004,
          `No se puede emitir la factura ${invoice.invoice_number ?? invoice.id}: la línea ` +
            `${index + 1} («${line.description}») es una porción del contrato que ` +
            `${describeAiuRegime(aiu.regime)} SÍ grava y no declara ningún impuesto. ` +
            `La DIAN aceptaría el ` +
            `documento declarando menos IVA del debido, y el faltante sólo se corregiría ` +
            `después con nota crédito. Corrige la factura declarando el impuesto de esa línea ` +
            `con su tarifa —o con tarifa 0 si el servicio es exento— antes de emitirla.`,
          {
            invoice_id: invoice.id,
            line_index: index,
            regime: aiu.regime,
            regime_source: aiu.regime_source,
          },
        );
      }
    });
  }

  /**
   * Re-verifica el piso legal del AIU ANTES de firmar.
   *
   * `InvoicingService.recalculateDocument` ya lo comprueba al crear y al editar,
   * y lanza `INVOICING_AIU_001`. Se vuelve a comprobar acá por la misma razón
   * por la que se re-comprueba la nota CAV03 unas líneas más arriba: entre la
   * captura y la transmisión pueden pasar días, y en el intervalo cambia lo que
   * la comprobación original no vio. Concretamente, el piso se mide contra el
   * VALOR DEL CONTRATO, que es la suma de TODAS las líneas —incluida la porción
   * de costo reembolsable, que no lleva componente AIU—; añadir o quitar una
   * línea de costo mueve el piso sin tocar ninguna línea de AIU. La creación no
   * puede anticipar eso.
   *
   * Se mide con `dianLineExtension`, la MISMA función con la que el builder
   * escribe cada `cbc:LineExtensionAmount`, y no con los importes persistidos:
   * lo que tiene que cumplir el piso es el documento que se va a firmar, no una
   * aproximación suya.
   *
   * Rechaza en vez de inflar la base. El AIU es un valor PACTADO en el contrato
   * y subirlo por cuenta propia cambiaría la cifra que el cliente firmó; dejarlo
   * pasar produce una factura que la DIAN ACEPTA declarando menos IVA del
   * debido, con el faltante apareciendo después con sanción e intereses.
   */
  private assertAiuMinimumBase(
    invoice: {
      id: number;
      invoice_number?: string | null;
      invoice_items?: Array<{ aiu_component?: string | null }> | null;
    },
    lines: UblDocumentLine[],
    aiu: AiuEmissionContext,
  ): void {
    if (aiu.minimum_percent === null) return;

    const rows = invoice.invoice_items || [];
    const contract_value = toDecimal(
      dianSum(lines.map((line) => dianLineExtension(line))),
    );
    const aiu_value = toDecimal(
      dianSum(
        lines
          .filter((_line, index) => !!rows[index]?.aiu_component)
          .map((line) => dianLineExtension(line)),
      ),
    );
    const minimum = toDecimal(
      dianAmount(contract_value.times(aiu.minimum_percent).dividedBy(100)),
    );

    if (aiu_value.greaterThanOrEqualTo(minimum)) return;

    throw new VendixHttpException(
      ErrorCodes.INVOICING_AIU_001,
      `No se puede emitir la factura ${invoice.invoice_number ?? invoice.id}: el AIU declarado ` +
        `(${aiu_value.toFixed(2)}) quedó por debajo del mínimo legal de ${minimum.toFixed(2)}, ` +
        `que es el ${aiu.minimum_percent.toFixed(2)}% del valor del contrato ` +
        `(${contract_value.toFixed(2)}) exigido por el artículo 462-1 del Estatuto Tributario. ` +
        `El valor del contrato incluye las líneas de costo reembolsable, así que agregar costo sin ` +
        `subir el AIU baja la proporción: sube el AIU, o si el contrato es de construcción de bien ` +
        `inmueble cambia el régimen —bajo el Decreto 1372/1992 la base es sólo la utilidad y este ` +
        `piso no aplica—.`,
      {
        invoice_id: invoice.id,
        aiu_value: aiu_value.toFixed(2),
        minimum_base: minimum.toFixed(2),
        contract_value: contract_value.toFixed(2),
        minimum_percent: aiu.minimum_percent.toFixed(2),
        regime_source: aiu.regime_source,
      },
    );
  }

  /**
   * Puebla los tributos DE CADA LÍNEA del payload que va al emisor UBL.
   *
   * Hay DOS fuentes posibles y se prefieren en este orden:
   *
   *   1. **El desglose PERSISTIDO** (`invoice_taxes.invoice_item_id`). Es el
   *      dato real: quién grava qué lo decidió el motor al crear el documento,
   *      no se deduce de nada. Ver `attachPersistedLineTaxes`.
   *   2. **La reconstrucción por subconjuntos**, para el histórico. Todos los
   *      documentos anteriores a la columna guardan sus tributos agregados por
   *      cabecera y no hay a quién preguntarle: se deduce enumerando
   *      combinaciones. Ver `attachReconstructedLineTaxes`.
   *
   * El segundo camino NO se borra ni se degrada: es lo único que sirve a las
   * facturas ya emitidas, que se reenvían tal cual años después.
   */
  private attachLineTaxes(
    lines: UblDocumentLine[],
    rows: any[],
    header_taxes: any[],
  ): void {
    if (this.attachPersistedLineTaxes(lines, rows, header_taxes)) return;
    this.attachReconstructedLineTaxes(lines, rows, header_taxes);
  }

  /**
   * La *price unit* que el emisor VA A DECLARAR para esta línea, o `undefined`.
   *
   * Existe como función y no como expresión repetida porque la condición tiene
   * dos consumidores que ya divergieron una vez —el mapeo del proveedor y el del
   * prevalidador— y un tercero nuevo (`resolveInclusiveLineOverrides`) que
   * DESPEJA el precio dividiendo por ella. Si los tres no usan exactamente el
   * mismo divisor, el precio despejado no reproduce el importe de la línea y el
   * documento se contradice a sí mismo, que es justo lo que FAV06 rechaza.
   *
   * La condición: `unit_price` es el precio de N unidades de stock sólo cuando
   * la cantidad está EN unidad de stock. Si la línea se vendió por presentación
   * (`stock_units_consumed` presente), `quantity` cuenta paquetes y `unit_price`
   * ya es el precio del paquete: volver a dividir declararía un importe N veces
   * menor.
   */
  private resolveEmittedPriceUnitQuantity(item: any): string | undefined {
    return item?.stock_units_consumed == null &&
      Number(item?.price_unit_quantity) > 1
      ? String(item.price_unit_quantity)
      : undefined;
  }

  /**
   * Precio y descuento DESPEJADOS de cada línea cuyo precio LLEVA EL IMPUESTO
   * DENTRO, indexados por `invoice_items.id`.
   *
   * ## El defecto que cierra
   *
   * Con `invoice_items.is_inclusive = true` el precio capturado es el que paga
   * el cliente: $1.000 con IVA 19 % son $840,34 de base y $159,66 de cuota. El
   * emisor escribía `cbc:LineExtensionAmount = cantidad × precio − descuento`,
   * o sea los $1.000 BRUTOS, así que `TaxExclusiveAmount` cargaba el IVA por
   * dentro y `PayableAmount` sobrestimaba la venta en el impuesto entero
   * ($1.159,66 por una venta de $1.000). El prevalidador local los frenaba con
   * `HEADER_LINE_EXTENSION_MISMATCH` —por eso ninguno alcanzó a quemar
   * consecutivo—, pero el efecto neto es que NINGUNA tienda que venda con
   * impuesto incluido podía facturar electrónicamente.
   *
   * ## Por qué no basta con corregir el importe de la línea
   *
   * La regla de rechazo **FAV06** (Anexo 1.9, pág. 443-444) valida
   * `cbc:LineExtensionAmount` contra el `cbc:PriceAmount` **de su propia
   * línea**, no contra el total de la cabecera. Bajar sólo el importe dejaría
   * el precio unitario bruto arriba y el neto abajo: un documento internamente
   * contradictorio, rechazado por la línea misma. Hay que despejar el PRECIO —
   * y por eso `cac:Price/cbc:PriceAmount` se emite con `dianPriceAmount`, que
   * deriva el precio del importe ya neto (`importe ÷ cantidad`) y usa los 0-6
   * decimales que ese campo admite y ningún otro importe monetario. La igualdad
   * que cierra es `PriceAmount × BaseQuantity − descuentos = LineExtensionAmount`,
   * donde `BaseQuantity` es la CANTIDAD facturada; la evidencia completa está en
   * `UblCommonBuilder.resolveBaseQuantity`.
   *
   * ## De dónde sale la base gravable
   *
   * Se RECIBE, no se recalcula. `invoice_taxes.taxable_amount` es lo que el
   * motor de cálculo escribió al crear la factura, y es la misma cifra que
   * sumada da `invoices.subtotal_amount`. Despejarla acá otra vez —dividiendo
   * por (1 + tarifa)— produciría una segunda verdad que puede diferir un
   * centavo de la persistida, y entonces la Σ de las líneas ya no sería la
   * cabecera que la DIAN contrasta (FAU14).
   *
   * Sin desglose por línea (histórico, sin `invoice_taxes.invoice_item_id`) la
   * base se deriva del propio ítem: `bruto − impuesto de la línea`. Es exacta
   * por construcción, porque el bruto inclusivo ES base + impuesto.
   *
   * Una línea con dos filas de tributo que declaran BASES DISTINTAS se deja
   * fuera: no hay un precio único que reproduzca dos bases, y elegir una sería
   * inventar. Cae al comportamiento anterior, que el prevalidador seguirá
   * frenando — visible, no silencioso.
   */
  private resolveInclusiveLineOverrides(
    invoice: any,
  ): Map<number, DianClearedLineAmounts> {
    const overrides = new Map<number, DianClearedLineAmounts>();
    const items: any[] = invoice?.invoice_items || [];
    // El 100 % del histórico y de las tiendas con precio sin impuesto entra
    // por acá: sin una sola línea inclusiva no se recorre nada.
    if (!items.some((item) => item?.is_inclusive === true)) return overrides;

    /** `invoice_items.id` → base persistida, o `null` si sus filas discrepan. */
    const base_by_item = new Map<number, string | null>();
    for (const tax of invoice?.invoice_taxes || []) {
      if (tax?.invoice_item_id == null) continue;
      const item_id = Number(tax.invoice_item_id);
      const base = dianAmount(tax.taxable_amount);
      if (!base_by_item.has(item_id)) {
        base_by_item.set(item_id, base);
        continue;
      }
      const seen = base_by_item.get(item_id);
      if (seen !== null && seen !== base) base_by_item.set(item_id, null);
    }

    for (const item of items) {
      if (item?.is_inclusive !== true) continue;

      const line = {
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_amount: item.discount_amount,
        price_unit_quantity: this.resolveEmittedPriceUnitQuantity(item),
      };

      const persisted = base_by_item.has(Number(item.id))
        ? base_by_item.get(Number(item.id))
        : undefined;
      if (persisted === null) {
        this.logger.warn(
          `Line ${item.id} prices tax-inclusive but its persisted taxes declare different taxable bases; ` +
            `the line keeps its gross amount rather than clearing it against a base that is not unique`,
        );
        continue;
      }

      const taxable_base =
        persisted ??
        toDecimal(dianLineExtension(line)).minus(toDecimal(item.tax_amount));

      const cleared = clearInclusiveLine({ ...line, taxable_base });
      if (!cleared) {
        this.logger.warn(
          `Line ${item.id} prices tax-inclusive but its taxable base ${dianAmount(taxable_base)} is not ` +
            `usable against its gross ${dianLineExtension(line)}; the line is emitted unchanged and the ` +
            `pre-validator will stop the document before it spends a consecutive`,
        );
        continue;
      }

      overrides.set(Number(item.id), cleared);
    }

    return overrides;
  }

  /**
   * Usa el desglose por línea PERSISTIDO, cuando el documento lo tiene.
   *
   * ## Qué cuenta como "lo tiene"
   *
   * TODAS las filas de tributo del documento apuntan a una línea. La condición
   * es deliberadamente todo-o-nada: un documento con unas filas vinculadas y
   * otras de cabecera tendría DOS verdades sobre el mismo impuesto —el agregado
   * y el desglose— y sumarlas duplicaría el `cac:TaxTotal`. Por eso
   * `InvoicingService` escribe una forma o la otra, nunca las dos, y acá se
   * verifica antes de creerle. Con la condición rota se devuelve `false` y el
   * documento cae a la reconstrucción, que es el comportamiento previo.
   *
   * ## Tres guardas por línea, y por qué ninguna sobra
   *
   * · **Línea sin filas** ⇒ se deja sin desglose. No es lo mismo que "no tiene
   *   impuestos": el emisor la resolverá por su camino histórico, exactamente
   *   como hasta hoy. Inventarle un tributo cero con el esquema de otra línea
   *   sería peor que no decir nada.
   * · **La base persistida tiene que coincidir con la que el emisor va a
   *   escribir** (`dianLineExtension`), y la suma de las cuotas con el impuesto
   *   de la línea. Las dos cifras se calcularon en momentos distintos y por
   *   caminos distintos —el motor al crear, `dianLineExtension` al emitir— y hay
   *   al menos un caso real donde divergen: una línea con `stock_units_consumed`
   *   hace que el emisor OMITA `price_unit_quantity`, así que su base no es la
   *   que el motor usó. Emitir el desglose igual dejaría un `cac:TaxSubtotal`
   *   en desacuerdo con el `cbc:LineExtensionAmount` de su propia línea, que es
   *   un XML internamente contradictorio: peor que un desglose ausente.
   *
   * ## `is_inclusive`: ya no hay exclusión que levantar
   *
   * Estas líneas estuvieron excluidas mientras el emisor escribía el bruto en
   * `cbc:LineExtensionAmount`: declarar ahí la base despejada dejaba la línea
   * diciendo una base y su importe diciendo otra. Desde
   * `resolveInclusiveLineOverrides` la línea llega YA DESPEJADA —precio y
   * descuento sin impuesto— así que `dianLineExtension` devuelve la base
   * gravable y la guarda de coincidencia de abajo la valida sola, sin caso
   * especial. Una línea inclusiva que no se pudiera despejar tampoco cuadra
   * ahí, y cae a la reconstrucción exactamente igual que antes.
   */
  private attachPersistedLineTaxes(
    lines: UblDocumentLine[],
    rows: any[],
    header_taxes: any[],
  ): boolean {
    // Se clasifican las retenciones con la MISMA función del emisor: una
    // retención infiltrada en `invoice_taxes` por el camino legacy de
    // `dto.taxes[]` no es un tributo del documento y nunca llevó línea.
    const document_rows = (header_taxes || []).filter(
      (tax: any) =>
        !UblCommonBuilder.isWithholdingTax({
          tax_name: tax.tax_name,
          tax_rate: dianRate(tax.tax_rate),
          taxable_amount: dianAmount(tax.taxable_amount),
          tax_amount: dianAmount(tax.tax_amount),
          tax_type: tax.tax_type ?? undefined,
        }),
    );

    if (document_rows.length === 0) return false;
    // Todo-o-nada: basta una fila sin vínculo para que el documento sea
    // "de cabecera" y haya que reconstruirlo entero.
    if (document_rows.some((tax: any) => tax.invoice_item_id == null)) {
      return false;
    }
    if (lines.length !== rows.length) return false;

    /** `invoice_items.id` → tributos que esa línea declara. */
    const taxes_by_item = new Map<number, ProviderInvoiceTax[]>();
    for (const tax of document_rows) {
      const item_id = Number(tax.invoice_item_id);
      const bucket = taxes_by_item.get(item_id) ?? [];
      bucket.push({
        tax_name: tax.tax_name,
        tax_rate: dianRate(tax.tax_rate),
        taxable_amount: dianAmount(tax.taxable_amount),
        tax_amount: dianAmount(tax.tax_amount),
        tax_type: tax.tax_type ?? undefined,
      });
      taxes_by_item.set(item_id, bucket);
    }

    const tolerance = toDecimal(ONE_CENT);

    lines.forEach((line, index) => {
      const row = rows[index];
      const persisted = taxes_by_item.get(Number(row?.id));
      if (!persisted || persisted.length === 0) return;

      // La base que el emisor VA A ESCRIBIR, no la que la fila afirma: son dos
      // cálculos distintos y sólo la primera llega a la DIAN.
      const emitted_base = dianAmount(dianLineExtension(line));
      const base_matches = persisted.every((tax) =>
        toDecimal(tax.taxable_amount).equals(toDecimal(emitted_base)),
      );
      if (!base_matches) {
        this.logger.warn(
          `Line ${index + 1} persisted tax base does not match the ${emitted_base} the emitter writes in ` +
            `cbc:LineExtensionAmount; the line keeps the document's primary tax rather than emitting a ` +
            `TaxSubtotal that contradicts its own line`,
        );
        return;
      }

      // La suma de las cuotas tiene que ser el impuesto de la línea: es lo que
      // hace que la Σ de las líneas siga siendo la cabecera que la DIAN
      // contrasta (FAS01b).
      const total = toDecimal(dianSum(persisted.map((tax) => tax.tax_amount)));
      if (total.minus(toDecimal(line.tax_amount)).abs().greaterThan(tolerance)) {
        this.logger.warn(
          `Line ${index + 1} persisted taxes add up to ${total.toFixed(2)} but the line declares ` +
            `${line.tax_amount}; the breakdown is not emitted to avoid a header/line mismatch`,
        );
        return;
      }

      line.taxes = persisted;
    });

    return true;
  }

  /**
   * Reconstruye los tributos DE CADA LÍNEA a partir de los tributos de cabecera.
   *
   * ## Por qué hay que reconstruirlos
   *
   * Los documentos ANTERIORES a `invoice_taxes.invoice_item_id` —y los que se
   * siguen escribiendo con un solo tributo— persisten sus tributos agregados por
   * cabecera. El builder, en cambio, escribe un `cac:TaxSubtotal`
   * por cada tributo de la línea, y sin desglose cae al camino histórico —
   * heredar el PRIMER tributo del documento—. En una factura mixta IVA + INC eso
   * hace que TODAS las líneas declaren el esquema de la primera: una cuenta de
   * restaurante sale entera como IVA 19 % o entera como INC 8 %, y la DIAN
   * recompone los impuestos desde lo que recibe.
   *
   * Este camino NO se puede borrar aunque el vínculo persistido ya exista: las
   * facturas ya emitidas se reenvían tal cual, y las suyas nunca van a tener
   * `invoice_item_id`.
   *
   * ## Cómo se reconstruye SIN inventar
   *
   * Cada línea persistida conoce su base (`dianLineExtension`, exactamente el
   * importe que el builder escribe en `cbc:LineExtensionAmount`) y su impuesto
   * (`invoice_items.tax_amount`). Con eso se enumeran los subconjuntos de
   * tributos de cabecera y se busca el que reproduce el impuesto de la línea al
   * centavo. Se acepta ÚNICAMENTE cuando hay exactamente UN subconjunto que
   * cuadra; con cero o con varios la línea se deja sin desglose y el builder
   * vuelve a su camino histórico. No se elige "el más probable": una elección
   * ambigua emitiría un esquema fiscal que nadie verificó, que es peor que el
   * defecto conocido.
   *
   * Cada tributo emitido SALE de una fila de cabecera, así que el
   * `cbc:Percent`/`cbc:Name`/`cbc:ID` de la línea coincide por construcción con
   * el `cac:TaxTotal` de cabecera, que es lo que compara la regla FAS01b.
   *
   * ## Dos exclusiones deliberadas
   *
   * · **Documento con un solo tributo** — el camino histórico ya produce
   *   EXACTAMENTE el mismo XML (misma base, mismo importe, mismo esquema), así
   *   que no se toca: cero riesgo, cero beneficio.
   * · **Línea con precio impuesto-incluido** (`invoice_items.is_inclusive`) — su
   *   base gravable NO es `dianLineExtension` sino esa cifra despejada hacia
   *   atrás, mientras que el builder sigue emitiendo la primera en
   *   `cbc:LineExtensionAmount`. Declarar acá la base despejada dejaría el
   *   `TaxSubtotal` de la línea en desacuerdo con su propio
   *   `LineExtensionAmount`. Es un defecto anterior y ajeno a este paso; se
   *   documenta y no se agrava. Ver la nota extensa de
   *   `attachPersistedLineTaxes`: el vínculo persistido tampoco lo levanta,
   *   porque el problema no es identificar el tributo sino la base que el
   *   emisor escribe.
   */
  private attachReconstructedLineTaxes(
    lines: UblDocumentLine[],
    rows: any[],
    header_taxes: any[],
  ): void {
    const candidates: ProviderInvoiceTax[] = (header_taxes || [])
      .map((tax: any) => ({
        tax_name: tax.tax_name,
        tax_rate: dianRate(tax.tax_rate),
        taxable_amount: dianAmount(tax.taxable_amount),
        tax_amount: dianAmount(tax.tax_amount),
        tax_type: tax.tax_type ?? undefined,
      }))
      // Una RETENCIÓN infiltrada en `invoice_taxes` (el DTO legacy lo permite)
      // no es un tributo del documento: tiene su propio grupo y no puede sumar
      // al `TaxAmount` que la DIAN contrasta. Se clasifica con la MISMA función
      // que usa el builder para filtrarlas.
      .filter((tax) => !UblCommonBuilder.isWithholdingTax(tax));

    if (
      candidates.length < 2 ||
      candidates.length > LINE_TAX_MAX_CANDIDATES ||
      lines.length !== rows.length
    ) {
      return;
    }

    // Divisor POR TRIBUTO, no uno fijo: el ICA se guarda por mil (7 significa
    // 7 ‰ = 0,7 %) y el emisor lo divide por 10 antes de escribir `cbc:Percent`.
    // Con un `/100` para todos, la cuota de ICA sale diez veces mayor, ningún
    // subconjunto cuadra y TODA factura con ICA pierde el desglose de línea sin
    // más síntoma que un `warn`. Se clasifica con la misma función del emisor.
    const divisors = candidates.map((tax) =>
      UblCommonBuilder.resolveTaxCodeFromTax(tax) === DIAN_TAX_CODES.ICA
        ? toDecimal(1000)
        : toDecimal(100),
    );
    const tolerance = toDecimal(ONE_CENT);
    const last_mask = (1 << candidates.length) - 1;

    lines.forEach((line, index) => {
      const base = toDecimal(dianLineExtension(line));
      if (!base.greaterThan(0)) return;

      const declared = toDecimal(line.tax_amount);

      let match: ProviderInvoiceTax[] | null = null;
      let ambiguous = false;

      for (let mask = 1; mask <= last_mask; mask++) {
        // Se conservan los ÍNDICES, no sólo los tributos: el divisor de cada uno
        // vive en `divisors` en la misma posición, y un `filter` sobre
        // `candidates` la perdería.
        const chosen_indexes: number[] = [];
        for (let i = 0; i < candidates.length; i++) {
          if ((mask >> i) & 1) chosen_indexes.push(i);
        }
        const chosen = chosen_indexes.map((i) => candidates[i]);
        // Se trunca CADA cuota antes de sumar, igual que el XML: la DIAN
        // recompone el documento sobre los importes que recibe, no sobre la
        // precisión plena que los originó.
        const amounts = chosen_indexes.map((i) =>
          toDecimal(
            dianAmount(
              base
                .times(toDecimal(candidates[i].tax_rate))
                .dividedBy(divisors[i]),
            ),
          ),
        );
        const total = amounts.reduce(
          (acc, amount) => acc.plus(amount),
          toDecimal(0),
        );
        if (total.minus(declared).abs().greaterThan(tolerance)) continue;

        if (match) {
          ambiguous = true;
          break;
        }
        match = chosen.map((tax, i) => ({
          ...tax,
          taxable_amount: dianAmount(base),
          tax_amount: dianAmount(amounts[i]),
        }));
      }

      if (ambiguous || !match) {
        this.logger.warn(
          `Line ${index + 1} tax breakdown is not reconstructible from the ${candidates.length} header taxes ` +
            `(${ambiguous ? 'several combinations match' : 'none matches'} ${declared.toFixed(2)}); ` +
            `the line inherits the document's primary tax, which may declare the wrong DIAN scheme`,
        );
        return;
      }

      line.taxes = match;
    });
  }

  /**
   * `cac:PaymentExchangeRate` — la DECLARACIÓN de la conversión cuando la
   * operación se pactó en divisa.
   *
   * **NO cambia la moneda del documento.** La factura electrónica colombiana se
   * emite siempre en pesos (Res. DIAN 000042/2020 art. 73; Oficios 901544 y
   * 903436 de 2020; Concepto 1509 de 2024): `cbc:DocumentCurrencyCode` y todos
   * los `@currencyID` siguen en COP. Este grupo es el único sitio donde la
   * divisa aparece.
   *
   * LANZA cuando el documento declara divisa y no tiene tasa. Es el punto exacto
   * donde tiene que fallar: `InvoicingService` degrada a propósito si la TRM no
   * responde al crear («el error sólo lo lanza quien necesite la tasa para
   * emitir»), y emitir en silencio produciría una factura que dice haberse
   * pactado en dólares sin decir a cuánto — irreparable sin nota crédito. Una
   * tasa inventada sería peor: un valor en pesos que no corresponde a la
   * operación.
   */
  private buildExchangeRateDeclaration(
    invoice: any,
  ): DianExchangeRateDeclaration | undefined {
    const foreign_currency = (invoice.foreign_currency || '')
      .trim()
      .toUpperCase();
    if (!foreign_currency || foreign_currency === 'COP') return undefined;

    const rate = toDecimal(invoice.exchange_rate);
    // `equals(1)` también se rechaza, pero NO por FAR03 —esa regla gobierna
    // `cbc:SourceCurrencyBaseRate`, que este emisor omite deliberadamente (ver
    // `UblCommonBuilder.buildPaymentExchangeRate`)—. Se rechaza porque una tasa
    // de 1 peso por unidad de divisa no es una conversión: es un documento que
    // declara moneda extranjera y a la vez afirma que no hay diferencia con el
    // peso. Se contradice a sí mismo, y el error es casi siempre una tasa que
    // nunca se cargó.
    if (!rate.greaterThan(0) || rate.equals(1)) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_TRM_001,
        `No se puede emitir el documento: está pactado en ${foreign_currency} pero no tiene tasa de cambio. ` +
          `La DIAN exige declarar cuántos pesos vale una unidad de la divisa (cac:PaymentExchangeRate). ` +
          `Escribe la tasa en el documento o vuelve a intentarlo cuando la TRM oficial esté disponible.`,
        {
          invoice_id: invoice.id,
          foreign_currency,
          exchange_rate: invoice.exchange_rate ?? null,
          exchange_rate_date: invoice.exchange_rate_date ?? null,
        },
      );
    }

    // Los valores FIJOS del grupo —FAR02 `SourceCurrencyCode=COP`, FAR05
    // `TargetCurrencyBaseRate=1.00` y la ausencia deliberada de FAR03— NO se
    // declaran acá: los emite `UblCommonBuilder.buildPaymentExchangeRate`, que
    // es donde vive la regla. Un productor que los repita es un productor que
    // puede equivocarlos, y FAR03 en particular RECHAZA el valor `1.00`, que es
    // exactamente el que invita a escribir un campo llamado «base rate».
    return {
      // FAR04 — la divisa destino es la que el operador eligió al crear la
      // factura, ya normalizada a mayúsculas arriba.
      foreign_currency,
      // FAR06 — PESOS POR UNA UNIDAD de la divisa. El sentido es el opuesto al
      // que uno escribiría espontáneamente: invertirlo declara una operación
      // miles de veces menor sin que ninguna regla lo note.
      rate: dianAmount(rate),
      // FAR07 — `exchange_rate_date` es `@db.Date`: Prisma la devuelve a
      // medianoche UTC y es una fecha-sólo, no un instante. Convertirla a la
      // zona de la tienda la correría al día anterior —el off-by-one clásico—,
      // así que se lee por sus componentes UTC, que es donde el valor
      // realmente está. Ausente se deja `undefined`, no cadena vacía: el
      // builder omite el elemento, y un `<cbc:Date/>` vacío no es un
      // `xsd:date` válido —fallo de esquema, antes de cualquier regla.
      date: invoice.exchange_rate_date
        ? new Date(invoice.exchange_rate_date).toISOString().slice(0, 10)
        : undefined,
    };
  }

  async send(id: number) {
    const invoice = await this.getInvoice(id);
    await this.assertInvoicingAreaActive(invoice);
    this.validateTransition(invoice.status, 'sent');
    await this.assertFiscalPeriodOpen(
      invoice.accounting_entity_id,
      invoice.issue_date,
      'send',
    );
    if (this.isSupportDocumentType(invoice.invoice_type)) {
      this.assertSupportDocumentReady(invoice);
    }

    const timezone = await this.resolveTimezone(invoice);

    // Unidad real de cada línea: la DIAN valida que la cantidad y su unidad
    // digan lo mismo, y desde que una ferretería factura metros el `EA` fijo
    // declararía "3 unidades" donde se vendieron 3 metros.
    const unitCodeByItem = await this.resolveLineUnitCodes(
      invoice.invoice_items || [],
    );

    // PUERTA: ninguna línea con producto viaja con una unidad inventada. Se
    // corre en el primer punto posible del envío —antes de resolver AIU,
    // retenciones o el consecutivo— porque rechazar acá es recuperable y
    // rectificar ante la DIAN un documento ya aceptado no lo es.
    this.assertLineUnitCodesResolved(invoice, unitCodeByItem);

    // Contrato AIU: régimen de base gravable + nota legal de la línea de
    // Administración. `null` en todo documento que no sea AIU, que es el 100 %
    // del histórico y no cuesta ninguna lectura.
    const aiu = await this.resolveAiuEmissionContext(invoice);

    const is_support_document = this.isSupportDocumentType(invoice.invoice_type);

    // RETENCIONES — se resuelven ANTES de transmitir porque el
    // `cac:WithholdingTaxTotal` del documento se construye con ellas, y las
    // MISMAS líneas se persisten después de la aceptación. Resolverlas dos veces
    // (una para el XML y otra para el asiento) permitiría que el documento
    // emitido y la contabilidad declararan retenciones distintas.
    //
    // NO restan de `cbc:PayableAmount` (Anexo 1.9 §11.9.1) — vale para los tres
    // roles, autorretención incluida. Restarlas rompe `base + impuestos = total`
    // y el documento se rechaza por descuadre aritmético.
    const withholding_batches = await this.resolveWithholdingBatches(
      invoice,
      is_support_document,
    );
    const withholding_lines = withholding_batches.flatMap(
      (batch) => batch.resolution.lines,
    );

    if (
      withholding_lines.length === 0 &&
      Number(invoice.withholding_amount || 0) > 0
    ) {
      // El agregado que la factura muestra no se pudo descomponer. No bloquea:
      // el importe no viaja al XML por ninguna vía (la DIAN valida los totales
      // sin mirar el grupo de retenciones), pero el documento saldrá sin
      // declararlas y el asiento no tendrá con qué postearlas.
      this.logger.warn(
        `Invoice #${id} declares withholding_amount=${invoice.withholding_amount} but no withholding line ` +
          `could be resolved; the document will be emitted without cac:WithholdingTaxTotal`,
      );
    }

    // Step 8 — customer-side wiring for the provider payload.
    //
    // The customer_* fields used to read directly from `invoice.supplier`
    // (the EMISOR's document_type/tax_regime — see the historical bug the
    // plan documents), so the UBL builder emitted the issuer's ID under
    // `cac:AccountingCustomerParty` for every invoice.
    //
    // Today the data path is:
    //   invoice.customer ──► toCustomerInvoiceData() ──► customer_*
    // `INVOICE_INCLUDE` (above) loads the customer row + primary address, the
    // adapter does the 1:1 mapping to `ProviderInvoiceData.customer_*`, and
    // `dian-direct.provider.ts:buildCustomerData` consumes the result. Each
    // hop is a no-op on `invoice.customer` being null: sales invoices always
    // have a customer, support documents don't — the support-document branch
    // below keeps the historical supplier-fallback so the existing
    // support-document fixture (no customer row) still passes its assertions.
    const customerFieldsFromAdapter = invoice.customer
      ? toCustomerInvoiceData(invoice.customer)
      : {};
    // Documento soporte: NO tiene `customer` (la contraparte es el
    // `supplier`). El comportamiento histórico copiaba `supplier.document_type`
    // y `supplier.tax_regime` a los campos `customer_*` para que el builder UBL
    // recibiera datos. Lo preservamos AQUÍ para no romper el spec del support
    // document, pero SOLO en este branch; ventas (donde sí hay customer) ya no
    // toca supplier.
    const supportDocSupplierFallback =
      !invoice.customer && invoice.supplier
        ? {
            customer_document_type:
              invoice.supplier.document_type || undefined,
            customer_regime: invoice.supplier.tax_regime || undefined,
            customer_verification_digit:
              invoice.supplier.verification_digit || undefined,
          }
        : {};
    const customerFields = {
      ...customerFieldsFromAdapter,
      ...supportDocSupplierFallback,
    };

    // Las líneas del payload se arman APARTE y antes que el resto porque los
    // tributos por línea se reconstruyen sobre la base que estas mismas líneas
    // declaran (`dianLineExtension`). Derivarla de la fila de la base de datos
    // en vez de la línea ya construida permitiría que la base con la que se
    // calcula el impuesto y la que viaja en `cbc:LineExtensionAmount` no fueran
    // la misma cifra.
    // Líneas con precio impuesto-incluido: se despejan ANTES de armarlas, para
    // que `dianLineExtension` —y con él el `cbc:LineExtensionAmount` que viaja,
    // el `ValFac` del CUFE y la base de los tributos por línea— hablen de la
    // base gravable y no del bruto. Ver `resolveInclusiveLineOverrides`.
    const inclusive_overrides = this.resolveInclusiveLineOverrides(invoice);

    const provider_items: UblDocumentLine[] = (invoice.invoice_items || []).map(
      (item: any) => ({
        description: item.description,
        // Quantity keeps its own scale: UBL InvoicedQuantity is not a monetary
        // value and fractional units (1.5 kg) must survive.
        quantity: item.quantity.toString(),
        // El precio despejado conserva SUS decimales (hasta 6): es el único
        // campo monetario del UBL que los admite, y truncarlo a 2 devolvería el
        // descuadre que FAV06 rechaza. Sin despeje, el precio de siempre.
        unit_price:
          inclusive_overrides.get(item.id)?.unit_price ??
          dianAmount(item.unit_price),
        discount_amount:
          inclusive_overrides.get(item.id)?.discount_amount ??
          dianAmount(item.discount_amount),
        tax_amount: dianAmount(item.tax_amount),
        total_amount: dianAmount(item.total_amount),
        // El SNAPSHOT manda sobre la resolución en vivo. `invoice_items.unit_code`
        // congela la unidad que se emitió, así que un reenvío años después
        // declara lo mismo aunque el producto haya cambiado de unidad de stock
        // entretanto — y la DIAN recomputa el documento sobre lo que recibe, no
        // sobre el catálogo de hoy.
        //
        // El `?? 'EA'` final ya NO es un relleno: `assertLineUnitCodesResolved`
        // acaba de garantizar que sólo llega hasta aquí la línea SIN producto —
        // texto libre, flete, ajuste— donde "cada" es la unidad correcta. Toda
        // línea con producto o llega resuelta, o el documento no se emite.
        unit_code: item.unit_code ?? unitCodeByItem.get(item.id) ?? 'EA',
        // Escala de precio de la línea. Misma función que usa el despeje
        // inclusivo y el prevalidador: tres divisores distintos sobre la misma
        // línea producen tres importes distintos.
        price_unit_quantity: this.resolveEmittedPriceUnitQuantity(item),
      }),
    );

    // Multi-impuesto por línea: sin esto, en una factura mixta IVA + INC todas
    // las líneas heredan el esquema del PRIMER tributo de la cabecera.
    this.attachLineTaxes(
      provider_items,
      invoice.invoice_items || [],
      invoice.invoice_taxes || [],
    );

    if (aiu) {
      this.attachAiuLineExtras(provider_items, invoice.invoice_items || [], aiu);
      // PUERTA, justo después de decidir qué líneas callan su grupo de tributos
      // y ANTES de firmar. Ver `assertAiuLineTaxCoherence`.
      this.assertAiuLineTaxCoherence(invoice, provider_items, aiu);
      this.assertAiuMinimumBase(invoice, provider_items, aiu);
    }

    // ClTec: lectura APARTE y en el punto de uso. Ya no viaja en
    // `INVOICE_INCLUDE` —publicarla mandaba la 14.ª entrada del hash del CUFE al
    // navegador en cada respuesta—, así que se carga aquí, contra la MISMA
    // factura y por el mismo accessor con el que se cargó el documento.
    //
    // Se resuelve ANTES de armar `provider_data` y no dentro del literal porque
    // el literal es síncrono; y no se registra su valor en ningún log ni
    // `details`: quien la necesita diagnosticar mira su longitud, que es lo que
    // ya hace `dian-direct.provider.ts` al rechazar una clave mal formada.
    const resolution_technical_key = await this.revealResolutionTechnicalKey(id);

    // Build provider data from invoice
    const provider_data: DianProviderInvoiceData = {
      invoice_number: invoice.invoice_number,
      invoice_type: invoice.invoice_type,
      issue_date: this.formatIssueDate(invoice.issue_date, timezone),
      issue_time: this.formatIssueTime(
        invoice.issue_date,
        timezone,
        invoice.created_at,
      ),
      due_date: invoice.due_date
        ? this.formatIssueDate(invoice.due_date, timezone)
        : undefined,
      // Step 8 — `customer_name` / `customer_tax_id` / `customer_address`
      // prefieren el adapter; caen al valor persistido en la invoice para
      // facturas creadas con la API legacy (esos `invoice.customer_*` siguen
      // siendo la fuente del nombre/ID/dirección en `invoicing.service.ts`),
      // y por último al `supplier` cuando son documentos soporte.
      customer_name:
        customerFields.customer_name ??
        invoice.customer_name ??
        invoice.supplier?.name ??
        undefined,
      customer_tax_id:
        customerFields.customer_tax_id ??
        invoice.customer_tax_id ??
        invoice.supplier?.tax_id ??
        undefined,
      customer_address:
        customerFields.customer_address ??
        invoice.customer_address ??
        invoice.supplier?.addresses ??
        undefined,
      customer_email: customerFields.customer_email,
      customer_phone: customerFields.customer_phone,
      // Antes: `invoice.supplier?.document_type || undefined` — el bug del
      // plan. Ahora viene del customer (o fallback de soporte).
      customer_document_type: customerFields.customer_document_type,
      customer_verification_digit: customerFields.customer_verification_digit,
      customer_person_type: customerFields.customer_person_type,
      // Antes: `invoice.supplier?.tax_regime || undefined` — el bug. Ahora
      // viene del customer (o fallback de soporte).
      customer_regime: customerFields.customer_regime,
      customer_tax_responsibilities:
        customerFields.customer_tax_responsibilities,
      customer_ciiu_code: customerFields.customer_ciiu_code,
      customer_is_withholding_agent:
        customerFields.customer_is_withholding_agent,
      // Anexo §12.2: a document re-sent after contingency must keep its prefix and
      // number and declare InvoiceTypeCode 04, not 01. Absent on a first send.
      contingency_type: invoice.contingency_type ?? undefined,
      // dianAmount, not `.toString()`: Prisma.Decimal drops trailing zeros, so
      // a Decimal(12,2) holding 1000.00 serializes as '1000'. The CUFE hashed
      // that bare '1000' while the UBL XML emitted '1000.00', and the DIAN —
      // which recomputes the hash from the XML — rejected every invoice landing
      // on whole pesos. See utils/dian-money.util.ts for the full account.
      subtotal_amount: dianAmount(invoice.subtotal_amount),
      discount_amount: dianAmount(invoice.discount_amount),
      tax_amount: dianAmount(invoice.tax_amount),
      withholding_amount: dianAmount(invoice.withholding_amount),
      total_amount: dianAmount(invoice.total_amount),
      // El documento se emite SIEMPRE en COP; la divisa sólo se DECLARA en
      // `exchange_rate` (ver abajo). Esta moneda es la del documento.
      currency: invoice.currency || undefined,
      // `cbc:CustomizationID` — tipo de operación. Estaba CABLEADO a '10' en el
      // builder, así que un contrato AIU salía declarado como operación estándar
      // y la DIAN no aplicaba sus reglas CAV/CAX: el documento entraba con una
      // base gravable que nadie validaba. NULL ≡ '10', y el builder lo resuelve.
      //
      // Sólo lo lee `UblInvoiceBuilder`: las notas, el documento soporte y el
      // documento equivalente tienen su `CustomizationID` fijado por su propia
      // tabla (20/22, 30/32, 10…), así que este campo no puede contaminarlos.
      operation_type: invoice.operation_type ?? undefined,
      // Divisa pactada. NO cambia `DocumentCurrencyCode` ni ningún `@currencyID`:
      // es una declaración aparte, y sin ella el XML no dice en qué se pactó la
      // operación aunque la factura lo tenga persistido.
      exchange_rate: this.buildExchangeRateDeclaration(invoice),
      // Forma de pago ('1' contado / '2' crédito) → `cac:PaymentMeans/cbc:ID`.
      payment_form: invoice.payment_form ?? undefined,
      // Medio de pago ('10' efectivo, '42' consignación, '48' tarjeta…) →
      // `cbc:PaymentMeansCode`. El nombre difiere del de la columna
      // (`invoices.payment_means_code`) porque el contrato del proveedor es
      // anterior; el builder lee `payment_means` y sin él emitía '10' fijo, o
      // sea declaraba efectivo en toda venta con tarjeta.
      payment_means: invoice.payment_means_code ?? undefined,
      items: provider_items as unknown as any[],
      taxes: (invoice.invoice_taxes || []).map((tax: any) => ({
        tax_name: tax.tax_name,
        tax_rate: dianRate(tax.tax_rate),
        taxable_amount: dianAmount(tax.taxable_amount),
        tax_amount: dianAmount(tax.tax_amount),
        tax_type: tax.tax_type ?? undefined,
      })),
      // `cac:WithholdingTaxTotal`. NO resta de `cbc:PayableAmount` (§11.9.1) y
      // el builder lo escribe en su propio grupo. La tarifa cambia de unidad al
      // mapear — ver `toProviderWithholdings`, que es donde está el peligro.
      withholdings: this.toProviderWithholdings(withholding_lines),
      resolution_number: invoice.resolution?.resolution_number,
      // La REVELADA arriba, no `invoice.resolution?.technical_key`: esa
      // propiedad ya no viene en el objeto cargado y evaluaba a `undefined`,
      // con lo que el proveedor hasheaba el CUFE con ClTec vacía. Es la
      // reproducción exacta del rechazo de producción del §B.0 —hash correcto
      // en apariencia, "Valor del CUFE no está calculado correctamente" de
      // vuelta, y el consecutivo autorizado ya gastado.
      technical_key: resolution_technical_key || undefined,
      notes: invoice.notes || undefined,
      order_reference: invoice.related_invoice?.invoice_number,
      original_invoice_number: invoice.related_invoice?.invoice_number,
      original_invoice_cufe: invoice.related_invoice?.cufe || undefined,
      original_invoice_issue_date: invoice.related_invoice?.issue_date
        ? this.formatIssueDate(invoice.related_invoice.issue_date, timezone)
        : undefined,
      // Concepto DIAN de la nota (`cbc:ResponseCode`). Sólo las notas lo tienen;
      // en cualquier otro documento la columna es NULL y el builder ni lo mira.
      // `|| undefined` porque `ProviderInvoiceData` declara ausencia como
      // `undefined`, no como `null`.
      note_concept_code: invoice.note_concept_code || undefined,
    };

    if (
      (invoice.invoice_type === 'credit_note' ||
        invoice.invoice_type === 'debit_note') &&
      (!invoice.related_invoice ||
        invoice.related_invoice.status !== 'accepted' ||
        invoice.related_invoice.accounting_entity_id !==
          invoice.accounting_entity_id ||
        !invoice.related_invoice.cufe)
    ) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_SCOPE_INVALID,
        'Credit and debit notes require an accepted original invoice with fiscal key in the same accounting entity.',
        {
          invoice_id: id,
          related_invoice_id: invoice.related_invoice?.id,
          accounting_entity_id: invoice.accounting_entity_id,
        },
      );
    }

    // Resolve the correct provider for this store at runtime
    const provider = await this.resolver.resolve({
      configuration_type: this.configurationType(invoice.invoice_type),
    });
    this.assertProviderSupports(provider, invoice.invoice_type);

    // sts:InvoiceControl — la autorización de numeración que respalda el
    // consecutivo. Sale del RESOLVEDOR ÚNICO, el mismo que consume la ruta de
    // habilitación, para que ambos caminos declaren lo mismo por construcción.
    //
    // SE RESUELVE AQUÍ Y NO AL ARMAR EL PAYLOAD, y el orden importa: las dos cosas
    // lanzan, así que quien va primero decide el error que ve quien opera. Si el
    // proveedor no puede emitir este tipo de documento, la causa es eso — no que su
    // resolución esté inactiva, que mandaría a revisar la resolución equivocada. Y
    // `assertProviderSupports` es la comprobación más barata de las dos, además de
    // la que su propio comentario declara como el rechazo temprano.
    //
    // El documento soporte se excluye porque NO cuelga de una resolución de la
    // DIAN: su consecutivo es interno del tenant, y el proveedor omite el bloque
    // para él a propósito. Pedirlo aquí haría lanzar al resolvedor justo donde la
    // ausencia del bloque es la respuesta correcta.
    if (!this.isSupportDocumentType(invoice.invoice_type)) {
      provider_data.control = resolveInvoiceControl(
        invoice.resolution,
        timezone,
        new Date(),
        {
          resolution_id: invoice.resolution?.id,
          document_type: invoice.invoice_type,
        },
      );
    }
    const transmission = await this.fiscal_ledger.ensureInvoiceTransmission({
      invoice,
      provider_data,
      dian_configuration_id: await this.resolveTransmissionConfigId(invoice),
      user_id: this.getContext().user_id,
    });

    // Send to provider
    let provider_response: ProviderResponse;
    try {
      await this.fiscal_ledger.markSubmitted(transmission.id);
      if (invoice.invoice_type === 'credit_note') {
        provider_response = await provider.sendCreditNote(provider_data);
      } else if (invoice.invoice_type === 'debit_note') {
        if (!provider.sendDebitNote) {
          throw new Error(
            'Debit note submission is not implemented for the resolved fiscal provider.',
          );
        }
        provider_response = await provider.sendDebitNote(provider_data);
      } else if (
        invoice.invoice_type === 'purchase_invoice' ||
        invoice.invoice_type === 'support_document'
      ) {
        provider_response = await provider.sendSupportDocument!(provider_data);
      } else if (invoice.invoice_type === 'support_adjustment_note') {
        provider_response =
          await provider.sendSupportAdjustmentNote!(provider_data);
      } else if (invoice.invoice_type === 'pos_equivalent_document') {
        provider_response =
          await provider.sendEquivalentDocument!(provider_data);
      } else if (invoice.invoice_type === 'equivalent_adjustment_note') {
        provider_response =
          await provider.sendEquivalentAdjustmentNote!(provider_data);
      } else {
        provider_response = await provider.sendInvoice(provider_data);
      }
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to send invoice #${id} to provider: ${cause.message}`,
      );

      if (
        error instanceof VendixHttpException &&
        error.errorCode === ErrorCodes.FISCAL_IDEMPOTENCY_CONFLICT.code
      ) {
        throw error;
      }

      // Enqueue for retry if it's a transient error (network, timeout, SOAP fault)
      // Don't retry certificate expiry or validation errors
      const is_transient = this.isTransientError(cause);
      if (is_transient) {
        this.retry_queue
          .enqueue(id, invoice.organization_id, invoice.store_id, cause.message)
          .catch((e) =>
            this.logger.error(
              `Failed to enqueue invoice #${id} for retry: ${e.message}`,
            ),
          );
      }

      await this.fiscal_ledger.markError(transmission.id, cause);

      // UN ERROR YA TIPADO SE RESPETA. El proveedor lanza con nombre propio
      // —`INVOICING_PROVIDER_003` cuando la resolución no tiene ClTec, el gate
      // fiscal, el rechazo del contexto— y cada uno trae su código, su mensaje y
      // sus `details`. Reemplazarlos por _001 no solo pierde el detalle: afirma
      // que hubo un fallo de comunicación con la DIAN cuando lo que hubo fue un
      // dato ausente, y manda a revisar la red en vez de la resolución.
      if (error instanceof VendixHttpException) {
        throw error;
      }

      // Lo que queda SÍ es un fallo de transporte o de preparación del envío: la
      // DIAN no llegó a juzgar el documento. `_001` (502) es correcto — pero con
      // la causa real, no con la frase genérica del catálogo, que era todo lo que
      // el operador recibía.
      throw new VendixHttpException(
        ErrorCodes.INVOICING_PROVIDER_001,
        cause.message?.trim().slice(0, PROVIDER_MESSAGE_MAX_LENGTH) || undefined,
        {
          invoice_id: id,
          fiscal_transmission_id: transmission.id,
          retry_scheduled: is_transient,
        },
      );
    }

    // A DIAN OUTAGE IS NOT A REJECTION. Anexo Técnico 1.9 §12.2: when the
    // validation service is unavailable, the document is expedited under
    // contingency Type 04 — it keeps its prefix and number, is delivered to the
    // acquirer without prior validation, and owes the DIAN a transmission within
    // 48 h. Falling through to the rejection branch below (the previous
    // behaviour) stamped `status: rejected` + `accounting_status: blocked` on a
    // perfectly valid invoice, a terminal state that no retry could undo.
    if (!provider_response.success && provider_response.contingency_eligible) {
      await this.handleContingency(id, invoice, transmission.id, provider_response);
      return this.prisma.invoices.findFirstOrThrow({
        where: { id },
        include: INVOICE_INCLUDE,
      });
    }

    if (!provider_response.success) {
      const rejected_fiscal_key =
        provider_response.cufe ||
        provider_response.cude ||
        provider_response.cuds ||
        provider_response.cune;
      await this.fiscal_ledger.markRejected(transmission.id, provider_response);
      const rejected = await this.prisma.invoices.update({
        where: { id },
        data: {
          status: 'rejected',
          send_status: 'sent_error',
          transmission_status: 'rejected',
          dian_status: 'rejected',
          accounting_status: 'blocked',
          sent_at: new Date(),
          cufe: rejected_fiscal_key,
          qr_code: provider_response.qr_code,
          xml_document: provider_response.xml_document,
          pdf_url: provider_response.pdf_url,
          provider_response: this.toProviderEvidence(provider_response),
        },
        include: INVOICE_INCLUDE,
      });

      // EL MOTIVO REAL, NO SOLO EL HECHO. La DIAN nombra la regla que se violó
      // («Valor del CUFE no está calculado correctamente») y esa frase es la única
      // que le dice al comerciante qué corregir. Viaja en `details.dian_errors`
      // —la misma lista que queda persistida en `provider_response`— para que el
      // frontend pueda enumerarla en vez de mostrar «documento rechazado» a secas.
      const rejection = this.extractDianRejection(provider_response);

      this.logger.warn(
        `Invoice #${id} (${rejected.invoice_number}) rejected by provider: ${
          provider_response.message || 'no provider message'
        }${
          rejection.dian_errors.length
            ? ` | DIAN: ${rejection.dian_errors
                .map((reason) =>
                  reason.code ? `${reason.code} ${reason.message}` : reason.message,
                )
                .join(' ; ')}`
            : ''
        }`,
      );

      throw new VendixHttpException(
        ErrorCodes.INVOICING_PROVIDER_004,
        this.dianRejectionMessage(provider_response, rejection),
        {
          invoice_id: id,
          tracking_id: provider_response.tracking_id,
          ...rejection,
        },
      );
    }

    const fiscal_key =
      provider_response.cufe ||
      provider_response.cude ||
      provider_response.cuds ||
      provider_response.cune;

    if (!provider_response.tracking_id || !fiscal_key) {
      await this.fiscal_ledger.markError(
        transmission.id,
        new Error('Provider response is missing fiscal acceptance evidence.'),
        'FISCAL_EVIDENCE_MISSING',
      );
      await this.prisma.invoices.update({
        where: { id },
        data: {
          send_status: 'sent_error',
          transmission_status: 'error',
          dian_status: 'error',
          accounting_status: 'blocked',
          provider_response: this.toProviderEvidence(provider_response),
        },
      });

      throw new VendixHttpException(
        ErrorCodes.INVOICING_PROVIDER_004,
        'Provider response is missing fiscal acceptance evidence.',
        {
          invoice_id: id,
          tracking_id: provider_response.tracking_id,
          // Una respuesta que se declara exitosa pero no trae CUFE ni tracking
          // suele traer el porqué en el estado de la DIAN. Es lo único que hay
          // para diagnosticarla, así que también viaja.
          ...this.extractDianRejection(provider_response),
        },
      );
    }

    await this.fiscal_ledger.markAccepted(transmission.id, provider_response);

    // Update invoice with provider response
    const updated = await this.prisma.invoices.update({
      where: { id },
      data: {
        status: 'accepted',
        send_status: 'sent_ok',
        transmission_status: 'accepted',
        dian_status: 'accepted',
        accounting_status: 'provisional',
        fiscal_document_type: this.fiscalDocumentType(invoice.invoice_type),
        sent_at: new Date(),
        accepted_at: new Date(),
        cufe: fiscal_key,
        qr_code: provider_response.qr_code,
        xml_document: provider_response.xml_document,
        pdf_url: provider_response.pdf_url,
        provider_response: this.toProviderEvidence(provider_response),
      },
      include: INVOICE_INCLUDE,
    });

    if (is_support_document) {
      await this.ensureSupportDocumentAccountsPayable(updated);
    }

    // LAS MISMAS líneas que se declararon en el XML, ahora persistidas. No se
    // vuelven a resolver: el documento ya salió con ellas y el asiento tiene que
    // hablar de esas y no de las que la configuración diga dentro de un segundo.
    const withholding_breakdown = await this.persistWithholdingBatches(
      updated,
      withholding_batches,
    );

    this.event_emitter.emit(
      is_support_document ? 'support_document.accepted' : 'invoice.accepted',
      {
        invoice_id: id,
        invoice_number: updated.invoice_number,
        invoice_type: updated.invoice_type,
        tracking_id: provider_response.tracking_id,
        organization_id: updated.organization_id,
        store_id: updated.store_id,
        accounting_entity_id: updated.accounting_entity_id,
        subtotal_amount: Number(updated.subtotal_amount),
        discount_amount: Number(updated.discount_amount),
        tax_amount: Number(updated.tax_amount),
        // Plan Despacho Economía — FASE 4 paso 14. Propagar shipping_amount al
        // listener de auto-entry para que separe producto vs flete.
        shipping_amount: Number(updated.shipping_amount ?? 0),
        tax_breakdown: buildTaxBreakdown(updated.invoice_taxes || []),
        withholding_amount: Number(updated.withholding_amount),
        withholding_breakdown,
        total_amount: Number(updated.total_amount),
        supplier_id: updated.supplier_id,
        customer: updated.customer
          ? {
              id: updated.customer.id,
              name: `${updated.customer.first_name} ${updated.customer.last_name}`.trim(),
              tax_id: updated.customer.document_number ?? undefined,
            }
          : undefined,
        user_id: this.getContext().user_id,
      },
    );

    this.logger.log(
      `Invoice #${id} (${updated.invoice_number}) accepted by provider`,
    );
    return updated;
  }

  async accept(id: number) {
    const invoice = await this.getInvoice(id);
    await this.assertInvoicingAreaActive(invoice);
    this.validateTransition(invoice.status, 'accepted');
    await this.assertFiscalPeriodOpen(
      invoice.accounting_entity_id,
      invoice.issue_date,
      'accept',
    );

    const accepted_transmission =
      await this.fiscal_ledger.findAcceptedInvoiceTransmission(invoice);
    if (!accepted_transmission) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_PROVIDER_004,
        'Invoice cannot be accepted without accepted DIAN ledger evidence.',
        { invoice_id: id },
      );
    }

    const fiscal_key =
      accepted_transmission.cufe ||
      accepted_transmission.cude ||
      accepted_transmission.cuds ||
      accepted_transmission.cune;
    if (!accepted_transmission.tracking_id || !fiscal_key) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_PROVIDER_004,
        'Accepted DIAN ledger evidence is missing tracking ID or fiscal key.',
        { invoice_id: id, fiscal_transmission_id: accepted_transmission.id },
      );
    }

    const updated = await this.prisma.invoices.update({
      where: { id },
      data: {
        status: 'accepted',
        send_status: 'sent_ok',
        transmission_status: 'accepted',
        dian_status: 'accepted',
        accounting_status: 'provisional',
        accepted_at: new Date(),
        cufe: fiscal_key,
      },
      include: INVOICE_INCLUDE,
    });

    const is_support_document = this.isSupportDocumentType(
      updated.invoice_type,
    );
    if (is_support_document) {
      await this.ensureSupportDocumentAccountsPayable(updated);
    }

    const withholding_breakdown = await this.resolveWithholdingForInvoice(
      updated,
      is_support_document,
    );

    this.event_emitter.emit(
      is_support_document ? 'support_document.accepted' : 'invoice.accepted',
      {
        invoice_id: id,
        invoice_number: updated.invoice_number,
        invoice_type: updated.invoice_type,
        organization_id: updated.organization_id,
        store_id: updated.store_id,
        accounting_entity_id: updated.accounting_entity_id,
        subtotal_amount: Number(updated.subtotal_amount),
        discount_amount: Number(updated.discount_amount),
        tax_amount: Number(updated.tax_amount),
        // Plan Despacho Economía — FASE 4 paso 14. Propagar shipping_amount al
        // listener de auto-entry para que separe producto vs flete.
        shipping_amount: Number(updated.shipping_amount ?? 0),
        tax_breakdown: buildTaxBreakdown(updated.invoice_taxes || []),
        withholding_amount: Number(updated.withholding_amount),
        withholding_breakdown,
        total_amount: Number(updated.total_amount),
        supplier_id: updated.supplier_id,
        customer: updated.customer
          ? {
              id: updated.customer.id,
              name: `${updated.customer.first_name} ${updated.customer.last_name}`.trim(),
              tax_id: updated.customer.document_number ?? undefined,
            }
          : undefined,
        user_id: this.getContext().user_id,
      },
    );

    this.logger.log(`Invoice #${id} (${updated.invoice_number}) accepted`);
    return updated;
  }

  async reject(id: number) {
    const invoice = await this.getInvoice(id);
    this.validateTransition(invoice.status, 'rejected');
    await this.assertFiscalPeriodOpen(
      invoice.accounting_entity_id,
      invoice.issue_date,
      'reject',
    );

    const updated = await this.prisma.invoices.update({
      where: { id },
      data: {
        status: 'rejected',
        send_status: 'sent_error',
      },
      include: INVOICE_INCLUDE,
    });

    this.logger.log(`Invoice #${id} (${updated.invoice_number}) rejected`);
    return updated;
  }

  async cancel(id: number) {
    const invoice = await this.getInvoice(id);

    // Simétrico a `void()`: descartar sólo aplica mientras el documento no haya
    // salido hacia la DIAN. Pedirlo sobre uno transmitido no es un capricho del
    // usuario —es el mismo botón, sobre otra fila— y merece que la respuesta
    // nombre la salida correcta (anular si lo rechazaron, nota crédito si lo
    // aceptaron) en vez de un «transición inválida» que no dice a dónde ir.
    if (
      !VALID_TRANSITIONS[invoice.status as InvoiceStatus]?.includes('cancelled')
    ) {
      const route = DISCARD_ROUTES[invoice.status as InvoiceStatus];
      throw new VendixHttpException(
        ErrorCodes.INVOICING_STATUS_001,
        route?.action && route.action !== 'cancel'
          ? `Este documento ya salió hacia la DIAN, así que no se descarta: usa «${route.label}». ${route.reason}`
          : `Este documento no se puede descartar en su estado actual. ${route?.reason ?? ''}`.trim(),
        {
          invoice_id: id,
          invoice_status: invoice.status,
          discard_route: route ?? null,
        },
      );
    }

    this.validateTransition(invoice.status, 'cancelled');
    await this.assertFiscalPeriodOpen(
      invoice.accounting_entity_id,
      invoice.issue_date,
      'cancel',
    );

    const updated = await this.prisma.invoices.update({
      where: { id },
      data: { status: 'cancelled' },
      include: INVOICE_INCLUDE,
    });

    this.logger.log(`Invoice #${id} (${updated.invoice_number}) cancelled`);
    return updated;
  }

  async void(id: number) {
    const invoice = await this.getInvoice(id);

    // El caso ACEPTADO se atiende ANTES de las dos compuertas genéricas, y el
    // orden es lo único que hace útil el mensaje. Con `accepted: []` en la
    // tabla, `validateTransition` contestaría «transición inválida» —cierto,
    // pero mudo sobre qué hacer—, y con el período cerrado ganaría el error de
    // período, que aquí es una respuesta a la pregunta equivocada: la factura
    // no se anula ni con el período abierto. Quien pregunta necesita saber que
    // el camino es una nota crédito, no que la transición no existe.
    if (invoice.status === 'accepted') {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_STATUS_002,
        'Un documento aceptado por la DIAN no se anula: emite una nota crédito que lo corrija o lo revierta. La anulación sólo aplica a documentos que la DIAN nunca aceptó.',
        {
          invoice_id: id,
          invoice_status: invoice.status,
          discard_route: DISCARD_ROUTES.accepted,
        },
      );
    }

    // ANULAR NO ES LA SALIDA DE TODOS LOS ESTADOS, Y DECIRLO IMPORTA.
    //
    // Un borrador se DESCARTA (`cancel`), no se anula: nunca se transmitió, así
    // que no hay nada ante la DIAN que dejar sin efecto. `validateTransition`
    // contestaría «no se puede pasar de draft a voided», que es cierto y es
    // inútil — nombra la transición que falta en vez de la acción que sí
    // funciona. Ése es literalmente el atasco reportado: «me dice que primero
    // debo cancelarla, pero no hay forma de cancelarla», sobre un documento
    // cuya salida existía y se llamaba distinto.
    //
    // Se resuelve ANTES de `validateTransition` para que el mensaje dirigido
    // gane sobre el genérico, igual que hace la guarda de `accepted` de arriba.
    if (!VALID_TRANSITIONS[invoice.status as InvoiceStatus]?.includes('voided')) {
      const route = DISCARD_ROUTES[invoice.status as InvoiceStatus];
      throw new VendixHttpException(
        ErrorCodes.INVOICING_STATUS_001,
        route?.action === 'cancel'
          ? `Este documento no se anula porque nunca se transmitió a la DIAN: usa «${route.label}». ${route.reason}`
          : `Este documento no se puede anular en su estado actual. ${route?.reason ?? ''}`.trim(),
        {
          invoice_id: id,
          invoice_status: invoice.status,
          discard_route: route ?? null,
        },
      );
    }

    this.validateTransition(invoice.status, 'voided');
    await this.assertFiscalPeriodOpen(
      invoice.accounting_entity_id,
      invoice.issue_date,
      'void',
    );

    const updated = await this.prisma.invoices.update({
      where: { id },
      data: { status: 'voided' },
      include: INVOICE_INCLUDE,
    });

    this.logger.log(`Invoice #${id} (${updated.invoice_number}) voided`);
    return updated;
  }

  getValidTransitions(currentStatus: string): InvoiceStatus[] {
    return VALID_TRANSITIONS[currentStatus as InvoiceStatus] || [];
  }

  /**
   * Determines if an error is transient (network, timeout, SOAP fault)
   * and therefore eligible for retry.
   * Non-transient: certificate expiry, validation errors, missing config.
   */
  /**
   * Records a document expedited under DIAN contingency (Anexo §12.2, Type 04).
   *
   * State choice, and why each one: `transmission_status: 'contingency'` (not
   * `rejected`, not `error`) because the document is valid and deliverable;
   * `dian_status: 'pending'` because the DIAN has not judged it and still must;
   * `accounting_status` is left untouched because a contingency invoice is a real
   * sale that must post — blocking it would create an accounting hole for the
   * duration of a DIAN outage.
   *
   * The retry queue keeps ownership of the 48 h retransmission: this method
   * declares the state and enqueues, it never gives up on the document.
   */
  private async handleContingency(
    id: number,
    invoice: { organization_id: number; store_id: number },
    transmission_id: number,
    provider_response: ProviderResponse,
  ): Promise<void> {
    const reason =
      provider_response.message ||
      `La DIAN no respondió (${provider_response.failure_class ?? 'dian_error'})`;

    await this.fiscal_ledger.markError(transmission_id, new Error(reason));

    await this.prisma.invoices.update({
      where: { id },
      data: {
        transmission_status: 'contingency',
        dian_status: 'pending',
        send_status: 'sent_error',
        sent_at: new Date(),
        xml_document: provider_response.xml_document,
        provider_response: this.toProviderEvidence(provider_response),
      },
    });

    // Sets contingency_type/declared_at/deadline idempotently — the 48 h run from
    // the FIRST declaration, so a later retry must not push the deadline forward.
    await this.retry_queue.declareContingency(id, reason);

    await this.retry_queue
      .enqueue(id, invoice.organization_id, invoice.store_id, reason)
      .catch((e) =>
        this.logger.error(
          `Failed to enqueue contingency invoice #${id} for retry: ${e.message}`,
        ),
      );

    this.logger.warn(
      `Invoice #${id} expedited under DIAN contingency (Type 04): ${reason}`,
    );
  }

  private isTransientError(error: any): boolean {
    const message = (error.message || '').toLowerCase();

    // Non-retryable patterns
    const non_retryable = [
      'certificado',
      'certificate',
      'expiró',
      'expired',
      'no active dian configuration',
      'store context required',
      'invalid state transition',
      'must have at least one item',
    ];

    if (non_retryable.some((pattern) => message.includes(pattern))) {
      return false;
    }

    // Retryable patterns
    const retryable = [
      'econnrefused',
      'econnreset',
      'etimedout',
      'enotfound',
      'socket hang up',
      'timeout',
      'network',
      'soap',
      '503',
      '502',
      '500',
      'service unavailable',
      'bad gateway',
    ];

    return retryable.some((pattern) => message.includes(pattern));
  }
}
