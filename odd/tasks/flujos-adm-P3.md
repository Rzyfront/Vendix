# Flujos adm — P3: externos e inéditos

Objetivo: webhook de entrada por flujo, nodo HTTP con secretos, registro de conectores (sin Google), formularios públicos avanzados, portal de seguimiento externo y registros personalizados (PLAN.md §2 P3). Fuera de alcance por orden de Rafael: conectores de Google (Sheets y Drive, D3).
Rama: `feat/flujos-adm-p3` desde `origin/develop`. Entrega: un PR a develop con commits por requisito. Runner backend: `/tmp/flujos-p3/jest1.sh <spec>` (jest `--runInBand`, config scratch `isolatedModules`, candado para un solo proceso Node pesado a la vez), un spec por invocación. Frontend: `ngc -p tsconfig.buildcheck.json` y Karma acotado al spec tocado, bajo el mismo candado.

## Specs

Historias de la fase (textuales del plan):
- "Como proveedor externo, quiero **llenar un formulario público** (con QR o enlace) para registrarme y subir mis documentos, y ver en qué va mi solicitud, sin tener cuenta en Vendix."
- "Como administrador, quiero que **otro sistema** (la web de la empresa, un CRM o un formulario de Google) **arranque un flujo** en Vendix, para centralizar todo."
- "Como administrador, quiero que una etapa **consulte o envíe datos a un servicio externo**, para integrar lo que Vendix no tiene."
- "Como gerente, quiero gestionar **procesos sobre cosas que Vendix no tiene** (contratos, activos, pólizas, trámites legales) con sus propios campos, para no usar Excel aparte."

Reglas del plan que aplican: R1 "Ninguna acción devuelve éxito sin ejecutar." R5 "Webhooks de entrada firmados por flujo, sin depender de la sesión de un usuario." R6 "Conectores como registro enchufable con esquema, permisos y tests, no controladores gigantes." R7 "Nada de endpoints de desarrollo en las rutas de producción. Todo sigue el aislamiento por tienda."

- **S1 — P3.1.** "**Webhook de entrada por flujo**: URL con secreto y firma HMAC, esquema de entrada validado, idempotencia por clave, límite de tasa (R5)". Criterio: "Un `curl` firmado inicia la solicitud; uno sin firma recibe 401".
  - Historia: Como administrador en el editor (Disparadores), quiero activar el webhook de entrada del flujo y copiar su URL y su secreto, para que la web de la empresa o un CRM inicie solicitudes en Vendix.
  - Pasos: 1) Editor → Disparadores → "Webhook de entrada" → publicar. 2) Integraciones del flujo → "Activar webhook" → copiar URL, secreto (se ve una sola vez) y el ejemplo `curl`. 3) Ejecutar el `curl` firmado con `Idempotency-Key`. 4) Repetirlo con la misma clave. 5) Ejecutarlo sin firma. 6) Mandar un valor de tipo equivocado. 7) Superar el límite por minuto.
  - Se ve: 3) respuesta 201 con la referencia `FLU-…` y la solicitud en la lista con "Iniciada por webhook"; 4) la misma referencia, sin duplicar; 5) 401; 6) 422 con el campo y el motivo; 7) 429. Rotar el secreto invalida el anterior; desactivar responde 404.
  - Notas: `workflow_inbound_hooks` / `workflow_inbound_requests`; firma `X-Vendix-Timestamp` + `X-Vendix-Signature: sha256=<hmac(secreto, "<ts>.<cuerpo crudo>")>` con ventana de 5 min; cuerpo `{"values":{…}}` validado contra los campos declarados; arranque `system` con `started.via = "webhook"`.
- **S2 — P3.2.** "**Nodo HTTP genérico**: método, headers, cuerpo con tokens, secretos guardados por tienda (nunca en el JSON), timeout, reintentos, respuesta mapeada a variables, protección SSRF (lista de bloqueo de IP privadas y metadata)". Criterio: ""Probar esta acción" muestra la respuesta real".
  - Historia: Como administrador en el editor (Acciones de una etapa), quiero una acción "Llamada HTTP" que use el token guardado de mi CRM y guarde la respuesta en campos, y probarla antes de publicar, para integrar lo que Vendix no tiene.
  - Pasos: 1) Integraciones → Secretos → crear `CRM_TOKEN`. 2) Etapa → Acciones → "Llamada HTTP" POST a una URL pública con `Authorization: Bearer {{secrets.CRM_TOKEN}}` y salida `body.id → crm_id`. 3) "Probar esta acción". 4) Publicar e iniciar. 5) Probar contra `http://169.254.169.254/` o `http://127.0.0.1`.
  - Se ve: 3) estado, encabezados y cuerpo reales y los campos que se llenarían; 4) la línea de tiempo "Acción ejecutada · Llamada HTTP" y el campo `crm_id` lleno; 5) "Destino bloqueado: dirección privada o de metadatos". El secreto nunca aparece en la definición, el outbox ni la línea de tiempo; la lista de secretos solo muestra nombres.
  - Notas: acción de registro `vendix.http.request` (outbox, permiso, política de error/reintentos de P2.7), `output` campo ← ruta; `workflow_secrets` cifrado con `EncryptionService`; política de URL de los webhooks salientes (`webhook-url-policy.ts`) con resolución DNS y sin redirecciones; timeout ≤ 30 s; respuesta ≤ 1 MB.
