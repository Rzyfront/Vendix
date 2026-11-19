import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '../../../../../common/errors';
import { CustomerDataSheetService } from './customer-data-sheet.service';

const STORE = 10;
const CUSTOMER = 4;
const PREFIX =
  'organizations/acme-2/stores/centro-10/data-collection/customers/4';

function field(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    store_id: STORE,
    entity_type: 'customer',
    field_key: `f${id}`,
    field_type: 'text',
    label: `Campo ${id}`,
    sort_order: id,
    is_active: true,
    ...overrides,
  };
}

const NAME = field(1);
const RUT = field(2, { field_type: 'file', label: 'RUT' });
const BOOKING_ONLY = field(3, { entity_type: 'booking' });
const INACTIVE = field(4, { is_active: false });
const BIRTHDAY = field(5, { field_type: 'date' });

/** CRM default template 20: one tab with a mixed section, plus a loose one. */
const TEMPLATE_20 = {
  id: 20,
  name: 'Ficha comercial',
  entity_type: 'customer',
  status: 'active',
  is_crm_default: true,
  products: [],
  tabs: [
    {
      id: 1,
      title: 'General',
      sections: [
        {
          id: 11,
          title: 'Datos',
          items: [
            { id: 111, metadata_field: NAME },
            { id: 112, metadata_field: BOOKING_ONLY },
          ],
          child_sections: [
            { id: 12, title: 'Docs', items: [{ id: 121, metadata_field: RUT }] },
            { id: 13, title: 'Vacía', items: [{ id: 131, metadata_field: INACTIVE }] },
          ],
        },
        {
          id: 14,
          title: 'Solo reserva',
          items: [{ id: 141, metadata_field: BOOKING_ONLY }],
          child_sections: [],
        },
      ],
    },
    { id: 2, title: 'Reservas', sections: [] },
  ],
  sections: [
    { id: 15, title: 'Extra', items: [{ id: 151, metadata_field: BIRTHDAY }], child_sections: [] },
  ],
};

const TEMPLATE_30 = {
  id: 30,
  name: 'Ficha técnica',
  entity_type: 'customer',
  status: 'active',
  is_crm_default: false,
  products: [],
  tabs: [],
  sections: [
    { id: 31, title: 'Técnico', items: [{ id: 311, metadata_field: BIRTHDAY }], child_sections: [] },
  ],
};

function valueRow(fieldRow: Record<string, any>, values: Record<string, unknown>) {
  return {
    id: fieldRow.id * 100,
    store_id: STORE,
    field_id: fieldRow.id,
    entity_type: 'customer',
    entity_id: CUSTOMER,
    value_text: null,
    value_number: null,
    value_date: null,
    value_bool: null,
    value_json: null,
    created_at: new Date('2026-11-01T00:00:00Z'),
    updated_at: new Date('2026-11-02T00:00:00Z'),
    field: fieldRow,
    ...values,
  };
}

