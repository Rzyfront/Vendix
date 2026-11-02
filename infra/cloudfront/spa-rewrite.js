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
