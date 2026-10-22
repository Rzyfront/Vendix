/**
 * Subtotal bruto (impuesto incluido) de las vistas al cliente: suma del total
 * bruto de cada línea NO cancelada. Fuente única para cuenta de mesa,
 * resumen de invitado, comprobante impreso y mensaje de WhatsApp.
 */
export interface GrossSubtotalLine {
  line_total_gross?: number | string | null;
  total_price_gross?: number | string | null;
  total_price?: number | string | null;
  total?: number | string | null;
  cancelled_at?: string | Date | null;
}

/** Total bruto de una línea; cae al neto legado si no hay bruto. */
export function grossLineTotal(line: GrossSubtotalLine): number {
  return (
    Number(
      line.line_total_gross ??
        line.total_price_gross ??
        line.total_price ??
        line.total ??
        0,
    ) || 0
  );
}

/** Suma de totales brutos excluyendo las líneas canceladas. */
export function sumGrossSubtotal(
  lines: ReadonlyArray<GrossSubtotalLine> | null | undefined,
): number {
  return (lines ?? [])
    .filter((l) => !l.cancelled_at)
    .reduce((sum, l) => sum + grossLineTotal(l), 0);
}
