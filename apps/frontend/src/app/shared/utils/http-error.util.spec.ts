import { extractApiError } from './http-error.util';

/**
 * QUI-559 — el usuario debe leer POR QUÉ se rechazó la operación, no cómo falló
 * el transporte. El síntoma reportado era literalmente el toast
 * "Http failure response for … 409 Conflict" en la caja del POS.
 */
describe('extractApiError', () => {
  it('prefiere el mensaje de negocio del backend sobre el texto de transporte', () => {
    const result = extractApiError({
      status: 409,
      message:
        'Http failure response for https://api.vendix.com/api/store/payments/pos: 409 Conflict',
      error: {
        error_code: 'POS_STOCK_INSUFFICIENT_001',
        message:
          'Stock insuficiente para Dell Inspiron 15: requiere 10 unidades, disponible 8.',
      },
    });

    expect(result).toEqual({
      code: 'POS_STOCK_INSUFFICIENT_001',
      message:
        'Stock insuficiente para Dell Inspiron 15: requiere 10 unidades, disponible 8.',
      status: 409,
    });
  });

  it('nunca deja pasar el texto de transporte cuando no hay body estructurado', () => {
    const result = extractApiError({
      status: 0,
      message:
        'Http failure response for https://api.vendix.com/api: 0 Unknown Error',
      error: null,
    });

    // `message` queda undefined a propósito: el consumidor aplica su fallback
    // de dominio (`message || 'No se pudo …'`).
    expect(result.message).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.code).toBeUndefined();
  });

  it('une los mensajes cuando class-validator devuelve un arreglo', () => {
    const result = extractApiError({
      status: 400,
      error: { message: ['quantity debe ser positivo', 'store_id requerido'] },
    });

    expect(result.message).toBe('quantity debe ser positivo store_id requerido');
  });

  it('ignora entradas vacías dentro del arreglo de class-validator', () => {
    const result = extractApiError({
      error: { message: ['', '   ', 'sku ya existe'] },
    });

    expect(result.message).toBe('sku ya existe');
  });

  it('cae al primer errors[].message cuando el envelope lo anida', () => {
    const result = extractApiError({
      status: 422,
      error: {
        error_code: 'SYS_VALIDATION_001',
        errors: [{ message: '' }, { message: 'La fecha de corte es obligatoria' }],
      },
    });

    expect(result.code).toBe('SYS_VALIDATION_001');
    expect(result.message).toBe('La fecha de corte es obligatoria');
  });

  it('acepta un body ya serializado a string', () => {
    expect(extractApiError({ status: 400, error: 'Periodo contable cerrado' }).message).toBe(
      'Periodo contable cerrado',
    );
  });

  it('respeta el mensaje de un Error lanzado por una guarda del frontend', () => {
    expect(extractApiError(new Error('Debe seleccionar un cliente.')).message).toBe(
      'Debe seleccionar un cliente.',
    );
  });

  it('deja code y message vacíos ante null, undefined u objeto vacío', () => {
    for (const input of [null, undefined, {}]) {
      expect(extractApiError(input)).toEqual({
        code: undefined,
        message: undefined,
        status: undefined,
      });
    }
  });

  it('no rompe con responseType blob (el body es un Blob sin message)', () => {
    const result = extractApiError({
      status: 500,
      message: 'Http failure response for /reports/x.pdf: 500 Internal Server Error',
      error: new Blob(['{}'], { type: 'application/json' }),
    });

    expect(result.code).toBeUndefined();
    expect(result.message).toBeUndefined();
    expect(result.status).toBe(500);
  });
});
