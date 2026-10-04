/**
 * Consolidado por método de pago: lo que el cajero debe tener por cada método.
 * `entered` = sales + cash_in; `exited` = refunds + cancellations + withdrawals.
 * Efectivo: `expected = opening + entered − exited`. No efectivo:
 * `expected = entered − exited`, `counted`/`difference` = null.
 */
export interface CashConsolidatedRow {
  method: string;
  sales: number;
  cash_in: number;
  entered: number;
  refunds: number;
  cancellations: number;
  withdrawals: number;
  exited: number;
  expected: number;
  counted: number | null;
  difference: number | null;
}

export interface CashConsolidated {
  rows: CashConsolidatedRow[];
  totals: { entered: number; exited: number; expected: number };
}

export interface CashBreakdown {
  opening: number;
  sales: number;
  cash_in: number;
  refunds: number;
  cancellations: number;
  withdrawals: number;
  expected: number;
  counted: number | null;
  difference: number | null;
}

export interface CashOutflow {
  id: number;
  at: string;
  kind: 'refund' | 'cancellation' | 'withdrawal';
  order_id: number | null;
  order_number: string | null;
  payment_method: string;
  amount: number;
  reason: string | null;
  user_name: string | null;
}

export interface CashIntegrity {
  sales_match: boolean;
  notes: string[];
}

export interface CashTipsSummary {
  total: number;
  mode: 'waiter' | 'pooled';
  mode_label: string;
  pooled_total: number;
  waiter_total: number;
  by_waiter: {
    waiter_id: number | null;
    waiter_name: string;
    total: number;
  }[];
}

export interface CashSalesSummary {
  orders_count: number;
  payments_count: number;
  subtotal: number;
  discounts: number;
  product_taxes: number;
  shipping_taxes: number;
  taxes: number;
  shipping: number;
  tips: number;
  /** Ventas netas del negocio (sin propinas). */
  net_sales?: number;
  /** Desglose de propinas según modalidad. */
  tips_summary?: CashTipsSummary;
  /** Total cobrado: Σ movimientos `sale` de ESTA sesión (no `orders.grand_total`). */
  grand_total: number;
  /** Σ `orders.grand_total` de las órdenes no canceladas con venta en la sesión. */
  orders_grand_total: number;
  /** orders_grand_total / orders_count. */
  average_ticket: number;
  /** Órdenes de la sesión canceladas o totalmente reembolsadas (excluidas arriba). */
  cancelled: { count: number; total: number };
}

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
  consolidated: CashConsolidated;
  cash_breakdown: CashBreakdown;
  outflows: CashOutflow[];
  sales_summary: CashSalesSummary;
  integrity: CashIntegrity;
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
    /** Ventas netas del negocio (sin propinas). */
    net_sales?: number;
    /** Desglose de propinas según modalidad. */
    tips_summary?: CashTipsSummary;
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
    /** Ventas netas del negocio deduciendo devoluciones y propinas. */
    net_business_sales?: number;
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
