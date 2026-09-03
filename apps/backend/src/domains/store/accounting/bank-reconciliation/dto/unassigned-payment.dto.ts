/**
 * Proyección del listado de pagos sin asignar (payments.bank_account_id IS NULL).
 *
 * CP-POLLO-ARABE-727 / E.2 (cross-ref QUI-728).
 * DTO de respuesta: NO expone `current_balance`, `opening_balance` ni datos de
 * extracto (bank_transactions). La pantalla solo necesita identificar el pago y
 * a qué cuenta propia se asignó.
 */

/** Cuenta bancaria asignable en el selector del modal de asignación. */
export interface AssignableBankAccount {
  id: number;
  name: string;
  bank_name: string;
  account_number: string;
}

/** Pago sin asignar, para la lista "Sin asignar" y la acción de asignación. */
export interface UnassignedPayment {
  payment_id: number;
  order_id: number;
  order_number: string | null;
  amount: number;
  currency: string | null;
  state: string;
  paid_at: string | null;
  payment_method: string | null;
  payment_method_display: string | null;
  gateway_reference: string | null;
  customer_alias: string | null;
}
