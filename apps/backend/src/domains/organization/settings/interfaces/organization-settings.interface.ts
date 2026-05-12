// ============================================================================
// ORGANIZATION SETTINGS - Única fuente de verdad para configuración de organización
// ============================================================================

import { PayrollSettingsSection } from '../../../store/payroll/calculation/interfaces/payroll-rules.interface';
import type { FiscalStatusBlock } from '@common/interfaces/fiscal-status.interface';

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

/**
 * Método de costeo de inventario aplicado al runtime para CPP/COGS.
 * - `weighted_average`: promedio ponderado, default seguro.
 * - `fifo`: first-in/first-out (requiere `inventory_cost_layers` poblado;
 *   la valuación cae a WA con `partial_data: true` cuando no hay layers —
 *   ver decisión §13#6 del Plan Unificado).
 *
 * NOTA: `lifo` está prohibido por el plan (§6.4.2). Se rechaza a nivel DTO.
 * Cualquier valor `cpp` legacy persistido a nivel store se mapea a
 * `weighted_average` en el resolver (`CostingMethodResolverService`).
 */
export type OrgCostingMethod = 'weighted_average' | 'fifo';

export interface OrganizationInventorySettings {
  mode: InventoryMode;
  low_stock_alerts_scope: LowStockAlertsScope;
  fallback_on_stockout: FallbackOnStockout;
  /**
   * Método de costeo a nivel organización. Cuando es `undefined`, el resolver
   * cae al setting de la store y, en última instancia, a `weighted_average`.
   * El owner debe optar explícitamente por `fifo` desde el wizard.
   */
  costing_method?: OrgCostingMethod;
}

// ============================================================================
// FISCAL DATA - Legal/tax identity at organization level
// ============================================================================
export interface OrganizationFiscalData {
  nit?: string;
  nit_dv?: string;
  tax_id?: string;
  tax_id_dv?: string;
  nit_type?: 'NIT' | 'CC' | 'CE' | 'TI' | 'PP' | 'NIT_EXTRANJERIA';
  legal_name?: string;
  person_type?: 'NATURAL' | 'JURIDICA';
  tax_regime?: 'COMUN' | 'SIMPLIFICADO' | 'GRAN_CONTRIBUYENTE';
  ciiu?: string;
  fiscal_address?: string;
  country?: string;
  department?: string;
  city?: string;
  tax_responsibilities?: string[];
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
  fiscal_status?: FiscalStatusBlock;
  fiscal_data?: OrganizationFiscalData;
}
