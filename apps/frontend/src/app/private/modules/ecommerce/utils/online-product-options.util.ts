/**
 * QUI-1005 — «Permitir adiciones en la tienda en línea».
 *
 * Lee `product_options.allow_online` de la respuesta de
 * `GET /ecommerce/catalog/config/public` (settings crudos de la tienda).
 * Default permitidas: solo un `false` explícito las apaga, así una tienda que
 * guardó la sección antes del flag (o nunca la guardó) se ve como hoy.
 *
 * Ocultar el selector no depende de esto (con el flag apagado el backend
 * devuelve los grupos vacíos); sirve para que el carrito olvide adiciones
 * elegidas antes de apagarlo. El checkout del backend las rechaza igual.
 */
export function allowsOnlineProductOptions(config: unknown): boolean {
  if (!config || typeof config !== 'object') return true;
  const section = (config as { product_options?: unknown }).product_options;
  if (!section || typeof section !== 'object') return true;
  return (section as { allow_online?: unknown }).allow_online !== false;
}
