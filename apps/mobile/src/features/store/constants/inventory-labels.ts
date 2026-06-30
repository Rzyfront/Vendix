/**
 * Inventory label / option registry — single source of truth for the user
 * facing strings and option lists in the store-admin inventory module.
 *
 * Values mirror the web Vendix.Online inventory module so labels stay
 * aligned with the source of truth.
 */

import { INVENTORY_ICONS, type StatPaletteKey } from './inventory-icons';

// ─── Adjustment types ─────────────────────────────────────────────────────────
export type AdjustmentTypeValue =
  | 'damage'
  | 'loss'
  | 'theft'
  | 'expiration'
  | 'count_variance'
  | 'manual_correction';

export interface AdjustmentTypeOption {
  value: AdjustmentTypeValue;
  label: string;
  /** lucide icon name (matches INVENTORY_ICONS) */
  icon: string;
  /** Stat palette key — drives bg + text colors of the chip */
  palette: StatPaletteKey;
  /** Backend `reason_code` mapped from adjustment_type */
  reasonCode: 'DAMAGED' | 'LOST' | 'THEFT' | 'EXPIRED' | 'INV_COUNT' | 'OTHER';
  /** Human label for the reason_code (used in detail modal) */
  reasonLabel: string;
}

export const ADJUSTMENT_TYPE_OPTIONS: AdjustmentTypeOption[] = [
  {
    value: 'damage',
    label: 'Daño',
    icon: INVENTORY_ICONS.adjustmentDamage,
    palette: 'amber',
    reasonCode: 'DAMAGED',
    reasonLabel: 'Producto dañado',
  },
  {
    value: 'loss',
    label: 'Pérdida',
    icon: INVENTORY_ICONS.adjustmentLoss,
    palette: 'red',
    reasonCode: 'LOST',
    reasonLabel: 'Producto perdido',
  },
  {
    value: 'theft',
    label: 'Robo',
    icon: INVENTORY_ICONS.adjustmentTheft,
    palette: 'red',
    reasonCode: 'THEFT',
    reasonLabel: 'Robo confirmado',
  },
  {
    value: 'expiration',
    label: 'Vencido',
    icon: INVENTORY_ICONS.adjustmentExpiration,
    palette: 'amber',
    reasonCode: 'EXPIRED',
    reasonLabel: 'Producto vencido',
  },
  {
    value: 'count_variance',
    label: 'Conteo',
    icon: INVENTORY_ICONS.adjustmentCountVariance,
    palette: 'blue',
    reasonCode: 'INV_COUNT',
    reasonLabel: 'Conteo de inventario',
  },
  {
    value: 'manual_correction',
    label: 'Corrección',
    icon: INVENTORY_ICONS.adjustmentManualCorrection,
    palette: 'green',
    reasonCode: 'OTHER',
    reasonLabel: 'Otro',
  },
];

export const ADJUSTMENT_TYPE_MAP: Record<AdjustmentTypeValue, AdjustmentTypeOption> =
  ADJUSTMENT_TYPE_OPTIONS.reduce(
    (acc, opt) => ({ ...acc, [opt.value]: opt }),
    {} as Record<AdjustmentTypeValue, AdjustmentTypeOption>,
  );

// ─── Movement types ──────────────────────────────────────────────────────────
export type MovementTypeValue =
  | 'stock_in'
  | 'stock_out'
  | 'transfer'
  | 'adjustment'
  | 'sale'
  | 'return'
  | 'damage'
  | 'expiration';

export interface MovementTypeOption {
  value: MovementTypeValue;
  label: string;
  icon: string;
  palette: StatPaletteKey;
  /** True for movements that increase stock (inbound) */
  inbound: boolean;
}

export const MOVEMENT_TYPE_OPTIONS: MovementTypeOption[] = [
  {
    value: 'stock_in',
    label: 'Entrada',
    icon: INVENTORY_ICONS.movementStockIn,
    palette: 'green',
    inbound: true,
  },
  {
    value: 'stock_out',
    label: 'Salida',
    icon: INVENTORY_ICONS.movementStockOut,
    palette: 'red',
    inbound: false,
  },
  {
    value: 'transfer',
    label: 'Transferencia',
    icon: INVENTORY_ICONS.movementTransfer,
    palette: 'purple',
    inbound: true,
  },
  {
    value: 'adjustment',
    label: 'Ajuste',
    icon: INVENTORY_ICONS.movementAdjustment,
    palette: 'blue',
    inbound: true,
  },
  {
    value: 'sale',
    label: 'Venta',
    icon: INVENTORY_ICONS.movementSale,
    palette: 'amber',
    inbound: false,
  },
  {
    value: 'return',
    label: 'Devolución',
    icon: INVENTORY_ICONS.movementReturn,
    palette: 'cyan',
    inbound: true,
  },
  {
    value: 'damage',
    label: 'Daño',
    icon: INVENTORY_ICONS.movementDamage,
    palette: 'red',
    inbound: false,
  },
  {
    value: 'expiration',
    label: 'Vencimiento',
    icon: INVENTORY_ICONS.movementExpiration,
    palette: 'gray',
    inbound: false,
  },
];

