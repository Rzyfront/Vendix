## Context
La portada pÃºblica responde200 pero entrega un app-root sin texto/H1. El prerender universal es neutral intencionalmente para impedir que marketing se filtre a tiendas. El usuario autorizÃ³ el16oct desarrollar y enviar PR, dejando revisiÃ³n/publicaciÃ³n a Rafa. Esta primera entrega prepara y valida un artefacto separado; no activa selecciÃ³n edge ni corrige producciÃ³n por sÃ­ sola.

## General Objective
Generar una vista previa HTML real de marketing sin alterar el documento compartido ni publicar pÃ¡ginas.

## Specific Objectives
1. Reutilizar la landing existente en HTML inicial con H1/enlaces y sin inventar contenido.
2. Rechazar la generaciÃ³n si falla el catÃ¡logo pÃºblico de planes, evitando su fallback curado.
3. Mantener build/deploy normales y guÃ­as desactivadas.
4. Probar un selector por host/path exactos sin conectarlo a AWS.

## Approach Chosen
ConfiguraciÃ³n Angular opt-in marketing-preview con entrada servidor e Ã­ndice separados, artefacto noindex y salida independiente. El cliente conserva main.ts normal; ngSkipHydration solo en el documento preview acepta reemplazo CSR, no promete hidrataciÃ³n completa. CI crea y conserva el artefacto sin S3/AWS.

## Alternatives Considered
- Forzar VENDIX_LANDING en main.server universal: rechazado por bleed previo.
- SSR por solicitud: requiere infraestructura nueva no presente en el despliegue actual.
- Copiar precios o textos a otra landing: rechazado por divergencia editorial.

## Critical Files
- apps/frontend/angular.json
- apps/frontend/package.json
- apps/frontend/src/main.marketing-preview.server.ts
- apps/frontend/src/marketing-preview-plans.ts
- apps/frontend/src/index.marketing-preview.html
- apps/frontend/scripts/marketing-host-selector.cjs
- apps/frontend/scripts/marketing-preview.test.cjs
- apps/frontend/scripts/check-marketing-preview.cjs
- .github/workflows/marketing-preview.yml
- apps/frontend/marketing-preview/README.md

## Reusable Assets
- VendixLandingComponent: fuente real de contenido, estilos y enlaces.
- appConfig: dependencias HTTP/Store/Router sin cambiar el initializer universal.
- publicPlansService: endpoint pÃºblico, con timeout y bloqueo de serializaciÃ³n solo en preview.
- main.ts: navegaciÃ³n cliente y resoluciÃ³n de dominio existentes.

## Steps
1. Preparar artefacto separado.
   Skills: vendix-frontend, vendix-frontend-component, vendix-zoneless-signals, vendix-monorepo-workspaces.
   Resources: https://v20.angular.dev/guide/hydration; Angular CLI en CI npm run build:marketing-preview -w apps/frontend.
   Business decision: solo portada; no guÃ­as ni publicaciÃ³n; no precios de fallback.
   Why: primero se necesita un documento revisable sin tocar tenants.
   Output: dist/marketing-preview/browser separado y noindex.
   Verification: node apps/frontend/scripts/check-marketing-preview.cjs tras ambas compilaciones CI.
2. Aislar selecciÃ³n por host y ruta.
   Skills: vendix-app-architecture, vendix-naming-conventions.
   Resources: node --test apps/frontend/scripts/marketing-preview.test.cjs.
   Business decision: Ãºnicamente apex/www exactos y GET/HEAD raÃ­z; todo otro request conserva ruta actual.
   Why: antes de cualquier activaciÃ³n debe existir un contrato probado contra mezcla de hosts.
   Output: funciÃ³n pura candidata sin asociaciÃ³n CloudFront.
   Verification: casos felices, rutas errÃ³neas, hosts maliciosos y alternancia de tenants.
3. Revisar y entregar.
   Skills: git-workflow, pr-code-review, buildcheck-dev, how-to-test.
   Resources: gh pr create; CI Marketing HTML preview; gh pr checks.
   Business decision: Rafa revisa y publica; sin merge/deploy automÃ¡tico. Registro local reemplaza memoria atribuida mientras el runtime no tenga identidad registrada.
   Why: CI valida compilaciÃ³n sin agotar RAM local y produce evidencia revisable.
   Output: PR y artefacto CI; lÃ­mites y rollback documentados.
   Verification: diffcheck, testsNode, build normal y preview en CI; revisiÃ³n independiente con hallazgos corregidos.

## End-to-End Verification
1. CI produce artefacto normal y separado y ejecuta check-marketing-preview.cjs sobre ambos.
2. Playwright MCP local sobre vhost autorizado: verificar visibilidad sin JS y sustituciÃ³n CSR, navegaciÃ³n y ausencia duplicados/errores. Pendiente si el entorno local no estÃ¡ disponible; no afirmar E2E completo por compilar.
3. node --test apps/frontend/scripts/marketing-preview.test.cjs prueba matriz host/path sin producciÃ³n.

## Knowledge Gaps
- ConfiguraciÃ³n real CloudFront no disponible: AWS CLI NoCredentials; selector no se instala. Rafa debe comprobar asociaciones existentes/cache antes de una activaciÃ³n separada.
- ngSkipHydration renuncia a hidrataciÃ³n del preview; medir transiciÃ³n y paridad antes de producciÃ³n. JSON-LD SSR y metadata definitiva son tareas posteriores, no cubiertas.

## Approval Request
This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
