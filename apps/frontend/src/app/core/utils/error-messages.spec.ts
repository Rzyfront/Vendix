import { HttpErrorResponse } from '@angular/common/http';

import { DEFAULT_ERROR_MESSAGE, ERROR_MESSAGES } from './error-messages';
import { parseApiError } from './parse-api-error';

/**
 * Words that would accuse the merchant of a debt.
 *
 * A store locked by `SUBSCRIPTION_011` had its plan retired from the catalog:
 * the renewal could not run, but nothing is owed. Charging someone with a debt
 * they do not have generates support tickets and destroys trust, so the copy is
 * asserted negatively here — an assert is what stops a future refactor from
 * quietly reintroducing dunning language.
 */
const DEBT_WORDS = ['pago', 'deuda', 'mora', 'pendiente'];

describe('ERROR_MESSAGES — SUBSCRIPTION_011 (plan retired from catalog)', () => {
  it('resolves to its own copy, not the generic DEFAULT_ERROR_MESSAGE', () => {
    const copy = ERROR_MESSAGES['SUBSCRIPTION_011'];

    expect(copy).toBeDefined();
    expect(copy).not.toBe(DEFAULT_ERROR_MESSAGE);
    expect((copy ?? '').trim().length).toBeGreaterThan(0);
  });

  it('parseApiError maps the backend code to the Spanish copy (no generic fallback)', () => {
    const parsed = parseApiError({
      error: {
        statusCode: 402,
        error_code: 'SUBSCRIPTION_011',
        // Backend `message` is the English devMessage from error-codes.ts.
        message: 'Plan retired — choose an active plan to continue',
        details: { subscription_state: 'suspended' },
      },
    });

    expect(parsed.errorCode).toBe('SUBSCRIPTION_011');
    expect(parsed.userMessage).toBe(ERROR_MESSAGES['SUBSCRIPTION_011']);
    expect(parsed.userMessage).not.toBe(DEFAULT_ERROR_MESSAGE);
    // The English dev copy must never become the user-facing message.
    expect(parsed.userMessage).not.toContain('Plan retired');
  });

  it('states the real reason: the plan was retired and an active plan must be picked', () => {
    const copy = (ERROR_MESSAGES['SUBSCRIPTION_011'] ?? '').toLowerCase();

    expect(copy).toContain('retirado');
    expect(copy).toContain('catalogo');
    expect(copy).toContain('vigente');
  });

  it('never mentions a debt (this store owes nothing)', () => {
    const copy = (ERROR_MESSAGES['SUBSCRIPTION_011'] ?? '').toLowerCase();

    for (const word of DEBT_WORDS) {
      expect(copy).not.toContain(word);
    }
  });
});

/**
 * QUI-560 — el código tipado tiene que sobrevivir a la capa de servicio.
 *
 * `store-settings.service.ts` aplanaba el `HttpErrorResponse` a
 * `new Error(message)` en su `catchError`, y con eso `parseApiError` perdía el
 * `error_code` y devolvía SIEMPRE el mensaje genérico: el backend respondía
 * `409 CASH_REGISTER_DISABLE_001`, la copy existía en `ERROR_MESSAGES`, y el
 * usuario igual veía "ocurrió un error inesperado".
 *
 * El servicio ahora re-lanza el error CRUDO, así que el test que importa es el
 * del `HttpErrorResponse` real: es la forma exacta que reciben los consumidores.
 * El último caso fija el bug original — un Error aplanado NO resuelve código —
 * para que reintroducir el `new Error(message)` rompa la suite en vez de
 * degradar el mensaje en silencio.
 */
