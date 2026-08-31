import {
  COMPLETED_SALE_STATES,
  RECOGNIZED_EXPENSE_STATES,
  PURCHASE_COMMITTED_STATES,
  computeOperatingRevenue,
  computeGrowth,
  round2,
  sqlStateList,
  CostCoverage,
  buildCostCoverage,
  // CASH BASIS block — every symbol below MUST stay exported. Merging any
  // PR that deletes one of these will fail this spec; that is the canary
  // the per-PR merge loop relies on.
  CASH_INCOME_PAYMENT_STATES,
  REFUND_CASH_OUT_STATES,
  REFUND_PENDING_STATES,
  EXPENSE_CASH_OUT_STATES,
  PASSTHROUGH_TAX_TYPES,
  PASSTHROUGH_TAX_SET,
  prorateByPayment,
} from './analytics-metrics.contract';

/**
 * Analytics-metrics contract — regression spec.
 *
 * Anchor of the per-PR merge loop for ~33 reports/analytics PRs (see
 * `plans/validated-seeking-comet.md`, CP-REPORTS-ANALYTICS-MERGE-2026-08).
 *
 * The CASH BASIS symbols (CASH_INCOME_PAYMENT_STATES, REFUND_CASH_OUT_STATES,
 * REFUND_PENDING_STATES, EXPENSE_CASH_OUT_STATES, PASSTHROUGH_TAX_TYPES,
 * prorateByPayment) are the contract surface that the `dashboard_cash_basis`
 * panel depends on. Many of the 17 andres2005md PR branches were forked
 * from a pre-contract base; when rebased onto `origin/dev` without the
 * Anchor they would silently delete this block. This spec fails if any
 * symbol is missing or its value drifts.
 *
 * The spec is intentionally dependency-free (no Prisma, no Nest, no
 * fixtures) so it runs in <100ms and can gate every merge in CI even
 * when the `backend-test` job is disabled via `.github/workflows/ci.yml`.
 */
