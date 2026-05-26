## Context

El flujo actual de creación de Anuncios ya genera imágenes con IA, pero obliga el pensamiento hacia productos/imágenes de producto y se siente más como formulario que como asistente. El nuevo flujo debe servir también para destacar una tienda, un servicio, una marca, un QR, un lanzamiento o un mensaje general, sin convertir la creación en un proceso largo. La mejora buscada es un wizard corto, conversacional y rápido que recoja solo lo valioso, sugiera un prompt profesional, genere un post escrito listo para publicar y permita generar el anuncio con los recursos disponibles.

## General Objective

Transformar la creación de Anuncios en un wizard conversacional de 3 pasos que permita crear piezas de marketing con IA de forma rápida, con productos y recursos visuales opcionales, imagen generada y post escrito persistido por anuncio.

## Specific Objectives

1. Permitir anuncios sin producto obligatorio, manteniendo productos como contexto opcional cuando aporten valor.
2. Reorganizar la pantalla en un wizard corto: intención, recursos opcionales, formato/prompt/generación.
3. Agregar una acción "Sugerir anuncio" que use una AI Application textual especializada para convertir el brief del usuario en un prompt profesional de flyer/banner/story.
4. Generar un post escrito para cada anuncio creado usando toda la información recolectada: intención, tienda, productos opcionales, recursos, formato, CTA, brief y prompt final.
5. Persistir el post escrito en el anuncio y mostrarlo en el modal de detalle/listado, con acción para copiarlo.
6. Reutilizar recursos existentes de tienda y productos: logo, sliders, QR si existen en settings, imágenes de productos seleccionados y recursos subidos para el anuncio.
7. Si el usuario selecciona una imagen QR como contexto, insertar ese QR idéntico en la imagen final en una zona estratégica, profesional y legible, sin estorbar el diseño publicitario.
8. Mantener la generación actual con `marketing_ad_image_generator`, SSE, cuota diaria, S3 y estados `draft/processing/completed/failed`.
9. Verificar que la experiencia sea mobile-first, zoneless-safe y rápida de completar en menos de 1 minuto para casos simples.

## Approach Chosen

Implementar un wizard compacto de 3 pasos dentro de `AnuncioCreatePageComponent`, respaldado por pequeños ajustes de contrato en backend: `product_ids` pasa a ser opcional, se agregan campos de brief/intención/canal/CTA, se aceptan referencias visuales no-producto ya guardadas en S3, y se crea un endpoint de sugerencia de prompt que llama `AIEngineService.run('marketing_ad_prompt_specialist', ...)`. Al crear cualquier anuncio, el backend también llamará una AI Application experta en copy de marketing, `marketing_ad_post_copywriter`, para generar un post escrito listo para publicar y guardarlo en el creative. Si entre las imágenes de contexto hay un QR, el sistema no debe pedirle al modelo que lo redibuje: debe generar la imagen sin alterar el QR y luego componer el QR original encima con `sharp`, respetando tamaño mínimo, contraste, margen/quiet zone y ubicación profesional. El wizard queda definido así: `Idea` pregunta qué quiere lograr el usuario y permite elegir intención/canal con chips rápidos; `Recursos` permite usar logo, sliders, QR, productos opcionales y recursos subidos sin obligar catálogo; `Crear` concentra formato, brief, sugerencia IA, prompt editable, generación, post escrito y preview. Este enfoque reutiliza la generación actual y evita crear un chat persistente o un constructor de campañas completo antes de validar el valor real del flujo.

## Alternatives Considered

- Chat completo estilo conversación libre: rechazado porque puede sentirse más largo, menos predecible y más difícil de validar que un wizard corto.
- Wizard largo de 6-8 pasos: rechazado porque el usuario pidió rapidez y baja fricción.
- Mantener producto obligatorio: rechazado porque muchos anuncios pueden destacar tienda, servicio, marca, QR, evento o mensaje general.
- Crear una nueva generación end-to-end separada: rechazado porque ya existe `marketing_ad_image_generator`, streaming, S3, cuotas y persistencia.
- Guardar el post escrito solo dentro de `generation_metadata`: rechazado porque el usuario debe verlo y copiarlo desde el modal; conviene una columna explícita y estable en el anuncio.
- Pedir al modelo de imagen que reproduzca el QR dentro del render: rechazado porque los modelos pueden deformar códigos QR; la utilidad del QR exige overlay exacto del asset original.

## Critical Files

