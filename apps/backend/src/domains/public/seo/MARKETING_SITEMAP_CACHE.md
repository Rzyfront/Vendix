# Marketing sitemap: registro y actualización editorial de caché

El registro MARKETING_SITEMAP_PAGES en apps/backend/src/domains/public/seo/marketing-sitemap.registry.ts es la fuente del XML y de su versión. Actualmente solo contiene la portada aprobada. No añadir /ayuda, /pqr ni /legal hasta resolver HTTP404 y aprobar su publicación.

## Publicar, retirar o editar una página

1. Confirmar URL canónica aprobada, contenido público, HTTP200 e indexación permitida. No añadir auth/admin, borradores, fragmentos ni UTMs.
2. Añadir/quitar su entrada en el registro. Para cambios editoriales de una entrada existente, incrementar editorialRevision. Ese número es una revisión de caché, no una fecha lastmod.
3. Si cambia el formato del XML sin cambiar páginas, incrementar formatVersion dentro de marketingSitemapVersion.
4. Entregar código y contenido por PR, revisión y publicación de Rafa. El cambio comienza a servir cuando la nueva revisión está desplegada; no antes. Tras despliegue, comprobar sitemap apex/www y estado de Search Console.

## Claves y expiración

Solo los hosts base configurado y www usan seo:sitemap:<hostname>:marketing:<SHA256>. La huella incluye versión de formato y registro serializado. Ambos conservan claves separadas aunque el XML canonical apunte al apex. Cambiar páginas o revisión produce otra clave automáticamente: evita leer el XML previo sin borrar Redis. Entradas viejas expiran con TTL existente de una hora; ningún escaneo/flush ni invalidación de tiendas.

Otros hosts mantienen seo:sitemap:<hostname>. Robots conserva su comportamiento. No cambia catálogo, permisos, esquema ni dependencia. Esto es registro estático publicado mediante código; no es un CMS ni una API de publicación dinámica. Mantener despliegue atómico y verificar después: servidores con versiones distintas pueden servir ediciones distintas durante transición/rollback.

No inventar lastmod con la revisión o hora de generación. La portada sigue sin lastmod hasta disponer de fecha editorial real. Un cambio en contenido externo sin PR requiere incrementar revisión y publicar para actualizar la clave; no se detecta automáticamente desde un CMS inexistente.

## Verificación

Pruebas en public-seo.service.spec.ts: edición/add/remove cambia versión, idéntico registro la conserva; caché de edición anterior no reutilizada; cachétenant sin cambio; alias separado; dominio configurable, catálogo y robots previos. Mantener nombre de prueba de sitemap exigido por backend-regression-gate.

Rollback: revertir el PR por flujo técnico normal; esa edición usa su propia huella. No borrar claves globales. Si el contenido cambió externamente, conciliar registro y contenido antes del rollback.
