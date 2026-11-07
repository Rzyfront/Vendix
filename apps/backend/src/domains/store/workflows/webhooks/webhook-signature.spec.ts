import {
  buildSignatureHeader,
  computeWebhookSignature,
  verifySignatureHeader,
} from './webhook-signature';

const SECRET = 'whsec_test_secret';
const TS = 1700000000;
const BODY = '{"event_id":"e1","type":"ping"}';
// hex(hmac_sha256("whsec_test_secret", "1700000000.{\"event_id\":\"e1\",\"type\":\"ping\"}"))
const EXPECTED =
  '25d57da3ee20237e3013c2256a68ab62a2ca6bfea1a069262b28505996bb7020';

describe('firma de webhooks', () => {
  it('vector conocido: t=<ts>,v1=hmac_sha256(secret, ts + "." + body)', () => {
    expect(computeWebhookSignature(SECRET, TS, BODY)).toBe(EXPECTED);
    expect(buildSignatureHeader(SECRET, TS, BODY)).toBe(
      `t=${TS},v1=${EXPECTED}`,
    );
  });

  it('cambia con el secreto, la marca de tiempo o el cuerpo', () => {
    expect(computeWebhookSignature('otro', TS, BODY)).not.toBe(EXPECTED);
    expect(computeWebhookSignature(SECRET, TS + 1, BODY)).not.toBe(EXPECTED);
    expect(computeWebhookSignature(SECRET, TS, `${BODY} `)).not.toBe(EXPECTED);
  });

  it('el receptor verifica en tiempo constante y rechaza lo manipulado o viejo', () => {
    const header = buildSignatureHeader(SECRET, TS, BODY);
    const opts = { now: TS + 10 };
    expect(verifySignatureHeader(SECRET, header, BODY, opts)).toBe(true);
    expect(verifySignatureHeader('otro', header, BODY, opts)).toBe(false);
    expect(verifySignatureHeader(SECRET, header, `${BODY}x`, opts)).toBe(false);
    expect(verifySignatureHeader(SECRET, header, BODY, { now: TS + 301 })).toBe(
      false,
    );
    expect(verifySignatureHeader(SECRET, 'v1=zz', BODY, opts)).toBe(false);
    expect(verifySignatureHeader(SECRET, `t=${TS}`, BODY, opts)).toBe(false);
    expect(verifySignatureHeader(SECRET, '', BODY, opts)).toBe(false);
  });
});
