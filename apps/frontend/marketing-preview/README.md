# Vista previa HTML comercial aislada

Esta entrega NO publica la portada SSR, NO cambia S3/CloudFront y NO activa las guías. Es el primer paso verificable de TECH02: prepara el documento que luego se podrá servir únicamente en marketing.

## Generación y comprobación

CI Marketing HTML preview ejecuta el build normal y `npm run build:marketing-preview -w apps/frontend`. Salida separada `apps/frontend/dist/marketing-preview/browser/`, descargable como artefacto7d. Prueba Node: `node --test apps/frontend/scripts/marketing-preview.test.cjs`. No ejecutar builds locales automáticamente; buildcheck-dev conserva esa regla.

El bootstrap de servidor renderiza el mismo VendixLandingComponent, no una copia del contenido. Reutiliza appConfig para sus dependencias y añade ruta vacía únicamente en la entrada preview. El catálogo público se consulta sin credenciales a environment.apiUrl/public/plans con timeout10s; La consulta y validación antes del bootstrap rechaza una respuesta fallida o vacía para que la landing no publique su fallback curado. El build depende de disponibilidad de ese API público; si falla, no hay artefacto validado ni despliegue. No son consultas de tiendas privadas.

El índice preview lleva noindex,nofollow. Su raíz ngSkipHydration hace que el cliente normal sustituya el árbol SSR al resolver el dominio: NO es hidratación completa y puede producir transición/flash. No se ha medido LCP/CLS ni validado E2E completo local. No usar este artefacto como prueba de que producción ya es indexable. JSON-LD SSR no se incluye en esta fase.

## Aislamiento y activación posterior

main.server.ts, app.config.server.ts, AppComponent, índice universal, build:prod y deploy-s3.yml permanecen intactos. El selector candidato devuelve /marketing/index.html solo para hostexacto vendix.online/www.vendix.online y URI / con GET/HEAD. No se asocia ni empaqueta como función AWS todavía. AWS CLI local no dispone de credenciales, de modo que las asociaciones vigentes y la caché deben verificarse antes de integrar cualquier selector.

Antes de activar: revisión de Rafa, pruebas navegador JSoff/on y móvil sobre corehost, comparación con HTMLreal, ausencia bleed en tenant/custom, política de actualización de planes, metadata definitiva/canonical/schema, objeto cargado con cache apropiada y regla edge antes de cachelookup. No sustituir index.html compartido ni mapear global404→200. Conservar respuestas404 para rutas no publicadas. Ante fallo de artefacto no activar selección.

Rollback: esta entrega no requiere cambio operacional. Si se habilita en PRposterior, retirar selector marketing y volver al shell neutral, invalidando solo claves afectadas; documentar comandos con distribución confirmada entonces. No tocar tenants, roles ni datos de clientes.

## Memoria de la decisión

Se conserva esta decisión en PLAN.md y en el seguimiento local. Las escrituras Engram atribuidas están bloqueadas por falta de identidad de runtime registrada; no se inventó sesión ni se utilizó CLI como sustituto.