describe('ERROR_MESSAGES — CASH_REGISTER_DISABLE_001 (caja con sesiones abiertas)', () => {
  it('resuelve a su propia copy y no al DEFAULT_ERROR_MESSAGE', () => {
    const copy = ERROR_MESSAGES['CASH_REGISTER_DISABLE_001'];

    expect(copy).toBeDefined();
    expect(copy).not.toBe(DEFAULT_ERROR_MESSAGE);
    // Debe decir qué hacer, no sólo que falló.
    expect((copy ?? '').toLowerCase()).toContain('caja registradora');
  });

  it('parseApiError lo mapea desde el cuerpo JSON del 409', () => {
    const parsed = parseApiError({
      error: {
        statusCode: 409,
        error_code: 'CASH_REGISTER_DISABLE_001',
        message:
          'No se puede deshabilitar la caja registradora: la tienda tiene 1 sesión abierta en "Caja Principal".',
        details: { open_sessions: 1, registers: [{ id: 19, name: 'Caja Principal' }] },
      },
    });

    expect(parsed.errorCode).toBe('CASH_REGISTER_DISABLE_001');
    expect(parsed.userMessage).toBe(ERROR_MESSAGES['CASH_REGISTER_DISABLE_001']);
    expect(parsed.details).toEqual({
      open_sessions: 1,
      registers: [{ id: 19, name: 'Caja Principal' }],
    });
  });

  it('lo mapea desde un HttpErrorResponse real, que es lo que re-lanza el servicio', () => {
    const raw = new HttpErrorResponse({
      status: 409,
      statusText: 'Conflict',
      url: 'https://api.vendix.com/api/store/settings',
      error: {
        statusCode: 409,
        error_code: 'CASH_REGISTER_DISABLE_001',
        message: 'Cannot disable the cash register module while ...',
        details: { open_sessions: 2 },
      },
    });

    const parsed = parseApiError(raw);

    expect(parsed.errorCode).toBe('CASH_REGISTER_DISABLE_001');
    expect(parsed.userMessage).toBe(ERROR_MESSAGES['CASH_REGISTER_DISABLE_001']);
    // `raw.message` es el texto técnico de Angular ("Http failure response
    // for ..."): nunca debe convertirse en el mensaje del usuario.
    expect(parsed.userMessage).not.toContain('Http failure');
    expect(parsed.details).toEqual({ open_sessions: 2 });
  });

  it('un Error aplanado cae al genérico — así se veía el bug original', () => {
    // Regresión: si alguien vuelve a poner `new Error(message)` en un
    // `catchError`, este es el resultado, y la suite lo deja documentado.
    const parsed = parseApiError(new Error('cualquier cosa'));

    expect(parsed.errorCode).toBeNull();
    expect(parsed.userMessage).toBe(DEFAULT_ERROR_MESSAGE);
  });
});

describe('ERROR_MESSAGES — real unpaid-balance codes stay untouched', () => {
  it('SUBSCRIPTION_008 keeps its unpaid-balance copy', () => {
    expect(ERROR_MESSAGES['SUBSCRIPTION_008']).toBe(
      'Suscripcion suspendida por falta de pago.',
    );
  });

  it('SUBSCRIPTION_009 keeps its unpaid-balance copy', () => {
    expect(ERROR_MESSAGES['SUBSCRIPTION_009']).toBe(
      'Suscripcion bloqueada. Regulariza tu pago para continuar.',
    );
  });

  it('008/009 resolve through parseApiError to their own copy', () => {
    for (const code of ['SUBSCRIPTION_008', 'SUBSCRIPTION_009']) {
      const parsed = parseApiError({ error: { error_code: code } });
      expect(parsed.userMessage).toBe(ERROR_MESSAGES[code]);
      expect(parsed.userMessage).not.toBe(DEFAULT_ERROR_MESSAGE);
    }
  });
});

/**
 * Escáner de facturas del POP. Ningún `INV_SCAN_*` estaba mapeado, así que el
 * modal enseñaba el devMessage crudo del backend — «AI OCR response parsed but
 * is missing required fields» —, que ni está en español ni dice qué hacer.
 */
describe('ERROR_MESSAGES — INV_SCAN_* (escáner de facturas POP)', () => {
  const CODES = [
    'INV_SCAN_NO_FILE',
    'INV_SCAN_INVALID_FILE',
    'INV_SCAN_AI_FAIL',
    'INV_SCAN_PARSE_FAIL',
    'INV_SCAN_INCOMPLETE',
  ];

  it('todos tienen copy propia, no el genérico', () => {
    for (const code of CODES) {
      const copy = ERROR_MESSAGES[code];
      expect(copy).toBeDefined();
      expect(copy).not.toBe(DEFAULT_ERROR_MESSAGE);
    }
  });

  it('el devMessage en inglés del 422 nunca llega al usuario', () => {
    const parsed = parseApiError(
      new HttpErrorResponse({
        status: 422,
        statusText: 'Unprocessable Entity',
        error: {
          statusCode: 422,
          error_code: 'INV_SCAN_INCOMPLETE',
          message: 'AI OCR response parsed but is missing required fields',
        },
      }),
    );

    expect(parsed.errorCode).toBe('INV_SCAN_INCOMPLETE');
    expect(parsed.userMessage).toBe(ERROR_MESSAGES['INV_SCAN_INCOMPLETE']);
    expect(parsed.userMessage).not.toContain('AI OCR');
  });

  it('INV_SCAN_INCOMPLETE ya no culpa al total: pide proveedor y productos', () => {
    const copy = (ERROR_MESSAGES['INV_SCAN_INCOMPLETE'] ?? '').toLowerCase();

    expect(copy).toContain('proveedor');
    expect(copy).toContain('productos');
  });
});
