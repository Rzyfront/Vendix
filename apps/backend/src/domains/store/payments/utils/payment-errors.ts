import { ErrorCodes, ErrorCodeEntry } from 'src/common/errors';

export enum PaymentErrorCodes {
  INVALID_ORDER = 'INVALID_ORDER',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  PAYMENT_METHOD_DISABLED = 'PAYMENT_METHOD_DISABLED',
  PROCESSOR_ERROR = 'PROCESSOR_ERROR',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  GATEWAY_TIMEOUT = 'GATEWAY_TIMEOUT',
  FRAUD_DETECTED = 'FRAUD_DETECTED',
  DUPLICATE_PAYMENT = 'DUPLICATE_PAYMENT',
  CURRENCY_NOT_SUPPORTED = 'CURRENCY_NOT_SUPPORTED',
}

/**
 * @deprecated Use VendixHttpException with ErrorCodes.PAY_* instead
 */
export class PaymentError extends Error {
  constructor(
    public code: PaymentErrorCodes,
    message: string,
    public details?: any,
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

/** Maps legacy PaymentErrorCodes to the new standardized ErrorCodeEntry */
export const LEGACY_TO_NEW: Record<PaymentErrorCodes, ErrorCodeEntry> = {
  [PaymentErrorCodes.INVALID_ORDER]: ErrorCodes.PAY_INVALID_ORDER_001,
  [PaymentErrorCodes.INVALID_AMOUNT]: ErrorCodes.PAY_INVALID_AMOUNT_001,
  [PaymentErrorCodes.PAYMENT_METHOD_DISABLED]:
    ErrorCodes.PAY_METHOD_DISABLED_001,
  [PaymentErrorCodes.PROCESSOR_ERROR]: ErrorCodes.PAY_PROCESSOR_001,
  [PaymentErrorCodes.VALIDATION_FAILED]: ErrorCodes.PAY_VALIDATE_001,
  [PaymentErrorCodes.INSUFFICIENT_FUNDS]: ErrorCodes.PAY_INVALID_AMOUNT_001,
  [PaymentErrorCodes.GATEWAY_TIMEOUT]: ErrorCodes.PAY_PROCESSOR_001,
  [PaymentErrorCodes.FRAUD_DETECTED]: ErrorCodes.PAY_VALIDATE_001,
  [PaymentErrorCodes.DUPLICATE_PAYMENT]: ErrorCodes.PAY_DUPLICATE_001,
  [PaymentErrorCodes.CURRENCY_NOT_SUPPORTED]: ErrorCodes.PAY_VALIDATE_001,
};

export const PAYMENT_ERRORS = {
  [PaymentErrorCodes.INVALID_ORDER]:
    'La orden especificada no es válida o no existe',
  [PaymentErrorCodes.INVALID_AMOUNT]: 'El monto del pago no es válido',
  [PaymentErrorCodes.PAYMENT_METHOD_DISABLED]:
    'El método de pago está deshabilitado',
  [PaymentErrorCodes.PROCESSOR_ERROR]: 'Error en el procesador de pago',
  [PaymentErrorCodes.VALIDATION_FAILED]:
    'La validación de los datos de pago falló',
  [PaymentErrorCodes.INSUFFICIENT_FUNDS]: 'Fondos insuficientes',
  [PaymentErrorCodes.GATEWAY_TIMEOUT]:
    'Timeout en la comunicación con el gateway',
  [PaymentErrorCodes.FRAUD_DETECTED]: 'Posible fraude detectado',
  [PaymentErrorCodes.DUPLICATE_PAYMENT]: 'Pago duplicado detectado',
  [PaymentErrorCodes.CURRENCY_NOT_SUPPORTED]: 'Moneda no soportada',
};