export const MOVEMENT_TYPE_MAP: Record<MovementTypeValue, MovementTypeOption> =
  MOVEMENT_TYPE_OPTIONS.reduce(
    (acc, opt) => ({ ...acc, [opt.value]: opt }),
    {} as Record<MovementTypeValue, MovementTypeOption>,
  );

export const MOVEMENT_INBOUND_TYPES: MovementTypeValue[] = MOVEMENT_TYPE_OPTIONS
  .filter((o) => o.inbound)
  .map((o) => o.value);

export const MOVEMENT_OUTBOUND_TYPES: MovementTypeValue[] = MOVEMENT_TYPE_OPTIONS
  .filter((o) => !o.inbound)
  .map((o) => o.value);

// ─── Location types ──────────────────────────────────────────────────────────
export type LocationTypeValue = 'warehouse' | 'store' | 'virtual' | 'transit';

export interface LocationTypeOption {
  value: LocationTypeValue;
  label: string;
  icon: string;
}

export const LOCATION_TYPE_OPTIONS: LocationTypeOption[] = [
  { value: 'warehouse', label: 'Almacén', icon: INVENTORY_ICONS.warehouse },
  { value: 'store', label: 'Tienda', icon: INVENTORY_ICONS.store },
  { value: 'virtual', label: 'Virtual', icon: INVENTORY_ICONS.package },
  { value: 'transit', label: 'En Tránsito', icon: INVENTORY_ICONS.truck },
];

export const LOCATION_TYPE_MAP: Record<LocationTypeValue, LocationTypeOption> =
  LOCATION_TYPE_OPTIONS.reduce(
    (acc, opt) => ({ ...acc, [opt.value]: opt }),
    {} as Record<LocationTypeValue, LocationTypeOption>,
  );

// ─── Transfer states ─────────────────────────────────────────────────────────
export type TransferStateValue =
  | 'draft'
  | 'pending'
  | 'in_transit'
  | 'completed'
  | 'cancelled';

export interface TransferStateOption {
  value: TransferStateValue;
  label: string;
  icon: string;
  palette: StatPaletteKey;
}

export const TRANSFER_STATE_OPTIONS: TransferStateOption[] = [
  { value: 'draft', label: 'Borrador', icon: INVENTORY_ICONS.draftStat, palette: 'gray' },
  { value: 'pending', label: 'Pendiente', icon: 'clock', palette: 'gray' },
  { value: 'in_transit', label: 'En Tránsito', icon: INVENTORY_ICONS.inTransitStat, palette: 'amber' },
  { value: 'completed', label: 'Completada', icon: INVENTORY_ICONS.completedStat, palette: 'emerald' },
  { value: 'cancelled', label: 'Cancelada', icon: INVENTORY_ICONS.close, palette: 'red' },
];

export const TRANSFER_STATE_MAP: Record<TransferStateValue, TransferStateOption> =
  TRANSFER_STATE_OPTIONS.reduce(
    (acc, opt) => ({ ...acc, [opt.value]: opt }),
    {} as Record<TransferStateValue, TransferStateOption>,
  );

// ─── Adjustment states ───────────────────────────────────────────────────────
export type AdjustmentStateValue = 'pending' | 'approved' | 'rejected';

export const ADJUSTMENT_STATE_OPTIONS = [
  { value: 'pending' as const, label: 'Pendiente', icon: 'clock', palette: 'amber' as StatPaletteKey },
  { value: 'approved' as const, label: 'Aprobado', icon: INVENTORY_ICONS.check, palette: 'green' as StatPaletteKey },
  { value: 'rejected' as const, label: 'Rechazado', icon: INVENTORY_ICONS.close, palette: 'red' as StatPaletteKey },
];

