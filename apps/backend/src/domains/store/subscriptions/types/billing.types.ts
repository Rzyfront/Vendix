import { Prisma } from '@prisma/client';

/**
 * Billing-level shared types for subscription invoices, payments, and
 * proration calculations. Money is ALWAYS Prisma.Decimal — no JS numbers.
 */

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unit_price: string; // Decimal serialized
  total: string; // Decimal serialized
  /**
   * Código de catálogo del ítem → `cac:StandardItemIdentification/cbc:ID` con
   * `schemeID="999"`. Lo produce `buildSubscriptionItemCode(plan_code)`.
   *
   * OPCIONAL a propósito: las facturas emitidas antes de este contrato no lo
   * tienen, y el builder cae al NÚMERO DE LÍNEA cuando falta —que es
   * exactamente el comportamiento que traían—. Un reenvío años después debe
   * producir el mismo XML.
   */
  item_code?: string;
  /**
   * Unidad de medida de la DIAN → `@unitCode` de `cbc:InvoicedQuantity` y
   * `cbc:BaseQuantity`. La resuelve `dianUnitCodeForBillingCycle(billing_cycle)`.
   *
   * ⚠️ El mes es `'LUN'` y el año `'ANA'`, no `'MON'`/`'ANN'` — ver el aviso de
   * traducción corrompida en `dian-unit-codes.ts`. Ausente ⇒ `'EA'`.
   */
  unit_code?: string;
  /**
   * `true` ⇒ la línea está EXCLUIDA del IVA por el artículo 476 numeral 21 del
   * Estatuto Tributario (computación en la nube). El emisor fiscal la traduce a
   * `omit_tax_total: true` en `UblDocumentLine`, con lo que la línea NO emite el
   * grupo `cac:TaxTotal` (regla FAX01).
   *
   * NO es «no tiene impuestos»: un ítem EXENTO sí emite el grupo, con
   * `cbc:Percent` en 0,00. Por eso viaja como bandera explícita y no se deduce
   * de que el importe del impuesto sea cero — un cero sin bandera es un cero por
   * accidente.
   */
  vat_excluded?: boolean;
  meta: {
    plan_id: number;
    plan_code: string;
    margin_pct?: string; // Decimal serialized (null when no partner)
    billing_cycle: string;
    prorated?: boolean;
    fresh_purchase?: boolean;
    plan_change?: boolean;
    kind?: ProrationKind;
    unused_credit_applied?: string;
  };
}

/**
 * `subscription_invoices.metadata`, tipado.
 *
 * Es JSON en la base, así que este contrato es una PROMESA de forma, no una
 * garantía del motor: leerlo siempre por los resolvedores del contrato fiscal
 * (`resolveSubscriptionDocumentDiscount`), nunca indexando el JSON a mano.
 */
export interface SubscriptionInvoiceMetadata {
  /** La factura es un ajuste de prorrateo, no un ciclo completo. */
  prorated?: boolean;
  /**
   * Crédito por cambio a plan inferior consumido por esta factura, 2 decimales.
   * Llave HISTÓRICA: existía antes de que el crédito se modelara como descuento
   * de documento y se sigue escribiendo para no romper lecturas anteriores.
   */
  credit_applied?: string;
  /**
   * DESCUENTO A NIVEL DE DOCUMENTO, 2 decimales. Mismo número que
   * `credit_applied`, con el nombre que dice qué ES fiscalmente.
   *
   * Es lo que el emisor fiscal pone en `ProviderInvoiceData.discount_amount`
   * para que salga como `cac:AllowanceCharge` de documento
   * (`ChargeIndicator=false`) en vez de como línea negativa. Una línea negativa
   * descuadra el bruto, la base y el total que la DIAN recompone desde las
   * líneas — la familia de rechazos DAU02 / DAU04 / DAU06.
   */
  document_discount?: string;
}

export interface InvoiceSplitBreakdown {
  /** Vendix share = base_price * quantity (Decimal serialized). */
  vendix_share: string;
  /** Partner share = margin_amount * quantity (Decimal serialized). */
  partner_share: string;
  /** Margin pct used, echoed for audit (Decimal serialized, "0" if no partner). */
  margin_pct_used: string;
  /** Partner organization id (null when no partner). */
  partner_org_id: number | null;
}

