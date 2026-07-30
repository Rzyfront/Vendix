import {
  extractPosErrorCode,
  extractPosErrorMessage,
} from './pos-backend-error.util';

/**
 * QUI-559 — el cajero debe leer POR QUÉ se bloqueó la venta, no cómo falló el
 * transporte. El síntoma reportado en el ticket era literalmente el toast
 * "Http failure response for … 409 Conflict".
 */
describe('extractPosErrorMessage', () => {
  const FALLBACK = 'Error de conexión al procesar el pago';

  it('prefiere el mensaje del backend sobre el texto de transporte', () => {
    const error = {
      status: 409,
      message:
        'Http failure response for https://api.vendix.com/api/store/payments/pos: 409 Conflict',
      error: {
        error_code: 'POS_STOCK_INSUFFICIENT_001',
        message:
          'Stock insuficiente para Dell Inspiron 15: requiere 10 unidades, disponible 8.',
      },
    };

    expect(extractPosErrorMessage(error, FALLBACK)).toBe(
      'Stock insuficiente para Dell Inspiron 15: requiere 10 unidades, disponible 8.',
    );
  });

  it('une los mensajes cuando class-validator devuelve un arreglo', () => {
    const error = {
      status: 400,
      error: { message: ['quantity debe ser positivo', 'store_id requerido'] },
    };

    expect(extractPosErrorMessage(error, FALLBACK)).toBe(
      'quantity debe ser positivo store_id requerido',
    );
  });

  it('nunca deja pasar el texto de transporte al toast', () => {
    const error = {
      status: 0,
      message: 'Http failure response for https://api.vendix.com/api: 0 Unknown Error',
      error: null,
    };

    expect(extractPosErrorMessage(error, FALLBACK)).toBe(FALLBACK);
  });

  it('respeta el mensaje de un Error lanzado por una guarda del frontend', () => {
    expect(
      extractPosErrorMessage(new Error('Debe seleccionar un cliente.'), FALLBACK),
    ).toBe('Debe seleccionar un cliente.');
  });

  it('cae al fallback ante null / undefined / objeto vacío', () => {
    expect(extractPosErrorMessage(null, FALLBACK)).toBe(FALLBACK);
    expect(extractPosErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
    expect(extractPosErrorMessage({}, FALLBACK)).toBe(FALLBACK);
  });
});

describe('extractPosErrorCode', () => {
  it('devuelve el error_code del envelope para ramificar sin comparar textos', () => {
    expect(
      extractPosErrorCode({ error: { error_code: 'INV_STOCK_002' } }),
    ).toBe('INV_STOCK_002');
  });

  it('devuelve null cuando no hay envelope tipado', () => {
    expect(extractPosErrorCode(new Error('boom'))).toBeNull();
    expect(extractPosErrorCode({ error: 'texto plano' })).toBeNull();
  });
});
