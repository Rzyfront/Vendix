import {
  createSettingsAdminTools,
  SettingsAdminToolDeps,
} from './settings-admin.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Paso 7 track B — contrato F-82 / F-83 / F-85 / F-87 / F-88 / F-92
 * (reads P0 settings-admin).
 *
 * Patrón canónico T4: (a) happy/sad con sad sin tocar deps, (b) snapshot de
 * salida con literales (`toEqual`, sin `.snap`), (c) forma
 * `{error, next_step}` en ES en los fallos guiados, (d) permiso declarado por
 * tool, (e) `readOnly: true` en los 6 reads sin `requiresConfirmation`.
 *
 * Pinnea además el contrato admin: branding solo lectura (sin write en la
 * familia), scopes resueltos por `OperatingScopeService`/`FiscalScopeService`
 * (nunca duplicados) y permisos verificados en controllers
 * (`store:settings:*`, `store:users:read`).
 */
describe('settings-admin.tools · F-82/F-83/F-85/F-87/F-88/F-92 P0 reads', () => {
  const CONTEXT = { organization_id: 3, store_id: 7, user_id: 11 };

  const SETTINGS = {
    branding: { primary_color: '#111111' },
    general: { timezone: 'America/Bogota', currency: 'COP' },
    pos: { allow_negative_stock: false },
  };

  const FISCAL_DATA = {
    tax_id: '900123456',
    legal_name: 'Tienda Centro SAS',
    tax_responsibilities: ['O-13'],
    tax_responsibilities_source: 'store',
    tax_regime_source: 'store',
  };

  const FISCAL_STATUS_BLOCK = {
    invoicing: {
      state: 'ACTIVE',
      locked_reasons: [],
      activated_at: '2026-01-10T00:00:00.000Z',
      locked_at: null,
      wizard: { selected_areas: ['invoicing'] },
    },
    accounting: {
      state: 'LOCKED',
      locked_reasons: ['Tiene asientos en el periodo'],
      activated_at: '2026-01-05T00:00:00.000Z',
      locked_at: '2026-02-01T00:00:00.000Z',
      wizard: {},
    },
    payroll: {
      state: 'INACTIVE',
      locked_reasons: [],
      activated_at: null,
      locked_at: null,
    },
  };

  const ROLES = [
    {
      id: 2,
      name: 'Cajero',
      description: 'POS diario',
      scope: 'store',
      is_system_role: false,
      permissions: ['Ver productos'],
      _count: { user_roles: 4 },
    },
  ];

  const STATS = {
    total_roles: 5,
    system_roles: 2,
    organization_roles: 1,
    store_roles: 2,
    custom_roles: 3,
    total_store_permissions: 120,
  };

  function buildTools(overrides: Record<string, any> = {}) {
    const deps = {
      settingsService: {
        getSettings: jest.fn().mockResolvedValue(SETTINGS),
        getFiscalData: jest.fn().mockResolvedValue(FISCAL_DATA),
      },
      fiscalStatusService: {
        read: jest.fn().mockResolvedValue({
          organization_id: 3,
          store_id: 7,
          fiscal_scope: 'STORE',
          fiscal_status: FISCAL_STATUS_BLOCK,
        }),
      },
      rolesService: {
        findAll: jest.fn().mockResolvedValue(ROLES),
        getStats: jest.fn().mockResolvedValue(STATS),
        findOne: jest.fn().mockResolvedValue(ROLES[0]),
        getRolePermissions: jest.fn().mockResolvedValue({
          role_id: 2,
          permission_ids: [10, 11],
          total_permissions: 2,
        }),
        listRoleUsers: jest.fn().mockResolvedValue([
          {
            assignment_id: 100,
            store_id: 7,
            store_name: 'Centro',
            user: {
              id: 11,
              email: 'caja@tienda.co',
              first_name: 'Ana',
              last_name: 'Caja',
              state: 'active',
              organization_id: 3,
            },
          },
        ]),
      },
      fiscalScopeService: {
        getFiscalScope: jest.fn().mockResolvedValue('STORE'),
      },
      operatingScopeService: {
        getOperatingScope: jest.fn().mockResolvedValue('STORE'),
      },
      ...overrides,
    } as any;
    const tools = createSettingsAdminTools(deps as SettingsAdminToolDeps);
    return { deps, tools };
  }

  function getTool(tools: RegisteredTool[], name: string): RegisteredTool {
    const tool = tools.find((t) => t.name === name);
    if (!tool?.handler) throw new Error(`${name} sin handler`);
    return tool;
  }

  const run = async (
    tools: RegisteredTool[],
    name: string,
    args: Record<string, any>,
    context: Record<string, any> = CONTEXT,
  ) => JSON.parse(await getTool(tools, name).handler!(args, context as any));

  describe('registro', () => {
    it('expone exactamente los 6 reads P0 settings-admin', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'get_store_settings',
        'get_fiscal_data',
        'get_fiscal_status',
        'list_store_roles',
        'get_role_permissions',
        'get_fiscal_scope',
      ]);
    });

    it('declara version 1, readOnly y dominio en las 6', () => {
      const { tools } = buildTools();
      for (const tool of tools) {
        expect(tool.version).toBe('1');
        expect(tool.readOnly).toBe(true);
        expect(tool.domain).toBe('settings-admin');
        expect(tool.requiresConfirmation).toBeUndefined();
        expect(tool.clientSide).toBeUndefined();
      }
    });

    it('declara los permisos verificados en controllers', () => {
      const { tools } = buildTools();
      const perms = Object.fromEntries(
        tools.map((t) => [t.name, t.requiredPermissions]),
      );
      expect(perms).toEqual({
        get_store_settings: ['store:settings:read'],
        get_fiscal_data: ['store:settings:fiscal_data:read'],
        get_fiscal_status: ['store:settings:fiscal_status:read'],
        list_store_roles: ['store:users:read'],
        get_role_permissions: ['store:users:read'],
        get_fiscal_scope: ['store:settings:read'],
      });
    });
  });

  describe('F-82 get_store_settings', () => {
    it('happy: devuelve todas las secciones sin filtro', async () => {
      const { tools, deps } = buildTools();
      expect(await run(tools, 'get_store_settings', {})).toEqual({
        settings: SETTINGS,
      });
      expect(deps.settingsService.getSettings).toHaveBeenCalledTimes(1);
    });

    it('happy: filtra por sections', async () => {
      const { tools } = buildTools();
      expect(
        await run(tools, 'get_store_settings', {
          sections: ['general', 'branding'],
        }),
      ).toEqual({
        settings: {
          general: SETTINGS.general,
          branding: SETTINGS.branding,
        },
      });
    });

    it('sad: sección desconocida → {error, next_step} sin tocar deps', async () => {
      const { tools, deps } = buildTools();
      const out = await run(tools, 'get_store_settings', {
        sections: ['general', 'no_existe'],
      });
      expect(out.error).toMatch('no_existe');
      expect(out.next_step).toMatch('branding');
      expect(deps.settingsService.getSettings).not.toHaveBeenCalled();
    });

    it('sad: el service lanza → {error}', async () => {
      const { tools } = buildTools({
        settingsService: {
          getSettings: jest.fn().mockRejectedValue(new Error('STORE_CONTEXT')),
        },
      });
      const out = await run(tools, 'get_store_settings', {});
      expect(out).toEqual({ error: 'STORE_CONTEXT' });
    });
  });

  describe('F-83 get_fiscal_data', () => {
    it('happy: devuelve la identidad fiscal del alcance vigente', async () => {
      const { tools } = buildTools();
      expect(await run(tools, 'get_fiscal_data', {})).toEqual({
        organization_id: 3,
        store_id: 7,
        fiscal_data: FISCAL_DATA,
      });
    });

    it('sad: el service lanza → {error}', async () => {
      const { tools } = buildTools({
        settingsService: {
          getFiscalData: jest.fn().mockRejectedValue(new Error('DB_DOWN')),
        },
      });
      const out = await run(tools, 'get_fiscal_data', {});
      expect(out).toEqual({ error: 'DB_DOWN' });
    });
  });

  describe('F-85 get_fiscal_status', () => {
    it('happy: proyecta estado por área sin wizard interno', async () => {
      const { tools, deps } = buildTools();
      expect(await run(tools, 'get_fiscal_status', {})).toEqual({
        organization_id: 3,
        store_id: 7,
        fiscal_scope: 'STORE',
        areas: {
          invoicing: {
            state: 'ACTIVE',
            locked_reasons: [],
            activated_at: '2026-01-10T00:00:00.000Z',
            locked_at: null,
          },
          accounting: {
            state: 'LOCKED',
            locked_reasons: ['Tiene asientos en el periodo'],
            activated_at: '2026-01-05T00:00:00.000Z',
            locked_at: '2026-02-01T00:00:00.000Z',
          },
          payroll: {
            state: 'INACTIVE',
            locked_reasons: [],
            activated_at: null,
            locked_at: null,
          },
        },
      });
      expect(deps.fiscalStatusService.read).toHaveBeenCalledWith(3, 7);
    });

    it('happy: filtra por area', async () => {
      const { tools } = buildTools();
      const out = await run(tools, 'get_fiscal_status', { area: 'payroll' });
      expect(Object.keys(out.areas)).toEqual(['payroll']);
      expect(out.areas.payroll.state).toBe('INACTIVE');
    });

    it('sad: área desconocida → {error, next_step} sin llamar al service', async () => {
      const { tools, deps } = buildTools();
      const out = await run(tools, 'get_fiscal_status', { area: 'nómina' });
      expect(out.error).toMatch('nómina');
      expect(out.next_step).toMatch('invoicing');
      expect(deps.fiscalStatusService.read).not.toHaveBeenCalled();
    });

    it('sad: sin organización → {error, next_step} sin llamar al service', async () => {
      const { tools, deps } = buildTools();
      const out = await run(tools, 'get_fiscal_status', {}, { store_id: 7 });
      expect(out.error).toMatch('organización');
      expect(out.next_step).toMatch('autenticada');
      expect(deps.fiscalStatusService.read).not.toHaveBeenCalled();
    });
  });

  describe('F-87 list_store_roles', () => {
    it('happy: compone roles + stats', async () => {
      const { tools } = buildTools();
      expect(await run(tools, 'list_store_roles', {})).toEqual({
        roles: ROLES,
        stats: STATS,
      });
    });

    it('sad: el service lanza → {error}', async () => {
      const { tools } = buildTools({
        rolesService: {
          findAll: jest.fn().mockRejectedValue(new Error('ROLE_SCOPE_002')),
          getStats: jest.fn().mockResolvedValue(STATS),
        },
      });
      const out = await run(tools, 'list_store_roles', {});
      expect(out).toEqual({ error: 'ROLE_SCOPE_002' });
    });
  });

  describe('F-88 get_role_permissions', () => {
    it('happy: compone rol + permisos + usuarios', async () => {
      const { tools, deps } = buildTools();
      expect(await run(tools, 'get_role_permissions', { role_id: 2 })).toEqual({
        role: {
          id: 2,
          name: 'Cajero',
          description: 'POS diario',
          scope: 'store',
          is_system_role: false,
          permissions: ['Ver productos'],
          users_count: 4,
        },
        permission_ids: [10, 11],
        total_permissions: 2,
        users: [
          {
            assignment_id: 100,
            store_id: 7,
            store_name: 'Centro',
            user: {
              id: 11,
              email: 'caja@tienda.co',
              first_name: 'Ana',
              last_name: 'Caja',
              state: 'active',
              organization_id: 3,
            },
          },
        ],
      });
      expect(deps.rolesService.findOne).toHaveBeenCalledWith(2);
      expect(deps.rolesService.getRolePermissions).toHaveBeenCalledWith(2);
      expect(deps.rolesService.listRoleUsers).toHaveBeenCalledWith(2);
    });

    it('happy: include_users=false omite usuarios', async () => {
      const { tools, deps } = buildTools();
      const out = await run(tools, 'get_role_permissions', {
        role_id: 2,
        include_users: false,
      });
      expect(out.users).toBeUndefined();
      expect(deps.rolesService.listRoleUsers).not.toHaveBeenCalled();
    });

    it('sad: role_id inválido → {error, next_step} sin tocar deps', async () => {
      const { tools, deps } = buildTools();
      const out = await run(tools, 'get_role_permissions', {
        role_id: 'xx',
      });
      expect(out.error).toMatch('role_id');
      expect(out.next_step).toMatch('list_store_roles');
      expect(deps.rolesService.findOne).not.toHaveBeenCalled();
      expect(deps.rolesService.getRolePermissions).not.toHaveBeenCalled();
    });
  });

  describe('F-92 get_fiscal_scope', () => {
    it('happy: resuelve ambos scopes vía services', async () => {
      const { tools, deps } = buildTools();
      expect(await run(tools, 'get_fiscal_scope', {})).toEqual({
        organization_id: 3,
        fiscal_scope: 'STORE',
        operating_scope: 'STORE',
        invalid_combination: false,
        meaning: 'Cada tienda factura con su propio NIT.',
      });
      expect(deps.fiscalScopeService.getFiscalScope).toHaveBeenCalledWith(3);
      expect(deps.operatingScopeService.getOperatingScope).toHaveBeenCalledWith(
        3,
      );
    });

    it('happy: marca la combinación inválida STORE/ORGANIZATION', async () => {
      const { tools } = buildTools({
        fiscalScopeService: {
          getFiscalScope: jest.fn().mockResolvedValue('ORGANIZATION'),
        },
        operatingScopeService: {
          getOperatingScope: jest.fn().mockResolvedValue('STORE'),
        },
      });
      const out = await run(tools, 'get_fiscal_scope', {});
      expect(out.invalid_combination).toBe(true);
      expect(out.meaning).toMatch('consolidado');
    });

    it('sad: sin organización → {error, next_step} sin tocar deps', async () => {
      const { tools, deps } = buildTools();
      const out = await run(tools, 'get_fiscal_scope', {}, { store_id: 7 });
      expect(out.error).toMatch('organización');
      expect(out.next_step).toMatch('autenticada');
      expect(deps.fiscalScopeService.getFiscalScope).not.toHaveBeenCalled();
      expect(deps.operatingScopeService.getOperatingScope).not.toHaveBeenCalled();
    });
  });
});
