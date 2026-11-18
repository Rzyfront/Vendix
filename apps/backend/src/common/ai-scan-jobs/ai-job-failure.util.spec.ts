import { classifyAiJobFailure, failureNeedsIncident } from './ai-job-failure.util';

describe('classifyAiJobFailure (QUI-1020)', () => {
  it.each([
    ['RUT_SCAN_PARSE_FAIL', 'document'],
    ['MEMBER_SCAN_INVALID_FILE', 'document'],
    ['RTSCAN_NO_FILE', 'document'],
    ['INVOICE_DRAFT_SCAN_PARSE_FAIL', 'document'],
  ])('%s (4xx del documento) -> %s', (code, category) => {
    expect(classifyAiJobFailure(code)).toEqual({ category });
  });

  it.each([
    ['RUT_SCAN_AI_FAIL'],
    ['SYS_INTERNAL_001'],
    ['STORE_CONTEXT_001'],
    ['No se pudo leer el documento guardado. Intenta de nuevo.'],
    ['AI_SCAN_UNKNOWN_KIND'],
    [''],
    [undefined],
  ])('%s -> technical', (code) => {
    expect(classifyAiJobFailure(code)).toEqual({ category: 'technical' });
  });

  it.each([
    ['AI_PROVIDER_003', 'credits'],
    ['AI_PROVIDER_004', 'rate_limited'],
    ['AI_APP_004', 'rate_limited'],
    ['AI_VISION_001', 'not_configured'],
    ['AI_APP_003', 'not_configured'],
    ['SUBSCRIPTION_006', 'plan_quota'],
  ])('%s -> ai_unavailable/%s', (code, reason) => {
    expect(classifyAiJobFailure(code)).toEqual({
      category: 'ai_unavailable',
      reason,
    });
  });
});

describe('failureNeedsIncident', () => {
  it('avisa por fallo técnico y por IA de Vendix sin servicio', () => {
    expect(failureNeedsIncident({ category: 'technical' })).toBe(true);
    expect(
      failureNeedsIncident({ category: 'ai_unavailable', reason: 'credits' }),
    ).toBe(true);
    expect(
      failureNeedsIncident({
        category: 'ai_unavailable',
        reason: 'rate_limited',
      }),
    ).toBe(true);
  });

  it('no avisa por documento ilegible ni por cuota del plan de la tienda', () => {
    expect(failureNeedsIncident({ category: 'document' })).toBe(false);
    expect(
      failureNeedsIncident({ category: 'ai_unavailable', reason: 'plan_quota' }),
    ).toBe(false);
  });
});
