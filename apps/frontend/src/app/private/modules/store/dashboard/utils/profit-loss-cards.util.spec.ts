import { OrganizationProfitLossSummary } from '../../../organization/stores/interfaces/store.interface';
import {
  buildBalanceSubText,
  buildGananciasSubText,
  buildGastosSubText,
  buildIncompleteCostText,
  buildIngresosSubText,
  getGrowthText,
  hasIncompleteCost,
} from './profit-loss-cards.util';

const fmt = (v: number) => `$${v}`;

function make(
  over: Partial<OrganizationProfitLossSummary['cash']> = {},
  root: Partial<OrganizationProfitLossSummary> = {},
): OrganizationProfitLossSummary {
  return {
    store_count: 2,
    cash: {
      income: 1000,
      income_without_tax: 800,
      refunds: 0,
      refunds_tax: 0,
      refunds_pending: 0,
      net_profit: 300,
      net_profit_after_expenses: 200,
      net_margin: 0,
      balance: 150,
      balance_accumulated: 900,
      expenses_paid: 100,
      cost_coverage: { units_total: 10, units_without_cost: 0, coverage_ratio: 1 },
      ...over,
    },
    operating_expenses: 100,
    comparison: { operating_expenses: 80, expenses_growth: 25 },
    ...root,
  };
}

describe('profit-loss-cards.util', () => {
  it('gastos: usa la etiqueta recibida (mes ant.)', () => {
    expect(buildGastosSubText(make(), fmt, 'mes ant.')).toBe('+25.0% vs mes ant.');
    expect(buildGastosSubText(make({ expenses_paid: 60 }), fmt, 'mes ant.')).toBe(
      '+25.0% vs mes ant. · Pagado: $60',
    );
  });

  it('getGrowthText: etiqueta parametrizada y sin base', () => {
    expect(getGrowthText(-3.14, 'semana ant.')).toBe('-3.1% vs semana ant.');
    expect(getGrowthText(null, 'mes ant.')).toBe('sin base de comparación');
  });

  it('ingresos: solo Sin IVA cuando no hay reembolsos', () => {
    expect(buildIngresosSubText(make(), fmt)).toBe('Sin IVA: $800');
  });

  it('ingresos: agrega Reembolsos y Por reembolsar', () => {
    const d = make({ refunds: 50, refunds_pending: 20 });
    expect(buildIngresosSubText(d, fmt)).toBe(
      'Sin IVA: $800 · Reembolsos: $50 · Por reembolsar: $20',
    );
  });

  it('ganancias: Tras gastos sin margen si es 0', () => {
    expect(buildGananciasSubText(make(), fmt)).toBe('Tras gastos: $200');
  });

  it('ganancias: Tras gastos con margen', () => {
    expect(buildGananciasSubText(make({ net_margin: 12.34 }), fmt)).toBe(
      'Tras gastos: $200 · 12.3% margen',
    );
  });

  it('ganancias/balance: vacío sin datos', () => {
    expect(buildGananciasSubText(null, fmt)).toBe('');
    expect(buildBalanceSubText(null, fmt)).toBe('');
  });

  it('balance: Caja acumulada', () => {
    expect(buildBalanceSubText(make(), fmt)).toBe('Caja acumulada: $900');
  });

  it('gastos: crecimiento vs ayer y sin Pagado cuando coincide', () => {
    expect(buildGastosSubText(make(), fmt, 'ayer')).toBe('+25.0% vs ayer');
  });

  it('gastos: crecimiento negativo', () => {
    const d = make({}, { comparison: { operating_expenses: 1, expenses_growth: -5 } });
    expect(buildGastosSubText(d, fmt, 'ayer')).toBe('-5.0% vs ayer');
  });

  it('gastos: growth null -> sin base de comparación', () => {
    const d = make({}, { comparison: { operating_expenses: 0, expenses_growth: null } });
    expect(buildGastosSubText(d, fmt, 'ayer')).toBe('sin base de comparación');
    expect(getGrowthText(undefined, 'ayer')).toBe('sin base de comparación');
  });

  it('gastos: Pagado cuando difiere del reconocido', () => {
    expect(buildGastosSubText(make({ expenses_paid: 60 }), fmt, 'ayer')).toBe(
      '+25.0% vs ayer · Pagado: $60',
    );
  });

  it('gastos: sin datos solo muestra la base de comparación', () => {
    expect(buildGastosSubText(null, fmt, 'ayer')).toBe('sin base de comparación');
  });

  it('costo incompleto: aviso cuando hay unidades sin costo', () => {
    const d = make({
      cost_coverage: { units_total: 10, units_without_cost: 3, coverage_ratio: 0.7 },
    });
    expect(hasIncompleteCost(d)).toBeTrue();
    expect(buildIncompleteCostText(d)).toBe(
      '3 de 10 unidades vendidas no tienen costo registrado (cobertura 70 %). La ganancia mostrada está sobreestimada hasta que se registre ese costo.',
    );
  });

  it('costo incompleto: sin aviso con cobertura total o sin datos', () => {
    expect(hasIncompleteCost(make())).toBeFalse();
    expect(buildIncompleteCostText(make())).toBe('');
    expect(hasIncompleteCost(null)).toBeFalse();
  });
});
