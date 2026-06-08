# Plan — Páginas públicas de documentos legales (versión activa desde BD)

## Context
El footer de la landing pública de Vendix (`vendix-landing.component.html`) tiene tres enlaces legales (Política de Privacidad, Términos de Servicio, Cookies) apuntando a `href="#"` (placeholders muertos). El backend ya tiene un sistema completo de `legal_documents` versionado (`is_active` + `is_system`) y la query `getActiveSystemDocument(type)`, pero su único endpoint público (`/ecommerce/legal/pending`) exige contexto de tienda y no sirve documentos de plataforma por tipo. Objetivo: exponer públicamente la versión activa de cada documento de sistema y renderizarla en páginas públicas enlazadas desde el footer. Decisión del usuario (Fase 3): las tres páginas (Privacidad, Términos, Cookies) se sirven dinámicamente desde BD mediante un visor genérico, reemplazando la página estática actual de Términos y repuntando el checkout.

## General Objective
Cualquier visitante anónimo puede abrir desde el footer de vendix.com las páginas de Términos de Servicio, Política de Privacidad y Cookies, y ver renderizada la versión activa vigente de cada documento legal de plataforma servida desde la base de datos.

## Specific Objectives
1. Existe `GET /api/public/legal/:documentType` (sin auth, rate-limited) que devuelve la versión activa de sistema (`is_active=true`, `is_system=true`, `organization_id=null`, `store_id=null`, no expirada) del tipo solicitado, con campos públicos seguros, y responde 400 si `documentType` no pertenece a `legal_document_type_enum`.
2. Existe un documento de sistema activo `COOKIES_POLICY` sembrado, y el documento `TERMS_OF_SERVICE` activo incluye una sección con `id="pagos-y-reembolsos"` para que el deep-link del checkout siga resolviendo.
3. Un único componente público `LegalDocumentViewerComponent` renderiza el `content` (HTML/markdown) vía `marked` + `DomSanitizer`, mostrando título, versión y fecha de vigencia, con estados de carga/vacío y scroll a `fragment`.
4. Las rutas públicas `legal/privacidad` (PRIVACY_POLICY), `legal/cookies` (COOKIES_POLICY) y `legal/terminos` (TERMS_OF_SERVICE) cargan el visor genérico con el tipo correspondiente.
5. Los tres enlaces del footer de `vendix-landing` usan `routerLink` a las rutas anteriores en lugar de `href="#"`.

## Approach Chosen
Un único visor genérico parametrizado por `documentType` (vía `route.data`) más un endpoint público dedicado en el dominio `public` del backend. Reutiliza la query exacta de `getActiveSystemDocument` y el patrón `marked` + `bypassSecurityTrustHtml` ya presentes. Una sola plantilla cubre los tres tipos (DRY): añadir un cuarto documento legal público en el futuro = una ruta nueva, sin código. El endpoint vive bajo `public/legal` espejando `public/plans` (mismo `@Public()` + `@Throttle`), manteniendo la separación pública/privada que ya existe en el árbol de dominios.

## Alternatives Considered
- Tres componentes separados (terms/privacy/cookies): rechazado — triplica plantillas y lógica de render idénticas; viola DRY y dificulta mantenimiento.
- Reutilizar `/ecommerce/legal/pending`: rechazado — exige `x-store-id` y devuelve "pendientes de aceptar" del cliente, no la versión activa de plataforma por tipo; semántica y scope equivocados.
- Mantener Términos estático y solo añadir Privacidad/Cookies dinámicas: rechazado por el usuario en Fase 3 — quiere las tres servidas desde BD.

