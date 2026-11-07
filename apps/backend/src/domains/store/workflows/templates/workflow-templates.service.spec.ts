import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { WorkflowTemplatesService } from './workflow-templates.service';
import { WORKFLOW_TEMPLATES } from './workflow-templates.catalog';

describe('WorkflowTemplatesService', () => {
  let existingKeys: string[];
  const prisma = {
    workflow_definitions: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const definitions = { create: jest.fn(), publish: jest.fn() };
  let service: WorkflowTemplatesService;

  const run = <T>(fn: () => Promise<T>) =>
    RequestContextService.run(
      { store_id: 7, organization_id: 1, user_id: 3 } as never,
      fn,
    );

  beforeEach(() => {
    jest.resetAllMocks();
    existingKeys = [];
    prisma.workflow_definitions.findMany.mockImplementation(async () =>
      existingKeys.map((key) => ({ key })),
    );
    prisma.workflow_definitions.updateMany.mockResolvedValue({ count: 1 });
    definitions.create.mockResolvedValue({ id: 41 });
    definitions.publish.mockResolvedValue({ unchanged: false, version: { version: 1 } });
    service = new WorkflowTemplatesService(prisma as never, definitions as never);
  });

  it('lists the 12 templates with a stage summary and no definition body', () => {
    const list = service.list();
    expect(list).toHaveLength(12);
    const purchase = list.find((t) => t.key === 'compras-aprobacion-monto')!;
    expect(purchase.stage_count).toBe(5);
    expect(purchase.stages[0]).toEqual({ key: 'solicitud', name: 'Solicitud de compra', type: 'form' });
    expect('definition' in purchase).toBe(false);
  });

  it('returns the full definition of one template', () => {
    expect(service.get('pqr').definition.key).toBe('pqr');
  });

  it('answers 404 for an unknown template on get and activate', async () => {
    expect(() => service.get('nope')).toThrow(VendixHttpException);
    await expect(run(() => service.activate('nope'))).rejects.toMatchObject({
      response: { error_code: 'WORKFLOW_TEMPLATE_NOT_FOUND' },
    });
    expect(definitions.create).not.toHaveBeenCalled();
  });

  it('creates the flow with category and source template, then publishes v1', async () => {
    const result = await run(() => service.activate('compras-aprobacion-monto'));

    const template = WORKFLOW_TEMPLATES[0];
    expect(definitions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: template.name,
        key: 'compras-aprobacion-monto',
        category: template.category,
        definition: expect.objectContaining({ key: 'compras-aprobacion-monto' }),
        source_template_key: 'compras-aprobacion-monto',
      }),
    );
    expect(prisma.workflow_definitions.updateMany).not.toHaveBeenCalled();
    expect(definitions.publish).toHaveBeenCalledWith(41, expect.any(Object));
    expect(result).toEqual({
      id: 41,
      key: 'compras-aprobacion-monto',
      name: template.name,
      version: 1,
      source_template_key: 'compras-aprobacion-monto',
    });
  });

  it('suffixes the key when it is taken and never overwrites', async () => {
    existingKeys = ['pqr', 'pqr-2', 'pqr-extra'];
    const result = await run(() => service.activate('pqr'));
    expect(result.key).toBe('pqr-3');
    expect(result.name).toBe('PQR (3)');
    expect(definitions.create).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'pqr-3', definition: expect.objectContaining({ key: 'pqr-3' }) }),
    );
  });

  it('does not report success when publishing fails', async () => {
    definitions.publish.mockRejectedValue(new Error('invalid'));
    await expect(run(() => service.activate('pqr'))).rejects.toThrow('invalid');
  });
});