function setup(options: { picked?: number | null; customer?: boolean } = {}) {
  const prisma = {
    store_users: {
      findFirst: jest.fn(async ({ select }: any) => {
        if (options.customer === false) return null;
        return select?.crm_data_template_id
          ? { crm_data_template_id: options.picked ?? null }
          : { id: 77 };
      }),
      updateMany: jest.fn(async (..._args: any[]) => ({ count: 1 })),
    },
    data_collection_templates: {
      findMany: jest.fn(async (..._args: any[]) => [
        { id: 20, name: 'Ficha comercial', is_crm_default: true },
        { id: 30, name: 'Ficha técnica', is_crm_default: false },
      ]),
      findFirst: jest.fn(async (..._args: any[]) => ({ entity_type: 'customer', status: 'active' })),
    },
    entity_metadata_values: {
      findMany: jest.fn(async ({ select }: any) =>
        select
          ? [{ field_id: RUT.id, value_text: `${PREFIX}/1-rut.pdf` }]
          : [
              valueRow(NAME, { value_text: 'Laura' }),
              valueRow(RUT, { value_text: `${PREFIX}/1-rut.pdf` }),
              valueRow(BOOKING_ONLY, { value_number: new Prisma.Decimal('3.5') }),
            ],
      ),
      deleteMany: jest.fn(async (..._args: any[]) => ({ count: 1 })),
      upsert: jest.fn(async (..._args: any[]) => ({})),
    },
    stores: {
      findUnique: jest.fn(async (..._args: any[]) => ({
        id: 10,
        slug: 'centro',
        organizations: { id: 2, slug: 'acme' },
      })),
    },
  } as Record<string, any>;
  prisma.withoutScope = () => prisma;
  const templates = {
    findOne: jest.fn(async (id: number) =>
      structuredClone(id === 30 ? TEMPLATE_30 : TEMPLATE_20),
    ),
  };
  const s3 = {
    signUrl: jest.fn(async (key: string) => `https://signed.example/${key}`),
    uploadImage: jest.fn(async (_buffer: Buffer, key: string) => ({ key })),
    uploadFile: jest.fn(async (_buffer: Buffer, key: string) => key),
  };
  const s3Path = {
    buildStorePath: jest.fn(
      (org: { id: number; slug: string }, store: { id: number; slug: string }) =>
        `organizations/${org.slug}-${org.id}/stores/${store.slug}-${store.id}`,
    ),
  };
  const service = new CustomerDataSheetService(
    prisma as any,
    templates as any,
    s3 as any,
    s3Path as any,
  );
  return { service, prisma, templates, s3 };
}

async function codeOf(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(VendixHttpException);
  return (error as VendixHttpException).errorCode;
}

beforeEach(() => {
  jest
    .spyOn(RequestContextService, 'getContext')
    .mockReturnValue({ store_id: STORE, user_id: 1 } as any);
});
afterEach(() => jest.restoreAllMocks());