## Critical Files
- `apps/backend/src/domains/public/legal/public-legal.controller.ts` — NUEVO. Controlador `@Public()` `GET public/legal/:documentType`.
- `apps/backend/src/domains/public/legal/public-legal.service.ts` — NUEVO. Query de documento activo de sistema + whitelist de campos.
- `apps/backend/src/domains/public/legal/public-legal.module.ts` — NUEVO. Módulo NestJS del feature.
- `apps/backend/src/domains/public/public.module.ts` — EDITAR. Registrar `PublicLegalModule` en `imports`.
- `apps/backend/src/common/errors/error-codes.ts` — EDITAR (si falta). Código de error para tipo de documento inválido / no encontrado.
- `apps/backend/prisma/seeds/legal-documents.seed.ts` — EDITAR. Añadir `COOKIES_POLICY` y sección `pagos-y-reembolsos` en `TERMS_OF_SERVICE`.
- `apps/frontend/src/app/public/legal/services/public-legal.service.ts` — NUEVO. Cliente HTTP del endpoint público.
- `apps/frontend/src/app/public/legal/document-viewer/legal-document-viewer.component.ts` — NUEVO. Visor genérico (standalone, signals).
- `apps/frontend/src/app/public/legal/document-viewer/legal-document-viewer.component.html` — NUEVO. Plantilla del visor.
- `apps/frontend/src/app/routes/public/default.public.routes.ts` — EDITAR. Rutas `legal/privacidad`, `legal/cookies`, repuntar `legal/terminos`.
- `apps/frontend/src/app/public/landing/vendix-landing/vendix-landing.component.html` — EDITAR. `routerLink` en los tres enlaces del footer (líneas ~765-767).
- `apps/frontend/src/app/private/modules/store/subscription/pages/checkout/checkout.component.ts` — REFERENCIA (líneas 414-415). Deep-link `/legal/terminos` + `fragment="pagos-y-reembolsos"` debe seguir funcionando; no se edita si el seed conserva el ancla.

## Reusable Assets
- `apps/backend/src/domains/superadmin/legal-documents/services/legal-documents.service.ts:99` (`getActiveSystemDocument`) — query exacta de versión activa de sistema + descarga S3 si `document_url`. Se replica en el servicio público (sin acoplar el módulo superadmin).
- `apps/backend/src/domains/public/subscriptions/public-plans.controller.ts` — patrón de controlador `@Public()` + `@Throttle({ default: { limit: 100, ttl: 60000 } })` + `ResponseService.success`. Plantilla directa.
- `apps/frontend/src/app/public/ecommerce/components/legal-preview-modal/legal-preview-modal.component.ts:41-49` — patrón `marked.parse()` + `sanitizer.bypassSecurityTrustHtml()` con `computed<SafeHtml>`. Se reutiliza tal cual.
- `marked` v17.0.1 (ya en `apps/frontend/package.json`) — no requiere instalación.
- `apps/frontend/src/app/public/pricing/services/public-plans.service.ts` — patrón de servicio público (`environment.apiUrl` + `HttpClient`). Plantilla del servicio frontend.
- `RouterModule` ya importado en `vendix-landing.component.ts:20` — `routerLink` disponible en la plantilla sin cambios de imports.

## Steps
1. Backend — Servicio público de documentos legales
   Skills: vendix-backend-api, vendix-prisma-scopes, vendix-naming-conventions
   Resources: `none` (sin migración; usa GlobalPrismaService existente)
   Business decision: solo documentos de sistema (`is_system=true`, `organization_id=null`, `store_id=null`) y solo la versión `is_active=true` no expirada son públicos; la respuesta whitelista campos seguros (id, document_type, title, version, content, effective_date) y excluye `created_by_user_id` y metadatos internos, igual que `public-plans` con `cost_*`.
   Why: primero porque el controlador (paso 2) y el frontend (pasos 5-6) consumen este contrato; sin la query lista no hay endpoint.
   Output: `PublicLegalService.getActiveSystemDocument(type)` devolviendo el documento público-safe o `null`, replicando la query de `legal-documents.service.ts:99` con descarga S3 si `document_url`.
   Verification: inspección del diff del archivo nuevo confirmando el `where` exacto (`is_active+is_system+org/store null+expiry`) y el mapeo de campos whitelist.

2. Backend — Controlador público + módulo + registro
   Skills: vendix-backend-api, vendix-backend-auth, vendix-error-handling, vendix-naming-conventions
   Resources: `none`
   Business decision: endpoint público sin JWT (datos legales son públicos) con `@Throttle({ default: { limit: 100, ttl: 60000 } })` anti-scraping; `documentType` se valida contra `legal_document_type_enum` y devuelve 400 con código de error de `error-codes.ts` si es inválido, 404 si no hay versión activa.
   Why: va tras el servicio porque lo inyecta; antes del frontend porque define el contrato HTTP que el cliente consume.
   Output: `GET /api/public/legal/:documentType` (`@Public()`, `@Controller('public/legal')`) registrado en `public.module.ts`, respondiendo `ResponseService.success(doc)`.
   Verification: `curl -s http://localhost:3000/api/public/legal/PRIVACY_POLICY` devuelve 200 con `data.content`; `curl -s http://localhost:3000/api/public/legal/INVALID` devuelve 400.

