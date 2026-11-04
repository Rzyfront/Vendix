import { MenuItem } from '../../../shared/components/sidebar/sidebar.component';
import {
  APPS_GROUP_LABEL,
  LANDING_APP_LABEL,
  applyAppsMenu,
} from './apps-menu.util';

/**
 * apps-module T7/T9. The sidebar tree is the same constant for every store;
 * `applyAppsMenu` only regroups it when `store_settings.apps.enabled === true`.
 */
const baseTree = (): MenuItem[] => [
  { label: 'Panel Principal', icon: 'home', route: '/admin/dashboard' },
  {
    label: 'Clientes',
    icon: 'users',
    children: [
      { label: 'Todos los Clientes', icon: 'circle', route: '/admin/customers/all' },
      {
        label: 'Landing de captación',
        icon: 'sparkles',
        route: '/admin/apps/landing',
        panelUiKey: 'customers_crm',
      },
    ],
  },
  { label: 'Tienda en línea', icon: 'shopping-bag', route: '/admin/ecommerce' },
  { label: 'Marketing', icon: 'megaphone', children: [] },
];

describe('applyAppsMenu (apps-module T7/T9)', () => {
  it('con el flag apagado devuelve el árbol exactamente igual', () => {
    const base = baseTree();
    const result = applyAppsMenu(base, false);

    expect(result).toBe(base);
    expect(result).toEqual(baseTree());
  });

  it('con el flag encendido Tienda en línea cuelga de Apps en el mismo lugar', () => {
    const result = applyAppsMenu(baseTree(), true);

    expect(result.map((i) => i.label)).toEqual([
      'Panel Principal',
      'Clientes',
      APPS_GROUP_LABEL,
      'Marketing',
    ]);
    const apps = result[2];
    expect(apps.route).toBeUndefined();
    expect(apps.children?.map((c) => [c.label, c.route, c.panelUiKey])).toEqual([
      ['Todas las apps', '/admin/apps', 'apps'],
      ['Tienda en línea', '/admin/ecommerce', undefined],
      [LANDING_APP_LABEL, '/admin/apps/landing', 'customers_crm'],
    ]);
  });

  it('con el flag encendido la landing sale de Clientes y conserva key y ruta', () => {
    const result = applyAppsMenu(baseTree(), true);
    const clientes = result.find((i) => i.label === 'Clientes')!;

    expect(clientes.children?.map((c) => c.route)).toEqual(['/admin/customers/all']);
    expect(LANDING_APP_LABEL).toBe('Landing page');
  });

  it('no muta el árbol de entrada', () => {
    const base = baseTree();
    applyAppsMenu(base, true);

    expect(base).toEqual(baseTree());
  });
});
