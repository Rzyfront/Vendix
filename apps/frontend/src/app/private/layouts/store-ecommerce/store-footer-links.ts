/**
 * Alias de la tienda que el router acepta pero que no son la URL canónica
 * (SEO-TECH-14). El menú ya enlaza las canónicas (#1011); los enlaces del pie
 * pueden venir de la configuración guardada de cada tienda con los alias
 * viejos, así que se normalizan al pintarlos.
 */
const STORE_ALIAS_TO_CANONICAL: Readonly<Record<string, string>> = {
  '/products': '/catalog',
  '/new': '/novedades',
  '/sale': '/ofertas',
};

/** Devuelve la URL canónica de un enlace interno del pie; los externos no se tocan. */
export function canonicalStoreLinkUrl(url: string, isExternal: boolean): string {
  if (isExternal) return url;
  const match = /^([^?#]*)(.*)$/.exec(url);
  const path = match?.[1] ?? url;
  const rest = match?.[2] ?? '';
  const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const canonical = STORE_ALIAS_TO_CANONICAL[normalized];
  return canonical ? canonical + rest : url;
}
