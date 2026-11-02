import { MenuItem } from '../../../shared/components/sidebar/sidebar.component';

/** Sidebar group of the Apps module (apps-module T7). */
export const APPS_GROUP_LABEL = 'Apps';

/** Name of the `customers_crm` entry inside Apps (apps-module T9). */
export const LANDING_APP_LABEL = 'Landing page';

const ECOMMERCE_ROUTE = '/admin/ecommerce';
const LANDING_ROUTE = '/admin/customers/crm';

/**
 * Regroups the store-admin sidebar under "Apps" when the store switch
 * `store_settings.apps.enabled` is on (odd/tasks/apps-module.md, D2/T7/T9).
 *
 * - Flag off: returns the SAME array, so the sidebar is exactly today's.
 * - Flag on: the top-level "Tienda en línea" entry is replaced, in place, by
 *   the "Apps" group; it moves inside untouched (same label, route and
 *   `ecommerce` key, so store-type and panel_ui filters still apply). The
 *   `customers_crm` entry leaves "Clientes" and shows inside Apps as
 *   "Landing page", with the same key and route.
 *
 * Only apps with an admin screen today are children; the rest live in the
 * catalog page ("Todas las apps"). No existing label is renamed: the group and
 * its first child are new entries, matched by `panelUiKey`, not by label.
 */
export function applyAppsMenu(items: MenuItem[], appsEnabled: boolean): MenuItem[] {
  if (!appsEnabled) return items;

  const ecommerce = items.find((item) => item.route === ECOMMERCE_ROUTE);
  let landing: MenuItem | undefined;

  const withoutLanding = items.map((item) => {
    const child = item.children?.find((c) => c.route === LANDING_ROUTE);
    if (!child) return item;
    landing = child;
    return {
      ...item,
      children: item.children!.filter((c) => c.route !== LANDING_ROUTE),
    };
  });

  const children: MenuItem[] = [
    {
      label: 'Todas las apps',
      icon: 'layout-grid',
      route: '/admin/apps',
      panelUiKey: 'apps',
    },
  ];
  if (ecommerce) children.push(ecommerce);
  if (landing) children.push({ ...landing, label: LANDING_APP_LABEL });

  const group: MenuItem = { label: APPS_GROUP_LABEL, icon: 'app-window', children };
  const index = withoutLanding.findIndex((item) => item.route === ECOMMERCE_ROUTE);
  if (index === -1) return [...withoutLanding, group];
  return [
    ...withoutLanding.slice(0, index),
    group,
    ...withoutLanding.slice(index + 1),
  ];
}
