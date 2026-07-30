/**
 * Convierte un nombre de tienda en un slug URL-safe.
 *
 * Reglas (alineadas con web `slugify` de `store-upsert-form.component.ts`):
 *   - lowercase
 *   - caracteres no alfanuméricos → espacio
 *   - colapsa espacios y guiones repetidos
 *   - trim de guiones al inicio/fin
 *
 * Si el resultado es vacío (e.g. nombre solo con emojis), devuelve `null`
 * y el caller decide qué hacer (rechazar o autogenerar).
 */
export function generateSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug;
}
