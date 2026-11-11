// CloudFront Function (viewer-request) para el comportamiento por defecto (*)
// de la distribución del frontend (origen S3 en modo sitio web).
//
// Problema: S3 website responde 404 (con index.html como cuerpo) en las rutas
// de Angular como /legal/privacidad. Los usuarios no lo notan, pero Meta,
// Google y cualquier robot ven un 404.
//
// Solución: pedir /index.html (existe y responde 200) cuando:
//  1. la ruta empieza por un prefijo público de Angular cuyo último segmento
//     es un slug o token (puede traer punto en datos viejos, p. ej. un slug
//     "aceite-1.5l"); o
//  2. el último segmento NO tiene extensión de archivo.
// Las rutas con extensión (.js, .css, .png, ...) fuera de esos prefijos pasan
// sin cambios, así un archivo que falte sigue dando 404. /.well-known/ nunca
// se reescribe.
//
// Como corre en viewer-request (antes de la caché), todas las rutas
// reescritas comparten la entrada de caché de /index.html.
// Redirecciones 301 (la función corre en las dos distribuciones: vendix.online
// y la de dominios propios de las tiendas):
//  - www.vendix.online → vendix.online (decisión del 22-oct: apex sin www).
//  - alias de páginas comerciales → URL canónica (SEO-TECH-14), solo en vendix.online.
//  - www.<dominio propio> → <dominio propio>: el backend solo registra el apex,
//    así que en www la tienda no resuelve y sale en blanco. Los subdominios de
//    vendix.online (www.tienda.vendix.online) no se tocan.
// El path y la query se conservan.
var MARKETING_HOST = 'vendix.online';
var MARKETING_ORIGIN = 'https://vendix.online';
var MARKETING_ALIASES = {
  '/precios': '/pricing',
  '/precios/': '/pricing'
};

function queryString(qs) {
  var parts = [];
  for (var key in qs) {
    var entry = qs[key];
    var values = entry.multiValue ? entry.multiValue : [entry];
    for (var i = 0; i < values.length; i++) {
      var value = values[i].value;
      parts.push(value === '' ? key : key + '=' + value);
    }
  }
  return parts.length ? '?' + parts.join('&') : '';
}

function endsWith(value, suffix) {
  return value.length >= suffix.length && value.substring(value.length - suffix.length) === suffix;
}

function redirect(location) {
  return {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: {
      location: { value: location },
      'cache-control': { value: 'max-age=3600' }
    }
  };
}

// SEO-TECH-03 (aprobado por Adel el 5-nov): en vendix.online, una ruta sin
// extensión que no es de la app NO se reescribe a /index.html. S3 responde 404
// con index.html como cuerpo (documento de error), así que el visitante ve la
// página «no encontrada» de Angular y los buscadores reciben un 404 real en vez
// de un soft 404. Al crear una página comercial nueva hay que agregarla aquí
// (y a scripts/seo/seo-smoke.cjs), o responderá 404.
var MARKETING_PAGES = {
  '/': true,
  '/index.html': true,
  '/pricing': true,
  '/ayuda': true,
  '/pqr': true,
  '/legal/terminos': true,
  '/legal/privacidad': true,
  '/legal/cookies': true
};
// Prefijos de la app en vendix.online: rutas con parámetros (/pqr/consultar/:n),
// guías, autenticación y paneles privados (super admin, organización, tienda,
// repartos), más los enlaces que envía el backend (onboarding, reset-password).
var MARKETING_PREFIXES = [
  '/pqr',
  '/guias',
  '/auth',
  '/admin',
  '/super-admin',
  '/superadmin',
  '/repartos',
  '/onboarding',
  '/reset-password',
  '/authenticate'
];

function isMarketingAppRoute(uri) {
  var path = uri.length > 1 && endsWith(uri, '/') ? uri.substring(0, uri.length - 1) : uri;
  if (MARKETING_PAGES[path]) {
    return true;
  }
  for (var i = 0; i < MARKETING_PREFIXES.length; i++) {
    var prefix = MARKETING_PREFIXES[i];
    if (path === prefix || path.indexOf(prefix + '/') === 0) {
      return true;
    }
  }
  return false;
}

