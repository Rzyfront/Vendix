import {
  createMembershipTools,
  MembershipToolDeps,
} from './memberships.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Paso 8 (vex-agent) — contrato memberships: 3 reads + 2 writes.
 *
 * Patrón canónico T4: happy/sad con sad sin tocar deps, literales con
 * `toEqual`, `{error, next_step}` en ES, permiso por tool, `readOnly` en
 * reads y `requiresConfirmation` + `preview` con sujeto humano en writes.
 * Pinnea además que el preview de checkin_member no llama a validate
 * (validar duplicaría el registro de ingreso).
 */
describe('memberships.tools · membresías', () => {
  const CONTEXT = { organization_id: 3, store_id: 7, user_id: 11 };

  const PLAN = { id: 2, name: 'Plan Mensual Full', price: 90000 };
  const MEMBERSHIP = {
    id: 15,
    customer_id: 4,
    plan_id: 2,
    status: 'pending_payment',
  };

  function buildTools(overrides: Record<string, any> = {}) {
    const deps = {
      membershipsService: {
        findAll: jest.fn().mockResolvedValue({
          data: [MEMBERSHIP],
          meta: { total: 1, page: 1, limit: 10, total_pages: 1 },
        }),
        findOne: jest.fn().mockResolvedValue(MEMBERSHIP),
        create: jest.fn().mockResolvedValue({ ...MEMBERSHIP, id: 16 }),
      },
      membershipAccessService: {
        validate: jest.fn().mockResolvedValue({
          granted: true,
          result: 'granted',
          member_name: 'Ana Ríos',
        }),
      },
      membershipPlansService: {
        findAll: jest.fn().mockResolvedValue({
          data: [PLAN],
          meta: { total: 1, page: 1, limit: 10, total_pages: 1 },
        }),
        findOne: jest.fn().mockResolvedValue(PLAN),
      },
      ...overrides,
    } as any;
    const tools = createMembershipTools(deps as MembershipToolDeps);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    return { deps: deps as any, tools, byName };
  }

  function run(tool: RegisteredTool, args: Record<string, any> = {}) {
    return tool.handler!(args, CONTEXT).then((raw) => JSON.parse(raw));
  }

  function preview(tool: RegisteredTool, args: Record<string, any> = {}) {
    return tool.preview!(args, CONTEXT);
  }

  it('expone 3 reads + 2 writes con permisos del endpoint equivalente', () => {
    const { tools } = buildTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'checkin_member',
        'get_membership',
        'list_membership_plans',
        'list_memberships',
        'sell_membership',
      ].sort(),
    );
    const perms = Object.fromEntries(
      tools.map((t) => [t.name, t.requiredPermissions]),
    );
    expect(perms).toEqual({
      list_membership_plans: ['store:membership_plans:read'],
      list_memberships: ['store:memberships:read'],
      get_membership: ['store:memberships:read'],
      sell_membership: ['store:memberships:create'],
      checkin_member: ['store:membership_access:create'],
    });
    for (const name of [
      'list_membership_plans',
      'list_memberships',
      'get_membership',
    ]) {
      expect(tools.find((t) => t.name === name)!.readOnly).toBe(true);
    }
    for (const name of ['sell_membership', 'checkin_member']) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.requiresConfirmation).toBe(true);
      expect(typeof tool.preview).toBe('function');
    }
  });

  it('list_memberships filtra por estado', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.list_memberships, { status: 'active' });
    expect(out.data).toEqual([MEMBERSHIP]);
    expect(deps.membershipsService.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' }),
    );
  });

  it('sell_membership nombra el plan y vende en pending_payment', async () => {
    const { deps, byName } = buildTools();
    const args = { customer_id: 4, plan_id: 2 };
    const prev = await preview(byName.sell_membership, args);
    expect(prev.status).toBe('ok');
    expect(prev.target).toContain('Plan Mensual Full');
    const out = await run(byName.sell_membership, args);
    expect(out.membership_id).toBe(16);
    expect(deps.membershipsService.create).toHaveBeenCalledWith({
      customer_id: 4,
      plan_id: 2,
    });
  });

  it('sell_membership rechaza plan inválido sin tocar create', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.sell_membership, {
      customer_id: 4,
      plan_id: 0,
    });
    expect(out.error).toContain('plan_id');
    expect(deps.membershipsService.create).not.toHaveBeenCalled();
  });

  it('checkin_member previsualiza sin validar y concede en el handler', async () => {
    const { deps, byName } = buildTools();
    const args = { credential_type: 'qr', credential_value: 'QR-ABC-123' };
    const prev = await preview(byName.checkin_member, args);
    expect(prev.status).toBe('ok');
    expect(prev.target).toContain('qr');
    expect(deps.membershipAccessService.validate).not.toHaveBeenCalled();
    const out = await run(byName.checkin_member, args);
    expect(out.granted).toBe(true);
    expect(out.resumen).toContain('Ana Ríos');
    expect(deps.membershipAccessService.validate).toHaveBeenCalledTimes(1);
  });

  it('checkin_member rechaza tipo inválido sin tocar deps', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.checkin_member, {
      credential_type: 'nfc',
      credential_value: 'x',
    });
    expect(out.error).toContain('qr, pin o external_ref');
    expect(deps.membershipAccessService.validate).not.toHaveBeenCalled();
  });

  it('checkin_member reporta el rechazo del lector', async () => {
    const { byName } = buildTools({
      membershipAccessService: {
        validate: jest.fn().mockResolvedValue({
          granted: false,
          result: 'denied_expired',
        }),
      },
    });
    const out = await run(byName.checkin_member, {
      credential_type: 'pin',
      credential_value: '0000',
    });
    expect(out.granted).toBe(false);
    expect(out.resumen).toContain('denied_expired');
  });
});
