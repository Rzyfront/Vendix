/**
 * Extensión canónica de archivo para cada MIME de imagen que puede salir del
 * recortador (`image-source-modal`) o de un origen remoto.
 *
 * El recortador exporta `image/webp` o `image/png` cuando la imagen tiene canal
 * alfa (un logo con fondo transparente exportado como `image/jpeg` sale con
 * fondo NEGRO, porque JPEG no tiene alfa), y `image/jpeg` cuando no lo tiene.
 * Es decir: el MIME del data URL NO es constante y no se puede asumir.
 */
const CANONICAL_EXTENSION_BY_MIME_TYPE: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

/**
 * Extensiones que se consideran EQUIVALENTES para un mismo MIME y que, por
 * tanto, no se deben reescribir. `foto.jpeg` con MIME `image/jpeg` ya es
 * coherente: renombrarla a `foto.jpg` sería ruido sin ganancia.
 */
const ACCEPTED_EXTENSIONS_BY_MIME_TYPE: Readonly<
  Record<string, readonly string[]>
> = {
  'image/jpeg': ['jpg', 'jpeg', 'jpe', 'jfif'],
};

/**
 * Extensión final del nombre de archivo.
 *
 * Exige que empiece por letra (y hasta 8 caracteres alfanuméricos) a propósito:
 * así `slider-1699999999999-2` o `version-1.2` NO se interpretan como que
 * tienen extensión `2`, y en vez de mutilar el nombre se le AÑADE la extensión
 * correcta al final.
 */
const TRAILING_EXTENSION_PATTERN = /\.([A-Za-z][A-Za-z0-9]{0,7})$/;

/**
 * Alinea la extensión del nombre de archivo con el MIME real del data URL.
 *
 * POR QUÉ EXISTE ESTA CORRECCIÓN
 * ------------------------------
 * Casi todos los llamadores construyen el nombre con la extensión HARDCODEADA
 * (`logo-${Date.now()}.jpg`, `avatar-${Date.now()}.jpg`, ...), heredada de
 * cuando el recortador siempre exportaba JPEG. Desde que el recortador exporta
 * WebP/PNG para preservar la transparencia, ese nombre miente: se sube un
 * `File` cuyo `type` es `image/webp` pero cuyo `name` termina en `.jpg`.
 *
 * Un `File` con esa incoherencia rompe a todo consumidor que decida MIRANDO LA
 * EXTENSIÓN en vez del MIME, y esos consumidores existen en ambos lados:
 *
 * - Backend: `S3Service.uploadImage()` deriva la key de S3 con
 *   `key.endsWith('.webp') ? key : key.split('.')[0] + '.webp'`, es decir, lee
 *   la extensión del nombre original para decidir si recomprime o no.
 * - Validadores por extensión (filtros de multer/`fileFilter`, reglas de
 *   allowlist, CDNs y navegadores que infieren el tipo por sufijo) pueden
 *   RECHAZAR el archivo o CLASIFICARLO MAL, sirviéndolo luego con un
 *   `Content-Type` equivocado.
 *
 * Corregir la extensión aquí, en el único punto por el que pasan los ~15
 * llamadores, evita tener que tocarlos uno por uno y evita que el próximo
 * llamador reintroduzca el mismo desajuste.
 *
 * Si el MIME es desconocido (no está en `CANONICAL_EXTENSION_BY_MIME_TYPE`) el
 * nombre se deja INTACTO: es preferible respetar lo que pidió el llamador antes
 * que inventar una extensión a partir de un MIME que no sabemos interpretar.
 *
 * @param fileName Nombre propuesto por el llamador.
 * @param contentType MIME detectado en el data URL, en minúsculas.
 * @returns El mismo nombre si ya es coherente, o el nombre con la extensión corregida/añadida.
 */
