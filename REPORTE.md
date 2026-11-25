# REPORTE — Tokens de diseño ampliados (Apps F7)

Rama `feat/apps-theme-tokens` (base `origin/develop`). Sin commit, push ni PR: todo queda en el árbol.

## Historia de usuario

**Como** dueño de una tienda en el panel de administración, **quiero** ajustar más a fondo el estilo de mis páginas de Producto, Servicio y Reservas (bordes, tamaño de letra, espacio entre secciones, tarjetas, sombras, imágenes y portada) **para** que se vean como mi marca sin tener que programar.

**Pasos en pantalla**

1. Entra a Tienda → Apps → abre el editor de la página de Producto (o Servicio, o Reservas) → pestaña **Estilo**.
2. Verás cuatro grupos: **Colores**, **Tipografía**, **Espaciado y tarjetas**, **Imágenes y portada**.
3. En **Colores**, pulsa una paleta rápida (Océano, Bosque, Terracota, Noche): cambian los cinco colores de una vez en el preview.
4. Escribe un color de **Bordes** casi igual al fondo (p. ej. `#FDFDFD` sobre fondo blanco): aparece el aviso «El color de los bordes casi no se distingue del fondo…».
5. En **Tipografía**, elige «Tamaño del texto: Grande» y «Tamaño de los títulos: Destacados»: el texto y los títulos crecen.
6. En **Espaciado y tarjetas**, prueba «Espacio entre secciones», «Tarjetas» (Planas / Con borde / Suaves) y «Sombra de tarjetas».
7. En **Imágenes y portada**, elige la proporción de imágenes, el alto de la portada (Pantalla completa) y mueve el slider **Velo sobre las imágenes** (0–80 %).
8. Pulsa «Como hoy» en cualquier chip (o «Quitar» en el velo): la página vuelve a verse como antes.

**Criterios de aceptación (lo que se ve)**

- Una página guardada antes de este cambio se ve exactamente igual (ningún token nuevo = ninguna regla nueva activa).
- Cada control cambia solo su aspecto en el preview y en la página pública.
- La paleta rápida rellena los cinco colores y conserva el resto del estilo.
- El chequeo de legibilidad existente sigue apareciendo; se añade el aviso de borde poco visible.
- La Tienda en línea (`store_home`) no muestra paletas, color de bordes, chips nuevos ni slider: solo ve los grupos reordenados con los tokens que ya tenía.

## Qué se hizo (notas técnicas)

