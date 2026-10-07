import { createStoreUserTools, StoreUserToolDeps } from './store-users.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Paso 8 (vex-agent) — contrato store-users: 2 reads + 2 writes.
 *
 * Patrón canónico T4: happy/sad con sad sin tocar deps, literales con
 * `toEqual`, `{error, next_step}` en ES, permiso por tool, `readOnly` en
 * reads y `requiresConfirmation` + `preview` con sujeto humano en writes.
 * Pinnea además que la contraseña nunca aparece en preview ni resumen.
 */
describe('store-users.tools · usuarios de tienda', () => {
  const CONTEXT = { organization_id: 3, store_id: 7, user_id: 11 };

  const USER = {
    id: 42,
    first_name: 'Luis',
    last_name: 'Caja',
    email: 'luis@tienda.com',
    roles: [{ id: 5, name: 'cashier' }],
  };

  function buildTools(overrides: Record<string, any> = {}) {
    const deps = {
      storeUserManagementService: {
        findAll: jest.fn().mockResolvedValue({
          data: [USER],
          meta: { total: 1, page: 1, limit: 10, total_pages: 1 },
        }),
        findOne: jest.fn().mockResolvedValue(USER),
        create: jest.fn().mockResolvedValue({ ...USER, id: 43 }),
        updateRoles: jest.fn().mockResolvedValue({
          ...USER,
          roles: [
            { id: 5, name: 'cashier' },
            { id: 6, name: 'waiter' },
          ],
        }),
      },
      ...overrides,
    } as any;
    const tools = createStoreUserTools(deps as StoreUserToolDeps);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    return { deps: deps as any, tools, byName };
  }

  function run(tool: RegisteredTool, args: Record<string, any> = {}) {
    return tool.handler!(args, CONTEXT).then((raw) => JSON.parse(raw));
  }

  function preview(tool: RegisteredTool, args: Record<string, any> = {}) {
    return tool.preview!(args, CONTEXT);
  }

  it('expone 2 reads + 2 writes con permisos del endpoint equivalente', () => {
    const { tools } = buildTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'assign_store_user_roles',
        'get_store_user',
        'invite_store_user',
        'list_store_users',
      ].sort(),
    );
    const perms = Object.fromEntries(
      tools.map((t) => [t.name, t.requiredPermissions]),
    );
    expect(perms).toEqual({
      list_store_users: ['store:users:read'],
      get_store_user: ['store:users:read'],
      invite_store_user: ['store:users:create'],
      assign_store_user_roles: ['store:users:update'],
    });
    expect(
      tools.find((t) => t.name === 'list_store_users')!.readOnly,
    ).toBe(true);
    expect(tools.find((t) => t.name === 'get_store_user')!.readOnly).toBe(
      true,
    );
    for (const name of ['invite_store_user', 'assign_store_user_roles']) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.requiresConfirmation).toBe(true);
      expect(typeof tool.preview).toBe('function');
    }
  });

  it('list_store_users filtra por rol', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.list_store_users, { role: 'cashier' });
    expect(out.data).toEqual([USER]);
    expect(deps.storeUserManagementService.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'cashier' }),
    );
  });

  it('invite_store_user previsualiza sin exponer la contraseña y crea', async () => {
    const { deps, byName } = buildTools();
    const args = {
      first_name: 'Luis',
      last_name: 'Caja',
      email: 'luis@tienda.com',
      password: 'Temporal1!',
      role: 'cashier',
    };
    const prev = await preview(byName.invite_store_user, args);
    expect(prev.status).toBe('ok');
    expect(prev.target).toContain('luis@tienda.com');
    expect(JSON.stringify(prev)).not.toContain('Temporal1!');
    const out = await run(byName.invite_store_user, args);
    expect(out.user_id).toBe(43);
    expect(JSON.stringify(out)).not.toContain('Temporal1!');
    expect(deps.storeUserManagementService.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'luis@tienda.com', role: 'cashier' }),
    );
  });

  it('invite_store_user rechaza correo inválido sin tocar deps', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.invite_store_user, {
      first_name: 'Luis',
      last_name: 'Caja',
      email: 'no-es-correo',
      password: 'Temporal1!',
    });
    expect(out.error).toContain('email');
    expect(deps.storeUserManagementService.create).not.toHaveBeenCalled();
  });

  it('invite_store_user rechaza rol no asignable', async () => {
    const { deps, byName } = buildTools();
    const prev = await preview(byName.invite_store_user, {
      first_name: 'Luis',
      last_name: 'Caja',
      email: 'luis@tienda.com',
      password: 'Temporal1!',
      role: 'owner',
    });
    expect(prev.status).toBe('error');
    expect(prev.message).toContain('role');
    expect(deps.storeUserManagementService.create).not.toHaveBeenCalled();
  });

  it('assign_store_user_roles muestra roles actuales y reemplaza', async () => {
    const { deps, byName } = buildTools();
    const args = { user_id: 42, role_ids: [5, 6] };
    const prev = await preview(byName.assign_store_user_roles, args);
    expect(prev.status).toBe('warning');
    expect(prev.target).toContain('luis@tienda.com');
    expect(prev.changes[0].from).toBe('cashier');
    const out = await run(byName.assign_store_user_roles, args);
    expect(out.user_id).toBe(42);
    expect(deps.storeUserManagementService.updateRoles).toHaveBeenCalledWith(
      42,
      { role_ids: [5, 6] },
    );
  });

  it('assign_store_user_roles rechaza role_ids vacío sin tocar deps', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.assign_store_user_roles, {
      user_id: 42,
      role_ids: [],
    });
    expect(out.error).toContain('role_ids');
    expect(deps.storeUserManagementService.updateRoles).not.toHaveBeenCalled();
  });
});
