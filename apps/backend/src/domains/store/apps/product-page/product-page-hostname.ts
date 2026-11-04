/**
 * Hostname of a product page: `{store}-{product}.{base}` (plan S5).
 *
 * Pure functions so the naming rules are tested without a database:
 * - the suffixes the other apps own (`store`, `landing`, `service`,
 *   `booking`, `shop`, plus `org` and `admin`) never end the hostname, so a
 *   product called "shop" or "mi-shop" can never look like another app;
 * - a taken hostname gets a numeric suffix (`-2`, `-3`, ...), like the
 *   existing generator does on collisions, then a random `-v{5}` one;
 * - the DNS label stays within 63 characters.
 */
export const RESERVED_APP_SUFFIXES = [
  'store',
  'landing',
  'service',
  'booking',
  'shop',
  'org',
  'admin',
] as const;

const MAX_LABEL_LENGTH = 63;
const MAX_ATTEMPTS = 50;
const RANDOM_TAG_LENGTH = 5;

/** Same normalization as `DomainGeneratorHelper.cleanSlug`. */
export function cleanHostnameSlug(slug: string): string {
  return slug
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function fitLabel(label: string, suffix: string): string {
  const room = MAX_LABEL_LENGTH - suffix.length;
  return label.slice(0, room).replace(/-$/, '') + suffix;
}

/**
 * Returns a free hostname for the product page, or `null` when every attempt
 * is taken (the caller turns that into an error instead of looping).
 */
export function buildProductPageHostname(
  storeSlug: string,
  productSlug: string,
  baseDomain: string,
  isTaken: (hostname: string) => boolean,
): string | null {
  const store = cleanHostnameSlug(storeSlug);
  let product = cleanHostnameSlug(productSlug) || 'producto';
  // The last segment decides which app a `{x}-{suffix}` hostname looks like.
  const lastSegment = product.split('-').pop() ?? '';
  if ((RESERVED_APP_SUFFIXES as readonly string[]).includes(lastSegment)) {
    product = `${product}-producto`;
  }
  const label = store ? `${store}-${product}` : product;
  return firstFreeHostname(label, baseDomain, isTaken);
}

/**
 * Hostname of an app with a fixed suffix: `{store}-{suffix}.{base}`
 * (plan S5, e.g. `{tienda}-service` for the service page). Same collision
 * and length rules as the product page.
 */
export function buildAppSuffixHostname(
  storeSlug: string,
  appSuffix: string,
  baseDomain: string,
  isTaken: (hostname: string) => boolean,
): string | null {
  // Trim the store, never the app suffix: the suffix says which app it is.
  // Room is kept for a collision suffix (`-50`).
  const room = MAX_LABEL_LENGTH - appSuffix.length - 1 - 3;
  const store =
    cleanHostnameSlug(storeSlug).slice(0, room).replace(/-$/, '') || 'tienda';
  return firstFreeHostname(`${store}-${appSuffix}`, baseDomain, isTaken);
}

function firstFreeHostname(
  label: string,
  baseDomain: string,
  isTaken: (hostname: string) => boolean,
): string | null {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const suffix = attempt === 1 ? '' : `-${attempt}`;
    const hostname = `${fitLabel(label, suffix)}.${baseDomain}`;
    if (!isTaken(hostname)) return hostname;
  }
  // Every numeric suffix is taken: publishing must never fail because the
  // name is busy, so fall back to a random `-v{5}` suffix.
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const hostname = `${fitLabel(label, `-${randomTag()}`)}.${baseDomain}`;
    if (!isTaken(hostname)) return hostname;
  }
  return null;
}

function randomTag(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let tag = 'v';
  for (let i = 0; i < RANDOM_TAG_LENGTH; i++) {
    tag += chars[Math.floor(Math.random() * chars.length)];
  }
  return tag;
}

/**
 * Whether `hostname` is `natural` itself or one of its collision variants
 * (`-2`, `-3`, ... or the random `-v{5}` fallback), the label possibly
 * trimmed to fit 63 characters. A product page uses it to reactivate its
 * earlier subdomain only while it still names the same product.
 */
export function isHostnameVariant(hostname: string, natural: string): boolean {
  const host = hostname.toLowerCase();
  const nat = natural.toLowerCase();
  if (host === nat) return true;
  const dot = nat.indexOf('.');
  const base = nat.slice(dot);
  if (dot < 0 || !host.endsWith(base)) return false;
  const label = host.slice(0, host.length - base.length);
  const natLabel = nat.slice(0, dot);
  const match = /^(.+)-(\d+|v[a-z0-9]{5})$/.exec(label);
  if (!match) return false;
  const stem = match[1];
  // A trimmed label only happens at the 63-character limit (62 when the
  // trim left a trailing `-` that was dropped).
  const trimmed = label.length >= MAX_LABEL_LENGTH - 1 && natLabel.startsWith(stem);
  return natLabel === stem || trimmed;
}
