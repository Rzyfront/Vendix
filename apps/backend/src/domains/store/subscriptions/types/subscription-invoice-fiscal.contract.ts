import { Prisma } from '@prisma/client';

import { PLATFORM_TIMEZONE } from '../../../../common/constants/platform-fiscal.constants';
import { localDateString } from '../../../../common/utils/store-timezone.util';
import {
  DIAN_DEFAULT_UNIT_CODE,
  DIAN_UNIT_CODES,
  DianUnitCode,
} from '../../invoicing/providers/dian-direct/constants/dian-unit-codes';
import {
  DIAN_PAYMENT_MEANS,
  DIAN_PAYMENT_METHODS,
  DianPaymentMeansCode,
  DianPaymentMethodCode,
} from '../../invoicing/providers/dian-direct/constants/dian-document-types';
import { SubscriptionInvoiceMetadata } from './billing.types';

/**
 * CONTRATO FISCAL DE LA FACTURA DE SUSCRIPCIÓN SaaS
 * =================================================
 *
 * Vendix le factura electrónicamente a sus propios tenants, así que la factura de
 * suscripción es una factura electrónica de venta ante la DIAN como cualquier
 * otra. Este módulo es el ÚNICO sitio donde vive la forma fiscal de esa factura:
 * la descripción visible al cliente, el código del ítem, la unidad de medida, la
 * forma y el medio de pago, y la leyenda de exclusión del IVA.
 *
 * ¿POR QUÉ UN MÓDULO COMPARTIDO Y NO CADA COSA EN SU SITIO DE USO?
 *
 * La factura nace en el riel de tienda (`subscription-billing.service.ts`, más
 * los dos controladores de checkout y el servicio de prorrateo, que arman el
 * `InvoicePreview` que el emisor persiste tal cual) y se TRANSMITE desde el riel
 * de plataforma (`superadmin/subscriptions/fiscal/subscription-fiscal.service.ts`).
 * Son dos dominios, cinco archivos y una sola verdad: si la descripción se
 * escribe en cinco literales, cuatro se quedan atrás el día que cambie el texto
 * —y eso ya pasó: por eso había descripciones en inglés en una factura
 * colombiana—.
 */

// ---------------------------------------------------------------------------
// Descripción de línea — español, con plan y período
// ---------------------------------------------------------------------------

/**
 * Encabezado FIJO de la descripción, decidido por el dueño del producto.
 *
 * Nombra el servicio que la DIAN reconoce como excluido de IVA por el artículo
 * 476 numeral 21 del ET («computación en la nube»). Que el nombre del servicio y
 * la razón de la exclusión digan lo mismo es lo que hace auditable el documento:
 * un «Plan pro (monthly)» no declara qué se vendió ni por qué no lleva IVA.
 */
export const SUBSCRIPTION_SERVICE_DESCRIPTION_PREFIX =
  'Servicio de Software en la Nube';

/** Prefijo de la línea de prorrateo (antes `Proration adjustment — plan …`). */
export const SUBSCRIPTION_PRORATION_PREFIX = 'Ajuste por prorrateo';

/**
 * Razón del descuento de documento cuando el crédito por bajar de plan se
 * aplica a la factura. Antes viajaba como DESCRIPCIÓN de una línea negativa
 * (`Downgrade credit (applied from previous cycle)`); ahora es la razón de un
 * `cac:AllowanceCharge` de documento — ver la nota de `document_discount` en
 * `billing.types.ts`.
 */
export const SUBSCRIPTION_DOWNGRADE_CREDIT_REASON =
  'Crédito por cambio a un plan inferior, aplicado del ciclo anterior';

/**
 * Versión CORTA de la razón anterior, para superficies con ancho fijo (la
 * columna de rótulos del recuadro de totales del PDF mide ~130 pt). El XML usa
 * la razón completa, que no tiene límite de ancho.
 */
export const SUBSCRIPTION_DOWNGRADE_CREDIT_LABEL = 'Crédito aplicado';

/** Ciclo de facturación → etiqueta en español para la descripción de línea. */
export const BILLING_CYCLE_LABELS_ES: Readonly<Record<string, string>> = {
  monthly: 'mensual',
  quarterly: 'trimestral',
  semiannual: 'semestral',
  annual: 'anual',
  lifetime: 'vitalicio',
};

/**
 * Etiqueta en español del ciclo. Un valor desconocido devuelve el propio valor
 * en minúsculas en vez de una cadena vacía: la descripción es texto visible al
 * cliente y perder el ciclo es peor que mostrarlo sin traducir.
 */
export function billingCycleLabelEs(cycle?: string | null): string {
  const key = (cycle ?? '').trim().toLowerCase();
  return BILLING_CYCLE_LABELS_ES[key] ?? key;
}