// SEO-TECH-02 (aprobado por Adel el 10-nov): la portada de vendix.online se
// sirve con su HTML comercial prerenderizado (texto, H1, enlaces, canonical y
// OG en la respuesta HTTP). El objeto lo sube deploy-s3.yml desde el build
// marketing-preview. Solo GET/HEAD de vendix.online/; las tiendas y los
// dominios propios siguen con el index.html neutro. Debe coincidir con
// apps/frontend/scripts/marketing-host-selector.cjs.
var MARKETING_ROOT_OBJECT = '/marketing/index.html';

// SEO-TECH-04: las rutas que no deben indexarse reciben una copia de la shell con
// <meta name="robots" content="noindex, follow"> en el HTML servido (la sube
// deploy-s3.yml como /noindex/index.html). Así el noindex no depende de que el
// buscador ejecute JavaScript. Es la misma app: solo cambia esa etiqueta.
// En vendix.online: ayuda, PQR, autenticación y paneles privados. En las tiendas
// (subdominios y dominios propios): carrito, checkout, cuenta, enlaces con token,
// PQR y paneles. Portada, catálogo, productos, novedades, ofertas y cartas no
// están aquí: siguen indexables. Solo GET/HEAD.
var NOINDEX_OBJECT = '/noindex/index.html';
var MARKETING_NOINDEX_PREFIXES = [
  '/ayuda',
  '/pqr',
  '/auth',
  '/admin',
  '/super-admin',
  '/superadmin',
  '/repartos',
  '/onboarding',
  '/reset-password',
  '/authenticate'
];
var STORE_NOINDEX_PREFIXES = [
  '/cart',
  '/wishlist',
  '/checkout',
  '/account',
  '/pedido',
  '/order',
  '/factura',
  '/preconsulta',
  '/pagar',
  '/seguimiento-servicio',
  '/pre-registro',
  '/calificar-estadia',
  '/hotel/reserva',
  '/flujos',
  '/firmar',
  '/estacion',
  '/fila',
  '/book',
  '/pqr',
  '/reset-password',
  '/auth',
  '/admin',
  '/super-admin',
  '/superadmin',
  '/repartos',
  '/onboarding'
];

function matchesPrefix(uri, prefixes) {
  var path = uri.length > 1 && endsWith(uri, '/') ? uri.substring(0, uri.length - 1) : uri;
  for (var i = 0; i < prefixes.length; i++) {
    var prefix = prefixes[i];
    if (path === prefix || path.indexOf(prefix + '/') === 0) {
      return true;
    }
  }
  return false;
}

function isNoindexRoute(host, uri) {
  return matchesPrefix(uri, host === MARKETING_HOST ? MARKETING_NOINDEX_PREFIXES : STORE_NOINDEX_PREFIXES);
}

var SPA_PREFIXES = [
  '/productos/',
  '/products/',
  '/catalog/',
  '/pedido/',
  '/order/',
  '/factura/',
  '/preconsulta/',
  '/seguimiento-servicio/',
  '/pre-registro/',
  '/calificar-estadia/'
];

function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.indexOf('/.well-known/') === 0) {
    return request;
  }

  var host = request.headers.host ? request.headers.host.value.toLowerCase() : '';
  if (host === 'www.' + MARKETING_HOST) {
    return redirect(MARKETING_ORIGIN + uri + queryString(request.querystring));
  }
  if (host === MARKETING_HOST && MARKETING_ALIASES[uri]) {
    return redirect(MARKETING_ORIGIN + MARKETING_ALIASES[uri] + queryString(request.querystring));
  }
  if (host.indexOf('www.') === 0 && host.length > 4 && !endsWith(host, '.' + MARKETING_HOST)) {
    return redirect('https://' + host.substring(4) + uri + queryString(request.querystring));
  }

  if (host === MARKETING_HOST && uri === '/' && (request.method === 'GET' || request.method === 'HEAD')) {
    request.uri = MARKETING_ROOT_OBJECT;
    return request;
  }

  if ((request.method === 'GET' || request.method === 'HEAD') &&
      uri.substring(uri.lastIndexOf('/') + 1).indexOf('.') === -1 && isNoindexRoute(host, uri)) {
    request.uri = NOINDEX_OBJECT;
    return request;
  }

  for (var i = 0; i < SPA_PREFIXES.length; i++) {
    if (uri.indexOf(SPA_PREFIXES[i]) === 0) {
      request.uri = '/index.html';
      return request;
    }
  }

  var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
  if (lastSegment.indexOf('.') === -1) {
    if (host === MARKETING_HOST && !isMarketingAppRoute(uri)) {
      return request;
    }
    request.uri = '/index.html';
  }

  return request;
}
