import {
  buildDeliverySender,
  buildDeliverySubject,
  buildDeliveryZipName,
  resolveDeliveryIssuerIdentity,
} from './dian-delivery-envelope.util';

describe('dian-delivery-envelope.util', () => {
  const organization = {
    name: 'PRINT SOLUTIONS RIOHACHA',
    legal_name: 'PRINT SOLUTIONS RIOHACHA SAS ZOMAC',
    tax_id: '901390098-5',
    email: 'info@print.co',
    fiscal_scope: 'ORGANIZATION',
    organization_settings: null,
  };

  it('resuelve la identidad del emisor', () => {
    expect(resolveDeliveryIssuerIdentity({ organization })).toMatchObject({
      nit: '901390098',
      legal_name: 'PRINT SOLUTIONS RIOHACHA SAS ZOMAC',
      email: 'info@print.co',
    });
  });

  it('sin NIT ni razón social devuelve null', () => {
    expect(
      resolveDeliveryIssuerIdentity({
        organization: { name: '', legal_name: '', tax_id: '' },
      }),
    ).toBeNull();
  });

  it('asunto DIAN con el ejemplo real', () => {
    const issuer = {
      nit: '901390098',
      legal_name: 'PRINT SOLUTIONS RIOHACHA SAS ZOMAC',
    };
    expect(
      buildDeliverySubject({
        issuer,
        document_number: 'FEPR2055',
        invoice_type: 'sales_invoice',
        fallback_subject: 'fb',
      }),
    ).toBe(
      '901390098;PRINT SOLUTIONS RIOHACHA SAS ZOMAC;FEPR2055;01;PRINT SOLUTIONS RIOHACHA SAS ZOMAC',
    );
  });

  it('asunto cae al fallback sin identidad o con tipo sin código', () => {
    expect(
      buildDeliverySubject({
        issuer: null,
        document_number: 'X1',
        invoice_type: 'sales_invoice',
        fallback_subject: 'fb',
      }),
    ).toBe('fb');
    expect(
      buildDeliverySubject({
        issuer: { nit: '1', legal_name: 'A' },
        document_number: 'X1',
        invoice_type: 'purchase_invoice',
        fallback_subject: 'fb',
      }),
    ).toBe('fb');
  });

  it('zip DIAN determinístico a partir del número de documento', () => {
    const args = {
      issuer: { nit: '901390098', legal_name: 'A' },
      document_number: 'FEPR2055',
      issue_date: '2026-10-08',
      operation_mode: 'own_software',
      fallback_name: 'fb.zip',
    };
    expect(buildDeliveryZipName(args)).toBe('z09013900980002600000807.zip');
    expect(buildDeliveryZipName(args)).toBe(buildDeliveryZipName(args));
  });

  it('zip: technological_provider no bloquea y sin identidad cae al fallback', () => {
    expect(
      buildDeliveryZipName({
        issuer: { nit: '901390098', legal_name: 'A' },
        document_number: 'F1',
        issue_date: '2026-01-01',
        operation_mode: 'technological_provider',
        fallback_name: 'fb.zip',
      }),
    ).toBe('z09013900980002600000001.zip');
    expect(
      buildDeliveryZipName({
        issuer: null,
        document_number: 'F1',
        fallback_name: 'fb.zip',
      }),
    ).toBe('fb.zip');
  });

  it('remitente: razón social y correo; sin identidad, undefined', () => {
    expect(
      buildDeliverySender({ nit: '1', legal_name: 'A SAS', email: 'a@b.co' }),
    ).toEqual({ name: 'A SAS', email: 'a@b.co' });
    expect(buildDeliverySender(null)).toBeUndefined();
  });
});
