import * as XLSX from 'xlsx';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { CustomerAiImportService } from './customer-ai-import.service';
import { CommitCustomerItemDto } from './dto/customer-ai-import.dto';

describe('CustomerAiImportService', () => {
  let service: CustomerAiImportService;
  let aiMock: { run: jest.Mock };
  let prismaMock: { addresses: { findMany: jest.Mock } };
  let customersMock: {
    create: jest.Mock;
    update: jest.Mock;
    findByDocumentInOrganization: jest.Mock;
    findCustomerMatchesInScope: jest.Mock;
    isCustomerInDuplicateScope: jest.Mock;
  };
  let addressesMock: { addCustomerLocation: jest.Mock };
  let registryMock: { register: jest.Mock };

  const AI_JSON = JSON.stringify({
    customers: [
      {
        person_type: 'JURIDICA',
        legal_name: 'Acme S.A.S',
        document_type: 'NIT',
        document_number: '900.123.456',
        verification_digit: '7',
        locations: [
          { label: 'Sede Norte', address_line_1: 'Cra 1 # 2-3', city: 'Cali' },
        ],
      },
      {
        legal_name: 'Acme S.A.S',
        document_type: 'NIT',
        document_number: '900123456',
        email: 'ACME@x.co',
        locations: [
          { label: 'Sede Sur', address_line_1: 'Cl 9 # 8-7', city: 'Cali' },
          { address_line_1: 'cra 1 #2-3', city: 'CALI' },
        ],
      },
    ],
    warnings: [],
  });

  const item = (
    over: Partial<CommitCustomerItemDto> = {},
  ): CommitCustomerItemDto =>
    ({
      action: 'create',
      person_type: 'NATURAL',
      first_name: 'Ana',
      last_name: 'Lopez',
      document_type: 'CC',
      document_number: '123',
      locations: [
        { address_line_1: 'Cl 1 # 2', city: 'Cali', label: 'Casa' },
        { address_line_1: 'Cl 3 # 4', city: 'Cali' },
      ],
      ...over,
    }) as CommitCustomerItemDto;

  const runInStore = <T>(fn: () => Promise<T>) =>
    RequestContextService.run(
      { store_id: 5, organization_id: 9 } as any,
      fn,
    );

  beforeEach(() => {
    aiMock = {
      run: jest
        .fn()
        .mockResolvedValue({ success: true, content: AI_JSON, model: 'm' }),
    };
    prismaMock = { addresses: { findMany: jest.fn().mockResolvedValue([]) } };
    customersMock = {
      create: jest.fn().mockResolvedValue({ id: 100 }),
      update: jest.fn().mockResolvedValue({ id: 100 }),
      findByDocumentInOrganization: jest.fn().mockResolvedValue(null),
      findCustomerMatchesInScope: jest.fn().mockResolvedValue([]),
      isCustomerInDuplicateScope: jest.fn().mockResolvedValue(true),
    };
    addressesMock = {
      addCustomerLocation: jest
        .fn()
        .mockResolvedValue({ address: { id: 1 }, created: true }),
    };
    registryMock = { register: jest.fn() };
    service = new CustomerAiImportService(
      aiMock as any,
      prismaMock as any,
      customersMock as any,
      addressesMock as any,
      registryMock as any,
    );
  });

  it('onModuleInit registra el handler customer_import', () => {
    service.onModuleInit();
    expect(registryMock.register).toHaveBeenCalledWith(
      'customer_import',
      expect.any(Function),
    );
  });

  it('normalize fusiona el mismo documento en un cliente con N ubicaciones', async () => {
    const scan = await service.scanFromFiles([
      {
        buffer: Buffer.from('x'),
        mimeType: 'application/pdf',
        originalName: 'c.pdf',
        size: 1,
      },
    ]);
    expect(scan.customers).toHaveLength(1);
    const [c] = scan.customers;
    expect(c.document_number).toBe('900123456');
    expect(c.person_type).toBe('JURIDICA');
    expect(c.email).toBe('acme@x.co');
    // 3 filas de ubicación, una repetida (misma dirección/ciudad) → 2.
    expect(c.locations.map((l) => l.label)).toEqual(['Sede Norte', 'Sede Sur']);
    expect(aiMock.run).toHaveBeenCalledWith(
      'customer_import_ocr',
      {},
      expect.any(Array),
    );
  });

  it('xlsx se envía como texto (sin imagen)', async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['nit', 'razon', 'direccion'],
      ['900123456', 'Acme', 'Cra 1 # 2-3'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Hoja1');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    await service.scanFromFiles([
      {
        buffer,
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        originalName: 'c.xlsx',
        size: buffer.length,
      },
    ]);

    const messages = aiMock.run.mock.calls[0][2];
    expect(typeof messages[0].content).toBe('string');
    expect(messages[0].content).toContain('900123456,Acme,Cra 1 # 2-3');
    expect(JSON.stringify(messages)).not.toContain('image_url');
  });

  it('rechaza un formato no soportado', async () => {
    await expect(
      service.scanFromFiles([
        {
          buffer: Buffer.from('x'),
          mimeType: 'text/plain',
          originalName: 'a.txt',
          size: 1,
        },
      ]),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });

  it('commit rechaza un cliente existente fuera del alcance de la tienda (S8)', async () => {
    customersMock.isCustomerInDuplicateScope.mockResolvedValue(false);
    const result = await runInStore(() =>
      service.commit({
        customers: [
          {
            action: 'add_locations',
            existing_customer_id: 999,
            legal_name: 'Otra tienda SAS',
            locations: [{ address_line_1: 'Calle 1', city: 'Cali' }],
          },
        ],
      } as any),
    );
    expect(result.failed).toBe(1);
    expect(result.results[0].error).toContain('no pertenece a esta tienda');
    expect(addressesMock.addCustomerLocation).not.toHaveBeenCalled();
  });

  it('analyze descarta un DV que no corresponde al NIT y avisa', async () => {
    const result = await runInStore(() =>
      service.analyze({
        customers: [
          {
            person_type: 'JURIDICA',
            legal_name: 'Acme SAS',
            document_type: 'NIT',
            document_number: '811222333',
            verification_digit: '4',
            locations: [],
          },
        ],
      }),
    );
    const [c] = result.customers;
    expect(c.verification_digit).toBeNull();
    expect(c.status).toBe('warning');
    expect(c.messages.join(' ')).toContain('no corresponde al NIT');
  });

  it('analyze informa coincidencia por correo y otros clientes que coinciden (S8)', async () => {
    customersMock.findCustomerMatchesInScope.mockResolvedValue([
      { id: 80, display_name: 'Ana Pérez', document_type: 'CC', document_number: '1', email: 'ana@x.co', in_store: true, matched_by: ['email'] },
      { id: 81, display_name: 'Otra Ana', document_type: 'CC', document_number: '2', email: null, in_store: true, matched_by: ['document'] },
    ]);
    const result = await runInStore(() =>
      service.analyze({
        customers: [
          { first_name: 'Ana', last_name: 'Pérez', email: 'ana@x.co', document_type: 'CC', document_number: '2', locations: [] },
        ],
      }),
    );
    expect(customersMock.findCustomerMatchesInScope).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      { document_type: 'CC', document_number: '2', email: 'ana@x.co' },
    );
    expect(result.customers[0].match).toMatchObject({
      existing_customer_id: 80,
      matched_by: ['email'],
      other_matches: [{ id: 81, display_name: 'Otra Ana', matched_by: ['document'] }],
    });
  });

  it('analyze marca cliente existente y ubicación ya registrada', async () => {
    customersMock.findCustomerMatchesInScope.mockResolvedValue([
      {
        id: 77,
        display_name: 'Acme S.A.S',
        document_type: 'NIT',
        document_number: '900123456',
        email: null,
        in_store: true,
        matched_by: ['document'],
      },
    ]);
    prismaMock.addresses.findMany.mockResolvedValue([
      { id: 1, label: 'Sede Norte', address_line1: 'Cra 1 # 2-3', city: 'Cali' },
    ]);

    const result = await runInStore(() =>
      service.analyze({
        customers: [
          {
            legal_name: 'Acme S.A.S',
            document_type: 'NIT',
            document_number: '900123456',
            locations: [
              { address_line_1: 'cra 1 #2-3', city: 'CALI' },
              { address_line_1: 'Cl 9 # 8-7', city: 'Cali' },
              { address_line_1: 'Cl 5', city: null },
            ],
          },
        ],
      }),
    );

    const [c] = result.customers;
    expect(c.match).toMatchObject({
      existing_customer_id: 77,
      display_name: 'Acme S.A.S',
      in_store: true,
    });
    expect(c.match?.existing_locations).toHaveLength(1);
    expect(c.locations.map((l) => l.already_registered)).toEqual([
      true,
      false,
      false,
    ]);
    expect(c.locations[2].status).toBe('error');
    expect(c.status).toBe('error');
    expect(result.summary).toMatchObject({ existing: 1, with_errors: 1 });
  });

  it('commit create llama a create y luego addCustomerLocation por ubicación', async () => {
    const result = await runInStore(() =>
      service.commit({ customers: [item()] }),
    );
    expect(customersMock.create).toHaveBeenCalledTimes(1);
    expect(customersMock.create.mock.calls[0][0]).toBe(5);
    expect(addressesMock.addCustomerLocation).toHaveBeenCalledTimes(2);
    expect(addressesMock.addCustomerLocation.mock.calls[0][0]).toBe(100);
    expect(addressesMock.addCustomerLocation.mock.calls[0][1]).toMatchObject({
      address_line_1: 'Cl 1 # 2',
      city: 'Cali',
      country: 'CO',
      label: 'Casa',
    });
    expect(result).toMatchObject({
      created: 1,
      locations_added: 2,
      failed: 0,
    });
  });

  it('commit add_locations no llama a create', async () => {
    addressesMock.addCustomerLocation
      .mockResolvedValueOnce({ address: { id: 1 }, created: true })
      .mockResolvedValueOnce({ address: { id: 2 }, created: false });
    const result = await runInStore(() =>
      service.commit({
        customers: [item({ action: 'add_locations', existing_customer_id: 50 })],
      }),
    );
    expect(customersMock.create).not.toHaveBeenCalled();
    expect(customersMock.update).not.toHaveBeenCalled();
    expect(addressesMock.addCustomerLocation.mock.calls[0][0]).toBe(50);
    expect(result).toMatchObject({
      locations_added: 1,
      locations_already_registered: 1,
      created: 0,
    });
  });

  it('commit update_and_add_locations actualiza solo los campos con valor', async () => {
    const result = await runInStore(() =>
      service.commit({
        customers: [
          item({
            action: 'update_and_add_locations',
            existing_customer_id: 50,
            email: '  ',
            phone: '300 111',
          }),
        ],
      }),
    );
    expect(customersMock.update).toHaveBeenCalledWith(5, 50, {
      first_name: 'Ana',
      last_name: 'Lopez',
      phone: '300 111',
    });
    expect(result.updated).toBe(1);
  });

  it('commit skip no hace nada', async () => {
    const result = await runInStore(() =>
      service.commit({ customers: [item({ action: 'skip' })] }),
    );
    expect(customersMock.create).not.toHaveBeenCalled();
    expect(addressesMock.addCustomerLocation).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it('un cliente que falla no aborta a los demás', async () => {
    customersMock.create
      .mockRejectedValueOnce(
        new VendixHttpException(
          ErrorCodes.SYS_CONFLICT_001,
          'Ya existe un cliente con ese correo',
          { kind: 'email' },
        ),
      )
      .mockResolvedValueOnce({ id: 101 });
    const result = await runInStore(() =>
      service.commit({
        customers: [item(), item({ first_name: 'Luis' })],
      }),
    );
    expect(result.failed).toBe(1);
    expect(result.created).toBe(1);
    expect(result.results[0]).toMatchObject({
      outcome: 'failed',
      error: 'Ya existe un cliente con ese correo',
    });
    expect(result.results[1].customer_id).toBe(101);
  });

  it('carrera SYS_CONFLICT_001 por documento cae a agregar ubicaciones', async () => {
    customersMock.create.mockRejectedValueOnce(
      new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        'Ya existe un cliente con este documento en la organización',
        { kind: 'document', existing_customer_id: 321 },
      ),
    );
    const result = await runInStore(() =>
      service.commit({ customers: [item()] }),
    );
    expect(addressesMock.addCustomerLocation.mock.calls[0][0]).toBe(321);
    expect(result).toMatchObject({ created: 0, failed: 0, locations_added: 2 });
    expect(result.results[0].outcome).toBe('locations_added');
  });
});
