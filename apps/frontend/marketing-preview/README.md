# Vista previa HTML comercial aislada

Esta entrega NO publica la portada SSR, NO cambia S3/CloudFront y NO activa las guÃ­as. Es el primer paso verificable de TECH02: prepara el documento que luego se podrÃ¡ servir Ãºnicamente en marketing.

## GeneraciÃ³n y comprobaciÃ³n

CI Marketing HTML preview ejecuta el build normal y `npm run build:marketing-preview -w apps/frontend`. Salida separada `apps/frontend/dist/marketing-preview/browser/`, descargable como artefacto7d. Prueba Node: `node --test apps/frontend/scripts/marketing-preview.test.cjs`. No ejecutar builds locales automÃ¡ticamente; buildcheck-dev conserva esa regla.

El bootstrap de servidor renderiza el mismo VendixLandingComponent, no una copia del contenido. Reutiliza appConfig para sus dependencias y aÃ±ade ruta vacÃ­a Ãºnicamente en la entrada preview. El catÃ¡logo pÃºblico se consulta sin credenciales a environment.apiUrl/public/plans con timeout10s; BEFORE_APP_SERIALIZED rechaza respuesta fallida/vacÃ­a para que la landing no publique su fallback curado. El build depende de disponibilidad de ese API pÃºblico; si falla, no hay artefacto validado ni despliegue. No son consultas de tiendas privadas.

El Ã­ndice preview lleva noindex,nofollow. Su raÃ­z ngSkipHydration hace que el cliente normal sustituya el Ã¡rbol SSR al resolver el dominio: NO es hidrataciÃ³n completa y puede producir transiciÃ³n/flash. No se ha medido LCP/CLS ni validado E2E completo local. No usar este artefacto como prueba de que producciÃ³n ya es indexable. JSON-LD SSR no se incluye en esta fase.

## Aislamiento y activaciÃ³n posterior

main.server.ts, app.config.server.ts, AppComponent, Ã­ndice universal, build:prod y deploy-s3.yml permanecen intactos. El selector candidato devuelve /marketing/index.html solo para hostexacto vendix.online/www.vendix.online y URI / con GET/HEAD. No se asocia ni empaqueta como funciÃ³n AWS todavÃ­a. AWS CLI local no dispone de credenciales, de modo que las asociaciones vigentes y la cachÃ© deben verificarse antes de integrar cualquier selector.

Antes de activar: revisiÃ³n de Rafa, pruebas navegador JSoff/on y mÃ³vil sobre corehost, comparaciÃ³n con HTMLreal, ausencia bleed en tenant/custom, polÃ­tica de actualizaciÃ³n de planes, metadata definitiva/canonical/schema, objeto cargado con cache apropiada y regla edge antes de cachelookup. No sustituir index.html compartido ni mapear global404â†’200. Conservar respuestas404 para rutas no publicadas. Ante fallo de artefacto no activar selecciÃ³n.

Rollback: esta entrega no requiere cambio operacional. Si se habilita en PRposterior, retirar selector marketing y volver al shell neutral, invalidando solo claves afectadas; documentar comandos con distribuciÃ³n confirmada entonces. No tocar tenants, roles ni datos de clientes.

## Memoria de la decisiÃ³n

Se conserva esta decisiÃ³n en PLAN.md y en el seguimiento local. Las escrituras Engram atribuidas estÃ¡n bloqueadas por falta de identidad de runtime registrada; no se inventÃ³ sesiÃ³n ni se utilizÃ³ CLI como sustituto.
