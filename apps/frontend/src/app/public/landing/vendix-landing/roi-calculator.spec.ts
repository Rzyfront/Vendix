import type { PublicPlan } from '../../pricing/services/public-plans.service';
import { estimateAnnualSavings, referenceAnnualPrice } from './roi-calculator';

const plan = (p: Partial<PublicPlan>): PublicPlan => p as PublicPlan;

describe('roi-calculator', () => {
  const plans = [
    plan({ plan_group_code: 'empresarial-pro', billing_cycle: 'monthly', base_price: 89900 }),
    plan({ plan_group_code: 'empresarial-pro', billing_cycle: 'annual', base_price: 969000 }),
    plan({ plan_group_code: 'emprendedor-pro', billing_cycle: 'annual', base_price: 749000 }),
  ];

  it('usa el precio anual publicado de Empresarial Pro', () => {
    expect(referenceAnnualPrice(plans)).toBe(969000);
  });

  it('cae a 12 × el mensual si no hay ciclo anual', () => {
    expect(referenceAnnualPrice(plans.filter((p) => p.billing_cycle !== 'annual'))).toBe(89900 * 12);
  });

  it('devuelve null sin planes cargados', () => {
    expect(referenceAnnualPrice([])).toBeNull();
    expect(estimateAnnualSavings(2, 7200, null)).toBeNull();
  });

  it('sigue el precio de la API cuando cambia', () => {
    const a = estimateAnnualSavings(2, 7200, 969000)!;
    const b = estimateAnnualSavings(2, 7200, 1069000)!;
    expect(a - b).toBe(100000);
  });

  it('no cobra por tienda adicional (tiendas ilimitadas)', () => {
    const perStore = 180000 * 12;
    const s1 = estimateAnnualSavings(1, 1000, 969000)!;
    const s3 = estimateAnnualSavings(3, 1000, 969000)!;
    const s10 = estimateAnnualSavings(10, 1000, 969000)!;
    expect(s3 - s1).toBe(2 * perStore);
    expect(s10 - s3).toBe(7 * perStore);
  });

  it('nunca devuelve ahorro negativo', () => {
    expect(estimateAnnualSavings(1, 0, 99999999)).toBe(0);
  });
});
