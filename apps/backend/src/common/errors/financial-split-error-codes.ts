import type { ErrorCodeEntry } from './error-codes';

/** F-006 entries in the canonical Vendix exception contract. Kept as a domain
 * group so concurrent lifecycle changes need not edit the same large catalog.
 */
export const FinancialSplitErrors = {
  SPLIT_SOURCE_CONFLICT: { code: 'SPLIT_SOURCE_CONFLICT', httpStatus: 409, devMessage: 'La cuenta cambió; vuelve a generar la vista previa.' },
  SPLIT_ALREADY_ACTIVE: { code: 'SPLIT_ALREADY_ACTIVE', httpStatus: 409, devMessage: 'La orden ya tiene una división activa.' },
  SPLIT_SOURCE_INCONSISTENT: { code: 'SPLIT_SOURCE_INCONSISTENT', httpStatus: 422, devMessage: 'Los importes de la orden no permiten un reparto financiero consistente.' },
  SPLIT_ACCOUNT_NOT_FOUND: { code: 'SPLIT_ACCOUNT_NOT_FOUND', httpStatus: 404, devMessage: 'La cuenta financiera no existe en esta tienda.' },
  SPLIT_ACCOUNT_LOCKED: { code: 'SPLIT_ACCOUNT_LOCKED', httpStatus: 409, devMessage: 'La orden tiene cuentas independientes. Usa cada cuenta para cobrar o facturar.' },
  SPLIT_PAYMENT_AMOUNT: { code: 'SPLIT_PAYMENT_AMOUNT', httpStatus: 422, devMessage: 'El importe excede el saldo disponible de la cuenta.' },
  SPLIT_IDEMPOTENCY_CONFLICT: { code: 'SPLIT_IDEMPOTENCY_CONFLICT', httpStatus: 409, devMessage: 'La clave ya se usó con otra cuenta, importe o división.' },
  SPLIT_PAYMENT_METHOD: { code: 'SPLIT_PAYMENT_METHOD', httpStatus: 422, devMessage: 'El medio de pago no está disponible para esta cuenta.' },
  SPLIT_CANCEL_BLOCKED: { code: 'SPLIT_CANCEL_BLOCKED', httpStatus: 409, devMessage: 'No se puede cancelar un reparto con pagos nuevos o documentos vigentes.' },
} satisfies Record<string, ErrorCodeEntry>;
