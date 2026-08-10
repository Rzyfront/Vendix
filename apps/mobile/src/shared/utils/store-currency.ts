import { apiClient } from '@/core/api';
import { useAuthStore } from '@/core/store/auth.store';

/**
 * Store currency, resolved the same way the web `CurrencyFormatService`
 * resolves it (`apps/frontend/src/app/shared/pipes/currency/currency.pipe.ts`).
 *
 * `formatCurrency()` in `./currency` only knows COP and USD with a hardcoded
 * `es-CO` locale. That is fine for a screen label, and wrong for a printed
 * document: the paper leaves with the customer, so its amounts must carry the
 * store's configured symbol, decimals and separators — the same ones the
 * desktop ticket prints.
 */
export interface StoreCurrency {
  code: string;
  name: string;
  symbol: string;
  decimal_places: number;
  position: 'before' | 'after';
  format_style?: 'comma_dot' | 'dot_comma' | 'space_comma';
  state?: 'active' | 'inactive' | 'deprecated';
}

/** Same TTL the web service uses for the active-currency catalogue. */
const CURRENCIES_CACHE_TTL_MS = 30 * 60 * 1000;

/** Public catalogue endpoint; not under `Endpoints` because nothing else consumes it. */
const ACTIVE_CURRENCIES_PATH = '/public/currencies/active';

let cachedCurrencies: StoreCurrency[] | null = null;
let cachedAt = 0;
let inFlight: Promise<StoreCurrency[] | null> | null = null;

/**
 * Currency code configured for the store, read from the persisted auth
 * snapshot — the mobile equivalent of the web's
 * `parsed?.store_settings?.general?.currency`.
 */
export function getStoreCurrencyCode(): string | null {
  const settings = useAuthStore.getState().store_settings as
    | { general?: { currency?: string } }
    | null
    | undefined;
  const code = settings?.general?.currency;
  return typeof code === 'string' && code.trim() ? code.trim() : null;
}

async function loadActiveCurrencies(): Promise<StoreCurrency[] | null> {
  if (cachedCurrencies && Date.now() - cachedAt < CURRENCIES_CACHE_TTL_MS) {
    return cachedCurrencies;
  }
  if (inFlight) return inFlight;

  inFlight = apiClient
    .get(ACTIVE_CURRENCIES_PATH)
    .then((response) => {
      const body = response.data as
        | { success?: boolean; data?: StoreCurrency[] }
        | StoreCurrency[];
      const list = Array.isArray(body) ? body : body?.data;
      if (!Array.isArray(list)) return cachedCurrencies;
      cachedCurrencies = list;
      cachedAt = Date.now();
      return cachedCurrencies;
    })
    .catch(() => cachedCurrencies)
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * The store's currency record, or `null` when it cannot be resolved (no store
 * settings yet, or the catalogue request failed). Never throws: a document
 * must still print with the fallback formatting rather than not print at all.
 */
export async function resolveStoreCurrency(): Promise<StoreCurrency | null> {
  const code = getStoreCurrencyCode();
  if (!code) return null;

  const currencies = await loadActiveCurrencies();
  return currencies?.find((c) => c.code === code) ?? null;
}

/**
 * Locale that produces each `format_style`'s separators. Verbatim mirror of
 * the web `getLocaleForStyle`, so the same amount reads identically on both
 * documents.
 */
function localeForStyle(style?: StoreCurrency['format_style']): string {
  switch (style) {
    case 'dot_comma':
      return 'de-DE';
    case 'space_comma':
      return 'fr-FR';
    case 'comma_dot':
    default:
      return 'en-US';
  }
}

/**
 * Formats an amount exactly as the web `CurrencyFormatService.format()` does:
 * decimals from the currency, separators from its `format_style`, symbol on
 * the configured side. With no currency resolved it degrades to the same
 * `$1,234.56` fallback the web uses while the currency is loading, so the two
 * documents never diverge by more than that transient.
 */
export function formatStoreMoney(
  amount: number | string | null | undefined,
  currency: StoreCurrency | null,
  decimals?: number,
): string {
  const num = Number(amount) || 0;

  if (!currency) {
    const dec = decimals ?? 2;
    return `$${num.toLocaleString('en-US', {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
    })}`;
  }

  const dec = decimals ?? currency.decimal_places ?? 2;
  const formatted = num.toLocaleString(localeForStyle(currency.format_style), {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
  const symbol = currency.symbol || currency.code;

  return currency.position === 'before'
    ? `${symbol}${formatted}`
    : `${formatted}${symbol}`;
}
