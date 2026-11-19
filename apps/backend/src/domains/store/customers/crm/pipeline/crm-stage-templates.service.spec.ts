import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '../../../../../common/errors';
import {
  CrmStageTemplatesService,
  INITIAL_STAGE_TEMPLATE_NAME,
} from './crm-stage-templates.service';
import { CrmStageKind } from './dto/crm-pipeline.dto';

const STORE = 10;
const OWNER = 1;
const SELLER = 2;

function as(user: 'owner' | 'seller') {
  jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
    store_id: STORE,
    user_id: user === 'owner' ? OWNER : SELLER,
    is_super_admin: false,
    is_owner: false,
    permissions:
      user === 'owner'
        ? ['store:crm_pipeline:read', 'store:crm_pipeline:manage', 'store:crm_inbox:assign']
        : ['store:crm_pipeline:read', 'store:crm_pipeline:manage'],
  } as any);
}

const PIPELINE_STAGES = [
  { id: 101, pipeline_id: 1, name: 'Nuevo', kind: 'open', probability: 10, color: '#111', sort_order: 0, is_active: true },
  { id: 102, pipeline_id: 1, name: 'contactado', kind: 'open', probability: null, color: null, sort_order: 1, is_active: true },
  { id: 103, pipeline_id: 1, name: 'Cotizado', kind: 'open', probability: 60, color: null, sort_order: 2, is_active: true },
  { id: 104, pipeline_id: 1, name: 'Ganado', kind: 'won', probability: 100, color: null, sort_order: 3, is_active: true },
  { id: 105, pipeline_id: 1, name: 'Perdido', kind: 'lost', probability: 0, color: null, sort_order: 4, is_active: true },
];

const TEMPLATE = {
  id: 7,
  store_id: STORE,
  name: 'B2B',
  stages: [
    { name: 'Nuevo', kind: 'open', color: '#222', probability: 5 },
    { name: 'Contactado', kind: 'open', color: null, probability: 20 },
    { name: 'Demo', kind: 'open', color: null, probability: 40 },
    { name: 'Ganado', kind: 'won', color: null, probability: 100 },
    { name: 'Perdido', kind: 'lost', color: null, probability: 0 },
  ],
  created_at: new Date('2026-11-01T00:00:00Z'),
  updated_at: new Date('2026-11-01T00:00:00Z'),
};

function unique() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function setup(options: { opportunities?: Array<{ stage_id: number; status: string }> } = {}) {
  const tx = {
    crm_pipeline_stages: {
      updateMany: jest.fn(async (..._args: any[]) => ({ count: 1 })),
      create: jest.fn(async ({ data }: any) => ({ id: 900, ...data })),
    },
    // Usage is counted inside the transaction (unscoped client).
    crm_opportunities: {
      findMany: jest.fn(async (..._args: any[]) => options.opportunities ?? []),
    },
  };
  const prisma = {
    crm_stage_templates: {
      findMany: jest.fn(async (..._args: any[]) => [TEMPLATE]),
      findFirst: jest.fn(async (..._args: any[]) => TEMPLATE),
      create: jest.fn(async ({ data }: any) => ({ id: 8, created_at: new Date(), updated_at: new Date(), ...data })),
      updateMany: jest.fn(async (..._args: any[]) => ({ count: 1 })),
      deleteMany: jest.fn(async (..._args: any[]) => ({ count: 1 })),
    },
    crm_pipelines: {
      findFirst: jest.fn(async (..._args: any[]) => ({
        id: 1,
        name: 'Ventas',
        is_default: true,
        stages: PIPELINE_STAGES,
      })),
      create: jest.fn(async (..._args: any[]) => ({ id: 3 })),
    },
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  } as Record<string, any>;
  const audit = { log: jest.fn(async (..._args: any[]) => undefined) };
  const bootstrap = { ensureDefaultCrmPipeline: jest.fn(async (..._args: any[]) => ({ id: 1 })) };
  const service = new CrmStageTemplatesService(prisma as any, audit as any, bootstrap as any);
  return { service, prisma, tx, audit, bootstrap };
}

