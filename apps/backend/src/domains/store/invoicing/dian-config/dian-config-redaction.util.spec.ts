import { redactDianConfigForHttp, stripNotePhase } from './dian-config-redaction.util';

describe('redactDianConfigForHttp (SEC-L1 / SEC-L2)', () => {
  const row = () => ({
    id: 10,
    software_pin_encrypted: 'enc:pin',
    certificate_password_encrypted: 'enc:pwd',
    certificate_s3_key: 'dian/certs/10/firma.p12',
    certificate_kms_key_id: 'arn:aws:kms:us-east-1:123456789012:key/abc',
    enablement_inherited_from_id: 99,
    last_test_result: {
      success: true,
      note_phase: { deferred: [{ xml: '<Invoice>firmado</Invoice>' }] },
    },
    enablement_evidence: {
      success: true,
      note_phase: { deferred: [{ xml: '<Invoice>firmado</Invoice>' }] },
      inheritance: { from_dian_configuration_id: 99, source_environment: 'production' },
    },
  });

  it('no deja salir la ubicación del .p12, el ARN de KMS ni el id fuente', () => {
    const out: any = redactDianConfigForHttp(row());
    expect(out).not.toHaveProperty('certificate_s3_key');
    expect(out).not.toHaveProperty('certificate_kms_key_id');
    expect(out).not.toHaveProperty('enablement_inherited_from_id');
    expect(out.certificate_present).toBe(true);
    expect(out.certificate_uses_kms).toBe(true);
    expect(out.enablement_inherited).toBe(true);
    const json = JSON.stringify(out);
    expect(json).not.toContain('firma.p12');
    expect(json).not.toContain('arn:aws');
    expect(json).not.toContain('firmado');
    expect(json).not.toContain('from_dian_configuration_id');
  });

  it('quita note_phase de last_test_result y enablement_evidence y conserva el resto', () => {
    const out: any = redactDianConfigForHttp(row());
    expect(out.last_test_result).toEqual({ success: true });
    expect(out.enablement_evidence.success).toBe(true);
    expect(out.enablement_evidence.inheritance).toEqual({ source_environment: 'production' });
  });

  it('sin certificado: certificate_present y certificate_uses_kms son false; PIN y contraseña enmascarados', () => {
    const out: any = redactDianConfigForHttp({
      ...row(),
      certificate_s3_key: null,
      certificate_kms_key_id: null,
      certificate_password_encrypted: null,
    });
    expect(out.certificate_present).toBe(false);
    expect(out.certificate_uses_kms).toBe(false);
    expect(out.software_pin_encrypted).toBe('****');
    expect(out.certificate_password_encrypted).toBeNull();
  });

  it('una proyección parcial (sin esas columnas) no inventa certificate_present', () => {
    const out: any = redactDianConfigForHttp({ id: 1, software_pin_encrypted: null });
    expect(out).not.toHaveProperty('certificate_present');
    expect(out.enablement_inherited).toBe(false);
  });

  it('stripNotePhase tolera null, primitivos y arreglos', () => {
    expect(stripNotePhase(null)).toBeNull();
    expect(stripNotePhase('x')).toBe('x');
    expect(stripNotePhase([1])).toEqual([1]);
  });
});
