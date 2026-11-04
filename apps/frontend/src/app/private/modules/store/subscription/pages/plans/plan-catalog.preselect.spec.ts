import { resolveCatalogPreselection } from './plan-catalog.component';

describe('resolveCatalogPreselection (paywall → página de planes)', () => {
  const PLANS = [
    { code: 'vendix-impulsa', billing_cycle: 'monthly' },
    { code: 'empresarial-pro-monthly', billing_cycle: 'monthly' },
    { code: 'empresarial-pro-annual', billing_cycle: 'annual' },
    { code: 'emprendedor-pro-annual', billing_cycle: 'annual' },
  ] as any[];

  it('sin query: ciclo por defecto (anual) y ningún plan resaltado — página sin cambios', () => {
    expect(resolveCatalogPreselection(PLANS, {})).toEqual({ cycle: 'annual', planCode: null });
  });

  it('con plan y ciclo: preselecciona el ciclo y resalta el plan', () => {
    expect(
      resolveCatalogPreselection(PLANS, { plan: 'empresarial-pro-monthly', cycle: 'monthly' }),
    ).toEqual({ cycle: 'monthly', planCode: 'empresarial-pro-monthly' });
  });

  it('solo plan: usa el ciclo del plan', () => {
    expect(resolveCatalogPreselection(PLANS, { plan: 'empresarial-pro-monthly' })).toEqual({
      cycle: 'monthly',
      planCode: 'empresarial-pro-monthly',
    });
  });

  it('plan desconocido o ciclo inexistente caen al comportamiento por defecto', () => {
    expect(resolveCatalogPreselection(PLANS, { plan: 'no-existe', cycle: 'lifetime' })).toEqual({
      cycle: 'annual',
      planCode: null,
    });
  });

  it('ciclo pedido distinto al del plan: manda el ciclo y no resalta un plan de otro ciclo', () => {
    expect(
      resolveCatalogPreselection(PLANS, { plan: 'empresarial-pro-monthly', cycle: 'annual' }),
    ).toEqual({ cycle: 'annual', planCode: null });
  });
});
