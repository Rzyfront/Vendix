// ============================================================================
// DEFAULT ORGANIZATION SETTINGS - Única fuente de verdad para los valores
// iniciales de organization_settings.settings
// ============================================================================

import {
  OrganizationSettings,
  OrganizationInventorySettings,
} from '../interfaces/organization-settings.interface';

/**
 * Defaults seguros para la sección `inventory` a nivel de organización.
 *
 * - `mode: 'independent'`
 *   Cada store maneja su propio inventario en aislamiento estricto. Activar
 *   `organizational` (inventario compartido entre stores) es una decisión
 *   explícita del owner. Este default replica el comportamiento histórico.
 *
 * - `low_stock_alerts_scope: 'location'`
 *   Máxima granularidad — se emite una alerta por cada location, minimizando
 *   la probabilidad de missing alerts cuando una bodega puntual queda baja.
 *
 * - `fallback_on_stockout: 'reject'`
 *   Fail-closed: si `resolveSaleLocation` no encuentra stock en la location
 *   resuelta, rechaza la venta. NUNCA adivina una location alternativa. El
 *   owner debe optar explícitamente por `ask_user` o `auto_next_available`.
 */
export function getDefaultOrganizationInventorySettings(): OrganizationInventorySettings {
  return {
    mode: 'independent',
    low_stock_alerts_scope: 'location',
    fallback_on_stockout: 'reject',
  };
}

/**
 * Defaults completos para `organization_settings.settings`.
 *
 * NOTA: `branding` es obligatorio en la interface y requiere decisión de marca
 * explícita del owner, por lo que este helper expone los defaults de las
 * secciones opcionales para composición en consumers. `getFullDefaults` debe
 * usarse cuando el consumer ya aportó los campos de marca.
 */
export function getDefaultOrganizationSettings(): Pick<
  OrganizationSettings,
  'inventory'
> {
  return {
    inventory: getDefaultOrganizationInventorySettings(),
  };
}
