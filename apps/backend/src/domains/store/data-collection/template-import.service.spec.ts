import { VendixHttpException } from '../../../common/errors';
import { TemplateImportService } from './template-import.service';
import { buildExampleTemplateJson } from './template-json/template-json.contract';

type FieldRow = {
  id: number;
  entity_type: string;
  field_key: string;
  field_type: string;
  is_active: boolean;
};

function setup(existing: FieldRow[] = []) {
  let nextId = 100;
  const prisma = {
    entity_metadata_fields: {
      findMany: jest.fn(async (..._args: any[]) => existing),
      create: jest.fn(async ({ data }: any) => ({ id: nextId++, ...data })),
    },
  };
  const templates = {
    createTemplate: jest.fn(async (dto: any) => ({ id: 1, ...dto })),
  };
  const service = new TemplateImportService(prisma as any, templates as any);
  return { service, prisma, templates };
}

const baseJson = (items: any[], extra: Record<string, unknown> = {}) => ({
  schema: 'vendix.data-collection-template/v1',
  name: 'Ingreso',
  entity_type: 'booking',
  sections: [{ title: 'Datos', items }],
  ...extra,
});

const textItem = (key = 'placa', extra: Record<string, unknown> = {}) => ({
  field: { key, type: 'text', label: 'Placa' },
  ...extra,
});

async function errorOf(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(VendixHttpException);
  return error as VendixHttpException;
}

describe('TemplateImportService (S2)', () => {
  it('creates missing fields and the template as inactive draft with metadata ids and documents rules', async () => {
    const { service, prisma, templates } = setup();
    const json = baseJson([
      textItem('placa', { required: true, help_text: 'Ayuda', width: '50' }),
      {
        field: { key: 'cedula', type: 'file', label: 'Cédula' },
        documents: { multiple: true, accept: ['pdf'], max_size_mb: 5 },
      },
    ]);
    await service.import(json);

    expect(prisma.entity_metadata_fields.create).toHaveBeenCalledTimes(2);
    const created = prisma.entity_metadata_fields.create.mock.calls.map(
      (c: any[]) => c[0].data,
    );
    expect(created[0]).toMatchObject({
      entity_type: 'booking',
      field_key: 'placa',
      field_type: 'text',
      label: 'Placa',
      display_mode: 'detail',
    });
    const dto = templates.createTemplate.mock.calls[0][0];
    expect(dto.status).toBe('inactive');
    expect(dto.entity_type).toBe('booking');
    const items = dto.sections[0].items;
    expect(items[0]).toMatchObject({
      metadata_field_id: 100,
      is_required: true,
      help_text: 'Ayuda',
      width: '50',
      sort_order: 0,
    });
    expect(items[1]).toMatchObject({
      metadata_field_id: 101,
      sort_order: 1,
      validation_rules: {
        documents: { multiple: true, accept: ['pdf'], max_size_mb: 5 },
      },
    });
  });

  it('maps tabs and child sections', async () => {
    const { service, templates } = setup();
    await service.import(buildExampleTemplateJson());
    const dto = templates.createTemplate.mock.calls[0][0];
    expect(dto.status).toBe('inactive');
    expect(dto.tabs?.length ?? dto.sections?.length).toBeGreaterThan(0);
  });

  it('invalid JSON throws DCOL_IMPORT_001 with per-path errors and writes nothing', async () => {
    const { service, prisma, templates } = setup();
    const error = await errorOf(
      service.import(
        baseJson([{ field: { key: 'x', type: 'nope', label: 'X' } }]),
      ),
    );
    expect(error.errorCode).toBe('DCOL_IMPORT_001');
    const body = error.getResponse() as any;
    expect(body.details.errors).toEqual([
      expect.objectContaining({ path: 'sections[0].items[0].field.type' }),
    ]);
    expect(prisma.entity_metadata_fields.create).not.toHaveBeenCalled();
    expect(templates.createTemplate).not.toHaveBeenCalled();
  });

  it('ignores ids that come in the JSON', async () => {
    const { service, templates } = setup();
    const json: any = baseJson([textItem()]);
    json.id = 999;
    json.template_id = 5;
    json.sections[0].items[0].metadata_field_id = 777;
    json.sections[0].items[0].field.id = 888;
    await service.import(json);
    const dto = templates.createTemplate.mock.calls[0][0];
    expect(dto.id).toBeUndefined();
    expect(dto.sections[0].items[0].metadata_field_id).toBe(100);
  });

  it('an existing key with another type is an error at its path and nothing is written', async () => {
    const { service, prisma, templates } = setup([
      { id: 7, entity_type: 'booking', field_key: 'placa', field_type: 'number', is_active: true },
    ]);
    const error = await errorOf(
      service.import(baseJson([textItem('nueva'), textItem('placa')])),
    );
    expect(error.errorCode).toBe('DCOL_IMPORT_001');
    const errors = (error.getResponse() as any).details.errors;
    expect(errors).toEqual([
      {
        path: 'sections[0].items[1].field.type',
        message: expect.stringContaining('La clave "placa" ya existe en la tienda como tipo "number"'),
      },
    ]);
    expect(prisma.entity_metadata_fields.create).not.toHaveBeenCalled();
    expect(templates.createTemplate).not.toHaveBeenCalled();
  });

  it('an existing inactive field is an error at field.key', async () => {
    const { service } = setup([
      { id: 7, entity_type: 'booking', field_key: 'placa', field_type: 'text', is_active: false },
    ]);
    const error = await errorOf(service.import(baseJson([textItem('placa')])));
    expect((error.getResponse() as any).details.errors[0].path).toBe(
      'sections[0].items[0].field.key',
    );
  });

  it('reuses an existing active field of the same type without creating it', async () => {
    const { service, prisma, templates } = setup([
      { id: 7, entity_type: 'booking', field_key: 'placa', field_type: 'text', is_active: true },
    ]);
    await service.import(baseJson([textItem('placa')]));
    expect(prisma.entity_metadata_fields.create).not.toHaveBeenCalled();
    expect(templates.createTemplate.mock.calls[0][0].sections[0].items[0].metadata_field_id).toBe(7);
  });

  it('dry_run writes nothing and reports new/reuse', async () => {
    const { service, prisma, templates } = setup([
      { id: 7, entity_type: 'booking', field_key: 'placa', field_type: 'text', is_active: true },
    ]);
    const result = await service.import(
      baseJson([textItem('placa'), textItem('color')]),
      true,
    );
    expect(result).toEqual({
      valid: true,
      fields: [
        { key: 'placa', entity_type: 'booking', type: 'text', status: 'reuse' },
        { key: 'color', entity_type: 'booking', type: 'text', status: 'new' },
      ],
    });
    expect(prisma.entity_metadata_fields.create).not.toHaveBeenCalled();
    expect(templates.createTemplate).not.toHaveBeenCalled();
  });
});
