import {
  mergePanelUiSoft,
  computeNewPanelUiKeys,
  mergeUserConfigPanelUi,
} from './panel-ui-merge.util';

describe('panel-ui-merge.util', () => {
  const storeAdminDefaults: Record<string, boolean> = {
    dashboard: true,
    pos: true,
    products: true,
    products_list: true,
    ecommerce: true,
    orders: true,
    orders_sales: true,
    orders_dispatch_routes: true,
    dispatch: true,
    inventory: true,
    customers: true,
    customers_all: true,
    restaurant_ops: true,
    restaurant_ops_tables: true,
    restaurant_ops_kds: true,
    restaurant_ops_production: true,
    restaurant_ops_recipes: true,
    accounting: true,
    payroll: true,
    settings: true,
    settings_users: true,
  };

  const sampleDefaults = {
    STORE_ADMIN: storeAdminDefaults,
    ORG_ADMIN: {
      dashboard: true,
      stores: true,
      users: true,
      accounting: true,
    },
  };

  describe('mergePanelUiSoft', () => {
    it('roles privilegiados (owner, admin, super_admin) reciben todos los defaults de STORE_ADMIN', () => {
      const merged = mergePanelUiSoft({}, sampleDefaults, ['owner']);
      expect(merged.STORE_ADMIN).toEqual(storeAdminDefaults);
      expect(merged.STORE_ADMIN.accounting).toBe(true);
      expect(merged.STORE_ADMIN.settings_users).toBe(true);
    });

    it('cashier recibe solo las keys operativas y NO ve contabilidad ni administración de usuarios', () => {
      const merged = mergePanelUiSoft({}, sampleDefaults, ['cashier']);
      expect(merged.STORE_ADMIN).toBeDefined();
      expect(merged.STORE_ADMIN.pos).toBe(true);
      expect(merged.STORE_ADMIN.orders).toBe(true);
      expect(merged.STORE_ADMIN.products).toBe(true);
      expect(merged.STORE_ADMIN.customers).toBe(true);
      expect(merged.STORE_ADMIN.restaurant_ops_tables).toBe(true);

      // No debe recibir módulos de administración sensible
      expect(merged.STORE_ADMIN.accounting).toBeUndefined();
      expect(merged.STORE_ADMIN.payroll).toBeUndefined();
      expect(merged.STORE_ADMIN.settings_users).toBeUndefined();
    });

    it('waiter (mesero) recibe mesas, pos, pedidos y productos', () => {
      const merged = mergePanelUiSoft({}, sampleDefaults, ['waiter']);
      expect(merged.STORE_ADMIN).toBeDefined();
      expect(merged.STORE_ADMIN.restaurant_ops_tables).toBe(true);
      expect(merged.STORE_ADMIN.restaurant_ops_kds).toBe(true);
      expect(merged.STORE_ADMIN.pos).toBe(true);
      expect(merged.STORE_ADMIN.orders).toBe(true);
      expect(merged.STORE_ADMIN.accounting).toBeUndefined();
    });

    it('kitchen (cocina) recibe kds y producción', () => {
      const merged = mergePanelUiSoft({}, sampleDefaults, ['kitchen']);
      expect(merged.STORE_ADMIN).toBeDefined();
      expect(merged.STORE_ADMIN.restaurant_ops_kds).toBe(true);
      expect(merged.STORE_ADMIN.restaurant_ops_production).toBe(true);
      expect(merged.STORE_ADMIN.pos).toBeUndefined();
      expect(merged.STORE_ADMIN.accounting).toBeUndefined();
    });

    it('carrier (repartidor) recibe orders_dispatch_routes y pedidos', () => {
      const merged = mergePanelUiSoft({}, sampleDefaults, ['carrier']);
      expect(merged.STORE_ADMIN).toBeDefined();
      expect(merged.STORE_ADMIN.orders_dispatch_routes).toBe(true);
      expect(merged.STORE_ADMIN.orders).toBe(true);
      expect(merged.STORE_ADMIN.accounting).toBeUndefined();
    });

    it('soporta unión de roles múltiples (e.g. cashier + kitchen)', () => {
      const merged = mergePanelUiSoft({}, sampleDefaults, ['cashier', 'kitchen']);
      expect(merged.STORE_ADMIN.pos).toBe(true);
      expect(merged.STORE_ADMIN.restaurant_ops_kds).toBe(true);
      expect(merged.STORE_ADMIN.accounting).toBeUndefined();
    });

    it('soporta roles especificados como objetos con propiedad name', () => {
      const merged = mergePanelUiSoft({}, sampleDefaults, [{ name: 'cashier' }]);
      expect(merged.STORE_ADMIN.pos).toBe(true);
      expect(merged.STORE_ADMIN.orders).toBe(true);
      expect(merged.STORE_ADMIN.accounting).toBeUndefined();
    });

    it('respeta la regla "User wins" (si el usuario tiene explícitamente false, no se sobreescribe)', () => {
      const userConfig = {
        STORE_ADMIN: {
          pos: false,
        },
      };
      const merged = mergePanelUiSoft(userConfig, sampleDefaults, ['cashier']);
      expect(merged.STORE_ADMIN.pos).toBe(false);
      expect(merged.STORE_ADMIN.orders).toBe(true);
    });

    it('usuarios sin roles de staff (e.g. customer) no reciben keys de STORE_ADMIN', () => {
      const merged = mergePanelUiSoft({}, sampleDefaults, ['customer']);
      expect(merged.STORE_ADMIN).toBeUndefined();
    });

    it('descarta formato plano legacy sin crashear', () => {
      const legacyConfig = { pos: true, orders: false } as any;
      const merged = mergePanelUiSoft(legacyConfig, sampleDefaults, ['cashier']);
      expect(merged.pos).toBeUndefined();
      expect(merged.STORE_ADMIN.pos).toBe(true);
    });

    it('rol de staff personalizado no listado recibe keys básicas defensivas', () => {
      const merged = mergePanelUiSoft({}, sampleDefaults, ['assistant_sales']);
      expect(merged.STORE_ADMIN).toBeDefined();
      expect(merged.STORE_ADMIN.pos).toBe(true);
      expect(merged.STORE_ADMIN.orders).toBe(true);
      expect(merged.STORE_ADMIN.accounting).toBeUndefined();
    });
  });

  describe('computeNewPanelUiKeys', () => {
    it('calcula new_keys para roles privilegiados', () => {
      const newKeys = computeNewPanelUiKeys(
        sampleDefaults,
        { STORE_ADMIN: ['pos', 'dashboard'] },
        ['owner'],
      );
      expect(newKeys.STORE_ADMIN).not.toContain('pos');
      expect(newKeys.STORE_ADMIN).not.toContain('dashboard');
      expect(newKeys.STORE_ADMIN).toContain('orders');
    });

    it('retorna arrays vacíos para roles no privilegiados', () => {
      const newKeys = computeNewPanelUiKeys(
        sampleDefaults,
        { STORE_ADMIN: [] },
        ['cashier'],
      );
      expect(newKeys.STORE_ADMIN).toEqual([]);
      expect(newKeys.ORG_ADMIN).toEqual([]);
    });
  });

  describe('mergeUserConfigPanelUi', () => {
    it('integra panel_ui mergeado y new_keys dentro de config', () => {
      const userConfig = {
        theme: 'dark',
        panel_ui: {},
      };
      const result = mergeUserConfigPanelUi(userConfig, sampleDefaults, ['cashier']);
      expect(result.theme).toBe('dark');
      expect(result.panel_ui.STORE_ADMIN.pos).toBe(true);
      expect(result.new_keys.STORE_ADMIN).toEqual([]);
    });
  });
});
