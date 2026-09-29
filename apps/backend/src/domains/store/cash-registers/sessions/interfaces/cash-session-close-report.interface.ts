/**
 * Reporte consolidado de una sesión de caja
 * (`GET store/cash-registers/sessions/:id/close-report`).
 *
 * Todo son agregados: nunca líneas una a una. Los montos viajan como `number`
 * redondeado a 2 decimales. El frontend consume este contrato tal cual.
 */
export interface CashSessionCloseReport {
  session: {
    id: number;
    status: string;
    register: { id: number; name: string; code: string | null } | null;
    opened_by: { id: number; name: string } | null;
    closed_by: { id: number; name: string } | null;
    opened_at: string;
    closed_at: string | null;
    closing_notes: string | null;
  };
  currency: { code: string; symbol: string };
  cash: {
    opening: number;
    cash_sales: number;
    cash_in: { count: number; total: number };
    cash_out: { count: number; total: number };
    cash_refunds: { count: number; total: number };
    expected: number;
    declared: number | null;
    difference: number | null;
  };
  payment_methods: { method: string; count: number; total: number }[];
  sales: {
    orders_count: number;
    payments_count: number;
    subtotal: number;
    discounts: number;
    /** Impuesto de productos (`orders.tax_amount`). */
    product_taxes: number;
    /** Impuesto del domicilio (`orders.shipping_tax_amount`). */
    shipping_taxes: number;
    /** Total de impuestos = product_taxes + shipping_taxes. */
    taxes: number;
    /** Envíos NETOS de impuesto (shipping_cost − shipping_tax_amount). */
    shipping: number;
    tips: number;
    grand_total: number;
    average_ticket: number;
  };
  refunds: {
    count: number;
    total: number;
    by_method: { method: string; count: number; total: number }[];
    payment_cancellations: { count: number; total: number };
  };
  /** Devoluciones: mismos valores que `refunds`, en un bloque plano. */
  returns: {
    refunds_count: number;
    refunds_total: number;
    /** Impuesto reembolsado (`refunds.tax_refund`). */
    refunds_tax: number;
    payments_cancelled_count: number;
    payments_cancelled_total: number;
  };
  /** Neto: ventas y impuestos tras devoluciones y pagos anulados. */
  net: {
    net_sales: number;
    net_taxes: number;
  };
  /** Órdenes enviadas/entregadas con saldo por cobrar al momento de la consulta. */
  pending_collection: { count: number; total: number };
  discounts: {
    orders_with_discount: number;
    total: number;
    promotions: { name: string; count: number; total: number }[];
    coupons: { code: string; count: number; total: number }[];
    other: { count: number; total: number };
  };
  generated_at: string;
}