describe('Analytics-metrics contract (Anchor regression)', () => {
  describe('Devengo (accrual) constants', () => {
    it('exports COMPLETED_SALE_STATES as the canonical sale-completion tuple', () => {
      expect(COMPLETED_SALE_STATES).toEqual(['delivered', 'finished']);
    });

    it('exports RECOGNIZED_EXPENSE_STATES as the canonical expense-recognition tuple', () => {
      expect(RECOGNIZED_EXPENSE_STATES).toEqual(['approved', 'paid']);
    });

    it('exports PURCHASE_COMMITTED_STATES as the canonical purchase-commitment tuple', () => {
      expect(PURCHASE_COMMITTED_STATES).toEqual(['approved', 'partial', 'received']);
    });
  });

  describe('CASH BASIS constants — must never be removed by a stale-base rebase', () => {
    it('exports CASH_INCOME_PAYMENT_STATES', () => {
      expect(CASH_INCOME_PAYMENT_STATES).toEqual([
        'succeeded',
        'captured',
        'refunded',
        'partially_refunded',
      ]);
    });

    it('exports REFUND_CASH_OUT_STATES', () => {
      expect(REFUND_CASH_OUT_STATES).toEqual(['completed', 'approved']);
    });

    it('exports REFUND_PENDING_STATES', () => {
      expect(REFUND_PENDING_STATES).toEqual([
        'requested',
        'pending_approval',
        'processing',
      ]);
    });

    it('exports EXPENSE_CASH_OUT_STATES', () => {
      expect(EXPENSE_CASH_OUT_STATES).toEqual(['paid']);
    });

    it('exports PASSTHROUGH_TAX_TYPES', () => {
      expect(PASSTHROUGH_TAX_TYPES).toEqual(['iva', 'inc']);
    });

    it('exports PASSTHROUGH_TAX_SET derived from PASSTHROUGH_TAX_TYPES', () => {
      expect(PASSTHROUGH_TAX_SET).toBeInstanceOf(Set);
      expect([...PASSTHROUGH_TAX_SET]).toEqual(['iva', 'inc']);
    });

    it('exports prorateByPayment as a callable function', () => {
      expect(typeof prorateByPayment).toBe('function');
      // Smoke: amount/total=0.4 should yield 40% of the orderComponent
      expect(
        prorateByPayment(1000, 400, 1000),
      ).toBe(400);
      // Smoke: amount > total (defensive) should clamp to the component
      expect(
        prorateByPayment(1000, 2000, 1000),
      ).toBe(1000);
    });
  });

  describe('Operating revenue — formula is subtotal − discounts + shipping (no VAT)', () => {
    it('returns subtotal when no discounts and no shipping', () => {
      expect(
        computeOperatingRevenue({
          subtotal: 1000,
          discounts: 0,
          shipping: 0,
          tax: 190,
        }),
      ).toBe(1000);
    });

    it('subtracts discounts', () => {
      expect(
        computeOperatingRevenue({
          subtotal: 1000,
          discounts: 100,
          shipping: 0,
          tax: 171,
        }),
      ).toBe(900);
    });

    it('adds shipping', () => {
      expect(
        computeOperatingRevenue({
          subtotal: 1000,
          discounts: 100,
          shipping: 50,
          tax: 180,
        }),
      ).toBe(950);
    });

    it('ignores tax (the field is present for context but never enters the formula)', () => {
      const taxZero = computeOperatingRevenue({
        subtotal: 500,
        discounts: 0,
        shipping: 0,
        tax: 0,
      });
      const taxHigh = computeOperatingRevenue({
        subtotal: 500,
        discounts: 0,
        shipping: 0,
        tax: 5000,
      });
      expect(taxZero).toBe(taxHigh);
    });
  });

  describe('Growth — null when previous is 0 (no base for comparison)', () => {
    it('returns null when previous = 0', () => {
      expect(computeGrowth(100, 0)).toBeNull();
    });

    it('returns 0 when current = previous = 0 (treated as null too)', () => {
      expect(computeGrowth(0, 0)).toBeNull();
    });

    // Estas dos esperaban una FRACCIÓN (0.5 / -0.5). `computeGrowth` devuelve un
    // PORCENTAJE: su propio doc comment lo dice en mayúsculas (`:241`) y el
    // cuerpo termina en `* 100` (`:254`). El spec estaba escrito contra una API
    // imaginada, igual que las de `CostCoverage` y `sqlStateList` en este mismo
    // archivo — y las tres sobrevivieron porque los `TS2339` tumbaban la suite
    // entera antes de que ninguna aserción llegara a ejecutarse.
    it('returns the percent change when previous > 0', () => {
      expect(computeGrowth(150, 100)).toBe(50);
    });

    it('returns the negative percent change', () => {
      expect(computeGrowth(50, 100)).toBe(-50);
    });
  });

  describe('round2 — half-away-from-zero at 2 decimals', () => {
    it('rounds 1.005 to 1.01 (not 1.00)', () => {
      expect(round2(1.005)).toBe(1.01);
    });
    it('rounds 1.0049 to 1.00', () => {
      expect(round2(1.0049)).toBe(1.0);
    });
    it('rounds -1.005 to -1.01', () => {
      expect(round2(-1.005)).toBe(-1.01);
    });
  });

  describe('sqlStateList — safe Prisma.Sql template for IN (...) clauses', () => {
    // La aserción anterior afirmaba que los estados viajan como PARÁMETROS
    // (`values`), y es falso: `sqlStateList` usa `Prisma.raw` (contrato `:159`),
    // que INTERPOLA los literales en el texto SQL y deja `values` vacío. Eso es
    // deliberado y está documentado en `:149-151` — la comparación tiene que
    // quedar sobre el tipo enum nativo para que los índices
    // `(store_id, state, created_at)` sigan siendo usables; un
    // `state::text = ANY($1)` los tiraría.
    //
    // Lo importante: si no hay parametrización, lo ÚNICO que separa a esta
    // función de una inyección SQL es el filtro `SAFE_STATE_REGEX` (`:142`,
    // `/^[a-z_]+$/`). El spec anterior no lo probaba — afirmaba una seguridad
    // que venía de otro mecanismo. Aquí se prueba el mecanismo real.
    it('interpola los literales en el texto, no como parámetros', () => {
      const sql = sqlStateList(COMPLETED_SALE_STATES);
      expect(typeof sql).not.toBe('string');
      expect((sql as any).strings).toBeDefined();
      expect((sql as any).values).toEqual([]);
      expect(sql.sql).toBe(
        COMPLETED_SALE_STATES.map((s) => `'${s}'`).join(', '),
      );
    });

    it('el filtro de charset descarta un literal con intención de inyección', () => {
      // Con `'; DROP TABLE orders; --` el filtro lo descarta y, al no quedar
      // ninguno válido, la función prefiere reventar antes que emitir un `IN ()`
      // vacío —que en Postgres es error de sintaxis— o, peor, la carga útil.
      expect(() => sqlStateList(["x'; DROP TABLE orders; --"])).toThrow(
        'sqlStateList: no valid state literals',
      );
      // Y si viene mezclado con uno legítimo, sólo sobrevive el legítimo.
      const mixto = sqlStateList(['delivered', "x'; DROP TABLE orders; --"]);
      expect(mixto.sql).toBe("'delivered'");
    });
  });

  describe('CostCoverage — emitted whenever COGS is emitted (rule 7 of tz:audit)', () => {
    // Estas aserciones nombraban `total_units` y `warns_when_partial`, dos
    // propiedades que `CostCoverage` no tiene ni tuvo: la forma real es
    // `units_total` / `units_without_cost` / `coverage_ratio` (contrato
    // `:217-224`). No era una regresión del contrato — el contrato está en uso
    // productivo y `org-inventory-reports.service.ts:397` y `:457` arman con
    // esos tres campos el mensaje que ve el usuario cuando la valuación es
    // parcial. El spec era el equivocado, y el spec hermano
    // `org-inventory-reports.service.spec.ts` ya usaba los nombres buenos.
    //
    // Por qué sobrevivió: dos `TS2339` no producen un fallo de aserción, tumban
    // la suite entera, y una suite que no compila reporta `Tests: 0 total` y NO
    // aparece en el conteo de `Tests:`. Encima `nest build` no la ve, porque
    // `tsconfig.build.json` excluye las specs. Sólo jest sobre la carpeta
    // completa la delata.
    //
    // `warns_when_partial` se traduce a su equivalente real: la cobertura
    // parcial es exactamente `coverage_ratio < 1`.
    it('buildCostCoverage flags when any unit lacks a snapshot cost', () => {
      const cov: CostCoverage = buildCostCoverage(100, 5);
      expect(cov.units_total).toBe(100);
      expect(cov.units_without_cost).toBe(5);
      expect(cov.coverage_ratio).toBeCloseTo(0.95);
      expect(cov.coverage_ratio).toBeLessThan(1);
    });

    it('buildCostCoverage is clean when every unit has a snapshot cost', () => {
      const cov: CostCoverage = buildCostCoverage(100, 0);
      expect(cov.units_total).toBe(100);
      expect(cov.units_without_cost).toBe(0);
      expect(cov.coverage_ratio).toBe(1);
    });
  });
});