- **S3 — P3.3.** "**Registro enchufable de conectores** (R6). Primera ola: correo saliente con plantilla; correo entrante que crea solicitudes (buzón por tienda); WhatsApp por el canal de la tienda; ~~Google Sheets (añadir/leer fila) y Drive (guardar documento) con OAuth por tienda **(pendiente de D3)**~~; facturación DIAN mediante el módulo propio de Vendix". Criterio: "Cada conector tiene su esquema, su prueba y su página de conexión".
  - Historia: Como administrador en Flujos → Conectores, quiero ver cada conector con su estado de conexión, sus acciones y disparadores, y probarlo, para saber qué puedo usar en mis flujos.
  - Pasos: 1) Abrir Conectores. 2) Correo saliente → "Probar" a mi correo. 3) Correo entrante → en un flujo con disparador "Correo entrante", "Activar buzón" y copiar la dirección; enviar un correo con adjunto. 4) WhatsApp → ver si el canal está conectado y probar una plantilla. 5) DIAN → ver si la facturación electrónica está habilitada. 6) En un flujo, acción "Enviar correo" / "Enviar WhatsApp" / "Emitir factura DIAN".
  - Se ve: una tarjeta por conector (HTTP, Webhook de entrada, Correo saliente, Correo entrante, WhatsApp, Facturación DIAN) con "Conectado / No conectado" y lo que falta; la prueba muestra el resultado real (enviado o el error del proveedor); el correo entrante crea `FLU-…` con asunto y remitente en sus campos y los adjuntos en el expediente.
  - Notas: `WORKFLOW_CONNECTOR_CATALOG` en el contrato; acciones `vendix.email.send`, `vendix.whatsapp.send`, `vendix.invoice.emit_order` con ejecutor real y spec; buzón `workflow_mailboxes` por flujo de la tienda (`flujos-<hex>@<dominio de recepción>`) sobre la tubería SES→SNS→SQS de recepción de documentos.
- **S4 — P3.4.** "**Formularios públicos avanzados**: QR, expiración, multi-paso, subida por partes, captcha y desactivación". Criterio: "Formulario de 3 pasos con adjunto de 50 MB".
  - Historia: Como proveedor externo en el formulario público (enlace o QR), quiero llenar mis datos en 3 pasos y adjuntar un archivo grande, para registrarme sin tener cuenta.
  - Pasos: 1) Editor: etapa inicial con pasos "Empresa", "Contacto", "Documentos" y un campo archivo de hasta 50 MB. 2) Enlace público → fecha de vencimiento, "Exigir captcha", ver y descargar el QR. 3) Abrir el enlace (o escanear el QR). 4) Avanzar y retroceder entre pasos; adjuntar un PDF de 50 MB. 5) Enviar. 6) Desactivar el enlace y recargar.
  - Se ve: barra "Paso 1 de 3"; no deja avanzar con un obligatorio vacío; el adjunto muestra su progreso por partes; el captcha se resuelve solo ("Verificando que no eres un robot…") antes de enviar; tras enviar, la referencia y el enlace de seguimiento; el archivo queda en el expediente; desactivado o vencido → "Este formulario no está disponible".
  - Notas: `form.steps` en el contrato; `workflow_public_links.captcha_required`; captcha de prueba de trabajo propio (reto firmado HMAC, un solo uso); `workflow_upload_sessions` con S3 multipart (partes de 5 MB).
