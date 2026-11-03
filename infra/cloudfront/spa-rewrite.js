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
// Redirecciones 301 solo en el host comercial (la función también corre en la
// distribución de dominios propios de las tiendas, que no se tocan):
//  - www.vendix.online → vendix.online (decisión del 22-oct: apex sin www).
//  - alias de páginas comerciales → URL canónica (SEO-TECH-14).
// La query se conserva.
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

  for (var i = 0; i < SPA_PREFIXES.length; i++) {
    if (uri.indexOf(SPA_PREFIXES[i]) === 0) {
      request.uri = '/index.html';
      return request;
    }
  }

  var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
  if (lastSegment.indexOf('.') === -1) {
    request.uri = '/index.html';
  }

  return request;
}