describe('CustomerDataSheetService (QUI-1043 H5/H8)', () => {
  describe('get', () => {
    it('without a pick the sheet is the CRM default, with only its active customer fields', async () => {
      const { service, templates } = setup();
      const sheet = await service.get(CUSTOMER);

      expect(templates.findOne).toHaveBeenCalledWith(20);
      expect(sheet.selected_template_id).toBeNull();
      expect(sheet.default_template_id).toBe(20);
      expect(sheet.templates).toEqual([
        { id: 20, name: 'Ficha comercial', is_crm_default: true },
        { id: 30, name: 'Ficha técnica', is_crm_default: false },
      ]);
      const template = sheet.template!;
      expect(template).not.toHaveProperty('products');
      // The booking-only section, the inactive child and the empty tab drop out.
      expect(template.tabs).toHaveLength(1);
      expect(template.tabs[0].sections).toHaveLength(1);
      const section = template.tabs[0].sections[0];
      expect(section.items.map((item: any) => item.metadata_field.id)).toEqual([NAME.id]);
      expect(section.child_sections.map((child: any) => child.id)).toEqual([12]);
      expect(template.sections.map((s: any) => s.id)).toEqual([15]);
    });

    it('answers of the template go to values, the rest to other_values; files come signed', async () => {
      const { service } = setup();
      const sheet = await service.get(CUSTOMER);

      expect(sheet.values.map((value) => value.field_id)).toEqual([NAME.id, RUT.id]);
      expect(sheet.values[1]).toMatchObject({
        field_type: 'file',
        value_text: `${PREFIX}/1-rut.pdf`,
        file_url: `https://signed.example/${PREFIX}/1-rut.pdf`,
      });
      expect(sheet.other_values).toEqual([
        expect.objectContaining({ field_id: BOOKING_ONLY.id, value_number: '3.5', file_url: null }),
      ]);
    });

    it('a picked template wins over the default', async () => {
      const { service, templates } = setup({ picked: 30 });
      const sheet = await service.get(CUSTOMER);
      expect(templates.findOne).toHaveBeenCalledWith(30);
      expect(sheet.selected_template_id).toBe(30);
      expect(sheet.default_template_id).toBe(20);
    });

    it('a pick that is no longer an active customer template falls back to the default', async () => {
      const { service, templates } = setup({ picked: 99 });
      const sheet = await service.get(CUSTOMER);
      expect(templates.findOne).toHaveBeenCalledWith(20);
      expect(sheet.selected_template_id).toBeNull();
    });

    it('without a pick nor a CRM default there is no template and every answer is "other"', async () => {
      const { service, prisma, templates } = setup();
      prisma.data_collection_templates.findMany.mockResolvedValueOnce([
        { id: 30, name: 'Ficha técnica', is_crm_default: false },
      ]);
      const sheet = await service.get(CUSTOMER);
      expect(templates.findOne).not.toHaveBeenCalled();
      expect(sheet.template).toBeNull();
      expect(sheet.values).toEqual([]);
      expect(sheet.other_values).toHaveLength(3);
    });

    it('a customer of another store answers 404', async () => {
      const { service, prisma } = setup({ customer: false });
      expect(await codeOf(service.get(CUSTOMER))).toBe('CRM_CUSTOMER_001');
      expect(prisma.entity_metadata_values.findMany).not.toHaveBeenCalled();
    });
  });

  describe('setTemplate', () => {
    it('stores the pick on the customer', async () => {
      const { service, prisma } = setup();
      await service.setTemplate(CUSTOMER, 30);
      expect(prisma.store_users.updateMany).toHaveBeenCalledWith({
        where: { user_id: CUSTOMER },
        data: { crm_data_template_id: 30 },
      });
    });

    it('null goes back to the default', async () => {
      const { service, prisma } = setup();
      await service.setTemplate(CUSTOMER, null);
      expect(prisma.data_collection_templates.findFirst).not.toHaveBeenCalled();
      expect(prisma.store_users.updateMany).toHaveBeenCalledWith({
        where: { user_id: CUSTOMER },
        data: { crm_data_template_id: null },
      });
    });

    it('rejects a template that is not an active customer one, or does not exist', async () => {
      const { service, prisma } = setup();
      prisma.data_collection_templates.findFirst.mockResolvedValueOnce({
        entity_type: 'booking',
        status: 'active',
      });
      expect(await codeOf(service.setTemplate(CUSTOMER, 40))).toBe('DCOL_CRM_001');
      prisma.data_collection_templates.findFirst.mockResolvedValueOnce(null);
      expect(await codeOf(service.setTemplate(CUSTOMER, 41))).toBe('DCOL_FIND_001');
      expect(prisma.store_users.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('saveValues', () => {
    it('upserts answers as customer values and deletes an all-null answer', async () => {
      const { service, prisma } = setup();
      await service.saveValues(CUSTOMER, [
        { field_id: NAME.id, value_text: 'Laura Pérez' },
        { field_id: BIRTHDAY.id, value_date: '1990-04-02' },
        { field_id: RUT.id, value_text: null },
      ]);

      expect(prisma.entity_metadata_values.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.entity_metadata_values.upsert).toHaveBeenCalledWith({
        where: {
          field_id_entity_type_entity_id: {
            field_id: NAME.id,
            entity_type: 'customer',
            entity_id: CUSTOMER,
          },
        },
        create: {
          store_id: STORE,
          field_id: NAME.id,
          entity_type: 'customer',
          entity_id: CUSTOMER,
          value_text: 'Laura Pérez',
          value_number: null,
          value_date: null,
          value_bool: null,
          value_json: Prisma.DbNull,
        },
        update: expect.objectContaining({ value_text: 'Laura Pérez' }),
      });
      const birthday = prisma.entity_metadata_values.upsert.mock.calls[1][0];
      expect(birthday.create.value_date).toEqual(new Date('1990-04-02T00:00:00.000Z'));
      expect(prisma.entity_metadata_values.deleteMany).toHaveBeenCalledWith({
        where: { field_id: RUT.id, entity_type: 'customer', entity_id: CUSTOMER },
      });
    });

    it('a field outside the effective template is rejected before any write', async () => {
      const { service, prisma } = setup();
      expect(
        await codeOf(
          service.saveValues(CUSTOMER, [
            { field_id: NAME.id, value_text: 'ok' },
            { field_id: BOOKING_ONLY.id, value_text: 'no' },
          ]),
        ),
      ).toBe('CRM_DATA_SHEET_001');
      expect(prisma.entity_metadata_values.upsert).not.toHaveBeenCalled();
    });

    it('a file answer must be a key uploaded to this customer, or the one already saved', async () => {
      const { service, prisma } = setup();
      for (const key of [
        'organizations/acme-2/stores/centro-10/data-collection/customers/5/1-rut.pdf',
        `${PREFIX}/../5/1-rut.pdf`,
        `${PREFIX}/sub/1-rut.pdf`,
        'https://evil.example/rut.pdf',
      ]) {
        expect(
          await codeOf(service.saveValues(CUSTOMER, [{ field_id: RUT.id, value_text: key }])),
        ).toBe('CRM_DATA_SHEET_002');
      }
      expect(prisma.entity_metadata_values.upsert).not.toHaveBeenCalled();

      await service.saveValues(CUSTOMER, [
        { field_id: RUT.id, value_text: `${PREFIX}/1-rut.pdf` },
      ]);
      await service.saveValues(CUSTOMER, [
        { field_id: RUT.id, value_text: `${PREFIX}/2-rut-nuevo.pdf` },
      ]);
      expect(prisma.entity_metadata_values.upsert).toHaveBeenCalledTimes(2);
    });
  });

  describe('upload', () => {
    it('uploads a document under the customer prefix with a safe name', async () => {
      const { service, s3 } = setup();
      jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      const result = await service.upload(CUSTOMER, {
        buffer: Buffer.from('pdf'),
        originalname: 'RUT 2026 (firmado).pdf',
        mimetype: 'application/pdf',
      } as Express.Multer.File);

      expect(s3.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        `${PREFIX}/1700000000000-RUT_2026_firmado_.pdf`,
        'application/pdf',
      );
      expect(result).toEqual({
        key: `${PREFIX}/1700000000000-RUT_2026_firmado_.pdf`,
        url: `https://signed.example/${PREFIX}/1700000000000-RUT_2026_firmado_.pdf`,
        original_name: 'RUT 2026 (firmado).pdf',
      });
    });

    it('images are optimized to webp; a missing file or a foreign customer is rejected', async () => {
      const { service, s3 } = setup();
      jest.spyOn(Date, 'now').mockReturnValue(1);
      await service.upload(CUSTOMER, {
        buffer: Buffer.from('img'),
        originalname: 'cédula.v2.jpg',
        mimetype: 'image/jpeg',
      } as Express.Multer.File);
      expect(s3.uploadImage).toHaveBeenCalledWith(
        expect.any(Buffer),
        `${PREFIX}/1-cedula.v2.webp`,
      );

      expect(await codeOf(service.upload(CUSTOMER, undefined))).toBe('UPLOAD_FILE_001');
      const foreign = setup({ customer: false });
      expect(
        await codeOf(
          foreign.service.upload(CUSTOMER, {
            buffer: Buffer.from('x'),
            originalname: 'x.pdf',
            mimetype: 'application/pdf',
          } as Express.Multer.File),
        ),
      ).toBe('CRM_CUSTOMER_001');
      expect(foreign.s3.uploadFile).not.toHaveBeenCalled();
    });

    it('refuses types outside the allow list and extensions that do not match the type', async () => {
      const { service, s3 } = setup();
      const refused: Array<[string, string]> = [
        ['logo.svg', 'image/svg+xml'],
        ['pagina.html', 'text/html'],
        ['pagina.html', 'text/plain'],
        ['script.js', 'application/javascript'],
        ['respaldo.zip', 'application/zip'],
        ['sin-extension', 'application/pdf'],
      ];
      for (const [originalname, mimetype] of refused) {
        expect(
          await codeOf(
            service.upload(CUSTOMER, {
              buffer: Buffer.from('x'),
              originalname,
              mimetype,
            } as Express.Multer.File),
          ),
        ).toBe('CRM_DATA_SHEET_003');
      }
      expect(s3.uploadFile).not.toHaveBeenCalled();
      expect(s3.uploadImage).not.toHaveBeenCalled();

      await service.upload(CUSTOMER, {
        buffer: Buffer.from('a;b'),
        originalname: 'clientes.CSV',
        mimetype: 'text/csv',
      } as Express.Multer.File);
      expect(s3.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.stringMatching(/clientes\.CSV$/),
        'text/csv',
      );
    });
  });
});