### 1. Contrato
- `apps/backend/src/domains/store/apps/shared/app-page.contract.ts`: nuevos catálogos cerrados `APP_THEME_FONT_SIZES`, `APP_THEME_HEADING_SCALES`, `APP_THEME_SECTION_GAPS`, `APP_THEME_CARD_STYLES`, `APP_THEME_SHADOWS`, `APP_THEME_IMAGE_RATIOS`, `APP_THEME_HERO_HEIGHTS` y `APP_THEME_MAX_IMAGE_OVERLAY = 80`. El spec `THEME` añade `border_color` (#RRGGBB, validado como los otros colores vía `APP_THEME_COLOR_KEYS`), los enums y `image_overlay: int(0, 80)`. Mismo criterio que hoy: un valor inválido **rechaza** el documento con su mensaje por campo; un valor vacío se descarta.
- Espejo `apps/frontend/.../templates/app-page.types.ts`: tipos nuevos en `AppPageTheme`, `APP_THEME_PALETTES` (4 paletas, todas pasan `contrastChecks`), `APP_THEME_BORDER_COLOR`, `APP_THEME_EXTENDED_OPTIONS` (con grupo y etiquetas) y `APP_THEME_OPTION_GROUPS` para reagrupar los tokens F3. `APP_THEME_COLORS` y `APP_THEME_OPTIONS` **no cambian**, así el editor antiguo (`app-page-editor`) queda igual.

### 2. Aplicación (preview y página pública)
- `public/app-page/app-page-theme.ts`: `themeStyle` expone `--ap-border`/`--color-border`, `--ap-font-scale`, `--ap-heading-scale`, `--ap-section-gap`, `--ap-card-shadow`, `--ap-image-ratio`, `--ap-image-overlay`, `--ap-image-brightness`, `--ap-hero-py(-md)`, solo cuando el token existe. Nuevos `themeMarkers` (atributos `data-ap-*`) y `borderContrast` (umbral `MIN_BORDER_CONTRAST = 1.15`).
- `public/app-page/app-page-view.component.ts`: reglas con fallback idéntico al actual (padding de sección × 1, galería `1 / 1`, portada `py-12 / md:py-16`) y reglas sin fallback neutro (tipografía, tarjetas, sombra, velo, portada completa) activadas solo por `data-ap-*`. El velo oscurece imágenes de portada/galería con `filter: brightness(1 − velo)` (equivale a un velo negro) y ajusta la capa existente sobre el fondo de portada. Clases marcadoras añadidas: `ap-hero`, `ap-hero-inner`, `ap-cover-veil`.

### 3. Panel Estilo
- `page-builder/app-page-style-panel.component.ts`: grupos «Colores», «Tipografía», «Espaciado y tarjetas», «Imágenes y portada»; selects para los tokens F3, chips para los nuevos (con «Como hoy»), slider 0–80 (paso 5) para el velo, fila de paletas rápidas, color de bordes y aviso de borde. Chequeo de contraste intacto.

### 4. Plantillas y migración
- Ninguna plantilla cambia; ninguna fija tokens nuevos. No hay migración de base de datos: el tema vive en el JSON `config.page` y los tokens nuevos son opcionales.

## Decisiones
- **Tienda en línea**: el panel es compartido; para no tocarla, los controles nuevos se ocultan cuando `kind === 'store_home'`. Solo cambia el orden de sus grupos (los mismos tokens F3). El contrato del backend es común a todas las apps y acepta los tokens también para `store_home`, pero su panel no los ofrece.
- `heading_scale` se multiplica sobre `base_font_size` (texto grande + títulos destacados se combinan).
- `section_gap` multiplica el padding vertical de cada sección (compone con `density`): tight 0.6, normal 1, airy 1.5.
- La paleta «Noche» usa secundario ámbar para que el texto de la portada sin imagen pase 4.5:1.

## Verificación ejecutada
Antes de cada corrida: `pgrep -f "karma|jest|vitest|ng test"` → solo el CLI de otro agente (`agy`), ningún test.

| Comando | Resultado |
|---|---|
| `npx jest --runInBand --config <scratch isolatedModules> src/domains/store/apps/shared/app-page.contract.spec.ts` (desde `apps/backend`) | 23/23 ✅ |
| `npx ng test --watch=false --aot --browsers=ChromeHeadless --include='src/app/public/app-page/*.spec.ts'` | 26/26 ✅ (vista + util de tema) |
| `npx ng test --watch=false --aot --browsers=ChromeHeadless --include='src/app/private/modules/store/apps/page-builder/app-page-style-panel.component.spec.ts'` | 7/7 ✅ |
| `npx ng test --watch=false --aot --browsers=ChromeHeadless --include='src/app/private/modules/store/apps/templates/app-page-templates.spec.ts'` | 40/40 ✅, sin avisos del compilador en los archivos tocados |

Specs nuevos/actualizados:
- `app-page.contract.spec.ts`: acepta todos los tokens nuevos; límites 0/80 del velo; rechazo de valores fuera de catálogo, borde mal formado y velo −1 / 12.5 / `'40'` / 81; documento viejo sin cambios. El caso anterior usaba `shadow` como campo no permitido; ahora usa `sparkle`.
- `app-page-theme.spec.ts` (nuevo): variables CSS y valores por defecto, marcadores, aviso de borde, paletas legibles.
- `app-page-view.component.spec.ts`: estilos calculados con tema F3 iguales a hoy; cada token nuevo aplicado (borde, tipografía, separación, tarjetas, sombra, proporción, velo, portada).
- `app-page-style-panel.component.spec.ts` (nuevo): grupos, paleta emite los 5 colores, chips, slider, aviso de borde, contraste existente y `store_home` sin controles nuevos.

Pendiente / no ejecutado:
- No se ejecutó build ni typecheck completos (regla del repo; CI los cubre). `ng test --aot` sí compiló las plantillas de los componentes tocados.
- No se verificó en el vhost con Playwright: el servidor MCP de Playwright no conectó en esta sesión. Falta una prueba manual de los pasos de arriba en `https://vendix.com`.
- RED antes de implementar: no se observó en un paso aparte; los tests se escribieron junto con el código.
- Entorno: se enlazó temporalmente `apps/frontend/node_modules` al checkout principal para correr karma y se borró al terminar; el config scratch de jest (en `mktemp -d`) también se borró.

Risk: ítem 3 (contrato compartido: `AppPageTheme` y el validador del backend los consumen todas las apps, incluida la Tienda en línea; el cambio es aditivo y opcional, y la vista solo activa reglas nuevas cuando el token existe).
