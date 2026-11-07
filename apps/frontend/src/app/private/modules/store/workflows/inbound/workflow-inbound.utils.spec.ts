import { inboundCurlExample, inboundHookUrl, parseRateLimit } from './workflow-inbound.utils';

describe('workflow-inbound.utils', () => {
  it('joins the API base and the hook path without doubling slashes', () => {
    expect(inboundHookUrl('https://api.vendix.online/api/', '/public/workflows/hooks/wfh_1')).toBe(
      'https://api.vendix.online/api/public/workflows/hooks/wfh_1',
    );
  });

  it('builds a signed curl that reads the secret from the environment and carries an idempotency key', () => {
    const curl = inboundCurlExample('https://x/api/public/workflows/hooks/wfh_1', ['monto', 'motivo']);
    expect(curl).toContain(`BODY='{"values":{"monto":"valor","motivo":"valor"}}'`);
    expect(curl).toContain('openssl dgst -sha256 -hmac "$VENDIX_WEBHOOK_SECRET"');
    expect(curl).toContain('Idempotency-Key');
    expect(curl).toContain('X-Vendix-Signature: sha256=$SIG');
    expect(curl).not.toContain('whin_');
  });

  it('accepts only whole limits from 1 to 600', () => {
    expect(parseRateLimit('60')).toBe(60);
    expect(parseRateLimit(600)).toBe(600);
    expect(parseRateLimit(0)).toBeNull();
    expect(parseRateLimit(601)).toBeNull();
    expect(parseRateLimit('1.5')).toBeNull();
    expect(parseRateLimit('')).toBeNull();
    expect(parseRateLimit(null)).toBeNull();
  });
});
