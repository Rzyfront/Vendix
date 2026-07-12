/**
 * Labels y constantes i18n del módulo Cupones.
 *
 * Mirror literal de la UI web (`apps/frontend/src/app/private/modules/store/marketing/coupons/`).
 * Toda la UI admin está hard-coded en español — NO usar `translate()`.
 *
 * Este archivo es la single source of truth para mobile.
 */

import { formatCurrency } from '@/shared/utils/currency';

export const COUPON_LABELS = {
  // ── Header / titles ─────────────────────────────────────────────────────
  title: 'Cupones',
  titleSingular: 'Cupon',
  pluralLabel: 'Cupones',

  // ── CTAs / botones ──────────────────────────────────────────────────────
  ctaNew: 'Nuevo Cupón',
  ctaEdit: 'Editar',
  ctaDelete: 'Eliminar',
  ctaSave: 'Guardar cambios',
  ctaCreate: 'Crear Cupón',
  ctaCancel: 'Cancelar',
  ctaSearch: 'Buscar cupón...',

  // ── Empty / loading ─────────────────────────────────────────────────────
  loading: 'Cargando cupones...',
  emptyTitle: 'No hay cupones creados',
  emptyDescription: 'Comienza creando un nuevo cupon.',
  emptyIcon: 'ticket',

  // ── Errores toast (verbatim backend response.message) ───────────────────
  errLoad: 'Error al cargar cupones',
  errStats: 'Error al cargar resumen',
  errCreate: 'Error al crear el cupon',
  errUpdate: 'Error al actualizar el cupon',
  errDelete: 'Error al eliminar el cupon',

  // ── Form fields ─────────────────────────────────────────────────────────
  fieldCode: 'Codigo',
  fieldName: 'Nombre',
  fieldDescription: 'Descripcion',
  fieldDiscountType: 'Tipo de descuento',
  fieldValue: 'Valor',
  fieldAppliesTo: 'Aplica a',
  fieldProducts: 'Productos',
  fieldCategories: 'Categorias',
  fieldValidFrom: 'Valido desde',
  fieldValidUntil: 'Valido hasta',
  fieldMinPurchase: 'Compra minima',
  fieldMaxDiscount: 'Descuento maximo',
  fieldUsageLimit: 'Limite de usos',
  fieldPerCustomerLimit: 'Usos por cliente',
  fieldIsActive: 'Cupon activo',

  // ── Selector options ───────────────────────────────────────────────────
  optionPercentage: 'Porcentaje',
  optionFixedAmount: 'Monto fijo',
  optionAllProducts: 'Todos los productos',
  optionSpecificProducts: 'Productos especificos',
  optionSpecificCategories: 'Categorias especificas',

  // ── Placeholders ────────────────────────────────────────────────────────
  placeholderCode: 'Ej: VERANO2026',
  placeholderName: 'Ej: Descuento de verano',
  placeholderDescription: 'Descripcion del cupon (opcional)...',
  placeholderMinPurchase: 'Sin minimo',
  placeholderMaxDiscount: 'Sin limite',
  placeholderUsageLimit: 'Sin limite',
  placeholderPerCustomerLimit: 'Sin limite',
  placeholderProducts: 'Buscar productos...',
  placeholderCategories: 'Buscar categorias...',

  // ── Validation messages (verbatim web inline errors) ──────────────────
  errCodeMinLength: 'Minimo 3 caracteres',
  errNameMinLength: 'Minimo 2 caracteres',
  errValueRequired: 'Requerido, mayor a 0',
  errValidFromRequired: 'Requerido',
  errValidUntilRequired: 'Requerido',
  errProductsRequired: 'Selecciona al menos un producto',
  errCategoriesRequired: 'Selecciona al menos una categoria',

  // ── Stats cards ────────────────────────────────────────────────────────
  statsTotalCoupons: 'Total Cupones',
  statsActiveCoupons: 'Activos',
  statsTotalUses: 'Usos Totales',
  statsDiscountApplied: 'Descuento Aplicado',
  statsSmallText: 'Cupones creados',
  statsActiveSmallText: 'Disponibles para uso',
  statsUsesSmallText: 'Cupones canjeados',
  statsDiscountSmallText: 'Descuento total otorgado',

  // ── Table / list columns ────────────────────────────────────────────────
  colCode: 'Codigo',
  colName: 'Nombre',
  colType: 'Tipo',
  colValue: 'Valor',
  colUses: 'Usos',
  colValidUntil: 'Valido hasta',
  colStatus: 'Estado',

  // ── Badge / display ────────────────────────────────────────────────────
  badgeActive: 'Activo',
  badgeInactive: 'Inactivo',
  typePercentage: 'Porcentaje',
  typeFixed: 'Monto Fijo',

  // ── Diálogos confirmación (verbatim web) ───────────────────────────────
  dialogDeleteTitle: 'Eliminar Cupón',
  dialogDeleteMessage: (code: string) =>
    `¿Está seguro de que desea eliminar el cupón "${code}"? Esta acción no se puede deshacer.`,
  dialogDeleteConfirm: 'Eliminar',
  dialogDeleteDeny: 'Cancelar',

  // ── Tabla de uses display ──────────────────────────────────────────────
  usesDisplay: (current: number, max?: number | null) =>
    max ? `${current}/${max}` : `${current}`,
};

// ── Helpers para display ──────────────────────────────────────────────────

export function formatDiscountValue(
  value: number,
  type: 'PERCENTAGE' | 'FIXED_AMOUNT',
): string {
  return type === 'PERCENTAGE' ? `${value}%` : formatCurrency(value);
}

/** Conversión ISO → YYYY-MM-DD para DatePicker */
export function toDateInput(iso?: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Genera un código aleatorio de 8 caracteres alphanumeric uppercase */
export function generateCouponCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}
