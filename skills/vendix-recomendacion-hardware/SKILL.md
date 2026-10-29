---
name: vendix-recomendacion-hardware
description: >
  Recomendación de hardware Vendix en PDF (fichas, totales y QR), a nombre y con firma de Rafael. Trigger: recomendar equipos a un cliente desde links de cualquier tienda, fotos o descripciones.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Vendix · Recomendación de hardware

Produce `entregables/propuestas/Recomendacion_Hardware_Vendix_<Empresa>.pdf`: portada, resumen con totales, una ficha por equipo y una hoja final de revisión y firma. Solo PDF.

Usa el motor, los estilos, la firma y las fuentes del skill `vendix-propuesta-comercial` (`../vendix-propuesta-comercial/`). El documento **siempre** sale a nombre y con firma de Rafael Eduardo Martínez Frontado; no cambies el emisor.

## 1. Pregunta (una sola tanda, a quien pide el documento)

1. **Empresa** y **persona a quien se emite** (tratamiento y cargo, si lo sabe).
2. **Qué tiene ya el cliente**: computador o portátil, impresora POS (marca, ancho, si tiene puerto para cajón), lectores, tablets. Así solo se recomienda lo que falta.
3. **Los equipos**, de cualquier fuente: link de cualquier tienda en línea, foto (de la publicación, de una vitrina o de una cotización) o el detalle escrito del dispositivo. Para cada uno: cantidad (fija, o rango como "1 o 2" según elija el cliente), para qué se usa (por ejemplo "KDS de cocina", "caja de recepción") y si es opcional.
4. **Plan de Vendix** si ya hay propuesta (por ejemplo, con facturación electrónica conviene impresora de 80 mm).

Si quien pide no tiene links, propón equipos por punto de trabajo (`references/compatibilidad.md`) y espera su aprobación antes de buscar publicaciones.

## 2. Reúne los datos de cada equipo

Según la fuente:

- **Link de Mercado Libre**: WebFetch recibe 403; usa el navegador (Playwright MCP) como indica `references/mercadolibre.md`.
- **Link de otra tienda** (Falabella, Alkosto, Éxito, Amazon, tienda del fabricante…): prueba WebFetch y, si falla, el navegador con Playwright MCP (`browser_navigate` + `browser_snapshot`). Extrae nombre, precio, precio anterior, vendedor, garantía, especificaciones y la URL de la foto principal.
- **Foto**: léela con la herramienta de imágenes. Si muestra el equipo, úsala como foto de la ficha (`imagen` = ruta local del archivo). Toma de ella los datos visibles (modelo, precio, specs).
- **Detalle escrito**: usa solo lo escrito. Si falta el precio, pregúntalo. Sin foto ni link, la ficha sale sin foto ni QR.

Pregunta lo que falte para la ficha (como mínimo: nombre, precio y uso). Si conoces el modelo exacto, puedes completar especificaciones desde la página del fabricante, citando solo lo que verifiques. Anota la fecha de consulta y la tienda de cada equipo.

Luego evalúa cada equipo para el uso indicado con `references/compatibilidad.md` y escribe "Puntos a tener en cuenta" honestos: lo bueno y las advertencias (garantía no indicada, Windows de prueba, pantalla no táctil, vendedor con pocas ventas, puertos justos, segundo cajón requiere segunda impresora). No inventes datos que la publicación no muestre.

## 3. Redacta los datos

Copia `examples/roysmar.json` a un archivo temporal (fuera del repo) y reemplaza:

| Campo | Qué poner |
|---|---|
| `cliente` | `empresa`, `empresa_corta`, `contacto`, `cargo` (puede ir vacío) |
| `fecha_consulta` | Fecha en que leíste las publicaciones, en texto ("29 de octubre de 2026") |
| `tienda` | Tienda por defecto para todos los equipos (cada equipo puede tener la suya) |
| `nota_precios` | Opcional: reemplaza la línea de precios del resumen (por ejemplo, "Precios de la cotización del proveedor del 28/10/2026") |
| `porque` | 1 o 2 párrafos: qué complementa, qué ya tiene el cliente y qué cubre la compra (máx. 70 palabras en total) |
| `equipos[]` | Uno por equipo: `nombre`, `nombre_corto`, `resumen` (specs en 8 palabras), `uso`, `seccion` ("Cocina · Pantallas KDS × 3"), `cantidad` o `cantidad_min`/`cantidad_max`, `precio` (número), `precio_antes` y `descuento` (si hay), `opcional`, `tienda` (opcional), `url` (opcional: genera el QR), `imagen` (opcional: URL o ruta local de la foto), `reputacion` (opcional), `incluye` (4–6 viñetas), `puntos` (3–4 viñetas) |
| `resumen_esencial`, `resumen_opcionales` | Cómo se compone cada total ("3 tablets + 1 cajón") |
| `nota_resumen` | Opcional: `titulo` + `puntos` para aclarar una elección (por ejemplo "¿Uno o dos cajones?") |
| `revisar` | 2 a 4 recuadros `titulo` + `texto` (Wi-Fi, soportes, papel, impresora para factura electrónica) |

Los subtotales, totales (esencial y con opcionales, con mínimo y máximo), QR y fotos los calcula y descarga el script. Hasta 4 equipos caben en la fila de fotos del resumen; con más equipos, cada uno igual tiene su ficha.

## 4. Genera y verifica

```bash
skills/vendix-propuesta-comercial/scripts/render.sh hardware --data <datos.json>
```

Debe imprimir `OK <ruta> (<N> páginas)`, donde N = equipos + 3. `DESBORDE-PAGINA-N` exige acortar los textos de esa hoja (viñetas de la ficha o los recuadros `revisar`). Mira las hojas antes de entregar y borra los temporales.

## 5. Entrega

Responde con la ruta del PDF, la tabla de equipos con cantidades y totales, y las advertencias que quien pide debe confirmar con el vendedor. Los precios son los del día de consulta.

## Recursos

- `templates/hardware.html.j2`: plantilla (hereda de `../vendix-propuesta-comercial/templates/_base.html.j2`).
- `references/mercadolibre.md`: cómo extraer los datos de una publicación de Mercado Libre (sirve de guía para otras tiendas).
- `references/compatibilidad.md`: qué equipo sirve para cada punto de trabajo con Vendix y qué revisar.
- `examples/roysmar.json`: caso real (3 tablets KDS, cajón SAT 1 o 2, ThinkCentre opcional).