- `apps/backend/prisma/schema.prisma` — agregar el campo persistido del post escrito en `marketing_ad_creatives`.
- `apps/backend/prisma/migrations/20260526000000_add_marketing_ad_post_copy/migration.sql` — agregar columna idempotente para el post escrito sin tocar datos existentes.
- `apps/frontend/src/app/private/modules/store/marketing/anuncios/pages/anuncio-create-page.component.ts` — reemplazar el flujo actual por el wizard conversacional corto.
- `apps/frontend/src/app/private/modules/store/marketing/anuncios/anuncios.interface.ts` — ampliar DTOs frontend para brief, intención, referencias visuales y sugerencia de prompt.
- `apps/frontend/src/app/private/modules/store/marketing/anuncios/anuncios.service.ts` — agregar llamada HTTP para sugerir prompt y carga/subida de recursos de anuncio.
- `apps/frontend/src/app/private/modules/store/marketing/anuncios/anuncios.component.ts` — mostrar el post escrito en el modal de detalle del anuncio y permitir copiarlo.
- `apps/frontend/src/app/private/modules/store/products/components/product-image-source-modal.component.ts` — reutilizar el selector de subir/foto/URL para recursos del anuncio cuando sea práctico.
- `apps/frontend/src/app/core/store/store-settings/store-settings.facade.ts` — leer branding/ecommerce settings para recursos de tienda disponibles.
- `apps/frontend/src/app/shared/components/icon/icons.registry.ts` — registrar iconos faltantes usados por el wizard.
- `apps/backend/src/domains/store/marketing-ad-creatives/dto/create-marketing-ad-creative.dto.ts` — permitir productos opcionales y validar nuevos campos del brief/referencias.
- `apps/backend/src/domains/store/marketing-ad-creatives/marketing-ad-creatives.controller.ts` — exponer endpoint de sugerencia de prompt.
- `apps/backend/src/domains/store/marketing-ad-creatives/marketing-ad-creatives.service.ts` — armar contexto de tienda/productos/recursos, guardar referencias y ejecutar las AI Applications de prompt y post escrito.
- `apps/backend/src/domains/upload/dto/upload-entity-type.enum.ts` — agregar tipo de upload para recursos temporales/permanentes de marketing si se soporta subida directa.
- `apps/backend/src/domains/upload/upload.controller.ts` — enrutar uploads de recursos de marketing a un path S3 store-scoped.
- `apps/backend/src/common/helpers/s3-path.helper.ts` — reutilizar o extender path de `marketing/anuncios` para recursos de referencia.
- `apps/backend/src/common/config/image-presets.ts` — reutilizar `MARKETING_AD` para assets subidos y generados.
- `apps/backend/src/common/services/s3.service.ts` — reutilizar lectura/subida y, si falta helper adecuado, soportar composición exacta de QR antes de guardar la imagen final.
- `apps/backend/prisma/seeds/ai-engine-apps.seed.ts` — registrar o actualizar `marketing_ad_prompt_specialist` y `marketing_ad_post_copywriter`.

## Reusable Assets

- `apps/frontend/src/app/private/modules/store/marketing/anuncios/pages/anuncio-create-page.component.ts` — ya contiene generación IA/manual, selección de productos, galería, SSE y preview.
- `apps/frontend/src/app/private/modules/store/marketing/anuncios/anuncios.service.ts` — ya encapsula CRUD, proxy de imágenes de producto y `EventSource` de generación.
- `apps/backend/src/domains/store/marketing-ad-creatives/marketing-ad-creatives.service.ts` — ya valida productos/imágenes, crea el creative, genera imagen vía AI Engine, guarda en S3 y firma URLs.
- `apps/backend/src/ai-engine/ai-engine.service.ts` — usar `run()` para el prompt specialist y mantener configuración/logging/costos/rate-limit.
- `apps/frontend/src/app/core/store/store-settings/store-settings.facade.ts` — expone settings de branding/ecommerce para detectar logo, sliders y QR de tienda.
- `apps/frontend/src/app/private/modules/store/products/services/products.service.ts` — búsqueda/detalle de productos e imágenes existentes.
- `apps/frontend/src/app/private/modules/store/products/components/product-image-source-modal.component.ts` — ya soporta subir archivo, cámara, URL y recorte como data URL.
- `apps/backend/src/domains/upload/upload.controller.ts` — ya soporta upload S3 multipart y preview seguro desde URL.
- `apps/backend/src/common/services/s3.service.ts` — ya usa `sharp` para optimización, thumbnails y uploads de imagen; se puede reutilizar para componer QR exacto.
- `apps/backend/package.json` — ya incluye `sharp`, por lo que no hace falta agregar dependencia para composición de imagen.
- `apps/frontend/src/app/shared/components/steps-line/steps-line.component.ts` — indicador de pasos reutilizable para el wizard.
- `apps/frontend/src/app/shared/components/input-buttons/input-buttons.component.ts` — chips/segmentos reutilizables para intención, formato, canal y estilo.
- `apps/frontend/src/app/shared/components/card/card.component.ts` — contenedores existentes para mantener consistencia visual.
- `apps/frontend/src/app/shared/components/button/button.component.ts` — acciones con iconos/loading.
- `apps/frontend/src/app/shared/components/textarea/textarea.component.ts` — brief y prompt editable.
- `apps/frontend/src/app/shared/components/inputsearch/inputsearch.component.ts` — búsqueda de productos sin inventar un buscador nuevo.

