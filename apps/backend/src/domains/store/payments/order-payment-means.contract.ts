import { Prisma } from '@prisma/client';

import {
  DIAN_PAYMENT_MEANS,
  DIAN_PAYMENT_METHODS,
  DianPaymentMeansCode,
  DianPaymentMethodCode,
  isDianPaymentMeansCode,
} from '../invoicing/providers/dian-direct/constants/dian-document-types';

/**
 * CONTRATO DEL MEDIO DE PAGO DE UNA ORDEN
 * =======================================
 *
 * Una orden declara su método de pago en dos registros distintos y a la vez:
 *
 * 1. La ETIQUETA LEGIBLE que ve una persona: el tiquete POS, el PDF de la
 *    factura y las columnas «Método de pago» de los reportes XLSX.
 * 2. El PAR DIAN que viaja en la factura electrónica: la FORMA de pago
 *    (`cac:PaymentMeans/cbc:ID`, contado/crédito) y el MEDIO de pago
 *    (`cbc:PaymentMeansCode`, con qué instrumento).
 *
 * ¿POR QUÉ UN CONTRATO COMPARTIDO Y NO LA LÓGICA EN CADA SUPERFICIE?
 *
 * Porque son SEIS superficies leyendo la misma orden —tiquete POS, factura
 * electrónica, PDF, dos reportes XLSX y el detalle de orden— y cada una lo
 * resolvía por su cuenta. Divergían en lo que más duele: unas leían sólo el
 * primer pago (y perdían la mitad de un pago mixto), otras ignoraban el
 * `display_name` personalizado de la tienda, y el default del medio DIAN no era
 * el mismo en todas. Una orden podía imprimirse «Efectivo» en el tiquete y
 * declararse con tarjeta ante la DIAN. Aquí vive UNA sola definición.
 *
 * NO confundir las dos tablas DIAN: FORMA responde «¿contado o crédito?» y
 * MEDIO responde «¿con qué instrumento?». Un pago con tarjeta de crédito es
 * forma `'1'` (el comercio cobra ya) y medio `'48'`.
 */

// ---------------------------------------------------------------------------
// Include canónico
// ---------------------------------------------------------------------------

/**
 * El ÚNICO include válido para leer los pagos de una orden con intención de
 * declarar su método de pago. Se exporta como constante para que las seis
 * superficies carguen exactamente la misma forma: una superficie que olvide
 * anidar `system_payment_method` no rompe la compilación, simplemente se queda
 * sin `dian_code` y sin el nombre del sistema, y cae al default silenciosamente.
 *
 * Filtra `state: 'succeeded'` en la propia consulta porque un pago `pending` o
 * `failed` no es evidencia de nada: cobrar es lo que declara el método, no
 * intentarlo. Las funciones de abajo vuelven a filtrar por su cuenta para ser
 * correctas aunque el llamador traiga los pagos de otra consulta.
 *
 * `orderBy: { paid_at: 'asc' }` fija el orden de la etiqueta del pago mixto:
 * «Efectivo + Tarjeta» se lee en el orden en que el cliente pagó, no en el
 * orden arbitrario en que Postgres devuelva las filas.
 */
export const ORDER_PAYMENT_MEANS_INCLUDE = {
  where: { state: 'succeeded' },
  include: {
    store_payment_method: { include: { system_payment_method: true } },
  },
  orderBy: { paid_at: 'asc' },
} satisfies Prisma.orders$paymentsArgs;

// ---------------------------------------------------------------------------
// Forma estructural mínima
// ---------------------------------------------------------------------------

/**
 * Forma mínima del método de pago del sistema. Se define aquí, estructural, en
 * vez de importar el tipo generado por Prisma, para que las funciones sean
 * testeables con literales y reutilizables desde un DTO o un snapshot que ya no
 * es una fila viva.
 */
export interface OrderPaymentSystemMethodForMeans {
  name?: string | null;
  display_name?: string | null;
  dian_code?: string | null;
}

/** Forma mínima del método de pago de la tienda (el que lleva el alias local). */
export interface OrderPaymentStoreMethodForMeans {
  display_name?: string | null;
  system_payment_method?: OrderPaymentSystemMethodForMeans | null;
}

/** Forma mínima de un pago, tal como lo entrega `ORDER_PAYMENT_MEANS_INCLUDE`. */
export interface OrderPaymentForMeans {
  state?: string | null;
  paid_at?: Date | string | null;
  store_payment_method?: OrderPaymentStoreMethodForMeans | null;
}