3. Backend — Seed de COOKIES_POLICY + ancla en TERMS
   Skills: vendix-prisma-seed
   Resources: `npm run db:seed -w apps/backend`
   Business decision: la página de Cookies necesita un documento activo de sistema; el checkout enlaza a `/legal/terminos#pagos-y-reembolsos`, por lo que el contenido activo de `TERMS_OF_SERVICE` debe incluir una sección con `id="pagos-y-reembolsos"` para preservar el deep-link sin tocar el checkout.
   Why: tras el endpoint para poder verificarlo end-to-end con datos reales; el seed es idempotente (`systemUpsert`) y no destructivo.
   Output: nuevo bloque `systemUpsert({ document_type: 'COOKIES_POLICY', ... })` activo y de sistema, y sección `<h2 id="pagos-y-reembolsos">Pagos y Reembolsos</h2>` añadida al `content` de `TERMS_OF_SERVICE`.
   Verification: tras `npm run db:seed -w apps/backend`, `curl -s http://localhost:3000/api/public/legal/COOKIES_POLICY` devuelve 200 con contenido; el `content` de TERMS contiene `id="pagos-y-reembolsos"`.

4. Frontend — Servicio HTTP público
   Skills: vendix-frontend, vendix-naming-conventions
   Resources: `none`
   Business decision: el cliente público no envía headers de tenant ni token; consume `${environment.apiUrl}/public/legal/:type` siguiendo el patrón de `public-plans.service.ts`.
   Why: antes del componente porque éste lo inyecta vía `toSignal`/`httpResource`.
   Output: `PublicLegalService.getDocument(type)` retornando `Observable<LegalDocument>` tipado.
   Verification: `npm run build -w apps/frontend` compila el servicio sin errores de tipos.

5. Frontend — Visor genérico de documento legal
   Skills: vendix-frontend, vendix-zoneless-signals, vendix-frontend-component, vendix-ui-ux, vendix-date-timezone
   Resources: https://marked.js.org/using_advanced (config `gfmHeadingId` para anclas de encabezados)
   Business decision: un solo componente parametrizado por `route.data.documentType` renderiza HTML/markdown saneado con `bypassSecurityTrustHtml`; muestra título/versión/fecha de vigencia (vía utilidades de `vendix-date-timezone`, sin off-by-one), estados de carga y vacío, enlace de regreso al home, y hace scroll al `fragment` de la URL tras render.
   Why: depende del servicio (paso 4); es el núcleo reutilizado por las tres rutas del paso 6.
   Output: `LegalDocumentViewerComponent` standalone con `content = computed<SafeHtml>()`, signals de estado, layout prose responsive consistente con la landing.
   Verification: `npm run zoneless:audit` pasa; build frontend compila; carga manual de `/legal/privacidad` renderiza el contenido.

6. Frontend — Rutas públicas + enlaces del footer
   Skills: vendix-frontend-routing, vendix-frontend, vendix-ui-ux
   Resources: `none`
   Business decision: rutas en español consistentes con `legal/terminos` existente; `legal/terminos` se repunta al visor genérico (`data: { documentType: 'TERMS_OF_SERVICE' }`) reemplazando la página estática sin borrar sus archivos (se dejan huérfanos, no se eliminan); footer usa `routerLink`.
   Why: último porque cablea rutas y UI sobre el visor (paso 5) y el endpoint (paso 2) ya existentes; cierra el flujo de navegación.
   Output: tres entradas de ruta en `default.public.routes.ts` cargando `LegalDocumentViewerComponent` con su `data.documentType`; tres `routerLink` en el footer de `vendix-landing.component.html`.
   Verification: carga manual de `/`, clic en cada enlace del footer navega a `/legal/privacidad`, `/legal/terminos`, `/legal/cookies` y renderiza el documento; `/legal/terminos#pagos-y-reembolsos` desde el checkout hace scroll a la sección.

## End-to-End Verification
1. Backend público vivo: `curl -s http://localhost:3000/api/public/legal/TERMS_OF_SERVICE | jq '.data.version'`, idem `PRIVACY_POLICY` y `COOKIES_POLICY` devuelven 200 con versión; `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/public/legal/FOO` imprime `400`.
2. Verificación de runtime backend con `buildcheck-dev`: revisar logs del contenedor en watch-mode (`docker logs --tail 100 <backend>`) sin errores de arranque tras registrar el módulo.
3. Frontend type-safe: `npm run build -w apps/frontend` finaliza en 0 y `npm run zoneless:audit` pasa.
4. Flujo UI manual: abrir `/`, clicar cada enlace del footer → cada página renderiza título + versión + contenido; desde checkout, `/legal/terminos` + `fragment=pagos-y-reembolsos` ancla en la sección correcta.

## Knowledge Gaps
None.

## Approval Request
This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