## Steps

1. Agregar persistencia del post escrito
   Skills: vendix-prisma, vendix-prisma-schema, vendix-prisma-migrations, vendix-backend, vendix-naming-conventions
   Resources: `npm run db:migrate:dev -w apps/backend -- --name add_marketing_ad_post_copy`, `npm run prisma:generate -w apps/backend`
   Business decision: El post escrito es parte del anuncio y debe guardarse como dato propio del creative, no como metadata interna del modelo de imagen.
   Why: La UI de detalle necesita mostrar y copiar el post de forma estable después de recargar la lista o consultar un anuncio antiguo.
   Output: Campo `post_copy` o equivalente en `marketing_ad_creatives`, migración idempotente y Prisma Client actualizado.
   Verification: Revisar `apps/backend/prisma/migrations/20260526000000_add_marketing_ad_post_copy/migration.sql` y confirmar que solo agrega columna nullable, sin mutar ni borrar datos existentes.

2. Ajustar contrato de anuncio para flujo flexible
   Skills: vendix-backend, vendix-backend-api, vendix-validation, vendix-s3-storage, vendix-ai-engine
   Resources: `rg -n "CreateMarketingAdCreativeDto|buildVariables|resolveSelectedImages|marketing_ad_image_generator" apps/backend/src apps/frontend/src/app/private/modules/store/marketing/anuncios`
   Business decision: Un anuncio no requiere producto; productos, precios e imágenes son contexto opcional y solo se usan cuando el usuario los selecciona.
   Why: El backend debe aceptar el nuevo comportamiento antes de que el frontend pueda ofrecer un wizard rápido sin bloquear al usuario.
   Output: DTOs frontend/backend con `product_ids` opcional, campos de intención/canal/CTA/estilo/brief, referencias visuales no-producto controladas y campo de respuesta `post_copy`.
   Verification: Revisar diff de DTOs y confirmar que una creación con `product_ids: []` o sin `product_ids` pasa validación, mientras referencias visuales inseguras siguen siendo rechazadas.

3. Crear sugerencia de prompt con AI Application textual
   Skills: vendix-ai-engine, vendix-ai-platform-core, vendix-backend-api, vendix-permissions, vendix-validation
   Resources: `rg -n "aiEngine.run\\(|ai_engine_applications|default-ai|prompt_template" apps/backend/src apps/backend/prisma`
   Business decision: "Sugerir anuncio" debe usar una AI Application configurable, no un prompt hardcodeado dentro del componente.
   Why: La generación de prompt debe beneficiarse de provider config, logging, costos, sanitización y administración super-admin antes de alimentar la generación de imagen.
   Output: Endpoint `POST /store/marketing/ad-creatives/suggest-prompt` que llama `AIEngineService.run('marketing_ad_prompt_specialist', variables)` y devuelve prompt sugerido, título sugerido y quizá notas breves.
   Verification: Probar con `curl -X POST http://localhost:3000/api/store/marketing/ad-creatives/suggest-prompt -H 'Authorization: Bearer $STORE_TOKEN' -H 'Content-Type: application/json' --data '{"intent":"highlight_store","format":"story","brief":"Quiero destacar mi tienda"}'` y confirmar respuesta textual controlada.

4. Crear post escrito por anuncio con AI Application experta
   Skills: vendix-ai-engine, vendix-ai-platform-core, vendix-backend, vendix-validation, vendix-s3-storage
   Resources: `rg -n "marketing_ad_prompt_specialist|marketing_ad_image_generator|ai-engine-apps.seed|generation_metadata" apps/backend/src apps/backend/prisma`
   Business decision: Cada anuncio creado debe incluir un texto publicable generado con toda la información recolectada, independiente de si el objetivo es descuento, tienda, servicio, producto, QR o novedad.
   Why: El usuario necesita salir con imagen y copy listo; crear el post en backend garantiza que quede guardado aunque cierre la pantalla después de generar.
   Output: AI Application `marketing_ad_post_copywriter` que devuelve un post breve listo para redes/WhatsApp/ecommerce, guardado en `marketing_ad_creatives.post_copy` para anuncios IA y manuales cuando exista información suficiente.
   Verification: Crear un anuncio con y sin producto y confirmar en respuesta API que `post_copy` existe, no excede el límite definido y usa intención/canal/CTA sin inventar descuentos cuando el usuario no los pidió.

