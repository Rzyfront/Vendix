import {
  createSettingsAdminTools,
  SettingsAdminToolDeps,
} from './settings-admin.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Pasos 7+12 track B — contrato F-82..F-94 settings-admin (6 reads P0 +
 * F-89/F-93 + writes F-84/F-86/F-90/F-91/F-94).
 *
 * Patrón canónico T4: (a) happy/sad con sad sin tocar deps, (b) snapshot de
 * salida con literales (`toEqual`, sin `.snap`), (c) forma
 * `{error, next_step}` en ES en los fallos guiados, (d) permiso declarado por
 * tool, (e) `readOnly: true` en reads y `requiresConfirmation` + `preview`
 * con sujeto humano en writes, con re-verificación en el handler.
 *
 * Pinnea además el contrato admin: branding solo lectura (sin write que lo
 * toque), NUNCA defaultear `tax_regime` en F-84, NUNCA otorgar
 * `superadmin:*` en F-90, scopes resueltos por
 * `OperatingScopeService`/`FiscalScopeService` (nunca duplicados),
 * migración F-94 con reason ≥10 y downgrade bloqueado por defecto, y
 * permisos verificados en controllers.
 */
describe('settings-admin.tools · F-82..F-94', () => {
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

  const AVAILABLE_PERMISSIONS = [
    {
      id: 10,
      name: 'store:products:read',
      description: 'Ver productos',
      path: '/api/store/products',
      method: 'GET',
    },
    {
      id: 11,
      name: 'store:pos:access',
      description: 'Acceso POS',
      path: '/api/store/pos',
      method: 'ALL',
    },
    {
      id: 12,
      name: 'store:orders:create',
      description: 'Crear órdenes',
      path: '/api/store/orders',
      method: 'POST',
    },
  ];

  const MIGRATION_PREVIEW_UP = {
    organization_id: 3,
    current_fiscal_scope: 'STORE',
    target_fiscal_scope: 'ORGANIZATION',
    current_operating_scope: 'ORGANIZATION',
    direction: 'UP',
    can_apply: true,
    warnings: [],
    blockers: [],
  };

  function buildTools(overrides: Record<string, any> = {}) {
    const deps = {
      settingsService: {
        getSettings: jest.fn().mockResolvedValue(SETTINGS),
        getFiscalData: jest.fn().mockResolvedValue(FISCAL_DATA),
        updateFiscalData: jest
          .fn()
          .mockImplementation(async (patch: Record<string, unknown>) => ({
            ...FISCAL_DATA,
            ...patch,
          })),
      },
      fiscalStatusService: {
        read: jest.fn().mockResolvedValue({
          organization_id: 3,
          store_id: 7,
          fiscal_scope: 'STORE',
          fiscal_status: FISCAL_STATUS_BLOCK,
        }),
        startWizard: jest.fn().mockResolvedValue({
          organization_id: 3,
          store_id: 7,
          fiscal_status: {
            ...FISCAL_STATUS_BLOCK,
            payroll: { ...FISCAL_STATUS_BLOCK.payroll, state: 'WIP' },
          },
        }),
      },
      rolesService: {
        findAll: jest.fn().mockResolvedValue(ROLES),
        getStats: jest.fn().mockResolvedValue(STATS),
        findOne: jest.fn().mockResolvedValue(ROLES[0]),
        create: jest.fn().mockImplementation(async (dto: any) => ({
          id: 9,
          scope: 'store',
          ...dto,
        })),
        getAvailablePermissions: jest
          .fn()
          .mockResolvedValue(AVAILABLE_PERMISSIONS),
        getRolePermissions: jest.fn().mockResolvedValue({
          role_id: 2,
          permission_ids: [10, 11],
          total_permissions: 2,
        }),
        assignPermissions: jest.fn().mockImplementation(async (role_id: number) => ({
          ...ROLES[0],
          id: role_id,
        })),
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
      fiscalScopeMigrationService: {
        proposeChange: jest.fn().mockResolvedValue(MIGRATION_PREVIEW_UP),
        applyChange: jest.fn().mockResolvedValue({
          organization_id: 3,
          previous_fiscal_scope: 'STORE',
          new_fiscal_scope: 'ORGANIZATION',
          audit_log_id: 44,
          applied_at: '2026-03-01T00:00:00.000Z',
          forced: false,
        }),
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

  const preview = async (
    tools: RegisteredTool[],
    name: string,
    args: Record<string, any>,
    context: Record<string, any> = CONTEXT,
  ) => {
    const tool = getTool(tools, name);
    if (!tool.preview) throw new Error(`${name} sin preview`);
    return tool.preview(args, context as any);
  };

  const READS = [
    'get_store_settings',
    'get_fiscal_data',
    'get_fiscal_status',
    'list_store_roles',
    'get_role_permissions',
    'get_fiscal_scope',
    'list_available_permissions',
    'get_operating_scope',
  ];

  const WRITES = [
    'update_fiscal_data',
    'start_fiscal_wizard',
    'assign_role_permissions',
    'create_store_role',
    'migrate_fiscal_scope',
  ];

  describe('registro', () => {
    it('expone exactamente las 13 tools settings-admin', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'get_store_settings',
        'get_fiscal_data',
        'get_fiscal_status',
        'list_store_roles',
        'get_role_permissions',
        'get_fiscal_scope',
        'update_fiscal_data',
        'start_fiscal_wizard',
        'list_available_permissions',
        'assign_role_permissions',
        'create_store_role',
        'get_operating_scope',
        'migrate_fiscal_scope',
      ]);
    });

    it('declara version 1 y dominio en las 13', () => {
      const { tools } = buildTools();
      for (const tool of tools) {
        expect(tool.version).toBe('1');
        expect(tool.domain).toBe('settings-admin');
        expect(tool.clientSide).toBeUndefined();
      }
    });

    it('los 8 reads son readOnly sin confirmación', () => {
      const { tools } = buildTools();
      for (const name of READS) {
        const tool = getTool(tools, name);
        expect(tool.readOnly).toBe(true);
        expect(tool.requiresConfirmation).toBeUndefined();
      }
    });

    it('los 5 writes exigen confirmación con preview', () => {
      const { tools } = buildTools();
      for (const name of WRITES) {
        const tool = getTool(tools, name);
        expect(tool.requiresConfirmation).toBe(true);
        expect(typeof tool.preview).toBe('function');
        expect(tool.readOnly).toBeUndefined();
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
        update_fiscal_data: ['store:settings:fiscal_data:write'],
        start_fiscal_wizard: ['store:settings:fiscal_status:write'],
        list_available_permissions: ['store:users:read'],
        assign_role_permissions: ['store:users:update'],
        create_store_role: ['store:users:update'],
        get_operating_scope: ['store:settings:read'],
        migrate_fiscal_scope: ['organization:settings:fiscal_scope:write'],
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

  describe('F-84 update_fiscal_data', () => {
    it('preview: difiere campo por campo con sujeto humano', async () => {
      const { tools, deps } = buildTools();
      const out = await preview(tools, 'update_fiscal_data', {
        legal_name: 'Tienda Norte SAS',
        city: 'Medellín',
      });
      expect(out).toEqual({
        status: 'ok',
        target: 'Identidad fiscal de Tienda Norte SAS',
        changes: [
          {
            field: 'legal_name',
            label: 'Razón social',
            from: 'Tienda Centro SAS',
            to: 'Tienda Norte SAS',
          },
          {
            field: 'city',
            label: 'Ciudad',
            from: '(vacío)',
            to: 'Medellín',
          },
        ],
        domain: 'settings-admin',
      });
      expect(deps.settingsService.getFiscalData).toHaveBeenCalledTimes(1);
      expect(deps.settingsService.updateFiscalData).not.toHaveBeenCalled();
    });

    it('happy: el patch lleva exactamente las llaves recibidas (sin tax_regime inventado)', async () => {
      const { tools, deps } = buildTools();
      const out = await run(tools, 'update_fiscal_data', {
        city: 'Medellín',
        tax_responsibilities: ['O-13', 'O-48'],
      });
      expect(deps.settingsService.updateFiscalData).toHaveBeenCalledWith({
        city: 'Medellín',
        tax_responsibilities: ['O-13', 'O-48'],
      });
      expect(
        deps.settingsService.updateFiscalData.mock.calls[0][0],
      ).not.toHaveProperty('tax_regime');
      expect(out).toEqual({
        updated: true,
        fiscal_data: {
          ...FISCAL_DATA,
          city: 'Medellín',
          tax_responsibilities: ['O-13', 'O-48'],
        },
      });
    });

    it('sad: sin campos → preview error y handler {error, next_step}', async () => {
      const { tools, deps } = buildTools();
      const p = await preview(tools, 'update_fiscal_data', {});
      expect(p.status).toBe('error');
      expect(p.message).toMatch('al menos un campo');
      const out = await run(tools, 'update_fiscal_data', {
        no_es_campo: 1,
      });
      expect(out.error).toMatch('Sin cambios');
      expect(out.next_step).toMatch('F-83');
      expect(deps.settingsService.updateFiscalData).not.toHaveBeenCalled();
    });

    it('sad: el service lanza → {error}', async () => {
      const { tools } = buildTools({
        settingsService: {
          getFiscalData: jest.fn().mockResolvedValue(FISCAL_DATA),
          updateFiscalData: jest
            .fn()
            .mockRejectedValue(new Error('organization level')),
        },
      });
      const out = await run(tools, 'update_fiscal_data', { city: 'Cali' });
      expect(out).toEqual({ error: 'organization level' });
    });
  });

  describe('F-86 start_fiscal_wizard', () => {
    it('preview: nombra áreas humanas con transición a WIP', async () => {
      const { tools } = buildTools();
      const out = await preview(tools, 'start_fiscal_wizard', {
        selected_areas: ['payroll', 'invoicing'],
      });
      expect(out).toEqual({
        status: 'ok',
        target: 'Activación fiscal: Nómina, Facturación',
        changes: [
          {
            field: 'payroll',
            label: 'Nómina',
            from: 'INACTIVE',
            to: 'WIP',
          },
          {
            field: 'invoicing',
            label: 'Facturación',
            from: 'ACTIVE',
            to: 'WIP',
          },
        ],
        domain: 'settings-admin',
      });
    });

    it('happy: inicia el wizard con áreas deduplicadas', async () => {
      const { tools, deps } = buildTools();
      const out = await run(tools, 'start_fiscal_wizard', {
        selected_areas: ['payroll', 'payroll'],
      });
      expect(deps.fiscalStatusService.startWizard).toHaveBeenCalledWith({
        organization_id: 3,
        store_id: 7,
        selected_areas: ['payroll'],
        changed_by_user_id: 11,
      });
      expect(out.started).toBe(true);
      expect(out.fiscal_status.payroll).toBeUndefined();
      expect(out.fiscal_status.fiscal_status.payroll.state).toBe('WIP');
    });

    it('sad: área LOCKED → preview error y handler {error, next_step} sin iniciar', async () => {
      const { tools, deps } = buildTools();
      const p = await preview(tools, 'start_fiscal_wizard', {
        selected_areas: ['accounting'],
      });
      expect(p.status).toBe('error');
      expect(p.message).toMatch('LOCKED');
      const out = await run(tools, 'start_fiscal_wizard', {
        selected_areas: ['accounting'],
      });
      expect(out.error).toMatch('LOCKED');
      expect(out.next_step).toMatch('registros fiscales');
      expect(deps.fiscalStatusService.startWizard).not.toHaveBeenCalled();
    });

    it('sad: área desconocida → preview error sin leer estado', async () => {
      const { tools, deps } = buildTools();
      const out = await preview(tools, 'start_fiscal_wizard', {
        selected_areas: ['nómina'],
      });
      expect(out.status).toBe('error');
      expect(out.message).toMatch('nómina');
      expect(deps.fiscalStatusService.read).not.toHaveBeenCalled();
    });
  });

  describe('F-89 list_available_permissions', () => {
    it('happy: lista permisos store:* con total', async () => {
      const { tools } = buildTools();
      expect(await run(tools, 'list_available_permissions', {})).toEqual({
        permissions: AVAILABLE_PERMISSIONS,
        total: 3,
      });
    });

    it('happy: filtra por search insensible a mayúsculas', async () => {
      const { tools } = buildTools();
      const out = await run(tools, 'list_available_permissions', {
        search: 'POS',
      });
      expect(out).toEqual({
        permissions: [AVAILABLE_PERMISSIONS[1]],
        total: 1,
      });
    });

    it('sad: el service lanza → {error}', async () => {
      const { tools } = buildTools({
        rolesService: {
          getAvailablePermissions: jest
            .fn()
            .mockRejectedValue(new Error('DB_DOWN')),
        },
      });
      const out = await run(tools, 'list_available_permissions', {});
      expect(out).toEqual({ error: 'DB_DOWN' });
    });
  });

  describe('F-90 assign_role_permissions', () => {
    it('preview: warning con rol humano y nombres otorgados', async () => {
      const { tools } = buildTools();
      const out = await preview(tools, 'assign_role_permissions', {
        role_id: 2,
        permission_ids: [12],
      });
      expect(out).toEqual({
        status: 'warning',
        target: 'Rol Cajero',
        changes: [
          {
            field: 'permission_ids',
            label: 'Permisos otorgados',
            from: 2,
            to: 3,
          },
        ],
        message: 'Se otorgan: store:orders:create.',
        domain: 'settings-admin',
      });
    });

    it('happy: otorga y devuelve el rol', async () => {
      const { tools, deps } = buildTools();
      const out = await run(tools, 'assign_role_permissions', {
        role_id: 2,
        permission_ids: [12],
      });
      expect(deps.rolesService.assignPermissions).toHaveBeenCalledWith(2, {
        permission_ids: [12],
      });
      expect(out).toEqual({
        assigned: true,
        role_id: 2,
        role_name: 'Cajero',
        permission_ids: [12],
      });
    });

    it('sad: id desconocido (superadmin:*) → preview error sin otorgar', async () => {
      const { tools, deps } = buildTools({
        rolesService: {
          findOne: jest.fn().mockResolvedValue(ROLES[0]),
          getAvailablePermissions: jest
            .fn()
            .mockResolvedValue(AVAILABLE_PERMISSIONS),
          getRolePermissions: jest.fn().mockResolvedValue({
            role_id: 2,
            permission_ids: [10],
            total_permissions: 1,
          }),
          assignPermissions: jest.fn(),
        },
      });
      const p = await preview(tools, 'assign_role_permissions', {
        role_id: 2,
        permission_ids: [999],
      });
      expect(p.status).toBe('error');
      expect(p.message).toMatch('999');
      expect(p.message).toMatch('superadmin');
      const out = await run(tools, 'assign_role_permissions', {
        role_id: 2,
        permission_ids: [999],
      });
      expect(out.error).toMatch('superadmin');
      expect(out.next_step).toMatch('F-89');
      expect(deps.rolesService.assignPermissions).not.toHaveBeenCalled();
    });

    it('sad: nombre no-store en disponibles → preview error', async () => {
      const { tools, deps } = buildTools({
        rolesService: {
          findOne: jest.fn().mockResolvedValue(ROLES[0]),
          getAvailablePermissions: jest.fn().mockResolvedValue([
            ...AVAILABLE_PERMISSIONS,
            { id: 77, name: 'superadmin:users:delete', description: 'X' },
          ]),
          getRolePermissions: jest.fn().mockResolvedValue({
            role_id: 2,
            permission_ids: [],
            total_permissions: 0,
          }),
          assignPermissions: jest.fn(),
        },
      });
      const p = await preview(tools, 'assign_role_permissions', {
        role_id: 2,
        permission_ids: [77],
      });
      expect(p.status).toBe('error');
      expect(p.message).toMatch('superadmin:users:delete');
      expect(deps.rolesService.assignPermissions).not.toHaveBeenCalled();
    });

    it('sad: todo ya otorgado → preview error', async () => {
      const { tools } = buildTools();
      const out = await preview(tools, 'assign_role_permissions', {
        role_id: 2,
        permission_ids: [10, 11],
      });
      expect(out.status).toBe('error');
      expect(out.message).toMatch('ya tiene');
    });
  });

  describe('F-91 create_store_role', () => {
    it('preview: nombra el rol nuevo', async () => {
      const { tools } = buildTools();
      const out = await preview(tools, 'create_store_role', {
        name: 'Supervisor',
        description: 'Supervisa cajas',
      });
      expect(out).toEqual({
        status: 'ok',
        target: 'Rol Supervisor',
        changes: [
          { field: 'name', label: 'Nombre', from: null, to: 'Supervisor' },
          {
            field: 'description',
            label: 'Descripción',
            from: null,
            to: 'Supervisa cajas',
          },
        ],
        message:
          'El rol nace sin permisos: otórgalos con assign_role_permissions (F-90).',
        domain: 'settings-admin',
      });
    });

    it('happy: crea y devuelve el rol', async () => {
      const { tools, deps } = buildTools();
      const out = await run(tools, 'create_store_role', {
        name: 'Supervisor',
      });
      expect(deps.rolesService.create).toHaveBeenCalledWith({
        name: 'Supervisor',
      });
      expect(out).toEqual({
        created: true,
        role: {
          id: 9,
          name: 'Supervisor',
          description: null,
          scope: 'store',
        },
      });
    });

    it('sad: nombre en colisión → preview error y handler {error, next_step}', async () => {
      const { tools, deps } = buildTools();
      const p = await preview(tools, 'create_store_role', { name: 'cajero' });
      expect(p.status).toBe('error');
      expect(p.message).toMatch('Ya existe');
      const out = await run(tools, 'create_store_role', { name: 'Cajero' });
      expect(out.error).toMatch('Cajero');
      expect(out.next_step).toMatch('F-87');
      expect(deps.rolesService.create).not.toHaveBeenCalled();
    });

    it('sad: nombre corto → preview error sin leer roles', async () => {
      const { tools, deps } = buildTools();
      const out = await preview(tools, 'create_store_role', { name: 'x' });
      expect(out.status).toBe('error');
      expect(deps.rolesService.findAll).not.toHaveBeenCalled();
    });
  });

  describe('F-93 get_operating_scope', () => {
    it('happy: resuelve ambos scopes vía services', async () => {
      const { tools, deps } = buildTools();
      expect(await run(tools, 'get_operating_scope', {})).toEqual({
        organization_id: 3,
        operating_scope: 'STORE',
        fiscal_scope: 'STORE',
        invalid_combination: false,
        meaning:
          'Cada tienda opera aislada: inventario, proveedores, compras y reportes por tienda.',
      });
      expect(deps.operatingScopeService.getOperatingScope).toHaveBeenCalledWith(
        3,
      );
      expect(deps.fiscalScopeService.getFiscalScope).toHaveBeenCalledWith(3);
    });

    it('happy: marca la combinación inválida STORE/ORGANIZATION', async () => {
      const { tools } = buildTools({
        operatingScopeService: {
          getOperatingScope: jest.fn().mockResolvedValue('STORE'),
        },
        fiscalScopeService: {
          getFiscalScope: jest.fn().mockResolvedValue('ORGANIZATION'),
        },
      });
      const out = await run(tools, 'get_operating_scope', {});
      expect(out.invalid_combination).toBe(true);
      expect(out.operating_scope).toBe('STORE');
    });

    it('sad: sin organización → {error, next_step} sin tocar deps', async () => {
      const { tools, deps } = buildTools();
      const out = await run(tools, 'get_operating_scope', {}, { store_id: 7 });
      expect(out.error).toMatch('organización');
      expect(deps.operatingScopeService.getOperatingScope).not.toHaveBeenCalled();
      expect(deps.fiscalScopeService.getFiscalScope).not.toHaveBeenCalled();
    });
  });

  describe('F-94 migrate_fiscal_scope', () => {
    const ARGS = {
      target_scope: 'ORGANIZATION',
      reason: 'Consolidar facturación del grupo',
    };

    it('preview: warning con consecuencia y motivo', async () => {
      const { tools, deps } = buildTools();
      const out = await preview(tools, 'migrate_fiscal_scope', ARGS);
      expect(out).toEqual({
        status: 'warning',
        target: 'Alcance fiscal STORE → ORGANIZATION',
        changes: [
          {
            field: 'fiscal_scope',
            label: 'Alcance fiscal',
            from: 'STORE',
            to: 'ORGANIZATION',
          },
        ],
        message:
          'La consolidación unifica la facturación bajo el NIT de la organización. Motivo: Consolidar facturación del grupo',
        domain: 'settings-admin',
      });
      expect(deps.fiscalScopeMigrationService.proposeChange).toHaveBeenCalledWith(
        3,
        'ORGANIZATION',
        11,
        'Consolidar facturación del grupo',
      );
      expect(deps.fiscalScopeMigrationService.applyChange).not.toHaveBeenCalled();
    });

    it('happy: aplica tras re-verificar y devuelve auditoría', async () => {
      const { tools, deps } = buildTools();
      const out = await run(tools, 'migrate_fiscal_scope', ARGS);
      expect(
        deps.fiscalScopeMigrationService.proposeChange,
      ).toHaveBeenCalledTimes(1);
      expect(deps.fiscalScopeMigrationService.applyChange).toHaveBeenCalledWith(
        3,
        'ORGANIZATION',
        11,
        'Consolidar facturación del grupo',
        false,
      );
      expect(out).toEqual({
        migrated: true,
        previous_fiscal_scope: 'STORE',
        new_fiscal_scope: 'ORGANIZATION',
        forced: false,
        audit_log_id: 44,
        applied_at: '2026-03-01T00:00:00.000Z',
      });
    });

    it('sad: reason corto → preview error sin proponer', async () => {
      const { tools, deps } = buildTools();
      const p = await preview(tools, 'migrate_fiscal_scope', {
        target_scope: 'ORGANIZATION',
        reason: 'corto',
      });
      expect(p.status).toBe('error');
      expect(p.message).toMatch('10 caracteres');
      const out = await run(tools, 'migrate_fiscal_scope', {
        target_scope: 'ORGANIZATION',
        reason: 'corto',
      });
      expect(out.error).toMatch('10 caracteres');
      expect(out.next_step).toMatch('auditoría');
      expect(
        deps.fiscalScopeMigrationService.proposeChange,
      ).not.toHaveBeenCalled();
      expect(deps.fiscalScopeMigrationService.applyChange).not.toHaveBeenCalled();
    });

    it('sad: DOWN con blockers y sin force → bloqueado por defecto', async () => {
      const down = {
        organization_id: 3,
        current_fiscal_scope: 'ORGANIZATION',
        target_fiscal_scope: 'STORE',
        current_operating_scope: 'ORGANIZATION',
        direction: 'DOWN',
        can_apply: false,
        warnings: [],
        blockers: [
          { code: 'PENDING_INVOICES', message: '2 facturas con envío pendiente.' },
          { code: 'OPEN_PERIODS', message: '1 periodo consolidado abierto.' },
        ],
      };
      const { tools, deps } = buildTools({
        fiscalScopeMigrationService: {
          proposeChange: jest.fn().mockResolvedValue(down),
          applyChange: jest.fn(),
        },
      });
      const p = await preview(tools, 'migrate_fiscal_scope', {
        target_scope: 'STORE',
        reason: 'Separar facturación por tienda',
      });
      expect(p.status).toBe('error');
      expect(p.message).toMatch('2 facturas');
      expect(p.message).toMatch('bloqueado por defecto');
      const out = await run(tools, 'migrate_fiscal_scope', {
        target_scope: 'STORE',
        reason: 'Separar facturación por tienda',
      });
      expect(out.error).toMatch('Bloqueado por 2');
      expect(out.next_step).toMatch('force=true');
      expect(deps.fiscalScopeMigrationService.applyChange).not.toHaveBeenCalled();
    });

    it('happy: DOWN con force expone blockers forzados y aplica', async () => {
      const down = {
        organization_id: 3,
        current_fiscal_scope: 'ORGANIZATION',
        target_fiscal_scope: 'STORE',
        current_operating_scope: 'ORGANIZATION',
        direction: 'DOWN',
        can_apply: false,
        warnings: [],
        blockers: [{ code: 'OPEN_PERIODS', message: '1 periodo abierto.' }],
      };
      const { tools, deps } = buildTools({
        fiscalScopeMigrationService: {
          proposeChange: jest.fn().mockResolvedValue(down),
          applyChange: jest.fn().mockResolvedValue({
            organization_id: 3,
            previous_fiscal_scope: 'ORGANIZATION',
            new_fiscal_scope: 'STORE',
            audit_log_id: 45,
            applied_at: '2026-03-02T00:00:00.000Z',
            forced: true,
          }),
        },
      });
      const p = await preview(tools, 'migrate_fiscal_scope', {
        target_scope: 'STORE',
        reason: 'Separar facturación por tienda',
        force: true,
      });
      expect(p.status).toBe('warning');
      expect(p.message).toMatch('ADVERTENCIA');
      expect(p.message).toMatch('1 periodo abierto');
      const out = await run(tools, 'migrate_fiscal_scope', {
        target_scope: 'STORE',
        reason: 'Separar facturación por tienda',
        force: true,
      });
      expect(deps.fiscalScopeMigrationService.applyChange).toHaveBeenCalledWith(
        3,
        'STORE',
        11,
        'Separar facturación por tienda',
        true,
      );
      expect(out.forced).toBe(true);
    });

    it('sad: NOOP → preview error', async () => {
      const { tools } = buildTools({
        fiscalScopeMigrationService: {
          proposeChange: jest.fn().mockResolvedValue({
            ...MIGRATION_PREVIEW_UP,
            current_fiscal_scope: 'ORGANIZATION',
            target_fiscal_scope: 'ORGANIZATION',
            direction: 'NOOP',
          }),
          applyChange: jest.fn(),
        },
      });
      const out = await preview(tools, 'migrate_fiscal_scope', ARGS);
      expect(out.status).toBe('error');
      expect(out.message).toMatch('actual');
    });
  });
});
