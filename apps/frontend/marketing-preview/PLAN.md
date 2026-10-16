## Context
La portada pública responde200 pero entrega un app-root sin texto/H1. El prerender universal es neutral intencionalmente para impedir que marketing se filtre a tiendas. El usuario autorizó el16oct desarrollar y enviar PR, dejando revisión/publicación a Rafa. Esta primera entrega prepara y valida un artefacto separado; no activa selección edge ni corrige producción por sí sola.

## General Objective
Generar una vista previa HTML real de marketing sin alterar el documento compartido ni publicar páginas.

## Specific Objectives
1. Reutilizar la landing existente en HTML inicial con H1/enlaces y sin inventar contenido.
2. Rechazar la generación si falla el catálogo público de planes, evitando su fallback curado.
3. Mantener build/deploy normales y guías desactivadas.
4. Probar un selector por host/path exactos sin conectarlo a AWS.

## Approach Chosen
Configuración Angular opt-in marketing-preview con entrada servidor e índice separados, artefacto noindex y salida independiente. El cliente conserva main.ts normal; ngSkipHydration solo en el documento preview acepta reemplazo CSR, no promete hidratación completa. CI crea y conserva el artefacto sin S3/AWS.

## Alternatives Considered
- Forzar VENDIX_LANDING en main.server universal: rechazado por bleed previo.
- SSR por solicitud: requiere infraestructura nueva no presente en el despliegue actual.
- Copiar precios o textos a otra landing: rechazado por divergencia editorial.

## Critical Files
- apps/frontend/angular.json
- apps/frontend/package.json
- apps/frontend/src/main.marketing-preview.server.ts
- apps/frontend/src/index.marketing-preview.html
- apps/frontend/scripts/marketing-host-selector.cjs
- apps/frontend/scripts/marketing-preview.test.cjs
- apps/frontend/scripts/check-marketing-preview.cjs
- .github/workflows/marketing-preview.yml
- apps/frontend/marketing-preview/README.md

## Reusable Assets
- VendixLandingComponent: fuente real de contenido, estilos y enlaces.
- appConfig: dependencias HTTP/Store/Router sin cambiar el initializer universal.
- publicPlansService: endpoint público, con timeout y bloqueo de serialización solo en preview.
- main.ts: navegación cliente y resolución de dominio existentes.

## Steps
1. Preparar artefacto separado.
   Skills: vendix-frontend, vendix-frontend-component, vendix-zoneless-signals, vendix-monorepo-workspaces.
   Resources: https://v20.angular.dev/guide/hydration; Angular CLI en CI npm run build:marketing-preview -w apps/frontend.
   Business decision: solo portada; no guías ni publicación; no precios de fallback.
   Why: primero se necesita un documento revisable sin tocar tenants.
   Output: dist/marketing-preview/browser separado y noindex.
   Verification: node apps/frontend/scripts/check-marketing-preview.cjs tras ambas compilaciones CI.
2. Aislar selección por host y ruta.
   Skills: vendix-app-architecture, vendix-naming-conventions.
   Resources: node --test apps/frontend/scripts/marketing-preview.test.cjs.
   Business decision: únicamente apex/www exactos y GET/HEAD raíz; todo otro request conserva ruta actual.
   Why: antes de cualquier activación debe existir un contrato probado contra mezcla de hosts.
   Output: función pura candidata sin asociación CloudFront.
   Verification: casos felices, rutas erróneas, hosts maliciosos y alternancia de tenants.
3. Revisar y entregar.
   Skills: git-workflow, pr-code-review, buildcheck-dev, how-to-test.
   Resources: gh pr create; CI Marketing HTML preview; gh pr checks.
   Business decision: Rafa revisa y publica; sin merge/deploy automático. Registro local reemplaza memoria atribuida mientras el runtime no tenga identidad registrada.
   Why: CI valida compilación sin agotar RAM local y produce evidencia revisable.
   Output: PR y artefacto CI; límites y rollback documentados.
   Verification: diffcheck, testsNode, build normal y preview en CI; revisión independiente con hallazgos corregidos.

## End-to-End Verification
1. CI produce artefacto normal y separado y ejecuta check-marketing-preview.cjs sobre ambos.
2. Playwright MCP local sobre vhost autorizado: verificar visibilidad sin JS y sustitución CSR, navegación y ausencia duplicados/errores. Pendiente si el entorno local no está disponible; no afirmar E2E completo por compilar.
3. node --test apps/frontend/scripts/marketing-preview.test.cjs prueba matriz host/path sin producción.

## Knowledge Gaps
- Configuración real CloudFront no disponible: AWS CLI NoCredentials; selector no se instala. Rafa debe comprobar asociaciones existentes/cache antes de una activación separada.
- ngSkipHydration renuncia a hidratación del preview; medir transición y paridad antes de producción. JSON-LD SSR y metadata definitiva son tareas posteriores, no cubiertas.

## Approval Request
This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
