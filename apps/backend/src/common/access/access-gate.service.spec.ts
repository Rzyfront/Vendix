import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AccessGateService } from './access-gate.service';
import {
  AccessAuditBatchDto,
  AccessAuditEventDto,
} from './dto/access-audit-events.dto';

const user = { id: 9, store_id: 3, organization_id: 2, roles: ['admin', 'x'] };

describe('AccessGateService', () => {
  let prisma: any;
  let mode: any;
  let audit: any;
  let svc: AccessGateService;

  beforeEach(() => {
    prisma = {
      stores: { findUnique: jest.fn(), findMany: jest.fn() },
      organization_settings: { findUnique: jest.fn() },
    };
    mode = {
      modeForStore: jest.fn().mockResolvedValue('audit'),
      modeForOrganization: jest.fn().mockResolvedValue('audit'),
      planModeForStore: jest.fn().mockResolvedValue('audit'),
      planModeForOrganization: jest.fn().mockResolvedValue('audit'),
    };
    audit = { record: jest.fn() };
    svc = new AccessGateService(prisma, mode, audit);
  });

  it('store POST: identity comes from the request, industry/mode server-side', async () => {
    prisma.stores.findUnique.mockResolvedValue({ industries: ['restaurant'] });
    const body = {
      events: [
        {
          key: 'orders',
          decision: 'would_hide',
          layer: 'industry',
          surface: 'sidebar',
          route: '/admin/orders',
          // forged identity must be ignored
          store_id: 999,
          user_id: 999,
          role: 'owner',
        },
      ],
    } as any;
    const res = await svc.recordStoreEvents(user, body);
    expect(res).toEqual({ recorded: 1 });
    expect(audit.record).toHaveBeenCalledWith({
      source: 'frontend',
      surface: 'sidebar',
      store_id: 3,
      organization_id: 2,
      user_id: 9,
      role: 'admin',
      key: 'orders',
      industry: ['restaurant'],
      decision: 'would_hide',
      layer: 'industry',
      route: '/admin/orders',
      mode: 'audit',
    });
  });

  it('store POST: layer plan usa el modo de plan; otras capas conservan el de industria', async () => {
    prisma.stores.findUnique.mockResolvedValue({ industries: ['retail'] });
    mode.modeForStore.mockResolvedValue('enforce');
    mode.planModeForStore.mockResolvedValue('audit');
    await svc.recordStoreEvents(user, {
      events: [
        { key: 'pos', decision: 'would_block', layer: 'plan', surface: 'sidebar' },
        { key: 'orders', decision: 'would_hide', layer: 'industry', surface: 'sidebar' },
      ],
    } as any);
    const [planCall, industryCall] = audit.record.mock.calls.map((c: any[]) => c[0]);
    expect(planCall).toEqual(
      expect.objectContaining({ layer: 'plan', mode: 'audit' }),
    );
    expect(industryCall).toEqual(
      expect.objectContaining({ layer: 'industry', mode: 'enforce' }),
    );
  });

  it('org POST: layer plan usa el modo de plan de la organización', async () => {
    prisma.stores.findMany.mockResolvedValue([]);
    mode.modeForOrganization.mockResolvedValue('audit');
    mode.planModeForOrganization.mockResolvedValue('enforce');
    await svc.recordOrganizationEvents(user, {
      events: [
        { key: 'pos', decision: 'would_block', layer: 'plan', surface: 'sidebar' },
        { key: 'stores', decision: 'would_hide', layer: 'org', surface: 'sidebar' },
      ],
    } as any);
    const [planCall, orgCall] = audit.record.mock.calls.map((c: any[]) => c[0]);
    expect(planCall.mode).toBe('enforce');
    expect(orgCall.mode).toBe('audit');
  });

  it('org POST: store_id null and industry = union of the org stores', async () => {
    prisma.stores.findMany.mockResolvedValue([
      { industries: ['restaurant'] },
      { industries: ['gym', 'restaurant'] },
    ]);
    await svc.recordOrganizationEvents(user, {
      events: [
        { key: 'stores', decision: 'would_hide', layer: 'org', surface: 'sidebar' },
      ],
    } as any);
    expect(prisma.stores.findMany).toHaveBeenCalledWith({
      where: { organization_id: 2, is_active: true },
      select: { industries: true },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        store_id: null,
        organization_id: 2,
        industry: ['restaurant', 'gym'],
        route: null,
      }),
    );
  });

  it('org state: union without stores → retail, and panel_ui ceiling', async () => {
    prisma.stores.findMany.mockResolvedValue([]);
    prisma.organization_settings.findUnique.mockResolvedValue({
      settings: { panel_ui: { ORG_ADMIN: { stores: true } } },
    });
    await expect(svc.getOrganizationState(user)).resolves.toEqual({
      mode: 'audit',
      industries: ['retail'],
      org_panel_ui: { stores: true },
    });
    prisma.organization_settings.findUnique.mockResolvedValue(null);
    expect((await svc.getOrganizationState(user)).org_panel_ui).toBeNull();
  });

  it('store state reflects the Redis mode', async () => {
    prisma.stores.findUnique.mockResolvedValue({ industries: [] });
    mode.modeForStore.mockResolvedValue('enforce');
    await expect(svc.getStoreState(user)).resolves.toEqual({
      mode: 'enforce',
      industries: ['retail'],
    });
  });
});

describe('AccessAuditBatchDto', () => {
  const ev = {
    key: 'orders',
    decision: 'would_hide',
    layer: 'industry',
    surface: 'sidebar',
  };
  const check = (events: unknown[]) =>
    validate(plainToInstance(AccessAuditBatchDto, { events }), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  it('accepts 50 events and rejects 51 (ArrayMaxSize)', async () => {
    expect(await check(Array(50).fill(ev))).toHaveLength(0);
    expect(await check(Array(51).fill(ev))).not.toHaveLength(0);
  });

  it('rejects bad key, surface api, bad decision and long route', async () => {
    for (const bad of [
      { ...ev, key: 'Bad Key' },
      { ...ev, key: 'a'.repeat(65) },
      { ...ev, surface: 'api' },
      { ...ev, decision: 'nope' },
      { ...ev, route: 'x'.repeat(201) },
    ]) {
      expect(await check([bad])).not.toHaveLength(0);
    }
  });

  it('rejects identity fields in the body (forbidNonWhitelisted)', async () => {
    expect(await check([{ ...ev, user_id: 1 }])).not.toHaveLength(0);
    expect(plainToInstance(AccessAuditEventDto, ev)).toBeInstanceOf(
      AccessAuditEventDto,
    );
  });
});
