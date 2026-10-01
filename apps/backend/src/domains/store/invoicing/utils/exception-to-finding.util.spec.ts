import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { exceptionToFinding } from './exception-to-finding.util';

describe('exceptionToFinding', () => {
  it('INVOICING_CALC_005 con line_index 2 apunta a items[2].unit_price en el formulario', () => {
    const finding = exceptionToFinding(
      new VendixHttpException(
        ErrorCodes.INVOICING_CALC_005,
        'La línea 3 no cierra',
        { line_index: 2 },
      ),
    );
    expect(finding).toMatchObject({
      code: 'INVOICING_CALC_005',
      severity: 'blocker',
      field: 'items[2].unit_price',
      target: 'form',
      problem: 'La línea 3 no cierra',
    });
    expect(finding?.fix).toBeTruthy();
    expect(finding?.cta).toBeUndefined();
  });

  it('CALC_001 de línea apunta a taxes y AIU_003/004 a aiu_component / taxes', () => {
    const f = (code: any, details: any) =>
      exceptionToFinding(new VendixHttpException(code, 'm', details));
    expect(f(ErrorCodes.INVOICING_CALC_001, { line_index: 0 })?.field).toBe(
      'items[0].taxes',
    );
    expect(f(ErrorCodes.INVOICING_AIU_003, { line_index: 1 })?.field).toBe(
      'items[1].aiu_component',
    );
    expect(f(ErrorCodes.INVOICING_AIU_004, { line_index: 4 })?.field).toBe(
      'items[4].taxes',
    );
  });

  it('FISCAL_ACCOUNTING_BLOCKED apunta a issue_date', () => {
    const finding = exceptionToFinding(
      new VendixHttpException(ErrorCodes.FISCAL_ACCOUNTING_BLOCKED, 'cerrado'),
    );
    expect(finding).toMatchObject({ field: 'issue_date', target: 'form' });
  });

  it('SYS_VALIDATION_001 de crédito apunta a due_date; details.field manda', () => {
    expect(
      exceptionToFinding(
        new VendixHttpException(ErrorCodes.SYS_VALIDATION_001, 'sin plazo'),
      )?.field,
    ).toBe('due_date');
    expect(
      exceptionToFinding(
        new VendixHttpException(ErrorCodes.SYS_VALIDATION_001, 'inline', {
          field: 'items[1].product_id',
        }),
      )?.field,
    ).toBe('items[1].product_id');
  });

  it('FISCAL_RESOLUTION_MISSING es de configuración y trae cta a resoluciones', () => {
    const finding = exceptionToFinding(
      new VendixHttpException(ErrorCodes.FISCAL_RESOLUTION_MISSING, 'sin res'),
    );
    expect(finding).toMatchObject({
      target: 'config',
      cta: '/admin/invoicing/resolutions',
    });
  });

  it('FISCAL_CONFIG_INCOMPLETE se reparte por origen', () => {
    const f = (message: string, details?: any) =>
      exceptionToFinding(
        new VendixHttpException(
          ErrorCodes.FISCAL_CONFIG_INCOMPLETE,
          message,
          details,
        ),
      );
    expect(f('x', { missing_field: 'prefix' })).toMatchObject({
      field: 'resolution.prefix',
      target: 'config',
      cta: '/admin/invoicing/resolutions',
    });
    expect(f('Support documents require a supplier.')).toMatchObject({
      field: 'supplier_id',
      target: 'form',
    });
    expect(f('x', { configuration_type: 'invoicing' })).toMatchObject({
      field: 'dian_config.configuration',
      target: 'config',
      cta: '/admin/invoicing/dian-config',
    });
  });

  it('CUSTOMER_NIT_DV_MISMATCH usa details.field; con ficha va a la ficha', () => {
    const err = () =>
      new VendixHttpException(ErrorCodes.CUSTOMER_NIT_DV_MISMATCH, 'dv', {
        field: 'customer_verification_digit',
      });
    expect(exceptionToFinding(err())).toMatchObject({
      field: 'customer_verification_digit',
      target: 'form',
    });
    expect(exceptionToFinding(err(), { customer_id: 7 })).toMatchObject({
      target: 'config',
      cta: '/admin/customers/7',
      details: { customer_id: 7 },
    });
  });

  it('certificado vencido y NIT del certificado van a la configuración DIAN', () => {
    expect(
      exceptionToFinding(
        new VendixHttpException(ErrorCodes.DIAN_CERT_003, undefined),
      ),
    ).toMatchObject({
      field: 'dian_config.certificate_expiry',
      target: 'config',
      cta: '/admin/invoicing/dian-config',
    });
    expect(
      exceptionToFinding(
        new VendixHttpException(ErrorCodes.DIAN_CERT_004, undefined),
      )?.field,
    ).toBe('dian_config.certificate_nit');
  });

  it('FISCAL_IDENTITY_INCOMPLETE usa issuer.<campo> y la ruta del asistente', () => {
    const finding = exceptionToFinding(
      new VendixHttpException(ErrorCodes.FISCAL_IDENTITY_INCOMPLETE, 'falta', {
        missing_field: 'municipality_code',
        missing: ['municipality_code', 'department'],
        cta: '/admin/fiscal/wizard',
      }),
    );
    expect(finding).toMatchObject({
      field: 'issuer.municipality_code',
      target: 'config',
      cta: '/admin/fiscal/wizard',
    });
  });

  it('error desconocido o no tipado devuelve null', () => {
    expect(exceptionToFinding(new Error('boom'))).toBeNull();
    expect(exceptionToFinding('x')).toBeNull();
    expect(
      exceptionToFinding(
        new VendixHttpException(ErrorCodes.SYS_INTERNAL_001, 'interno'),
      ),
    ).toBeNull();
  });
});