/**
 * Fecha de un extremo del período facturado, en formato colombiano
 * `dd/mm/aaaa`.
 *
 * Se resuelve en la zona de la PLATAFORMA, que es la del obligado a facturar
 * (Vendix), y por `localDateString` —nunca por `toLocaleDateString` sobre un
 * `Date`—: `period_start` es un instante UTC y renderizarlo con el reloj local
 * del proceso hace retroceder un día la mitad de las facturas emitidas de noche.
 */
export function formatSubscriptionPeriodDate(value: Date): string {
  const [year, month, day] = localDateString(value, PLATFORM_TIMEZONE).split(
    '-',
  );
  return `${day}/${month}/${year}`;
}

/**
 * Descripción canónica de una línea de suscripción.
 *
 * Forma: `Servicio de Software en la Nube — Plan {nombre} ({ciclo}) — Período
 * del {dd/mm/aaaa} al {dd/mm/aaaa}`.
 *
 * - `planName` es el NOMBRE legible del plan, no su `code`: el `code` es la
 *   llave de negocio (`pro_annual`) y no es texto para un cliente. Quien lo
 *   invoca cae al `code` sólo si el plan no tiene nombre.
 * - El período se OMITE cuando no se conoce, en vez de imprimir un rango falso.
 */
export function buildSubscriptionLineDescription(input: {
  planName: string;
  billingCycle?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  /** `true` ⇒ antepone «Ajuste por prorrateo». */
  prorated?: boolean;
  /** Aclaración del cambio de plan («Cambio a un plan superior…»). */
  changeNote?: string | null;
}): string {
  const plan = input.planName.trim() || 'Vendix';
  const cycle = billingCycleLabelEs(input.billingCycle);
  const head = cycle
    ? `${SUBSCRIPTION_SERVICE_DESCRIPTION_PREFIX} — Plan ${plan} (${cycle})`
    : `${SUBSCRIPTION_SERVICE_DESCRIPTION_PREFIX} — Plan ${plan}`;

  const parts = [
    input.prorated ? `${SUBSCRIPTION_PRORATION_PREFIX} — ${head}` : head,
  ];

  if (input.periodStart && input.periodEnd) {
    parts.push(
      `Período del ${formatSubscriptionPeriodDate(input.periodStart)} al ${formatSubscriptionPeriodDate(input.periodEnd)}`,
    );
  }

  const note = (input.changeNote ?? '').trim();
  if (note) parts.push(note);

  return parts.join(' — ');
}

/** Aclaración de una subida de plan con crédito por los días no consumidos. */
export const SUBSCRIPTION_UPGRADE_NOTE =
  'Cambio a un plan superior, con crédito por los días no usados';

/** Aclaración de una bajada de plan: arranca ciclo nuevo y no genera crédito. */
export const SUBSCRIPTION_DOWNGRADE_NOTE =
  'Cambio a un plan inferior, ciclo nuevo sin crédito';

// ---------------------------------------------------------------------------
// Identificación del ítem — `cac:StandardItemIdentification/cbc:ID`
// ---------------------------------------------------------------------------

/**
 * Prefijo del código de ítem del servicio de suscripción.
 *
 * Se emite con `schemeID="999"` («estándar de adopción del contribuyente»)
 * porque Vendix no publica catálogo UNSPSC ni GTIN — ver la nota de
 * `ProviderInvoiceItem.item_code`.
 */
export const SUBSCRIPTION_ITEM_CODE_PREFIX = 'VDX-SUB';

/**
 * Código ESTABLE del ítem, uno POR PLAN.
 *
 * CRITERIO (y por qué éste y no otro):
 *
 * - Se deriva de `subscription_plans.code`, que es la llave de negocio inmutable
 *   del plan. El `name` es texto de vitrina y cambia con el marketing; un código
 *   de catálogo que cambia deja de identificar el mismo servicio entre facturas.
 * - Por PLAN y no por servicio único: la DIAN lee este campo como «cuál de mis
 *   artículos es éste», y Vendix vende planes distinguibles. Un único
 *   `VDX-SUB` para todo declararía que los tres planes son el mismo artículo.
 * - NO lleva el ciclo ni el período: el ciclo viaja en la unidad de medida
 *   (`LUN`/`ANA`) y el período en `cac:InvoicePeriod`. Meterlo aquí duplicaría
 *   el dato y produciría dos códigos para el mismo plan.
 * - Sin `code` utilizable devuelve el prefijo pelado, que sigue siendo estable y
 *   preferible al número de línea al que caería el builder.
 */
