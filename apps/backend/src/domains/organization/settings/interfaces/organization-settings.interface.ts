// ============================================================================
// ORGANIZATION SETTINGS - Única fuente de verdad para configuración de organización
// ============================================================================

import { PayrollSettingsSection } from '../../../store/payroll/calculation/interfaces/payroll-rules.interface';

// ============================================================================
// BRANDING - Colores, logo y theming a nivel de organización
// ============================================================================
export interface OrganizationBranding {
  name: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  background_color: string;
  surface_color: string;
  text_color: string;
  text_secondary_color: string;
  text_muted_color: string;
  logo_url?: string;
  favicon_url?: string;
}

// ============================================================================
// FONTS - Configuración de fuentes
// ============================================================================
export interface OrganizationFonts {
  primary: string;
  secondary: string;
  headings: string;
}

// ============================================================================
// PANEL UI - Control de módulos disponibles a nivel de organización
// ============================================================================
export interface OrganizationPanelUISettings {
  ORG_ADMIN?: Record<string, boolean>;
}

// ============================================================================
// INVENTORY - Modo de inventario y comportamiento multi-location
// ============================================================================
/**
 * Modo de operación del inventario en la organización.
 * - `organizational`: inventario compartido y visible entre stores (requiere
 *   decisión explícita del owner).
 * - `independent`: cada store maneja sus propios stock levels en aislamiento
 *   estricto (default — replica el comportamiento histórico).
 */
export type InventoryMode = 'organizational' | 'independent';

/**
 * Scope en el que se evalúan las alertas de stock bajo.
 * - `location`: granularidad máxima, alerta por cada location individual.
 * - `store`: agregado por store.
 * - `org`: agregado a nivel de organización.
 */
export type LowStockAlertsScope = 'location' | 'store' | 'org';

/**
 * Estrategia cuando una venta no tiene stock en la location resuelta.
 * - `reject`: fail-closed, rechaza la venta (default — nunca adivina bodega).
 * - `ask_user`: solicita al usuario elegir location alternativa.
 * - `auto_next_available`: intenta automáticamente la siguiente location con
 *   stock disponible según orden/prioridad.
 */
export type FallbackOnStockout = 'reject' | 'ask_user' | 'auto_next_available';

export interface OrganizationInventorySettings {
  mode: InventoryMode;
  low_stock_alerts_scope: LowStockAlertsScope;
  fallback_on_stockout: FallbackOnStockout;
}

// ============================================================================
// ORGANIZATION SETTINGS - Interfaz principal
// ============================================================================
export interface OrganizationSettings {
  branding: OrganizationBranding;
  fonts?: OrganizationFonts;
  panel_ui?: OrganizationPanelUISettings;
  payroll?: PayrollSettingsSection;
  inventory?: OrganizationInventorySettings;
}
