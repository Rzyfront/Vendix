# BLOQUEO — Bloques 9 (D2) y 10 (D3)

Fecha: 2026-11-05. Rama `feat/flujos-documental`.

## Bloque 9 — plantillas y render HTML→PDF

**Qué pide el brief:** "Servicio de render HTML→PDF en cola aparte con límite de memoria y timeout; `issued_document` conectado al motor; requisito `issued_document`." El diseño (`odd/tasks/flujos-ai-business.md` §10.4, decisión D4) fija Chromium headless en un servicio aislado.

**Por qué se detiene:**

1. No existe ningún motor HTML→PDF en el repo. `apps/backend/package.json` no tiene `puppeteer`, `playwright`, Chromium, Gotenberg ni Handlebars. Hay que agregar dependencias nuevas y cambiar la imagen de Docker.
2. Es un cambio de entrega e infraestructura (riesgo alto, item 5). Hace falta un contenedor nuevo con `mem_limit` en `docker-compose.yml` y en el workflow de deploy a EC2. El propio compose dice "Subir mem_limit requiere VM con más RAM (hoy 10 GB, 1.6 GB libres)", y el riesgo T4 del plan pide "Medir antes de D2".
3. Cambiar la topología de producción, la RAM de la VM o el proveedor (por ejemplo un servicio gestionado) no se puede decidir desde el código.

**Decisión que necesito de Rafael (elige una):**

- **A.** Contenedor `vendix_pdf_renderer` (Chromium headless + cola BullMQ `documents-render`, concurrencia 2, timeout 30 s, `mem_limit` ~768 MB) en la VM actual. Requiere confirmar la RAM libre o subir la instancia.
- **B.** Servicio gestionado de HTML→PDF (por ejemplo Gotenberg en un host aparte, o un SaaS). Requiere la cuenta o el host y el costo.
- **C.** Render con `pdfkit`, que ya está en el repo, sobre el modelo de bloques: sin HTML/CSS libre, con bloques limitados (títulos, párrafos con tokens, tabla, imagen, salto, casilla de firma). Es una desviación de D4, pero no suma infraestructura.

Con la elección se implementa en orden: `document_templates` y sus versiones inmutables, tokens y filtros, editor por bloques con vista previa, render en cola, `issued_document` en el motor y el requisito.

## Bloque 10 — documento firmado por el cliente

Depende del 9. En el contrato `vendix.workflow/v1`, el requisito `signature` se define con `of`, la clave de un requisito `issued_document` de la misma etapa: el documento firmado es la versión firmada de un documento emitido. Además, el validador rechaza hoy todo `issued_document` mientras no haya plantillas publicadas (`TEMPLATE_NOT_PUBLISHED`), así que no se puede publicar ningún flujo con firma.

Para construir el 10 sin el 9 habría que cambiar el contrato (un `signature` sin `of`, o sea la carga de un documento firmado sin documento emitido de origen), y eso es una decisión de producto. Opciones:

- Esperar al 9.
- Autorizar `signature` sin `of` como "documento firmado aportado por el cliente".

## Qué se hizo en su lugar

Se sigue con los bloques 11 en adelante, en orden, y cada uno se cierra entero. El estado final queda en `REPORTE-FLUJOS.md`.

## Bloque 14 — OCR/validación IA, plantillas desde PDF base, generación IA de plantillas, retención

Actualizado el 2026-11-05 tras la ronda 2 de correcciones del PR #1099.

**Cerrado en este PR (parcial):** el borrado de archivos respeta `legal_hold` y `retention_until`. `StoredFilesService.discard` rechaza con 409 `DOCUMENT_RETAINED` una fila bajo `legal_hold` o con la retención vigente, dentro de una transacción, y en ese caso no borra el objeto de S3 (`5b600f4bf`).

**Fuera de este PR. Es una decisión de alcance, no un bloqueo técnico:**

- **OCR/validación IA con procedencia** (tabla de resultados con `source`/`model`/`confidence`/`file_id`, sin mezclarse con los campos humanos, y con revisión humana). No depende del 9; se aplazó por alcance. La revisión del PR lo acepta fuera solo si Rafael lo deja por escrito.
- **Políticas de retención y purga automática** (quién fija `retention_until`, el job de purga y la UI de `legal_hold`). Hoy solo existe la protección del borrado.
- **Plantillas desde PDF base y generación IA de plantillas.** Dependen del Bloque 9 (render).

**Decisión que necesito de Rafael:** confirmar que OCR, la purga y las plantillas desde PDF base van en el siguiente PR. Si no, decir cuál de ellas debe entrar en este.
