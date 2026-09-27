/**
 * Normalizador único del cobro multimétodo de contado.
 *
 * Convierte cualquiera de los dos contratos (escalar o `payments[]`) en una
 * lista de tramos validada, para que `processPosPaymentTransaction` y las ramas
 * `direct`/`shipped` de `payOrder` recorran UN solo camino de código: el
 * escalar se normaliza a un tramo con el mismo comportamiento de hoy.
 *
 * Reglas (decisión de negocio del plan de pago multimétodo):
 *   · Sólo métodos directos: Wompi nunca; wallet únicamente en la ruta POS
 *     que debita el ledger en la MISMA transacción (opt-in explícito), nunca contra entrega
 *     (`processing_mode = ON_DELIVERY`, que nace `pending`) ni crédito. Es el
 *     mismo criterio de `resolvePosPaymentRoute` + `isOnDeliveryMethod` en
 *     `payments.service.ts`: lo que ahí se va por pasarela o contra entrega,
 *     aquí se rechaza.
 *   · A lo sumo un tramo en efectivo: es el único que recibe y da vuelto.
 *   · Σ tramos = total a cobrar, comparado en centavos enteros con tolerancia
 *     cero (nunca floats).
 *   · `amount_received` se compara contra `undefined`: ausente significa pago
 *     exacto (igual que el escalar de hoy); `0` es un valor real y se rechaza
 *     por insuficiente.
 *
 * Lógica pura: no toca Prisma. El llamador carga los métodos y los pasa en
 * `methodsById`. Un id ausente del mapa se rechaza (fail closed): sólo un
 * método verificado como directo puede ser tramo.
 */
import { ErrorCodes, VendixHttpException } from 'src/common/errors';

/** Forma mínima del método que el normalizador necesita por tramo. */
export interface PaymentLegMethodInfo {
  /** `system_payment_methods.type` (`cash`, `card`, `wompi`, …). */
  type: string;
  /** `system_payment_methods.processing_mode` (`DIRECT`, `ONLINE`, `ON_DELIVERY`). */
  processing_mode?: string | null;
  /**
   * Nombre visible del método (mismo fallback que ya usa la respuesta del
   * POS: `store_payment_methods.display_name` primero, luego
   * `system_payment_methods.display_name`, nunca vacío). Opcional aquí
   * porque el llamador construye el mapa; `normalizePaymentLegs` cae a
   * `'Unknown'` si falta.
   */
  display_name?: string;
  /**
   * Etiqueta CONTABLE del método: `system_payment_methods.display_name`,
   * nunca el nombre que la tienda le puso. `AutoEntryService
   * .resolveCashBankKey` elige Caja o Bancos por esta etiqueta; un efectivo
   * renombrado «Caja» o «Contado» no debe caer en Bancos. Opcional: el
   * normalizador cae a `'Unknown'` si falta, igual que el POS.
   */
  accounting_method?: string;
}

/** Un tramo tal como llega en el DTO (`payments[]`). */
export interface PaymentLegInput {
  store_payment_method_id: number;
  amount: number;
  amount_received?: number;
  payment_reference?: string;
  bank_account_id?: number;
}

/**
 * Entrada del normalizador: los campos de pago del contrato escalar más el
 * arreglo opcional de tramos. Si `payments` trae elementos, gana sobre el
 * escalar; si no, el escalar se convierte en un único tramo.
 */
export interface NormalizePaymentLegsInput {
  store_payment_method_id?: number;
  amount_received?: number;
  payment_reference?: string;
  bank_account_id?: number;
  payments?: PaymentLegInput[];
}

/** Un tramo validado, listo para crear su fila `payments`. */
export interface NormalizedLeg {
  store_payment_method_id: number;
  amount: number;
  amount_received?: number;
  payment_reference?: string;
  bank_account_id?: number;
  /** True sólo en el (a lo sumo único) tramo en efectivo. */
  is_cash: boolean;
  /**
   * Nombre visible del método de este tramo (`payments[].payment_method` en
   * la respuesta de `flow/pay`, igual que ya expone el POS). Sale de
   * `methodsById`, sin consultas nuevas.
   */
  display_name: string;
  /**
   * Etiqueta contable del método (`system_payment_methods.display_name`) —
   * la que viaja como `payment_method` en `payment.received`. Separada de
   * `display_name` (UI/ticket) a propósito.
   */
  accounting_method: string;
}

export interface NormalizedPaymentLegs {
  legs: NormalizedLeg[];
  /** Vuelto del acto: recibido − monto del tramo en efectivo, o 0 sin efectivo. */
  change: number;
}

/** Métodos que liquidan por pasarela, después del commit (ver `resolvePosPaymentRoute`). */
const GATEWAY_METHOD_TYPES = ['wompi'];

