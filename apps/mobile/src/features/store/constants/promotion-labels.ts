/**
 * Labels y constantes i18n del módulo Promociones.
 *
 * Mirror literal de la UI web (`apps/frontend/src/app/private/modules/store/marketing/promotions/**`).
 * Toda la UI admin está hard-coded en español — NO usar `translate()`.
 *
 * Este archivo es la single source of truth para mobile.
 */

import type {
  PromotionRuleType,
  PromotionScope,
  PromotionState,
  PromotionType,
} from '@/features/store/types/promotions.types';

export const PROMOTION_LABELS = {
  // Header / titles
  title: 'Promociones',
  titleSingular: 'Promocion',
  pluralLabel: 'Promociones',

  // CTAs / botones
  ctaNew: 'Nueva Promocion',
  ctaEdit: 'Editar',
  ctaSave: 'Guardar cambios',
  ctaCreate: 'Crear Promocion',
  ctaCancel: 'Cancelar',
  ctaSearch: 'Buscar promociones...',

  // Empty / loading
  loading: 'Cargando promociones...',
  emptyTitle: 'No se encontraron promociones',
  emptyDescription: 'Comienza creando una nueva promocion.',

  // Errores toast
  errLoad: 'Error al cargar promociones',
  errSummary: 'Error al cargar resumen',
  errCreate: 'Error al crear promocion',
  errUpdate: 'Error al actualizar promocion',
  errDelete: 'Error al eliminar promocion',
  errActivate: 'Error al activar promocion',
  errPause: 'Error al pausar promocion',
  errCancel: 'Error al cancelar promocion',

  // Form fields
  fieldName: 'Nombre',
  fieldDescription: 'Descripcion',
  fieldCode: 'Codigo (cupon)',
  fieldRule: 'Regla',
  fieldScope: 'Alcance',
  fieldType: 'Tipo',
  fieldValue: 'Valor',
  fieldTiers: 'Escalas por cantidad',
  fieldProducts: 'Productos elegibles',
  fieldCategories: 'Categorias elegibles',
  fieldStartDate: 'Fecha inicio',
  fieldEndDate: 'Fecha fin',
  fieldMinPurchase: 'Compra minima',
  fieldMaxDiscount: 'Descuento maximo',
  fieldUsageLimit: 'Limite de usos',
  fieldPerCustomerLimit: 'Limite por cliente',
  fieldAutoApply: 'Aplicar automaticamente',
  fieldPriority: 'Prioridad',
  fieldTierMin: 'Cantidad min.',
  fieldTierMax: 'Cantidad max.',
  fieldTierOrder: 'Orden',
  fieldAddTier: 'Anadir escala',
  fieldTierHelp: 'Define rangos ascendentes de cantidad. Solo la ultima escala puede quedar abierta (sin maximo).',
  fieldNoTiers: 'No hay escalas. Agrega al menos una para esta regla.',

  // Stats cards
  statsActive: 'Activas',
  statsScheduled: 'Programadas',
  statsTotalDiscount: 'Total descuentos',
  statsTotalUsage: 'Usos totales',

  // Filter sections
  filterState: 'Estado',
  filterType: 'Tipo',
  filterScope: 'Alcance',
  filterAll: 'Todos',
  filterClear: 'Limpiar filtros',

  // Acciones por fila
  rowEdit: 'Editar',
  rowActivate: 'Activar',
  rowPause: 'Pausar',
  rowCancel: 'Cancelar',
  rowDelete: 'Eliminar',
  rowCode: 'Codigo',

  // Diálogos confirmación (verbatim web)
  dialogCancelTitle: 'Cancelar promocion',
  dialogCancelMessage: '¿Estas seguro de cancelar esta promocion? Esta accion no se puede deshacer.',
  dialogCancelConfirm: 'Si, cancelar',
  dialogCancelDeny: 'No',
  dialogDeleteTitle: 'Eliminar promocion',
  dialogDeleteMessage: '¿Estas seguro de eliminar esta promocion?',
  dialogDeleteConfirm: 'Si, eliminar',
  dialogDeleteDeny: 'No',

  // Validation messages (verbatim web inline)
  errRequired: 'Este campo es obligatorio',
  errMinValue: 'Debe ser mayor a 0',
  errMaxPercent: 'Debe ser <= 100',
  errNameRequired: 'El nombre es requerido',
  errStartDateRequired: 'La fecha de inicio es requerida',
  errValueRequired: 'El valor es requerido',
  errProductsRequired: 'Selecciona al menos un producto para esta promocion',
  errCategoriesRequired: 'Selecciona al menos una categoria para esta promocion',
  errTiersMinOne: 'Agrega al menos una escala para esta regla.',
  errTiersAdjacency:
    'Revisa las escalas: deben ser ascendentes y continuas.',

  // Headers / secciones detalle
  detailIdentity: 'Identidad',
  detailRule: 'Regla y descuento',
  detailVigency: 'Vigencia',
  detailRestrictions: 'Restricciones',
  detailProducts: 'Productos elegibles',
  detailCategories: 'Categorias elegibles',
  detailTiers: 'Escalas por cantidad',
  detailUsage: 'Uso',
};

export const PROMOTION_STATE_LABEL: Record<PromotionState, string> = {
  draft: 'Borrador',
  scheduled: 'Programada',
  active: 'Activa',
  paused: 'Pausada',
  expired: 'Expirada',
  cancelled: 'Cancelada',
};

export const PROMOTION_TYPE_LABEL: Record<PromotionType, string> = {
  percentage: 'Porcentaje',
  fixed_amount: 'Monto fijo',
};

export const PROMOTION_RULE_TYPE_LABEL: Record<PromotionRuleType, string> = {
  flat: 'Plana',
  quantity_tiered: 'Por cantidad',
};

export const PROMOTION_SCOPE_LABEL: Record<PromotionScope, string> = {
  order: 'Orden',
  product: 'Producto',
  category: 'Categoria',
};

// Badge variants used by PromotionCard
export const PROMOTION_STATE_BADGE_VARIANT: Record<PromotionState, 'default' | 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  draft: 'neutral',
  scheduled: 'info',
  active: 'success',
  paused: 'warning',
  expired: 'error',
  cancelled: 'error',
};
