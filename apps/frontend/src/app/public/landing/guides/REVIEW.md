# Guías sectoriales: entrega para revisión, publicación desactivada

Sección bajoFAQ sin cambios dehero/precios/claims existentes; fotosrestaurant.webp/retail.webp reutilizadas. Tres rutas lazy sólo en vendixLandingPublicRoutes: /guias/comandas-restaurantes, /guias/ventas-mayoristas-al-detal, /guias/preparar-demostracion. Navegación semántica, contenido tipado,checklist,sinformularios ni nuevasAPI/Analytics.

## Publicación

sectorGuidesEnabled false en environment.ts producción; true solo development. El mismo gate controla sección y rutas. No se añade sitemap/backendregistry ni prerender de estas páginas. Aprobar código no activa publicación. Para activar: aprobacióncomercialtextos,HTTP200HTMLcorrespondiente en acceso directo/reload,metadata/robots/canonical/OG,aislamiento hosts,noindex retirado solo tras aprobación yregistroeditorial/sitemapactualizados. Con SSR actualshellno contiene texto inicial; no presentar esto como cierreSEO02/03/23 ni soluciónCDN.

Artículos llevan Borrador/noindex,follow y quitan canonicalhome enDOM; retornan metadata previa al destruir componente. Publicación definitiva requiere metadata inicial real y canonicalpropia; no inferirla delDOMsolamente.

## Evidencia y contenido

Restaurantes: guía operativa con roles,pedidos,cambios,caja; noQR/split/recetas/fiscal ni ahorro prometido. Mayorista: tarifa manual,cupónválido/promoción limitados a prueba de carrito; no acumulación/cliente/cantidadautomáticos. Preparación no envía contacto ni equivale a lead.

Textos: borradores de seguimiento aprobados para desarrollo14oct. Fotos ilustrativas existentes,no testimonios. No exenciónIVA,todoslosplanes o pagos simulados ejecutados por crear esta sección.

## Verificación requerida

Recorrido local real:home tarjetas→ambasguías→preparación→volver,índicefragmentos,móvil375pxsinoverflow,metadatacambiayrestauración,unknownroute,noinyecciónquery. Probar dominio tienda/org conroute no montada. Configuraciónprodgateoff yCIcompilación. Si runtime local no puede compilar por dependenciaspreexistentes, documentarerror y mantenerPRdraft; no afirmarE2Eaprobado.

Rollback de código porPR; no tocar CDN,roles,tenants ni campañas para probar recursos. Nada publicado por esta entrega.

Verificación de esta entrega: 5 pruebas Node pasan (flag, contenido, enlaces, parserAngular, separación de rutas). Comando: node --test apps/frontend/src/app/public/landing/guides/sector-guides.test.cjs. Preview visual exacto de sección HTML/CSS comprobado en1440px/375px; no equivale a routerAngularE2E. Watcher completo primero falló por heic2any ya declarada, instalada solo en carpeta temporal sin cambios de manifests; segunda ejecución se detuvo con esbuild The service was stopped. Backend local responde Empty reply; integración real aún bloqueada. PRdraft requiereCI/runtime antesdeactivación.
