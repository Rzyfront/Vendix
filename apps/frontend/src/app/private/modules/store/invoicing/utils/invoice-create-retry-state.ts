/** Un rechazo posterior a un timeout no prueba que el primer POST haya fallado. */
export function invoiceCreateFailurePolicy(status: number | undefined, previouslyUncertain: boolean) {
  const definitiveRejection = status != null && status >= 400 && status < 500 && status !== 408;
  return {
    releasePayload: definitiveRejection,
    preserveRequestKey: previouslyUncertain || !definitiveRejection,
    uncertainResponse: !definitiveRejection,
    resultUncertain: previouslyUncertain || !definitiveRejection,
  };
}

/** La recarga recupera la clave, no genera un segundo intento económico. */
export function resolveInvoiceCreateRequestKey(
  current: string | null,
  stored: string | null,
  generate: () => string,
): { key: string; recoveredUncertainty: boolean } {
  return { key: current ?? stored ?? generate(), recoveredUncertainty: !current && !!stored };
}

export function mustConfirmInvoiceCreate(
  hasPendingPayload: boolean,
  resultUncertain: boolean,
  storedKey: string | null,
): boolean {
  return hasPendingPayload || resultUncertain || !!storedKey;
}