async function codeOf(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(VendixHttpException);
  return (error as VendixHttpException).errorCode;
}

afterEach(() => jest.restoreAllMocks());

describe('CrmStageTemplatesService (QUI-1043 H3)', () => {
  describe('list', () => {
    it('seeds "Embudo estándar" with the active stages of the default pipeline', async () => {
      as('owner');
      const { service, prisma } = setup();
      prisma.crm_stage_templates.findMany.mockResolvedValueOnce([]);

      const templates = await service.list();

      expect(prisma.crm_stage_templates.create).toHaveBeenCalledWith({
        data: {
          store_id: STORE,
          name: INITIAL_STAGE_TEMPLATE_NAME,
          stages: [
            { name: 'Nuevo', kind: 'open', color: '#111', probability: 10 },
            { name: 'contactado', kind: 'open', color: null, probability: null },
            { name: 'Cotizado', kind: 'open', color: null, probability: 60 },
            { name: 'Ganado', kind: 'won', color: null, probability: 100 },
            { name: 'Perdido', kind: 'lost', color: null, probability: 0 },
          ],
        },
      });
      expect(templates).toHaveLength(1);
    });

    it('without a pipeline the initial template is the funnel every store is born with', async () => {
      as('owner');
      const { service, prisma } = setup();
      prisma.crm_stage_templates.findMany.mockResolvedValueOnce([]);
      prisma.crm_pipelines.findFirst.mockResolvedValueOnce(null);

      await service.list();

      const { data } = prisma.crm_stage_templates.create.mock.calls[0][0];
      expect(data.stages.map((stage: any) => `${stage.name}:${stage.kind}`)).toEqual([
        'Nuevo:open',
        'Contactado:open',
        'Cotizado:open',
        'Ganado:won',
        'Perdido:lost',
      ]);
    });

    it('a concurrent seed (P2002) is not an error', async () => {
      as('owner');
      const { service, prisma } = setup();
      prisma.crm_stage_templates.findMany.mockResolvedValueOnce([]);
      prisma.crm_stage_templates.create.mockRejectedValueOnce(unique());

      await expect(service.list()).resolves.toHaveLength(1);
    });

    it('a plain read (no see-all) never writes: no seed, empty list', async () => {
      as('seller');
      const { service, prisma } = setup();
      prisma.crm_stage_templates.findMany.mockResolvedValueOnce([]);

      await expect(service.list()).resolves.toEqual([]);
      expect(prisma.crm_stage_templates.create).not.toHaveBeenCalled();
    });

    it('does not seed when the store already has templates', async () => {
      as('owner');
      const { service, prisma } = setup();
      const templates = await service.list();
      expect(prisma.crm_stage_templates.create).not.toHaveBeenCalled();
      expect(templates[0]).toMatchObject({ id: 7, name: 'B2B', stages: TEMPLATE.stages });
    });
  });

  describe('create / update / remove', () => {
    it('only see-all edits templates', async () => {
      as('seller');
      const { service, prisma } = setup();
      expect(
        await codeOf(service.create({ name: 'X', stages: [{ name: 'A', kind: 'open' }] })),
      ).toBe('CRM_PIPELINE_007');
      expect(await codeOf(service.remove(7))).toBe('CRM_PIPELINE_007');
      expect(prisma.crm_stage_templates.create).not.toHaveBeenCalled();
      expect(prisma.crm_stage_templates.deleteMany).not.toHaveBeenCalled();
    });

    it('trims names and stores the stages in order', async () => {
      as('owner');
      const { service, prisma } = setup();
      const created = await service.create({
        name: '  Retail  ',
        stages: [
          { name: ' Lead ', kind: 'open', color: '', probability: 10 },
          { name: 'Cerrado', kind: 'won' },
          { name: 'Descartado', kind: 'lost', probability: 0 },
        ],
      });
      expect(prisma.crm_stage_templates.create).toHaveBeenCalledWith({
        data: {
          store_id: STORE,
          name: 'Retail',
          stages: [
            { name: 'Lead', kind: 'open', color: null, probability: 10 },
            { name: 'Cerrado', kind: 'won', color: null, probability: null },
            { name: 'Descartado', kind: 'lost', color: null, probability: 0 },
          ],
        },
      });
      expect(created.stages).toHaveLength(3);
    });

    it('rejects repeated stage names (case insensitive) and a template without an open, won or lost stage', async () => {
      as('owner');
      const { service, prisma } = setup();
      expect(
        await codeOf(
          service.create({
            name: 'X',
            stages: [
              { name: 'Nuevo', kind: 'open' },
              { name: 'NUEVO ', kind: 'won' },
              { name: 'Perdido', kind: 'lost' },
            ],
          }),
        ),
      ).toBe('CRM_STAGE_TEMPLATE_003');
      expect(
        await codeOf(
          service.update(7, {
            stages: [
              { name: 'Ganado', kind: 'won' },
              { name: 'Perdido', kind: 'lost' },
            ],
          }),
        ),
      ).toBe('CRM_STAGE_TEMPLATE_003');
      // Without a closing stage the pipeline could never win or lose.
      for (const closing of ['won', 'lost'] as const) {
        expect(
          await codeOf(
            service.create({
              name: 'Sin cierre',
              stages: [
                { name: 'Nuevo', kind: 'open' },
                { name: 'Cierre', kind: closing },
              ],
            }),
          ),
        ).toBe('CRM_STAGE_TEMPLATE_003');
      }
      expect(prisma.crm_stage_templates.create).not.toHaveBeenCalled();
      expect(prisma.crm_stage_templates.updateMany).not.toHaveBeenCalled();
    });

    it('a repeated template name answers 409', async () => {
      as('owner');
      const { service, prisma } = setup();
      prisma.crm_stage_templates.create.mockRejectedValueOnce(unique());
      expect(
        await codeOf(service.create({
            name: 'B2B',
            stages: TEMPLATE.stages.map((stage) => ({ ...stage, kind: stage.kind as CrmStageKind })),
          })),
      ).toBe('CRM_STAGE_TEMPLATE_002');
    });

    it('an unknown template answers 404', async () => {
      as('owner');
      const { service, prisma } = setup();
      prisma.crm_stage_templates.findFirst.mockResolvedValueOnce(null);
      expect(await codeOf(service.update(99, { name: 'Y' }))).toBe('CRM_STAGE_TEMPLATE_001');
    });

    it('remove deletes and audits the snapshot', async () => {
      as('owner');
      const { service, prisma, audit } = setup();
      await expect(service.remove(7)).resolves.toEqual({ id: 7 });
      expect(prisma.crm_stage_templates.deleteMany).toHaveBeenCalledWith({ where: { id: 7 } });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DELETE',
          resource: 'crm_stage_templates',
          resourceId: 7,
          storeId: STORE,
          userId: OWNER,
          oldValues: expect.objectContaining({ name: 'B2B' }),
        }),
      );
    });
  });

  describe('createPipeline', () => {
    it('keeps the store default and creates a non-default pipeline with the template stages in order', async () => {
      as('owner');
      const { service, prisma, bootstrap, audit } = setup();
      await service.createPipeline({ name: ' Mayoristas ', template_id: 7 });

      expect(bootstrap.ensureDefaultCrmPipeline).toHaveBeenCalledWith({ store_id: STORE });
      const { data } = prisma.crm_pipelines.create.mock.calls[0][0];
      expect(data).toMatchObject({ store_id: STORE, name: 'Mayoristas', is_default: false });
      expect(data.stages.create).toEqual(
        TEMPLATE.stages.map((stage, index) => ({
          store_id: STORE,
          name: stage.name,
          kind: stage.kind,
          color: stage.color,
          probability: stage.probability,
          sort_order: index,
        })),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', resource: 'crm_pipelines', resourceId: 3 }),
      );
    });

    it('a repeated pipeline name answers 409', async () => {
      as('owner');
      const { service, prisma } = setup();
      prisma.crm_pipelines.create.mockRejectedValueOnce(unique());
      expect(await codeOf(service.createPipeline({ name: 'Ventas', template_id: 7 }))).toBe(
        'CRM_PIPELINE_009',
      );
    });
  });

  describe('applyTemplate', () => {
    it('reconciles by name: updates matches, creates new stages and deactivates the rest', async () => {
      as('owner');
      // Closed opportunities in the stage left out do not block.
      const { service, tx, audit } = setup({
        opportunities: [
          { stage_id: 101, status: 'open' },
          { stage_id: 103, status: 'won' },
        ],
      });

      await service.applyTemplate(1, 7);

      expect(tx.crm_opportunities.findMany).toHaveBeenCalledWith({
        where: { pipeline_id: 1, store_id: STORE },
        select: { stage_id: true, status: true },
      });
      const updates = tx.crm_pipeline_stages.updateMany.mock.calls.map(([args]: any) => args);
      expect(updates).toEqual([
        {
          where: { id: 101, pipeline_id: 1, store_id: STORE },
          data: { kind: 'open', color: '#222', probability: 5, sort_order: 0, is_active: true },
        },
        // "contactado" matches "Contactado" without renaming.
        {
          where: { id: 102, pipeline_id: 1, store_id: STORE },
          data: { kind: 'open', color: null, probability: 20, sort_order: 1, is_active: true },
        },
        {
          where: { id: 104, pipeline_id: 1, store_id: STORE },
          data: { kind: 'won', color: null, probability: 100, sort_order: 3, is_active: true },
        },
        {
          where: { id: 105, pipeline_id: 1, store_id: STORE },
          data: { kind: 'lost', color: null, probability: 0, sort_order: 4, is_active: true },
        },
        {
          where: { id: 103, pipeline_id: 1, store_id: STORE },
          data: { is_active: false, sort_order: 5 },
        },
      ]);
      expect(tx.crm_pipeline_stages.create).toHaveBeenCalledTimes(1);
      expect(tx.crm_pipeline_stages.create).toHaveBeenCalledWith({
        data: {
          store_id: STORE,
          pipeline_id: 1,
          name: 'Demo',
          kind: 'open',
          color: null,
          probability: 40,
          sort_order: 2,
        },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          resource: 'crm_pipelines',
          resourceId: 1,
          newValues: expect.objectContaining({ template_id: 7 }),
          metadata: { reason: 'crm_apply_stage_template' },
        }),
      );
    });

    it('refuses when a stage left out still has open opportunities', async () => {
      as('owner');
      const { service, tx, audit } = setup({
        opportunities: [{ stage_id: 103, status: 'open' }],
      });
      expect(await codeOf(service.applyTemplate(1, 7))).toBe('CRM_PIPELINE_006');
      expect(tx.crm_pipeline_stages.updateMany).not.toHaveBeenCalled();
      expect(tx.crm_pipeline_stages.create).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('refuses to change the kind of a stage that has opportunities', async () => {
      as('owner');
      const { service, prisma, tx } = setup({
        opportunities: [{ stage_id: 104, status: 'won' }],
      });
      prisma.crm_stage_templates.findFirst.mockResolvedValueOnce({
        ...TEMPLATE,
        stages: [
          { name: 'Nuevo', kind: 'open', color: null, probability: null },
          { name: 'Ganado', kind: 'open', color: null, probability: null },
          { name: 'Cierre', kind: 'won', color: null, probability: null },
          { name: 'Perdido', kind: 'lost', color: null, probability: null },
        ],
      });
      expect(await codeOf(service.applyTemplate(1, 7))).toBe('CRM_PIPELINE_008');
      expect(tx.crm_pipeline_stages.updateMany).not.toHaveBeenCalled();
      expect(tx.crm_pipeline_stages.create).not.toHaveBeenCalled();
    });

    it('only see-all applies templates, and an unknown pipeline answers 404', async () => {
      as('seller');
      const seller = setup();
      expect(await codeOf(seller.service.applyTemplate(1, 7))).toBe('CRM_PIPELINE_007');

      jest.restoreAllMocks();
      as('owner');
      const owner = setup();
      owner.prisma.crm_pipelines.findFirst.mockResolvedValueOnce(null);
      expect(await codeOf(owner.service.applyTemplate(99, 7))).toBe('CRM_PIPELINE_001');
    });
  });
});
