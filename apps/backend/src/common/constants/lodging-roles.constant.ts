/**
 * Default hotel roles (Hotelería, H0.5).
 *
 * Single source for the seed (`permissions-roles.seed.ts`), the assignable
 * role allowlist and the panel preset applied when a store creates a user
 * with one of these roles. Plan decision D10: each role carries EVERY
 * permission its workflow needs, so the process never breaks with a 403.
 * Later hotel slices extend these lists when they add an endpoint the role
 * uses.
 */
export const RECEPTIONIST_ROLE = 'receptionist';
export const HOUSEKEEPER_ROLE = 'housekeeper';

export const LODGING_ROLE_PERMISSIONS: Readonly<
  Record<string, readonly string[]>
> = {
  // Front desk: reservations, check-in/out, folio charges and closing, guest
  // registration, room status. Rates, channels, reports and hotel settings
  // stay with owner/admin/manager.
  [RECEPTIONIST_ROLE]: [
    'store:lodging:inventory:read',
    'store:lodging:reservations:read',
    'store:lodging:reservations:write',
    'store:lodging:front_desk:operate',
    'store:lodging:folio:charge',
    'store:lodging:folio:close',
    // H7.1 — the night auditor closes the day; reopening stays with managers.
    'store:lodging:night_audit:close',
    'store:lodging:housekeeping:read',
    'store:lodging:compliance:operate',
    // Guest profiles (the reservation holder is a customer).
    'store:customers:read',
    'store:customers:create',
    'store:customers:update',
    // The folio wraps a draft order, charged through POS.
    'store:orders:create',
    'store:orders:read',
    'store:orders:update',
    'store:orders:order_flow:create',
    'store:orders:order_flow:read',
    'store:pos:access',
    // Extra charges (minibar, laundry) are store products.
    'store:products:read',
    'store:products:read:one',
    'store:products:read:store',
    'store:products:read:slug',
  ],
  // Housekeeping: sees rooms and updates their cleaning status. No money.
  [HOUSEKEEPER_ROLE]: [
    'store:lodging:inventory:read',
    'store:lodging:housekeeping:read',
    'store:lodging:housekeeping:operate',
  ],
};

/**
 * STORE_ADMIN panel modules a new user of the role sees. Every other module
 * starts hidden; the owner can still change it per user in "Módulos del
 * panel". Hotel modules are also gated by permission in the sidebar.
 */
export const ROLE_PANEL_UI_PRESETS: Readonly<Record<string, readonly string[]>> =
  {
    [RECEPTIONIST_ROLE]: [
      'hospitality',
      'hospitality_rooms',
      'hospitality_reservations',
      'pos',
      'orders',
      'orders_sales',
      'customers',
      'customers_all',
    ],
    [HOUSEKEEPER_ROLE]: ['hospitality', 'hospitality_rooms'],
  };

/**
 * Returns a copy of `config` whose `panel_ui.STORE_ADMIN` keeps only the
 * role's preset modules visible. Roles without a preset get `config` back
 * untouched.
 */
export function applyRolePanelPreset<
  T extends { panel_ui: Record<string, Record<string, boolean>> },
>(config: T, roleName: string | undefined): T {
  const preset = roleName ? ROLE_PANEL_UI_PRESETS[roleName] : undefined;
  const storeAdmin = config.panel_ui?.STORE_ADMIN;
  if (!preset || !storeAdmin) return config;

  const keys = new Set([...Object.keys(storeAdmin), ...preset]);
  const presetPanel: Record<string, boolean> = {};
  for (const key of keys) presetPanel[key] = preset.includes(key);

  return {
    ...config,
    panel_ui: { ...config.panel_ui, STORE_ADMIN: presetPanel },
  };
}
