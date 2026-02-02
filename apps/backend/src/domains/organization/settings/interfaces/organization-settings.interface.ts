// ============================================================================
// ORGANIZATION SETTINGS - Única fuente de verdad para configuración de organización
// ============================================================================

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
// ORGANIZATION SETTINGS - Interfaz principal
// ============================================================================
export interface OrganizationSettings {
  branding: OrganizationBranding;
  fonts?: OrganizationFonts;
  panel_ui?: OrganizationPanelUISettings;
}
