import { invoiceCreateFailurePolicy, mustConfirmInvoiceCreate, resolveInvoiceCreateRequestKey } from './invoice-create-retry-state';

describe('Nueva factura — reintentos sin duplicados', () => {
  const KEY = '3dd5fe96-659c-4ef7-b489-753007e411ca';
  it('genera una sola clave y la reutiliza en todos los reintentos', () => {
    const generate = jest.fn(() => KEY);
    const first = resolveInvoiceCreateRequestKey(null, null, generate);
    const retry = resolveInvoiceCreateRequestKey(first.key, KEY, generate);
    expect(retry.key).toBe(KEY);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('recargar recupera la incertidumbre y no genera UUID nuevo', () => {
    const generate = jest.fn(() => 'otro');
    const reloaded = resolveInvoiceCreateRequestKey(null, KEY, generate);
    expect(reloaded).toEqual({ key: KEY, recoveredUncertainty: true });
    expect(generate).not.toHaveBeenCalled();
    expect(mustConfirmInvoiceCreate(false, false, KEY)).toBe(true);
  });

  it.each([undefined, 0, 408, 500, 502, 504])('HTTP %s conserva clave y payload', (status) => {
    expect(invoiceCreateFailurePolicy(status, false)).toMatchObject({
      releasePayload: false, preserveRequestKey: true, resultUncertain: true,
    });
  });

  it.each([400, 403, 409, 422])('timeout → recarga → HTTP %s permite corregir SIN liberar UUID', (status) => {
    const restored = resolveInvoiceCreateRequestKey(null, KEY, () => 'otro');
    const policy = invoiceCreateFailurePolicy(status, restored.recoveredUncertainty);
    expect(policy).toMatchObject({ releasePayload: true, preserveRequestKey: true, resultUncertain: true });
    expect(resolveInvoiceCreateRequestKey(restored.key, KEY, () => 'otro').key).toBe(KEY);
    expect(mustConfirmInvoiceCreate(false, policy.resultUncertain, KEY)).toBe(true);
  });

  it('un 409 inicial permite seleccionar cliente y corregir sin payload inline congelado', () => {
    expect(invoiceCreateFailurePolicy(409, false)).toMatchObject({
      releasePayload: true, preserveRequestKey: false, resultUncertain: false,
    });
  });

  it('con almacenamiento bloqueado sigue impidiendo descartar el UUID incierto en memoria', () => {
    expect(mustConfirmInvoiceCreate(false, true, null)).toBe(true);
    expect(mustConfirmInvoiceCreate(false, false, null)).toBe(false);
  });
});
