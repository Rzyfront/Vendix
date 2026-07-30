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
