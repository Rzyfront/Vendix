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
 * @param dataUrl Data URL en formato `data:<mime>[;base64],<payload>`.
 * @param fileName Nombre opcional del archivo resultante. Por defecto `image.jpg`.
 * @returns Un `File` con el contenido decodificado y el tipo MIME detectado.
 * @throws Error si el `dataUrl` no tiene un formato de data URL válido.
 */
export function dataUrlToFile(dataUrl: string, fileName = 'image.jpg'): File {
  const match = /^data:([^;,]*)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) {
    throw new Error('No se pudo preparar la imagen');
  }

  const [, mimeFromUrl, base64Flag, payload] = match;
  const contentType = mimeFromUrl || 'image/jpeg';

  let bytes: Uint8Array;
  if (base64Flag) {
    const binary = atob(payload);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
  } else {
    // Data URL sin base64: el payload viene percent-encoded.
    const decoded = decodeURIComponent(payload);
    bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      bytes[i] = decoded.charCodeAt(i);
    }
  }

  return new File([bytes], fileName, { type: contentType });
}