// ─── Supplier / Location stats labels ────────────────────────────────────────
export const SUPPLIER_STATS = {
  total: { label: 'Total Proveedores', description: 'Proveedores registrados' },
  active: { label: 'Activos', description: 'Disponibles para compras' },
  inactive: { label: 'Inactivos', description: 'Suspendidos o deshabilitados' },
  pendingPO: { label: 'Órdenes Pendientes', description: 'Por recibir' },
} as const;

export const LOCATION_STATS = {
  total: { label: 'Total Ubicaciones', description: 'Puntos registrados' },
  warehouse: { label: 'Almacenes', description: 'Puntos de almacenamiento' },
  active: { label: 'Activas', description: 'Operativas' },
  inactive: { label: 'Inactivas', description: 'Fuera de operación' },
} as const;

export const ADJUSTMENT_STATS = {
  total: { label: 'Total Ajustes', description: 'Movimientos registrados' },
  loss: { label: 'Pérdidas', description: 'Productos extraviados' },
  damage: { label: 'Daños', description: 'Productos dañados' },
  correction: { label: 'Correcciones', description: 'Ajustes de inventario' },
} as const;

export const MOVEMENT_STATS = {
  total: { label: 'Total Movimientos', description: 'Movimientos registrados' },
  inbound: { label: 'Entradas', description: 'Ingresos de stock' },
  outbound: { label: 'Salidas', description: 'Egresos de stock' },
  transfer: { label: 'Transferencias', description: 'Entre ubicaciones' },
} as const;

export const TRANSFER_STATS = {
  total: { label: 'Total', description: 'Transferencias creadas' },
  draft: { label: 'Borradores', description: 'Por aprobar' },
  inTransit: { label: 'En Tránsito', description: 'En camino' },
  completed: { label: 'Completadas', description: 'Recibidas' },
} as const;

export const DASHBOARD_STATS = {
  totalValue: { label: 'Valor Total Inventario' },
  productsInStock: { label: 'Productos con Stock' },
  lowStock: { label: 'Stock Bajo' },
  pendingOrders: { label: 'Órdenes Pendientes' },
} as const;

export const STOCK_DETAIL_STATS = {
  available: { label: 'Total Disponible', description: 'Unidades disponibles' },
  reserved: { label: 'Total Reservado', description: 'Unidades reservadas' },
  onHand: { label: 'Total en Mano', description: 'Unidades físicas' },
} as const;

// ─── Currency options (for supplier form) ────────────────────────────────────
export const CURRENCY_OPTIONS = [
  { value: 'COP', label: 'COP - Peso Colombiano' },
  { value: 'USD', label: 'USD - Dólar Estadounidense' },
  { value: 'EUR', label: 'EUR - Euro' },
  { value: 'MXN', label: 'MXN - Peso Mexicano' },
  { value: 'ARS', label: 'ARS - Peso Argentino' },
  { value: 'CLP', label: 'CLP - Peso Chileno' },
  { value: 'PEN', label: 'PEN - Sol Peruano' },
  { value: 'BRL', label: 'BRL - Real Brasileño' },
] as const;

// ─── Tax regime options ──────────────────────────────────────────────────────
export const TAX_REGIME_OPTIONS = [
  { value: 'COMUN', label: 'Régimen Común' },
  { value: 'SIMPLIFICADO', label: 'Régimen Simplificado' },
  { value: 'GRAN_CONTRIBUYENTE', label: 'Gran Contribuyente' },
] as const;

// ─── Person type options ─────────────────────────────────────────────────────
export const PERSON_TYPE_OPTIONS = [
  { value: 'NATURAL', label: 'Persona Natural' },
  { value: 'JURIDICA', label: 'Persona Jurídica' },
] as const;

// ─── Country options (default for location address) ──────────────────────────
export const COUNTRY_OPTIONS = [
  { value: 'CO', label: 'Colombia' },
  { value: 'MX', label: 'México' },
  { value: 'AR', label: 'Argentina' },
  { value: 'CL', label: 'Chile' },
  { value: 'PE', label: 'Perú' },
  { value: 'BR', label: 'Brasil' },
  { value: 'US', label: 'Estados Unidos' },
  { value: 'ES', label: 'España' },
] as const;

// ─── Wizard step labels ──────────────────────────────────────────────────────
export const WIZARD_STEPS = {
  adjustment: ['Ubicación', 'Productos', 'Confirmar'],
  transfer: ['Ubicaciones', 'Productos', 'Confirmar'],
  bulkAdjustment: ['Configuración', 'Archivo', 'Resultado'],
} as const;