5. Reutilizar galería de recursos sin hacerla pesada
   Skills: vendix-frontend, vendix-zoneless-signals, vendix-frontend-state, vendix-s3-storage, vendix-settings-system
   Resources: `rg -n "branding|ecommerce|qr_code|slider|logo_url|StoreSettingsFacade" apps/frontend/src/app apps/backend/src/domains/store/settings`
   Business decision: La galería inicial muestra recursos de tienda y solo carga imágenes de producto cuando el usuario decide seleccionar productos.
   Why: Esto mantiene rápido el flujo y evita mostrar todas las imágenes de catálogo en una pantalla que no siempre necesita productos.
   Output: Modelo de recursos visuales con logo, sliders, QR si existe, productos seleccionados y recursos subidos/foto/URL, todos con selección opcional y tipo de recurso distinguible (`logo`, `slider`, `qr`, `product`, `uploaded`).
   Verification: En la UI, abrir el paso de recursos sin productos debe mostrar recursos de tienda o estado vacío útil; seleccionar productos debe agregar sus imágenes sin recargar toda la pantalla.

6. Preservar QRs seleccionados como overlay exacto
   Skills: vendix-backend, vendix-s3-storage, vendix-ai-engine, vendix-validation
   Resources: `rg -n "sharp|uploadBase64|saveGeneratedImage|buildReferenceImages|qr_code_data_url|online_purchase_qr_code" apps/backend/src apps/frontend/src/app`
   Business decision: Un QR seleccionado debe quedar idéntico y escaneable; la IA puede diseñar el anuncio, pero no debe recrear ni deformar el código.
   Why: Los QRs pierden accesibilidad si el modelo los altera, los tapa, los reduce demasiado o los mezcla con el fondo.
   Output: Flujo backend que identifica recursos `qr`, excluye el QR de la renderización directa cuando convenga, genera la imagen base, compone el QR original con `sharp` en una esquina o zona de baja interferencia, agrega fondo/quiet zone si hace falta, mantiene tamaño mínimo relativo por formato y guarda la imagen final compuesta en S3.
   Verification: Generar anuncios con QR de tienda y QR de producto en formatos `square`, `story` y `landscape`; confirmar visualmente que el QR queda idéntico, con margen suficiente, contraste alto, sin tapar producto/texto principal y sigue siendo escaneable desde la imagen final.

7. Rediseñar la pantalla como wizard conversacional de 3 pasos
   Skills: vendix-frontend, vendix-frontend-component, vendix-angular-forms, vendix-zoneless-signals, vendix-frontend-icons, vendix-ui-ux
   Resources: `apps/frontend/scripts/zoneless-audit.sh`
   Business decision: El usuario completa lo mínimo: qué quiere lograr, qué recursos usar y formato/prompt; todo lo demás debe ser opcional o sugerido por IA.
   Why: Este paso convierte la intención de producto en experiencia real y reduce fricción frente al formulario actual.
   Output: `AnuncioCreatePageComponent` con pasos claramente definidos. `Idea`: mensaje corto de bienvenida, selección de objetivo (`Destacar tienda`, `Destacar producto/servicio`, `Anunciar novedad`, `Invitar a comprar/contactar`, `Promoción/descuento`, `Usar QR`) y campo breve "cuéntame qué quieres comunicar". `Recursos`: galería de tienda con logo/sliders/QR, búsqueda opcional de productos/servicios que al seleccionarse carga sus imágenes, y acción para subir/tomar/cargar recurso desde URL; cuando se seleccione un QR, mostrar ayuda breve indicando que se insertará legible en la pieza final. `Crear`: selector de formato (`1:1`, `9:16`, `16:9`), estilo visual opcional, prompt editable, botón "Sugerir anuncio", resumen del post escrito cuando ya exista, botón "Generar anuncio", preview de stream y acciones finales.
   Verification: Ejecutar `apps/frontend/scripts/zoneless-audit.sh` y revisar visualmente que cada paso tiene una decisión principal, que se puede avanzar sin producto, que productos solo se cargan al buscarlos/seleccionarlos y que no se introducen `@Input/@Output`, `EventEmitter`, `NgZone`, `*ngIf/*ngFor` nuevos ni bindings de formulario inseguros.