/** Forma mínima de la orden: sólo la forma de pago ya declarada por el POS. */
export interface OrderForPaymentMeans {
  payment_form?: string | null;
}

/** Par DIAN que la factura electrónica necesita para `cac:PaymentMeans`. */
export interface OrderDianPaymentMeans {
  /** `cbc:ID` — `'1'` contado, `'2'` crédito. */
  payment_form: DianPaymentMethodCode;
  /** `cbc:PaymentMeansCode` — el instrumento. */
  payment_means_code: DianPaymentMeansCode;
}

/** Único estado de pago que cuenta como cobrado. */
const SUCCEEDED_PAYMENT_STATE = 'succeeded';

/** Separador de la etiqueta de pago mixto. */
const PAYMENT_LABEL_SEPARATOR = ' + ';

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Milisegundos de `paid_at`, o `null` si no hay fecha utilizable. */
function paidAtMillis(payment: OrderPaymentForMeans): number | null {
  const value = payment.paid_at;
  if (!value) return null;
  const millis = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(millis) ? null : millis;
}

/**
 * Pagos cobrados, en orden cronológico de cobro y con los `paid_at` nulos al
 * final.
 *
 * El filtro por estado es REDUNDANTE con `ORDER_PAYMENT_MEANS_INCLUDE` a
 * propósito: una función que sólo es correcta cuando el llamador ya filtró bien
 * es una trampa: el día que alguien le pase `order.payments` de otra consulta
 * (y va a pasar), declararía un método que nadie pagó.
 *
 * El orden se recompone acá, en vez de confiar en el `orderBy`, por el mismo
 * motivo. El desempate por índice mantiene la ordenación estable: dos pagos con
 * el mismo instante conservan el orden en que llegaron.
 */
function succeededPayments(
  payments?: readonly OrderPaymentForMeans[] | null,
): OrderPaymentForMeans[] {
  return (payments ?? [])
    .filter(
      (payment): payment is OrderPaymentForMeans =>
        !!payment && payment.state === SUCCEEDED_PAYMENT_STATE,
    )
    .map((payment, index) => ({ payment, index }))
    .sort((a, b) => {
      const left = paidAtMillis(a.payment);
      const right = paidAtMillis(b.payment);
      if (left === right) return a.index - b.index;
      if (left === null) return 1;
      if (right === null) return -1;
      return left - right;
    })
    .map((entry) => entry.payment);
}

/**
 * Etiqueta de UN pago, en cascada de tres niveles:
 *
 * 1. `store_payment_method.display_name` — el alias que la tienda le puso
 *    («Datáfono Bancolombia»). Gana siempre: es el nombre que el cajero
 *    reconoce y el que el cliente espera ver en su tiquete.
 * 2. `system_payment_method.display_name` — el nombre canónico de la
 *    plataforma («Tarjeta de Crédito»).
 * 3. `system_payment_method.name` — la clave técnica, como último recurso.
 *
 * `undefined` cuando ninguno de los tres existe: un pago sin nombre no aporta
 * nada a la etiqueta y se omite en vez de contaminarla con un vacío.
 */
