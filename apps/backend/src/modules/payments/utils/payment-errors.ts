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
