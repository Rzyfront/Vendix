import { PlatformInvoicingService } from './platform-invoicing.service';

/**
 * Directorio de clientes externos de plataforma: al emitir
 * `POST sales-invoices` con `customer.kind = 'external'` el adquiriente se
 * recuerda en `platform_customers` (upsert por `document_type + tax_id`),
 * después de crear el documento y sin poder tumbar la emisión.
 */
describe('PlatformInvoicingService — upsert de platform_customers', () => {
  let upsert: jest.Mock;
  let createPlatformInvoice: jest.Mock;
  let getTenantByKindAndId: jest.Mock;
  let service: PlatformInvoicingService;

  const legacyResult = {
    transmission_id: 55,
    fiscal_number: 'VNDS1',
    transmission_status: 'accepted',
    dian_status: 'accepted',
    cufe: 'abc',
    accepted: true,
    error_message: null,
  };

  const baseArgs = (customer: Record<string, unknown>) => ({
    organizationId: 1,
    accountingEntityId: 2,
    dianConfigurationId: 3,
    actorUserId: 0,
    dto: {
      customer,
      items: [{ description: 'Plan Pro', quantity: 1, unit_price: 100000 }],
    },
  });

  const externalCustomer = {
    kind: 'external',
    legal_name: 'Constructora Andina SAS',
    tax_id: '900123456',
    tax_id_dv: '8',
    document_type: '31',
    person_type: '1',
    tax_regime_code: '48',
    fiscal_responsibilities: ['O-13'],
    email: 'compras@andina.co',
    phone: '6015551234',
    address: { line: 'Cra 7 # 71-21', city_code: '11001' },
  };

  beforeEach(() => {
    upsert = jest.fn().mockResolvedValue({ id: 9 });
    createPlatformInvoice = jest.fn().mockResolvedValue(legacyResult);
    getTenantByKindAndId = jest.fn();
    const prisma = { platform_customers: { upsert } };
    service = new PlatformInvoicingService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      { getTenantByKindAndId } as any,
      { createPlatformInvoice } as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('crea/actualiza por (document_type, tax_id) con los datos de la factura', async () => {
    const res = await service.createSalesInvoice(baseArgs(externalCustomer));

    expect(res.transmission_id).toBe(55);
    expect(createPlatformInvoice).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    const call = upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      document_type_tax_id: { document_type: '31', tax_id: '900123456' },
    });
    expect(call.create).toMatchObject({
      document_type: '31',
      tax_id: '900123456',
      tax_id_dv: '8',
      legal_name: 'Constructora Andina SAS',
      person_type: '1',
      tax_regime_code: '48',
      fiscal_responsibilities: ['O-13'],
      email: 'compras@andina.co',
      phone: '6015551234',
      address_line: 'Cra 7 # 71-21',
      city_code: '11001',
      department_code: '11',
    });
    expect(call.create.last_invoiced_at).toBeInstanceOf(Date);
    // Rama UPDATE (cliente ya existente): actualiza datos y last_invoiced_at.
    expect(call.update).toMatchObject({
      legal_name: 'Constructora Andina SAS',
      email: 'compras@andina.co',
      phone: '6015551234',
      fiscal_responsibilities: ['O-13'],
    });
    expect(call.update.last_invoiced_at).toBeInstanceOf(Date);
  });

  it('en UPDATE un campo opcional vacío no borra el valor guardado', async () => {
    await service.createSalesInvoice(
      baseArgs({
        kind: 'external',
        legal_name: 'Juan Pérez',
        tax_id: '1020304050',
        document_type: '13',
        person_type: '2',
      }),
    );
    const call = upsert.mock.calls[0][0];
    expect(call.where.document_type_tax_id).toEqual({
      document_type: '13',
      tax_id: '1020304050',
    });
    expect(call.update).not.toHaveProperty('email');
    expect(call.update).not.toHaveProperty('phone');
    // Cédula: el DV por defecto ('0') no se guarda.
    expect(call.create.tax_id_dv).toBeNull();
  });

  it('una etiqueta de documento se guarda como código DIAN', async () => {
    await service.createSalesInvoice(
      baseArgs({ ...externalCustomer, document_type: 'CC', tax_id: '1020304050' }),
    );
    expect(upsert.mock.calls[0][0].create.document_type).toBe('13');
  });

  it('no registra nada cuando el cliente no es externo (tenant)', async () => {
    getTenantByKindAndId.mockResolvedValue({
      kind: 'store',
      tenant_id: 4,
      legal_name: 'Tienda Demo SAS',
      tax_id: '900111222',
      tax_id_dv: '1',
      document_type: '31',
      person_type: '1',
      fiscal_responsibilities: ['O-13'],
      address: { line: 'Calle 1', city: 'Bogotá', city_code: '11001', department_code: '11' },
    });
    await service.createSalesInvoice(baseArgs({ kind: 'store', tenant_id: 4 }));
    expect(createPlatformInvoice).toHaveBeenCalledTimes(1);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('no registra nada (ni emite) cuando el externo no trae tax_id', async () => {
    await expect(
      service.createSalesInvoice(baseArgs({ ...externalCustomer, tax_id: '  ' })),
    ).rejects.toMatchObject({ errorCode: 'SYS_VALIDATION_001' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('un fallo del upsert no tumba la emisión (no-fatal)', async () => {
    upsert.mockRejectedValue(new Error('relation "platform_customers" does not exist'));
    const res = await service.createSalesInvoice(baseArgs(externalCustomer));
    expect(res.accepted).toBe(true);
    expect(res.fiscal_number).toBe('VNDS1');
  });

  it('si la emisión lanza, no se registra el cliente', async () => {
    createPlatformInvoice.mockRejectedValue(new Error('boom'));
    await expect(service.createSalesInvoice(baseArgs(externalCustomer))).rejects.toThrow('boom');
    expect(upsert).not.toHaveBeenCalled();
  });
});