function paymentLabel(payment: OrderPaymentForMeans): string | undefined {
  const storeMethod = payment.store_payment_method;
  const systemMethod = storeMethod?.system_payment_method;
  const candidates = [
    storeMethod?.display_name,
    systemMethod?.display_name,
    systemMethod?.name,
  ];
  for (const candidate of candidates) {
    const label = (candidate ?? '').trim();
    if (label) return label;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Etiqueta legible
// ---------------------------------------------------------------------------

/**
 * Etiqueta legible del método de pago de una orden, lista para imprimir.
 *
 * Un pago mixto une sus etiquetas con `' + '` («Efectivo + Tarjeta de
 * Crédito»), en orden de cobro. Las etiquetas repetidas se DEDUPLICAN
 * preservando la primera aparición: dos pagos en efectivo (un abono y el saldo)
 * son un método, no dos, y «Efectivo + Efectivo» no le dice nada a nadie.
 *
 * Devuelve `undefined` —no `'N/A'`, ni `'—'`, ni cadena vacía— cuando no hay
 * ningún pago cobrado con nombre. La ausencia la representa cada superficie a
 * su manera: el reporte XLSX quiere una celda vacía, el tiquete POS quiere
 * omitir la línea entera, y el detalle de orden quiere su propio placeholder.
 * Codificar aquí una de las tres obligaría a las otras dos a deshacerla.
 */
export function resolveOrderPaymentLabel(
  payments?: readonly OrderPaymentForMeans[] | null,
): string | undefined {
  const labels: string[] = [];
  for (const payment of succeededPayments(payments)) {
    const label = paymentLabel(payment);
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels.length ? labels.join(PAYMENT_LABEL_SEPARATOR) : undefined;
}

// ---------------------------------------------------------------------------
// Par DIAN
// ---------------------------------------------------------------------------

/**
 * Par forma/medio de pago de la orden para `cac:PaymentMeans`.
 *
 * FORMA DE PAGO (`payment_form`)
 *
 * `orders.payment_form` ya lo escribe el POS al cerrar la venta y es la fuente
 * de verdad cuando trae un valor de la tabla (`'1'` contado, `'2'` crédito).
 * Cualquier otro contenido —nulo, vacío, basura histórica— se ignora y se
 * deriva de los hechos: hay pago cobrado ⇒ contado; no hay ninguno ⇒ crédito,
 * porque una factura sin cobro es exactamente una venta a plazo.
 *
 * MEDIO DE PAGO (`payment_means_code`)
 *
 * Se recolectan los `dian_code` de los pagos cobrados, descartando los nulos,
 * los vacíos y los que NO pertenecen a la tabla de la DIAN. Ese último filtro
 * no es paranoia: en producción hay filas con códigos inventados (el `'99'`
 * histórico de wallet) que la DIAN rechaza con FAU-xx al validar el XML. Un
 * código basura equivale a no tener código.
 *
 * - Exactamente UN código distinto ⇒ ese código. Es el caso normal.
 * - DOS O MÁS códigos distintos (pago mixto) ⇒ `'1'`, instrumento no definido.
 *   `cbc:PaymentMeansCode` es UN valor y una orden pagada mitad en efectivo y
 *   mitad con tarjeta no tiene un instrumento único. Elegir uno de los dos
 *   —el primero, el mayor, el del monto más alto— sería una AFIRMACIÓN FALSA
 *   dentro de un documento fiscal: diría «esto se pagó en efectivo» sobre una
 *   venta que a medias no lo fue. `'1'` es el valor de la propia tabla de la
 *   DIAN para decir «no se determina el instrumento», que es justo la verdad.
 * - NINGÚN código utilizable (sin pagos, o todos con `dian_code` nulo o
 *   inválido) ⇒ también `'1'`. NUNCA `'10'` (efectivo): la ausencia de pago no
 *   es evidencia de efectivo. Declarar efectivo por defecto convierte cada
 *   venta a crédito y cada método sin configurar en una afirmación de caja que
 *   nadie hizo, y ese sesgo sistemático es lo que la DIAN cruza contra los
 *   movimientos reales.
 */
export function resolveOrderDianPaymentMeans(
  order?: OrderForPaymentMeans | null,
  payments?: readonly OrderPaymentForMeans[] | null,
): OrderDianPaymentMeans {
  const succeeded = succeededPayments(payments);

  const declaredForm = (order?.payment_form ?? '').trim();
  const payment_form: DianPaymentMethodCode =
    declaredForm === DIAN_PAYMENT_METHODS.CASH ||
    declaredForm === DIAN_PAYMENT_METHODS.CREDIT
      ? (declaredForm as DianPaymentMethodCode)
      : succeeded.length > 0
        ? DIAN_PAYMENT_METHODS.CASH
        : DIAN_PAYMENT_METHODS.CREDIT;

  const codes = new Set<string>();
  for (const payment of succeeded) {
    const code = (
      payment.store_payment_method?.system_payment_method?.dian_code ?? ''
    ).trim();
    if (code && isDianPaymentMeansCode(code)) codes.add(code);
  }

  // El cast es deliberado: `DianPaymentMeansCode` nombra los instrumentos que
  // un comercio colombiano usa de verdad, mientras que `isDianPaymentMeansCode`
  // valida contra las 75 filas completas de `MediosPago-2.1.gc`. Un código
  // legal pero no nombrado (un giro, una nota promisoria) sigue siendo válido
  // para el XML y no debe degradarse a `'1'` sólo por no estar en la unión.
  const payment_means_code: DianPaymentMeansCode =
    codes.size === 1
      ? ([...codes][0] as DianPaymentMeansCode)
      : DIAN_PAYMENT_MEANS.UNDEFINED_INSTRUMENT;

  return { payment_form, payment_means_code };
}