function alignFileNameWithContentType(
  fileName: string,
  contentType: string,
): string {
  const canonicalExtension = CANONICAL_EXTENSION_BY_MIME_TYPE[contentType];
  if (!canonicalExtension) {
    return fileName;
  }

  const baseName = fileName.trim();
  if (!baseName) {
    return `image.${canonicalExtension}`;
  }

  const acceptedExtensions = ACCEPTED_EXTENSIONS_BY_MIME_TYPE[contentType] ?? [
    canonicalExtension,
  ];

  const match = TRAILING_EXTENSION_PATTERN.exec(baseName);
  if (!match) {
    // Sin extensión reconocible: se añade la correcta en vez de recortar nada.
    return `${baseName}.${canonicalExtension}`;
  }

  const currentExtension = match[1].toLowerCase();
  if (acceptedExtensions.includes(currentExtension)) {
    return baseName;
  }

  return `${baseName.slice(0, match.index)}.${canonicalExtension}`;
}

/**
 * Convierte un data URL (`data:<mime>;base64,<payload>`) en un objeto `File`.
 *
 * Extraído y unificado a partir de las implementaciones idénticas presentes en
 * `brand-form-modal.component.ts` y `category-form-modal.component.ts`, donde el
 * helper era `async` y resolvía el blob vía `fetch(dataUrl)`. Aquí se reescribe
 * de forma SÍNCRONA (sin `fetch`) parseando el data URL directamente, que es la
 * forma canónica y más robusta: evita un round-trip de red para un recurso ya en
 * memoria y permite una firma síncrona reutilizable.
 *
 * El `contentType` se deriva del propio data URL; si no se puede determinar se
 * usa `image/jpeg` como fallback (mismo fallback que las implementaciones
 * originales mediante `blob.type || 'image/jpeg'`).
 *
 * La EXTENSIÓN del `fileName` se alinea con ese `contentType` real
 * (ver `alignFileNameWithContentType`): los llamadores pasan `.jpg` fijo por
 * herencia, y desde que el recortador exporta WebP/PNG para preservar la
 * transparencia ese sufijo ya no describe el contenido.
 *
 * @param dataUrl Data URL en formato `data:<mime>[;<param>][;base64],<payload>`.
 * @param fileName Nombre opcional del archivo resultante. Por defecto `image.jpg`.
 * @returns Un `File` con el contenido decodificado, el tipo MIME detectado y una extensión coherente con él.
 * @throws Error si el `dataUrl` no tiene un formato de data URL válido.
 */
export function dataUrlToFile(dataUrl: string, fileName = 'image.jpg'): File {
  // El bloque de metadatos admite parámetros además de `;base64`
  // (p. ej. `data:image/svg+xml;charset=utf-8;base64,...`), por eso se captura
  // entero hasta la primera coma y se disecciona después.
  const match = /^data:([^,]*),(.*)$/s.exec(dataUrl);
  if (!match) {
    throw new Error('No se pudo preparar la imagen');
  }

  const [, metadata, payload] = match;
  const metadataParts = metadata.split(';');
  const mimeFromUrl = (metadataParts[0] ?? '').trim().toLowerCase();
  const isBase64 = metadataParts
    .slice(1)
    .some((part) => part.trim().toLowerCase() === 'base64');

  const contentType = mimeFromUrl || 'image/jpeg';

  let bytes: Uint8Array;
  if (isBase64) {
    const binary = atob(payload);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
  } else {
    // Data URL sin base64: el payload viene percent-encoded, que representa
    // BYTES UTF-8. Reencodificar con TextEncoder (en vez de `charCodeAt`) es lo
    // que mantiene intacto cualquier carácter no ASCII, caso habitual en los
    // data URL de `image/svg+xml`, que se sirven sin base64.
    bytes = new TextEncoder().encode(decodeURIComponent(payload));
  }

  const resolvedFileName = alignFileNameWithContentType(fileName, contentType);

  return new File([bytes.buffer as ArrayBuffer], resolvedFileName, {
    type: contentType,
  });
}