const toCents = (value: number | null | undefined) =>
  Math.round(Number(value || 0) * 100);
const fromCents = (cents: number) => cents / 100;

function isCashMethod(method: PaymentLegMethodInfo): boolean {
  return method.type === 'cash';
}

function assertDirectMethod(
  storePaymentMethodId: number,
  method: PaymentLegMethodInfo | undefined,
  allowWallet: boolean,
): asserts method is PaymentLegMethodInfo {
  const detail = { store_payment_method_id: storePaymentMethodId };
  if (!method) {
    throw new VendixHttpException(
      ErrorCodes.PAY_MULTI_TENDER_METHOD_NOT_ALLOWED,
      'El método de pago del tramo no está disponible para este cobro.',
      detail,
    );
  }
  if (
    GATEWAY_METHOD_TYPES.includes(method.type) ||
    (method.type === 'wallet' && (!allowWallet || method.processing_mode !== 'DIRECT')) ||
    method.type === 'credit' ||
    method.processing_mode === 'ON_DELIVERY'
  ) {
    throw new VendixHttpException(
      ErrorCodes.PAY_MULTI_TENDER_METHOD_NOT_ALLOWED,
      'Solo se aceptan métodos de pago directos en un cobro multimétodo de contado.',
      { ...detail, method_type: method.type },
    );
  }
}

export function normalizePaymentLegs(
  input: NormalizePaymentLegsInput,
  payableAmount: number,
  methodsById: Record<number, PaymentLegMethodInfo>,
  options: { allowWallet?: boolean } = {},
): NormalizedPaymentLegs {
  const rawLegs: PaymentLegInput[] =
    input.payments && input.payments.length > 0
      ? input.payments
      : [
          {
            store_payment_method_id: input.store_payment_method_id as number,
            amount: payableAmount,
            amount_received: input.amount_received,
            payment_reference: input.payment_reference,
            bank_account_id: input.bank_account_id,
          },
        ];

  const legs: NormalizedLeg[] = rawLegs.map((raw) => {
    const method = methodsById[raw.store_payment_method_id];
    assertDirectMethod(raw.store_payment_method_id, method, options.allowWallet === true);
    if (toCents(raw.amount) <= 0) {
      throw new VendixHttpException(
        ErrorCodes.PAY_INVALID_AMOUNT_001,
        'El monto de cada tramo debe ser mayor a cero.',
        { store_payment_method_id: raw.store_payment_method_id },
      );
    }
    return {
      store_payment_method_id: raw.store_payment_method_id,
      amount: raw.amount,
      amount_received: raw.amount_received,
      payment_reference: raw.payment_reference,
      bank_account_id: raw.bank_account_id,
      is_cash: isCashMethod(method),
      display_name: method.display_name || 'Unknown',
      accounting_method: method.accounting_method || 'Unknown',
    };
  });

  const cashLegs = legs.filter((leg) => leg.is_cash);
  if (cashLegs.length > 1) {
    throw new VendixHttpException(
      ErrorCodes.PAY_MULTI_TENDER_MULTIPLE_CASH,
      'Solo uno de los tramos puede ser en efectivo.',
      {
        cash_legs: cashLegs.map((leg) => leg.store_payment_method_id),
      },
    );
  }

  const legsCents = legs.reduce((sum, leg) => sum + toCents(leg.amount), 0);
  const payableCents = toCents(payableAmount);
  if (legsCents !== payableCents) {
    throw new VendixHttpException(
      ErrorCodes.PAY_MULTI_TENDER_SUM_MISMATCH,
      'La suma de los tramos debe ser igual al total a cobrar, al centavo.',
      {
        legs_total: fromCents(legsCents),
        payable_amount: fromCents(payableCents),
      },
    );
  }

  let change = 0;
  const cashLeg = cashLegs[0];
  if (cashLeg) {
    // Ausente (o nulo) ⇒ pago exacto, igual que el escalar de hoy
    // (`processPosPaymentTransaction`). `0` es insuficiente, no ausente: por
    // eso se compara contra `undefined` y nunca por falsy.
    const received =
      cashLeg.amount_received !== undefined && cashLeg.amount_received !== null
        ? Number(cashLeg.amount_received)
        : cashLeg.amount;
    if (toCents(received) < toCents(cashLeg.amount)) {
      throw new VendixHttpException(
        ErrorCodes.PAY_MULTI_TENDER_CASH_INSUFFICIENT,
        'El monto recibido en efectivo no puede ser menor al monto del tramo.',
        {
          store_payment_method_id: cashLeg.store_payment_method_id,
          leg_amount: cashLeg.amount,
          amount_received: cashLeg.amount_received ?? null,
        },
      );
    }
    change = fromCents(toCents(received) - toCents(cashLeg.amount));
  }

  return { legs, change };
}