8. Mostrar post escrito en el modal de detalle
   Skills: vendix-frontend, vendix-frontend-component, vendix-zoneless-signals, vendix-frontend-icons, vendix-ui-ux
   Resources: `rg -n "selectedAnuncio|copyImage|downloadImage|shareImage|modal" apps/frontend/src/app/private/modules/store/marketing/anuncios/anuncios.component.ts`
   Business decision: Al ver un anuncio, el usuario debe ver no solo la imagen, sino también el post escrito generado para publicarlo o copiarlo.
   Why: El valor del copy se pierde si solo queda disponible durante creación; el modal de detalle es donde el usuario reutiliza el anuncio después.
   Output: Modal de anuncio con sección "Post sugerido" o equivalente, texto completo, botón copiar, y fallback claro cuando un anuncio antiguo aún no tenga `post_copy`.
   Verification: Abrir un anuncio desde `/admin/marketing/anuncios`, confirmar que el modal muestra imagen, detalles, productos y `post_copy`, y que copiar deja el texto en clipboard.

9. Integrar generación actual con el nuevo brief
   Skills: vendix-ai-engine, vendix-ai-streaming, vendix-s3-storage, vendix-backend, vendix-frontend-state
   Resources: `docker logs --tail 40 vendix_backend`, `docker logs --tail 40 vendix_frontend`
   Business decision: La imagen final sigue generándose con `marketing_ad_image_generator`; las nuevas AI Applications textuales mejoran el prompt y crean el post escrito sin reemplazar la tubería de imagen, y los QRs seleccionados se componen después como assets exactos.
   Why: Mantener la tubería existente reduce riesgo y conserva cuotas, streaming, estados, S3 y lista de anuncios.
   Output: Crear anuncio desde el wizard genera draft con `post_copy`, inicia SSE, muestra progreso/preview, compone QR exacto cuando aplique, guarda resultado y permite editar detalles/copiar/descargar como hoy.
   Verification: Flujo manual en `http://localhost:4200/admin/marketing/anuncios/create`: crear un anuncio sin producto, sugerir prompt, generar imagen, ver post escrito, generar otro con QR seleccionado, comprobar QR visible/escaneable, ver estado completado y volver a la lista.

10. Verificar runtime de desarrollo
    Skills: buildcheck-dev, vendix-frontend, vendix-backend
    Resources: `docker ps`, `docker logs --tail 40 vendix_backend`, `docker logs --tail 40 vendix_frontend`, `docker logs --tail 40 vendix_postgres`
    Business decision: El cambio solo queda listo si frontend, backend y base de datos no muestran errores relevantes en watch-mode.
    Why: El wizard cruza template Angular, DTOs NestJS, AI Engine, S3 y SSE; los logs dev son la verificación obligatoria del repo.
    Output: Implementación verificada con contenedores sanos y sin errores relevantes.
    Verification: `docker ps` muestra contenedores activos y los tres comandos de logs no reportan errores nuevos de compilación, runtime, Prisma, template o TypeScript.

## End-to-End Verification

1. Crear anuncio sin producto desde `http://localhost:4200/admin/marketing/anuncios/create`, seleccionar intención "Destacar tienda", formato `9:16`, sugerir prompt y generar.
2. Crear anuncio con un producto opcional, confirmar que sus imágenes aparecen solo después de seleccionarlo y que el prompt sugerido usa su nombre/descripción cuando existen.
3. Confirmar que cada anuncio nuevo queda con `post_copy` generado por `marketing_ad_post_copywriter` y que el texto no inventa ofertas/precios cuando no fueron indicados.
4. Probar un recurso de tienda o subido como referencia y confirmar que el backend guarda S3 key, no URL firmada, cuando aplica.
5. Seleccionar un QR de tienda o producto, generar el anuncio y confirmar que el QR final es el asset original compuesto con buena legibilidad, quiet zone, contraste y ubicación no invasiva.
6. Confirmar que el stream SSE llega a `completed` o a un `error` controlado y que la lista `/admin/marketing/anuncios` muestra el creative actualizado.
7. Abrir el modal de detalle desde `/admin/marketing/anuncios`, confirmar que se ve el post escrito completo y que el botón copiar funciona.
8. Ejecutar `apps/frontend/scripts/zoneless-audit.sh`, `npm run prisma:generate -w apps/backend`, `docker ps`, `docker logs --tail 40 vendix_backend`, `docker logs --tail 40 vendix_frontend` y `docker logs --tail 40 vendix_postgres`.

## Knowledge Gaps

None.

## Approval Request

This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
