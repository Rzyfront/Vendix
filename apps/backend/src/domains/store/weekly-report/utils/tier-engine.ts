import { WeeklyTier } from '../types';

/**
 * Tier engine determinista.
 *
 * Reglas de negocio (alineadas con el plan):
 *   - ZERO     → revenue == 0 y orders == 0
 *   - STELLAR  → revenue >= 1.30 × rolling4w (>= +30%)
 *   - ABOVE    → revenue >= 1.05 × rolling4w (>= +5%)
 *   - BELOW    → todo lo demás con actividad
 *   - ZERO     → sin actividad
 *
 * Umbrales configurables vía constante. En el MVP no son parametrizables
 * por tienda; si el patrón se replica, ver "Knowledge Gaps" en el plan.
 */
const TIER_THRESHOLDS = {
  STELLAR_MIN_GROWTH: 0.3, // +30% sobre el promedio
  ABOVE_MIN_GROWTH: 0.05, // +5% sobre el promedio
  BELOW_MIN_REVENUE: 0, // cualquier ingreso > 0 cuenta como actividad
};

export interface TierInput {
  currentRevenue: number;
  currentOrders: number;
  rolling4wRevenue: number;
  rolling4wOrders: number;
}

export function classifyTier(input: TierInput): WeeklyTier {
  const { currentRevenue, currentOrders, rolling4wRevenue } = input;

  if (currentRevenue <= 0 && currentOrders <= 0) {
    return 'ZERO';
  }

  // Si no hay histórico (tienda nueva), no podemos comparar → BELOW por defecto.
  if (rolling4wRevenue <= 0) {
    return 'BELOW';
  }

  const growth = (currentRevenue - rolling4wRevenue) / rolling4wRevenue;

  if (growth >= TIER_THRESHOLDS.STELLAR_MIN_GROWTH) {
    return 'STELLAR';
  }
  if (growth >= TIER_THRESHOLDS.ABOVE_MIN_GROWTH) {
    return 'ABOVE';
  }
  return 'BELOW';
}
