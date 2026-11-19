/**
 * Formato compacto de dinero (K/M), único para tarjetas, tooltips y ejes.
 *
 * QUI-1017 — el signo va ANTES del símbolo: "-$5.9M", nunca "$-5.9M". Un
 * valor que redondea a 0 no lleva signo ("$0", no "-$0").
 *
 * `CurrencyFormatService.formatCompact` / `formatChartAxis` delegan aquí con la
 * moneda de la tienda; las vistas sin moneda resuelta (super-admin) lo llaman
 * con el símbolo por defecto.
 */

export interface CompactMoneyOptions {
  symbol?: string;
  position?: 'before' | 'after';
  /** Locale para los montos menores a mil (separador de miles). */
  locale?: string;
  /** `card`: 1 decimal ("$5.9M"); `axis`: enteros ("$6M") para ejes. */
  mode?: 'card' | 'axis';
}

export function formatCompactMoney(
  value: number | string | null | undefined,
  options: CompactMoneyOptions = {},
): string {
  const num = Number(value) || 0;
  const abs = Math.abs(num);
  const mode = options.mode ?? 'card';
  const digits = mode === 'axis' ? 0 : 1;

  let body: string;
  if (abs >= 1_000_000) {
    body = `${(abs / 1_000_000).toFixed(digits)}M`;
  } else if (abs >= 1_000) {
    body = `${(abs / 1_000).toFixed(digits)}K`;
  } else {
    const rounded = Math.round(abs);
    body =
      mode === 'axis'
        ? `${rounded}`
        : rounded.toLocaleString(options.locale ?? 'en-US');
  }

  const symbol = options.symbol ?? '$';
  const sign = num < 0 && Math.round(abs) !== 0 ? '-' : '';
  return options.position === 'after'
    ? `${sign}${body}${symbol}`
    : `${sign}${symbol}${body}`;
}
