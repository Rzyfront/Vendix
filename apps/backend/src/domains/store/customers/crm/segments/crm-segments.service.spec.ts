import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '../../../../../common/errors';
import { CrmSegmentQueryService } from './crm-segment-query.service';
import { CrmSegmentsService } from './crm-segments.service';

const STORE = 1;
const FILTER = { op: 'and', rules: [{ field: 'tag', cmp: 'eq', value: 4 }] };

function setup() {
  const prisma = {
    crm_tags: { findMany: jest.fn().mockResolvedValue([{ id: 4 }]) },
    crm_pipeline_stages: { findMany: jest.fn().mockResolvedValue([]) },
    entity_metadata_fields: { findMany: jest.fn().mockResolvedValue([]) },
    store_settings: { findFirst: jest.fn().mockResolvedValue({ settings: {}, stores: { timezone: 'America/Bogota' } }) },
    crm_segments: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: 3, name: 'VIP', filter: FILTER }),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 3, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $queryRaw: jest.fn(),
  };
  const raw = jest.fn((sql: Prisma.Sql) =>
    Promise.resolve(
      sql.text.includes('AS "count"')
        ? [{ count: 2 }]
        : [
            { id: 11, first_name: 'Ana', last_name: 'Gil', email: 'ana@shop.co', phone: '+573001234567', orders_count: 2, total_spent: '500', last_order_at: null },
          ],
    ),
  );
  const scoped = { ...prisma, withoutScope: () => ({ $queryRaw: raw }) };
  const customers = { getSegmentPopulationForAgent: jest.fn().mockResolvedValue([]) };
  const query = new CrmSegmentQueryService(scoped as never, customers as never);
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new CrmSegmentsService(scoped as never, query, audit as never);
  return { service, prisma, raw, audit };
}

const as = <T>(fn: () => Promise<T>, extra: Record<string, unknown> = {}) =>
  RequestContextService.runIsolated(
    { store_id: STORE, user_id: 9, is_super_admin: false, is_owner: false, permissions: [], ...extra },
    fn,
  );

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as VendixHttpException).errorCode;
  }
  return null;
};

describe('CrmSegmentsService', () => {
  it('previews count and a sample scoped to the store, masking contact without contact:read', async () => {
    const { service, raw } = setup();
    const preview = await as(() => service.preview(FILTER));
    expect(preview.count).toBe(2);
    expect(preview.sample[0]).toMatchObject({ email: 'a***@shop.co', phone: '+57********67' });
    for (const [sql] of raw.mock.calls) {
      expect(sql.text).toContain('su."store_id" = $');
      expect(sql.values).toContain(STORE);
    }
  });

  it('shows full contact data with store:customers:contact:read', async () => {
    const { service } = setup();
    const preview = await as(() => service.preview(FILTER), { permissions: ['store:customers:contact:read'] });
    expect(preview.sample[0]).toMatchObject({ email: 'ana@shop.co', phone: '+573001234567' });
  });

  it('rejects a filter outside the catalog with a 400 and the path', async () => {
    const { service, raw } = setup();
    let error: VendixHttpException | undefined;
    try {
      await as(() => service.preview({ op: 'and', rules: [{ field: 'password', cmp: 'eq', value: 'x' }] }));
    } catch (caught) {
      error = caught as VendixHttpException;
    }
    expect(error?.errorCode).toBe('CRM_SEGMENT_001');
    expect(error?.getStatus()).toBe(400);
    expect(raw).not.toHaveBeenCalled();
  });

  it('rejects a tag of another store (the scoped lookup does not find it)', async () => {
    const { service, prisma, raw } = setup();
    prisma.crm_tags.findMany.mockResolvedValue([]);
    await expect(code(as(() => service.preview(FILTER)))).resolves.toBe('CRM_SEGMENT_001');
    expect(raw).not.toHaveBeenCalled();
  });

  it('saves the normalized filter with the count seen in the preview', async () => {
    const { service, prisma } = setup();
    await as(() => service.create({ name: ' VIP ', filter: FILTER }));
    expect(prisma.crm_segments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          store_id: STORE,
          name: 'VIP',
          filter: FILTER,
          filter_version: 1,
          last_count: 2,
          created_by_user_id: 9,
        }),
      }),
    );
  });

  it('maps a duplicated name to 409', async () => {
    const { service, prisma } = setup();
    prisma.crm_segments.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(code(as(() => service.create({ name: 'VIP', filter: FILTER })))).resolves.toBe('CRM_SEGMENT_003');
  });

  it('re-evaluates a saved segment when listing its customers', async () => {
    const { service, prisma } = setup();
    const result = await as(() => service.customers(3, { page: 1, limit: 10 }));
    expect(result.meta).toEqual({ total: 2, page: 1, limit: 10, totalPages: 1 });
    expect(prisma.crm_segments.updateMany).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { last_count: 2, last_counted_at: expect.any(Date) },
    });
  });

  it('answers 404 for a segment of another store', async () => {
    const { service, prisma } = setup();
    prisma.crm_segments.findFirst.mockResolvedValue(null);
    await expect(code(as(() => service.get(3)))).resolves.toBe('CRM_SEGMENT_002');
    await expect(code(as(() => service.customers(3, {})))).resolves.toBe('CRM_SEGMENT_002');
    await expect(code(as(() => service.remove(3)))).resolves.toBe('CRM_SEGMENT_002');
    expect(prisma.crm_segments.deleteMany).not.toHaveBeenCalled();
  });

  it('audits deletions', async () => {
    const { service, audit } = setup();
    await as(() => service.remove(3));
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE', resource: 'crm_segments', resourceId: 3, storeId: STORE }),
    );
  });
});