export interface InvoicePreview {
  total: string; // Decimal serialized
  period_start: string; // ISO
  period_end: string; // ISO
  line_items: InvoiceLineItem[];
  split_breakdown: InvoiceSplitBreakdown;
  /**
   * Descuento a nivel de DOCUMENTO que la emisión aplicará, 2 decimales.
   *
   * Los previews no lo calculan (el crédito pendiente se resuelve al emitir, con
   * la fila bloqueada `FOR UPDATE`), así que hoy siempre es `'0.00'` o ausente.
   * Existe para que `total` sea legible sin ambigüedad: `Σ line_items.total −
   * document_discount = total`. Ausente ⇒ `'0.00'`.
   */
  document_discount?: string;
}

export type ProrationKind =
  | 'upgrade'
  | 'downgrade'
  | 'same-tier'
  | 'trial_plan_swap'
  | 're_subscribe';

/**
 * Legacy trial plan-swap metadata. Kept for backwards compatibility with old
 * clients, but current trial → free checkout starts a fresh free cycle
 * immediately and does not carry trial_ends_at forward.
 */
export interface TrialPlanSwapInfo {
  old_plan: { id: number; code: string; name: string; base_price: string };
  new_plan: { id: number; code: string; name: string; base_price: string };
  trial_ends_at: string; // ISO
  /** Spanish copy ready for display. */
  message: string;
}

export interface ProrationPreview {
  kind: ProrationKind;
  /**
   * S3.4 — Free-form mode mirroring `kind` for finer-grained UI branches.
   */
  mode?: ProrationKind;
  days_remaining: number;
  cycle_days: number;
  old_effective_price: string; // Decimal serialized
  new_effective_price: string; // Decimal serialized
  /** Positive => charge now, negative => credit for next invoice. */
  proration_amount: string; // Decimal serialized
  applies_immediately: boolean;
  invoice_to_issue: InvoicePreview | null;
  credit_to_apply_next_cycle: string; // Decimal serialized
  /**
   * Legacy payload for older trial-swap previews. New trial → free previews do
   * not set it because the change is immediate.
   */
  trial_swap?: TrialPlanSwapInfo;
  /**
   * Moment when the destination plan takes effect. For immediate paths it
   * mirrors `now`.
   */
  effective_at?: string; // ISO
  /**
   * S3.5 — Set when the source sub has `scheduled_cancel_at` and the
   * checkout will void the scheduled cancellation as a side-effect of the
   * commit (clears `scheduled_cancel_at` + restores `auto_renew=true`). The
   * frontend renders a notice so the user understands the implicit revert.
   */
  voids_scheduled_cancel?: {
    active: boolean;
    scheduled_at: string; // ISO
  };
  /**
   * Whether the destination plan is configured as free (`subscription_plans.is_free=true`).
   * Used by frontend defense-in-depth: if the target is paid AND
   * `proration_amount > 0` AND backend returned `widget=null`, the UI must
   * surface an error rather than navigating to "success". Replaces the legacy
   * `base_price <= 0` heuristic that fails silently when sub.plan is null.
   */
  target_plan_is_free?: boolean;
}

export interface FreePlanInfo {
  plan: {
    id: number;
    code: string;
    name: string;
    effective_price: string; // Decimal serialized — always "0" or "0.00"
    billing_cycle: string;
  };
}

/** Response shape for /checkout/preview. Distinguishes paid vs free plan flows. */
export interface CheckoutPreviewResult {
  proration: ProrationPreview | null;
  invoice: InvoicePreview | null;
  free_plan: FreePlanInfo | null;
  /**
   * S2.1 — Coupon overlay preview. When the request carries a `coupon_code`
   * the backend re-validates and projects the overlay that will land if the
   * commit succeeds. `null` when no coupon was sent or it was invalid.
   */
  coupon?: CouponPreviewInfo | null;
}

export interface CouponPreviewInfo {
  valid: boolean;
  reason?: string;
  reasons_blocked?: string[];
  code: string;
  plan?: {
    id: number;
    code: string;
    name: string;
    plan_type: string;
  };
  overlay_features?: Record<string, unknown>;
  duration_days?: number | null;
  starts_at?: string | null;
  expires_at?: string | null;
}

export interface PartnerLedger {
  accrued: string;
  pending_payout: string;
  paid: string;
  total_history: string;
}

/** Internal — not exported via DTOs. */
export interface ComputedPricing {
  base_price: Prisma.Decimal;
  margin_pct: Prisma.Decimal; // 0 when no partner
  margin_amount: Prisma.Decimal; // 0 when no partner
  fixed_surcharge: Prisma.Decimal; // 0 when no partner
  effective_price: Prisma.Decimal;
  partner_org_id: number | null;
}