export function buildSubscriptionItemCode(planCode?: string | null): string {
  const normalized = (planCode ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized
    ? `${SUBSCRIPTION_ITEM_CODE_PREFIX}-${normalized}`
    : SUBSCRIPTION_ITEM_CODE_PREFIX;
}

// ---------------------------------------------------------------------------
// Unidad de medida — ciclo de facturación → `@unitCode`
// ---------------------------------------------------------------------------

/**
 * Ciclo de facturación → unidad de medida de la DIAN.
 *
 * ⚠️ `monthly` es **`LUN`** y `annual` es **`ANA`**, NO `MON` ni `ANN`. No es
 * una errata: la DIAN publicó la lista UN/ECE traducida automáticamente y la
 * herramienta tradujo también los códigos, así que `MON` (month) quedó como
 * `LUN` y `ANN` (annum) como `ANA`. La corrupción está en el `.gc` **y** en el
 * Schematron, o sea es lo que el validador realmente compara. Ver el «AVISO
 * GRAVE» en `dian-unit-codes.ts`, que enumera los 16 códigos afectados.
 * Enviar `MON` o `ANN` no fallaría ruidosamente: `toDianUnitCode` los degrada a
 * `EA` en silencio, y la línea declararía «1 unidad».
 *
 * `quarterly`, `semiannual` y `lifetime` se quedan en `EA` A PROPÓSITO. La línea
 * de suscripción viaja con `quantity = 1`, y la unidad califica esa cantidad: un
 * ciclo trimestral declarado `1 LUN` afirmaría «un mes», que es FALSO. Mientras
 * el origen no emita la cantidad en meses (3 / 6), «cada» es lo único cierto que
 * se puede declarar — y es además el respaldo histórico de todo el catálogo.
 *
 * Severidad de la regla FB04: NOTIFICACIÓN, no rechazo. Una unidad fuera de
 * lista no quema el consecutivo autorizado, pero declara mal la operación.
 */
export const DIAN_UNIT_CODE_BY_BILLING_CYCLE: Readonly<
  Record<string, DianUnitCode>
> = {
  monthly: DIAN_UNIT_CODES.MONTH,
  annual: DIAN_UNIT_CODES.YEAR,
  quarterly: DIAN_UNIT_CODES.EACH,
  semiannual: DIAN_UNIT_CODES.EACH,
  lifetime: DIAN_UNIT_CODES.EACH,
};

/** Unidad de la DIAN para un ciclo de facturación; `EA` cuando no hay mapeo. */
export function dianUnitCodeForBillingCycle(
  cycle?: string | null,
): DianUnitCode {
  const key = (cycle ?? '').trim().toLowerCase();
  return DIAN_UNIT_CODE_BY_BILLING_CYCLE[key] ?? DIAN_DEFAULT_UNIT_CODE;
}

// ---------------------------------------------------------------------------
// Exclusión del IVA — artículo 476 numeral 21 del ET
// ---------------------------------------------------------------------------

/**
 * Leyenda de exclusión del IVA para el `cbc:Note` del documento.
 *
 * EXCLUIDO ≠ EXENTO, y la diferencia cambia el XML: un ítem EXCLUIDO **no**
 * emite el grupo `cac:TaxTotal` de línea (regla FAX01, pág. 94 del anexo
 * técnico; espejo CAX01 pág. 172), mientras que un ítem EXENTO sí lo emite con
 * `cbc:Percent` en 0,00. La bandera que lo controla es `omit_tax_total` en
 * `UblDocumentLine`; esta leyenda es la que DICE por qué el impuesto no está.
 *
 * Un importe de IVA en cero sin leyenda es un cero por accidente: no distingue
 * «excluido por ley» de «se nos olvidó calcularlo».
 *
 * Respaldo: artículo 476 numeral 21 del Estatuto Tributario, adicionado por la
 * Ley 1819 de 2016; DIAN Concepto Unificado 017056 de 2017 y Oficio 900930 de
 * 2022. La exclusión aplica al PROVEEDOR del servicio, y Vendix lo es.
 */
export const SUBSCRIPTION_VAT_EXCLUSION_NOTE =
  'Servicio excluido del impuesto sobre las ventas (IVA) conforme al artículo 476 numeral 21 del Estatuto Tributario, adicionado por la Ley 1819 de 2016: suministro de páginas web, servidores (hosting) y computación en la nube (cloud computing).';

/**
 * `cbc:Note` completo del documento: trazabilidad hacia la factura SaaS interna
 * más la leyenda de exclusión.
 *
 * Se compone acá y no en el sitio de uso para que la leyenda no pueda quedarse
 * fuera al editar la nota de trazabilidad, que es exactamente lo que pasó antes.
 */
export function buildSubscriptionInvoiceNotes(
  saasInvoiceNumber: string,
): string {
  const reference = saasInvoiceNumber.trim();
  const trace = reference
    ? `Factura electrónica generada desde la factura SaaS ${reference}.`
    : 'Factura electrónica de suscripción SaaS.';
  return `${trace} ${SUBSCRIPTION_VAT_EXCLUSION_NOTE}`;
}

// ---------------------------------------------------------------------------
// Forma y medio de pago
// ---------------------------------------------------------------------------

/**
 * Forma de pago — `cac:PaymentMeans/cbc:ID`: `'1'` contado, `'2'` crédito.
 *
 * La factura de suscripción vence a +7 días de la emisión, así que es una venta
 * A CRÉDITO y debe declarar `'2'`. Declarar `'1'` con un vencimiento posterior
 * es una contradicción dentro del propio documento: dice «pagado al contado» y
 * a la vez publica un `PaymentDueDate` futuro.
 *
 * Ambas fechas se comparan como cadenas `YYYY-MM-DD` porque así llegan ya
 * resueltas en la zona del obligado (`localDateString`). El orden lexicográfico
 * de ese formato ES el orden cronológico, y comparar cadenas evita reconstruir
 * dos `Date` que volverían a introducir la ambigüedad de zona.
 *
 * NO confundir con `payment_means` (`cbc:PaymentMeansCode`), que responde «con
 * qué instrumento». Un pago con tarjeta de crédito es forma `'1'` y medio `'48'`.
 */
export function resolveSubscriptionPaymentForm(
  issueDate: string,
  dueDate?: string | null,
): DianPaymentMethodCode {
  const issue = (issueDate ?? '').trim();
  const due = (dueDate ?? '').trim();
  return issue && due && due > issue
    ? DIAN_PAYMENT_METHODS.CREDIT
    : DIAN_PAYMENT_METHODS.CASH;
}

/**
 * Medio de pago — `cac:PaymentMeans/cbc:PaymentMeansCode`.
 *
 * `subscription_payments.payment_method` sólo toma dos valores:
 *
 * - `'manual'` → `'42'` consignación bancaria. El pago manual se registra con
 *   referencia bancaria, así que la consignación es el instrumento real.
 * - `'wompi'` → `'1'` instrumento no definido. Wompi multiplexa tarjeta, PSE,
 *   Nequi y transferencia Bancolombia, y el instrumento concreto NO se
 *   persiste. Declarar `'48'` (tarjeta crédito) afirmaría una tarjeta que puede
 *   no existir; `'1'` es el valor por defecto seguro de la tabla de la DIAN.
 *
 * Sin pago (la factura se emite a crédito, antes de cobrarse) también `'1'`.
 */
export function resolveSubscriptionPaymentMeans(
  paymentMethod?: string | null,
): DianPaymentMeansCode {
  switch ((paymentMethod ?? '').trim().toLowerCase()) {
    case 'manual':
      return DIAN_PAYMENT_MEANS.BANK_DEPOSIT;
    default:
      return DIAN_PAYMENT_MEANS.UNDEFINED_INSTRUMENT;
  }
}

// ---------------------------------------------------------------------------
// Descuento a nivel de documento
// ---------------------------------------------------------------------------

/**
 * Descuento de documento de una factura de suscripción, como cadena de 2
 * decimales (`'0.00'` cuando no hay).
 *
 * ES LA ÚNICA LECTURA VÁLIDA del crédito por cambio de plan. Alimenta
 * `ProviderInvoiceData.discount_amount`, que a su vez alimenta
 * `UblCommonBuilder.buildDocumentAllowanceCharge` (`ChargeIndicator=false` +
 * `BaseAmount`) y el `cbc:AllowanceTotalAmount` del total legal. Antes ese
 * crédito viajaba como LÍNEA con `unit_price` negativo, que es lo que rompía la
 * familia DAU02 / DAU04 / DAU06: la DIAN recompone bruto, base y total desde las
 * líneas, y una línea negativa descuadra los tres.
 *
 * RETROCOMPATIBILIDAD: prefiere `metadata.document_discount` (la llave nueva,
 * explícita) y cae a `metadata.credit_applied` (la que ya escribían las facturas
 * emitidas antes de este contrato). Las dos llevan el mismo número; la segunda
 * existe desde antes y no se retira para no romper lecturas históricas.
 */
export function resolveSubscriptionDocumentDiscount(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return '0.00';
  }
  // `keyof` y no la interfaz directa: el JSON de la base no está tipado, así que
  // los valores entran como `unknown` y se estrechan con guardas. Tomar la forma
  // por buena sin verificarla es cómo un `null` en la columna termina siendo un
  // descuento `NaN` en el XML.
  const bag = metadata as Record<keyof SubscriptionInvoiceMetadata, unknown>;
  const raw = bag.document_discount ?? bag.credit_applied;
  if (typeof raw !== 'string' && typeof raw !== 'number') return '0.00';
  try {
    const value = new Prisma.Decimal(raw);
    // ROUND_HALF_EVEN = 6, el mismo redondeo que usa el emisor al persistir.
    return value.greaterThan(0)
      ? value.toDecimalPlaces(2, 6).toFixed(2)
      : '0.00';
  } catch {
    return '0.00';
  }
}
