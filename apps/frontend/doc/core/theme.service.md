# ThemeService

Ubicación: `src/app/core/services/theme.service.ts`

## Propósito
Aplicar tema, branding y SEO del tenant en tiempo de ejecución (solo en navegador):
- Variables CSS (colores, espaciado, sombras, fuentes).
- Inyección de CSS personalizado.
- Carga de fuentes (Google Fonts) bajo demanda.
- Actualización de favicon y metatags.
- Estado del tema actual (`currentTheme$`).

## Flujo
1. applyTenantConfiguration(tenantConfig): orquesta applyTheme + applyBranding + applySEO.
2. applyTheme(theme): variables CSS, spacing, shadows, carga de fuente, set `currentTheme`.
3. applyBranding(branding): colores, fuentes, CSS custom, favicon.
4. applySEOConfiguration(seo): title + meta OG/Twitter + canonical + robots.

## Métodos útiles
- injectCustomCSS(css, id?)
- updateFavicon(url)
- loadFont(fontFamily)
- resetTheme()

## Notas
- Usa `PLATFORM_ID` para evitar manipular DOM en SSR.
- Lista blanca de Google Fonts; considerar ampliarla o parametrizarla.
