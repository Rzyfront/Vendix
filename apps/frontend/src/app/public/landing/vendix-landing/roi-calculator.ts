import type { PublicPlan } from '../../pricing/services/public-plans.service';

/**
 * Supuestos de la calculadora de ahorro de la landing. Son estimaciones de
 * mercado mostradas al visitante; no son precios de Vendix.
 */
export const ROI_ASSUMPTIONS = {
  legacyPosMonthlyPerStore: 180000,
  dianFolioCost: 280,
  webPluginMonthly: 90000,
} as const;

/** Grupo de plan con facturación DIAN contra el que se compara. */
export const ROI_REFERENCE_PLAN_GROUP = 'empresarial-pro';

/**
 * Precio anual real del plan de referencia, leído de los planes publicados.
 * Usa el ciclo anual; si no existe, 12 × el mensual. Sin datos devuelve null
 * para no mostrar una cifra inventada.
 */
export function referenceAnnualPrice(plans: readonly PublicPlan[]): number | null {
  const group = plans.filter((p) => p.plan_group_code === ROI_REFERENCE_PLAN_GROUP);
  const annual = group.find((p) => p.billing_cycle === 'annual');
  const annualPrice = Number(annual?.base_price);
  if (Number.isFinite(annualPrice) && annualPrice > 0) return annualPrice;
  const monthly = group.find((p) => p.billing_cycle === 'monthly');
  const monthlyPrice = Number(monthly?.base_price);
  if (Number.isFinite(monthlyPrice) && monthlyPrice > 0) return monthlyPrice * 12;
  return null;
}

/**
 * Ahorro anual estimado: costo de herramientas separadas menos el plan anual
 * de Vendix. Los planes incluyen tiendas ilimitadas: no hay cargo por tienda.
 */
export function estimateAnnualSavings(
  stores: number,
  monthlyInvoices: number,
  vendixAnnualPrice: number | null,
): number | null {
  if (vendixAnnualPrice === null) return null;
  const a = ROI_ASSUMPTIONS;
  const annualLegacy =
    stores * a.legacyPosMonthlyPerStore * 12 +
    monthlyInvoices * a.dianFolioCost * 12 +
    a.webPluginMonthly * 12;
  return Math.max(0, annualLegacy - vendixAnnualPrice);
}