- **S5 — P3.5.** "**Portal de seguimiento externo**: enlace mágico para que el solicitante externo vea el estado y responda lo que le pidan". Criterio: "El proveedor ve "Falta: RUT actualizado" y lo sube desde el enlace".
  - Historia: Como proveedor externo con el enlace de seguimiento, quiero ver en qué va mi solicitud y subir lo que me pidan, para no llamar ni escribir a la empresa.
  - Pasos: 1) Enviar el formulario público con correo de contacto. 2) Abrir el enlace de seguimiento (pantalla de confirmación o correo). 3) El flujo llega a una etapa con el requisito externo "RUT actualizado". 4) Recargar el portal, subir el RUT y escribir una respuesta. 5) Un administrador revoca el enlace.
  - Se ve: referencia, nombre del flujo, estado y etapa actual con fechas; "Falta: RUT actualizado" con botón Subir; tras subirlo, "Recibido" y en el expediente de la solicitud el archivo; la respuesta aparece en la línea de tiempo como "Respuesta del solicitante"; revocado o vencido → "Este enlace no está disponible".
  - Notas: `workflow_tracking_links` (hash del token, vence a 90 días); requisito `upload` con `external: true`; mismo aislamiento por dominio de tienda que el formulario público.
- **S6 — P3.6.** "**Registros personalizados (entidades inéditas)**: el cliente define una colección con sus campos (contratos, activos, pólizas), con lista, detalle, expediente y flujos sobre ella". Criterio: "Crear "Contratos" con fecha de vencimiento y un flujo de renovación que arranca 30 días antes".
  - Historia: Como gerente en Flujos → Registros, quiero crear la colección "Contratos" con sus campos, registrar mis contratos con sus documentos y que el flujo de renovación arranque solo 30 días antes del vencimiento, para no usar Excel aparte.
  - Pasos: 1) Registros → Nueva colección "Contratos" con campos Cliente (texto), Valor (dinero) y Vence (fecha). 2) Crear un contrato que vence en 30 días y subirle el PDF. 3) Flujo "Renovación de contrato" sobre "Contratos" con disparador "30 días antes de Vence" → publicar. 4) Esperar la corrida diaria (en vivo: forzarla). 5) Abrir el contrato.
  - Se ve: la lista de contratos con búsqueda; el detalle con sus campos, su expediente y sus solicitudes; una solicitud "Renovación de contrato" iniciada por "Fecha de registro" con el cliente lleno, una sola vez aunque la corrida se repita; desde el detalle, "Iniciar flujo" con el registro como sujeto.
  - Notas: `workflow_collections` / `workflow_records`; sujeto `custom_record` + `subject.collection`; disparador `record_date` (cron diario en la zona de la tienda, idempotencia por registro y fecha); permisos: colecciones = `store:workflows:design`, registros lectura = `store:workflows:read`, escritura = `store:workflows:manage`.

Riesgo (textual del plan): "Risk: item 2 (endpoints públicos, secretos, SSRF) → verificador independiente." El pipeline lanza la revisión aparte.

## Tasks

| ID | S# | Ruta | Estado | Evidencia |
|---|---|---|---|---|
| T0 | S1–S6 | inline | ✅ | contrato + validador + esquema + migración `20261119090000_workflow_external_records`; validador P3 9/9, validador 92/92, P2 16/16, paridad 10/10, scoping 182/182 |
| T1 | S1, S3 (correo entrante) | delegada (escritor, superficie disjunta, paralelo) | pendiente | |
| T2 | S2 | delegada (escritor, superficie disjunta, paralelo) | pendiente | |
| T3 | S3 (correo saliente, WhatsApp, DIAN, página de conectores) | delegada (escritor, superficie disjunta, paralelo) | pendiente | |
| T4 | S4, S5 | delegada (escritor, superficie disjunta, paralelo) | pendiente | |
| T5 | S6 | delegada (escritor, superficie disjunta, paralelo) | pendiente | |
| T6 | todos | inline | pendiente | integración, verificación en vivo :3099 sobre `vendix_flujos` |

Ruta: el disparador Writer se cumple (cinco unidades independientes con superficies disjuntas, cada una con varios archivos y >100 líneas, lanzadas juntas). El padre es dueño del contrato, el esquema, la migración, el registro de scoping y git.

## Log

- L1 (2026-11-07) Pedido: "Implementa TODA la fase P3 de PLAN.md §2 (todas sus filas y sus historias), cerrando cada requisito con código, specs y verificación. Excluye los conectores de Google (Sheets y Drive) por orden de Rafael; el resto de P3.3 sí va."
- L2 Decisiones aditivas (sin Rafael, opción más simple): buzón de correo entrante por flujo dentro de la tienda (no uno compartido, para no adivinar qué flujo arranca); captcha propio de prueba de trabajo (no hay proveedor de captcha en el repo ni llaves); conectores = acciones del registro existente agrupadas en `WORKFLOW_CONNECTOR_CATALOG` (mismo outbox, permisos e idempotencia); el WhatsApp saliente usa plantillas aprobadas (fuera de la ventana de 24 h Meta no acepta texto libre); la subida por partes es del formulario público y del portal de seguimiento (la subida autenticada sigue ≤ 25 MB).
