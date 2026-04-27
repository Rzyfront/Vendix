const COP_FORMATTER = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(amount: number, currency: 'COP' | 'USD' = 'COP'): string {
  if (currency === 'COP') {
    return COP_FORMATTER.format(amount);
  }
  return USD_FORMATTER.format(amount);
}

export function formatCOP(amount: number): string {
  return COP_FORMATTER.format(amount);
}

export function formatUSD(amount: number): string {
  return USD_FORMATTER.format(amount);
}

export function parseCurrency(value: string): number {
  const cleaned = value.replace(/[^0-9.-]/g, '');
  return parseFloat(cleaned) || 0;
}

export function formatPrice(price: number, discount?: number): {
  original: string;
  discounted?: string;
  discountPercent?: number;
} {
  const result: { original: string; discounted?: string; discountPercent?: number } = {
    original: formatCOP(price),
  };

  if (discount && discount > 0) {
    const discountedPrice = price * (1 - discount / 100);
    result.discounted = formatCOP(discountedPrice);
    result.discountPercent = discount;
  }

  return result;
}
