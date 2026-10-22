import { redactDianConfigForHttp } from '../../store/invoicing/dian-config/dian-config-redaction.util';

import { TenantDianConfigController } from './tenant-dian-config.controller';

/**
 * T4-H1: `redact` del controlador de superadmin debe conservar el
 * `certificate_present` que el servicio ya calculó al sanear la fila (que ya no
 * trae `certificate_s3_key`), en vez de recalcularlo siempre a `false`.
 */
describe('TenantDianConfigController · redact', () => {
  const controller = new TenantDianConfigController(
    ...(new Array(8).fill(null) as [any, any, any, any, any, any, any, any]),
  );
  const redact = (value: any) => (controller as any).redact(value);

  it('conserva certificate_present true de una fila ya saneada', () => {
    const sanitized = redactDianConfigForHttp({
      id: 1,
      certificate_s3_key: 'org/7/cert.p12',
      certificate_kms_key_id: 'arn:aws:kms:secret',
    });
    expect(sanitized.certificate_present).toBe(true);

    const out = redact(sanitized);
    expect(out.certificate_present).toBe(true);
    expect(out.certificate_uses_kms).toBe(true);
  });

  it('fila cruda con certificate_s3_key -> true y sin la clave', () => {
    const out = redact({ id: 1, certificate_s3_key: 'org/7/cert.p12' });
    expect(out.certificate_present).toBe(true);
    expect(out).not.toHaveProperty('certificate_s3_key');
  });

  it('sin certificado -> false', () => {
    expect(redact({ id: 1, certificate_s3_key: null }).certificate_present).toBe(
      false,
    );
    const sanitized = redactDianConfigForHttp({
      id: 1,
      certificate_s3_key: null,
      certificate_kms_key_id: null,
    });
    const out = redact(sanitized);
    expect(out.certificate_present).toBe(false);
    expect(out.certificate_uses_kms).toBe(false);
  });

  it('la respuesta no contiene certificate_s3_key ni certificate_kms_key_id', () => {
    const out = redact({
      id: 1,
      certificate_s3_key: 'k',
      certificate_kms_key_id: 'arn:aws:kms:secret',
    });
    expect(out).not.toHaveProperty('certificate_s3_key');
    expect(out).not.toHaveProperty('certificate_kms_key_id');
    expect(JSON.stringify(out)).not.toContain('arn:aws:kms:secret');
    expect(out.certificate_uses_kms).toBe(true);
  });
});
