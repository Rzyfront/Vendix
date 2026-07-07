/**
 * Inventory icon registry — single source of truth for icon names used in the
 * store-admin inventory module. All names must match entries in the global
 * `Icon` component iconMap (lucide-react-native), which is intentionally
 * 1:1 with the web (lucide-angular) names so visual parity is preserved.
 *
 * Why this file exists:
 * - Centralises icon string literals used across the 7 inventory screens.
 * - Avoids typos and "magic string" duplication.
 * - Documents the visual contract with the web Vendix.Online inventory module.
 */

export const INVENTORY_ICONS = {
  // ─── Stats (web `app-stats`) ────────────────────────────────────────────────
  /** Dashboard stat 1 — Total Inventory Value (purple) */
  valueStat: 'dollar-sign',
  /** Dashboard stat 2 — Products With Stock (blue) */
  productStat: 'package',
  /** Dashboard stat 3 — Low Stock (amber) */
  lowStockStat: 'alert-triangle',
  /** Dashboard stat 4 — Pending Orders (green) */
  pendingOrdersStat: 'truck',

  // Suppliers
  suppliersTotalStat: 'users',
  activeStat: 'check-circle',
  inactiveStat: 'x-circle',
  pendingPOStat: 'package',

  // Adjustments
  adjustmentsTotalStat: 'clipboard-list',
  lossStat: 'trending-down',
  damageStat: 'alert-triangle',
  correctionStat: 'edit-3',
  /** Adjustment detail modal — "Eliminar" button icon */
  trash: 'trash-2',

  // Movements
  movementsTotalStat: 'activity',
  /** Inbound / stock_in (semantically "coming in") */
  inboundStat: 'arrow-down-circle',
  /** Outbound / stock_out (semantically "going out") */
  outboundStat: 'arrow-up-circle',
  transferStat: 'repeat',

  // Locations
  locationsTotalStat: 'map-pin',
  warehouseStat: 'warehouse',

  // Transfers
  transferTotalStat: 'repeat',
  draftStat: 'file-text',
  inTransitStat: 'truck',
  completedStat: 'check-circle',

  // Stock detail
  stockAvailableStat: 'package-check',
  stockReservedStat: 'lock',
  stockOnHandStat: 'warehouse',

  // ─── Movement type badges (used in detail modal + lists) ────────────────────
  movementStockIn: 'arrow-down-circle',
  movementStockOut: 'arrow-up-circle',
  movementTransfer: 'repeat',
  movementAdjustment: 'sliders',
  movementSale: 'shopping-cart',
  movementReturn: 'corner-down-left',
  movementDamage: 'alert-triangle',
  movementExpiration: 'clock',

  // ─── Adjustment type chips (used in wizard + cards) ─────────────────────────
  adjustmentDamage: 'alert-triangle',
  adjustmentLoss: 'trending-down',
  adjustmentTheft: 'shield-off',
  adjustmentExpiration: 'clock',
  adjustmentCountVariance: 'hash',
  adjustmentManualCorrection: 'edit-3',

  // ─── Quick actions (dashboard) ──────────────────────────────────────────────
  quickNewOrder: 'plus-circle',
  quickAdjustStock: 'edit-3',
  quickNewSupplier: 'user-plus',
  quickViewProducts: 'package',

  // ─── Common UI ──────────────────────────────────────────────────────────────
  refresh: 'refresh',
  filter: 'filter',
  search: 'search',
  sort: 'sliders',
  settings: 'settings',
  empty: 'package',
  back: 'arrow-left',
  close: 'x',
  check: 'check',
  more: 'ellipsis-vertical',
  warning: 'alert-triangle',
  info: 'info',
  calendar: 'calendar',
  notes: 'file-text',
  user: 'user',
  users: 'users',
  edit: 'edit',
  eye: 'eye',
  truck: 'truck',
  warehouse: 'warehouse',
  store: 'store',
  mapPin: 'map-pin',
  hash: 'hash',
  star: 'star',
  package: 'package',
  clipboardList: 'clipboard-list',
  rotateCcw: 'rotate-ccw',
  plus: 'plus',
  trendingUp: 'trending-up',
  trendingDown: 'trending-down',
  shippingBag: 'shopping-bag',
  minus: 'minus',
  save: 'save',
  filePlus: 'file-plus',
  packageCheck: 'package-check',
  clock: 'clock',
} as const;

export type InventoryIconName = (typeof INVENTORY_ICONS)[keyof typeof INVENTORY_ICONS];

/**
 * Helper — palette for stat cards. Mirrors the web `bg-{color}-100` /
 * `text-{color}-600` pairs used in `app-stats`.
 */
export const STAT_PALETTE = {
  blue: { bg: '#dbeafe', color: '#2563eb' },
  green: { bg: '#dcfce7', color: '#16a34a' },
  amber: { bg: '#fef3c7', color: '#d97706' },
  red: { bg: '#fee2e2', color: '#dc2626' },
  purple: { bg: '#f3e8ff', color: '#9333ea' },
  gray: { bg: '#f3f4f6', color: '#6b7280' },
  cyan: { bg: '#cffafe', color: '#0891b2' },
  emerald: { bg: '#d1fae5', color: '#059669' },
} as const;

export type StatPaletteKey = keyof typeof STAT_PALETTE;