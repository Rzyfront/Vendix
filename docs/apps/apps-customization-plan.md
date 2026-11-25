# Constructor de apps — configurabilidad total

Pedido de Rafael, 2026-11-25. Alcance: **todas las apps excepto Tienda en línea** (`store_home`), que queda como está.

## Historia de usuario

Como dueño de la tienda quiero **configurar cada parte de mis apps** (colores, tipografía, secciones, fotos, productos, reservas) sin depender de enlaces externos ni de un diseñador, y poder pedirle cambios a una IA viendo el resultado en vivo, para que mis páginas públicas se vean como yo quiero.

## Estado

- **F1.1 (este PR) — biblioteca de medios: HECHO.**
  - Tabla `store_app_media` (migración aditiva, borrado lógico con `deleted_at`).
  - `POST /store/apps/media` (máx. 20 archivos, 8 MB c/u; imágenes a webp + thumbnail, PDF validado por firma); `GET` con búsqueda y paginación; `PATCH` del `alt`; `DELETE` lógico.
  - Techo técnico de 1 GB por tienda; lote validado antes de subir y sin objetos huérfanos si falla la fila.
  - `GET /public/apps/media/:id` devuelve una firma fresca (302): la app guarda una URL estable que no vence.
  - Frontend: `AppMediaService`, galería accesible (`app-modal`) con subida múltiple, miniaturas, búsqueda con debounce, `alt` y borrado con confirmación; botón **Galería** en Logo y Portada de Estilo.
- **Fases 2-5: PLANIFICADAS, no implementadas en este PR.**

## Fases

### F2 — Editor por secciones (10-12 días-dev)
Catálogo de bloques por app (hero 3 variantes, galería grid/carrusel/mosaico, destacados, listado con filtros, testimonios, FAQ, CTA, mapa, horarios, equipo, precios, texto+imagen). Por bloque: layout preconfigurado (2-4 variantes), alineación, espaciado, fondo (color/imagen/degradado), overlay, altura, orden y visibilidad; imágenes con roles `cover`/`background`/`carousel[]`/`gallery[]`/`avatar`/`logo`; duplicar, copiar/pegar, deshacer/rehacer y presets por industria.

### F3 — Selectores y detalle (4-5 días-dev)
Selector de productos con búsqueda, filtros y variantes; selector de servicios/reservas con disponibilidad; detalle de reserva/hotel en la página; condiciones por bloque.

### F4 — Diseño con IA (6-8 días-dev)
Vex con herramientas acotadas sobre el borrador (`set_theme`, `set_section_layout`, `set_section_media`, `add_block`, `reorder_blocks`, `apply_preset`, `set_brand`), chat lateral y preview por SSE. Regla dura: Vex **no** genera HTML/CSS libre; escribe el documento que el backend ya valida. Cada cambio es reversible («aplicar»/«descartar») con historial.

### F5 — Pulido (3-4 días-dev)
Presets por industria, accesibilidad (contraste, foco, `alt`), migración de configs viejas y plantillas compartidas.

## Decisiones tomadas por defecto

- Un solo editor para todas las apps menos Tienda en línea.
- Fotos en nuestro storage, con compresión, sin cobro por cantidad (techo técnico 1 GB/tienda).
- El release develop→main lo coordina Aurora.

## Riesgos

- **Peso del documento**: los medios se referencian por URL estable/id, no se embeben; el documento se valida con tope.
- **Regresión visual**: cada token nuevo debe tener un valor por defecto igual al de hoy; los tests de plantillas lo fijan.
- **Costos de IA**: el diseño con IA usa el cupo normal de Vex, con herramientas acotadas.

## Tasks

- [x] F1.1 tabla + endpoints + galería + URL estable + specs.
- [ ] F1.2 tokens ampliados (paleta completa, escala tipográfica, fondos por sección).
- [ ] F1.3 aplicar tokens y medios en General/Estilo de las tres apps con preview.
- [ ] F2 bloques y layouts por app.
- [ ] F3 selectores y detalle.
- [ ] F4 herramientas de Vex + preview SSE + historial.
- [ ] F5 presets, accesibilidad y migración.
