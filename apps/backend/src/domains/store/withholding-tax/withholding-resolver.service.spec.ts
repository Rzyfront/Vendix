import {
  WithholdingResolverService,
  EvaluableConcept,
  TenantFiscalProfile,
  SupplierFiscalProfile,
  CustomerFiscalProfile,
} from './withholding-resolver.service';

/**
 * Unit tests for the PURE `evaluate()` core — no DB, no NestJS DI.
 * Validates the Colombian legal gates that make withholding deterministic.
 */
describe('WithholdingResolverService.evaluate (pure core)', () => {
  // The pure core touches neither prisma nor the calculator, so undefined deps
  // are fine — only `evaluate` is exercised here.
  const resolver = new WithholdingResolverService(
    undefined as any,
    undefined as any,
  );

  const UVT = 1000; // arbitrary COP/UVT for tests

  const retefuente: EvaluableConcept = {
    id: 1,
    code: 'RF-SERVICIOS',
    rate: 0.04,
    min_uvt_threshold: 4, // 4 UVT → 4000 COP threshold
    withholding_type: 'retefuente',
    applies_to: 'service',
    supplier_type_filter: 'any',
    account_code: '236520',
  };

  const reteiva: EvaluableConcept = {
    id: 2,
    code: 'RIVA-15',
    rate: 0.15,
    min_uvt_threshold: 4,
    withholding_type: 'reteiva',
    applies_to: 'service',
    supplier_type_filter: 'any',
    account_code: null,
  };

  const agentTenant: TenantFiscalProfile = {
    is_withholding_agent: true,
    is_self_withholder: false,
    tax_regime: 'COMUN',
  };

  const normalSupplier: SupplierFiscalProfile = {
    tax_regime: 'COMUN',
    person_type: 'JURIDICA',
    is_self_withholder: false,
  };

  describe('CASO 1 — practiced (tenant buys, withholds supplier)', () => {
    it('(i) régimen simple supplier → no retefuente practiced', () => {
      const lines = resolver.evaluate({
        role: 'practiced',
        base: 100_000,
        uvtValue: UVT,
        concepts: [retefuente],
        tenant: agentTenant,
        supplier: { tax_regime: 'SIMPLE', person_type: 'JURIDICA' },
      });
      expect(lines).toHaveLength(0);
    });

    it('régimen simple supplier still suffers reteiva (only retefuente gated)', () => {
      const lines = resolver.evaluate({
        role: 'practiced',
        base: 100_000,
        uvtValue: UVT,
        concepts: [retefuente, reteiva],
        tenant: agentTenant,
        supplier: { tax_regime: 'RST', person_type: 'JURIDICA' },
      });
      expect(lines.map((l) => l.withholding_type)).toEqual(['reteiva']);
    });

    it('(ii) autorretenedor supplier → no retefuente', () => {
      const lines = resolver.evaluate({
        role: 'practiced',
        base: 100_000,
        uvtValue: UVT,
        concepts: [retefuente],
        tenant: agentTenant,
        supplier: { ...normalSupplier, is_self_withholder: true },
      });
      expect(lines).toHaveLength(0);
    });

    it('(iii) base below threshold → empty', () => {
      const lines = resolver.evaluate({
        role: 'practiced',
        base: 3_000, // below 4 UVT * 1000 = 4000
        uvtValue: UVT,
        concepts: [retefuente],
        tenant: agentTenant,
        supplier: normalSupplier,
      });
      expect(lines).toHaveLength(0);
    });

    it('(iv) multi-concept retefuente + reteiva both apply → 2 lines', () => {
      const lines = resolver.evaluate({
        role: 'practiced',
        base: 1_000_000,
        ivaAmount: 190_000, // IVA 19% of the subtotal
        uvtValue: UVT,
        concepts: [retefuente, reteiva],
        tenant: agentTenant,
        supplier: normalSupplier,
      });
      expect(lines).toHaveLength(2);

      const rf = lines.find((l) => l.withholding_type === 'retefuente')!;
      expect(rf.amount).toBe(40_000); // 1,000,000 * 0.04
      expect(rf.base).toBe(1_000_000); // retefuente base = subtotal
      expect(rf.role).toBe('practiced');
      expect(rf.account_role).toBe('withholding.practiced.retefuente_payable');
      expect(rf.account_code).toBe('236520');

      const riva = lines.find((l) => l.withholding_type === 'reteiva')!;
      expect(riva.amount).toBe(28_500); // 190,000 (IVA) * 0.15
      expect(riva.base).toBe(190_000); // reteIVA base = IVA amount, NOT subtotal
      expect(riva.account_role).toBe('withholding.practiced.reteiva_payable');
      expect(riva.account_code).toBeNull();
    });

    it('(iv-bis) reteIVA is computed on the IVA amount, not the subtotal', () => {
      // Same operation, different IVA values → reteIVA tracks IVA, retefuente
      // stays on the subtotal.
      const linesHighIva = resolver.evaluate({
        role: 'practiced',
        base: 1_000_000,
        ivaAmount: 50_000, // an unusual low IVA on this base
        uvtValue: UVT,
        concepts: [reteiva],
        tenant: agentTenant,
        supplier: normalSupplier,
      });
      const riva = linesHighIva.find((l) => l.withholding_type === 'reteiva')!;
      expect(riva.amount).toBe(7_500); // 50,000 * 0.15 — NOT 150,000
      expect(riva.base).toBe(50_000);
    });

    it('(v) tenant.is_withholding_agent=false → empty for Caso 1', () => {
      const lines = resolver.evaluate({
        role: 'practiced',
        base: 1_000_000,
        uvtValue: UVT,
        concepts: [retefuente, reteiva],
        tenant: { ...agentTenant, is_withholding_agent: false },
        supplier: normalSupplier,
      });
      expect(lines).toHaveLength(0);
    });

    it('supplier_type_filter mismatch → concept skipped', () => {
      const granOnly: EvaluableConcept = {
        ...retefuente,
        supplier_type_filter: 'gran_contribuyente',
      };
      const lines = resolver.evaluate({
        role: 'practiced',
        base: 1_000_000,
        uvtValue: UVT,
        concepts: [granOnly],
        tenant: agentTenant,
        supplier: { tax_regime: 'COMUN', person_type: 'JURIDICA' },
      });
      expect(lines).toHaveLength(0);
    });

    it('appliesTo filter excludes non-matching concepts', () => {
      const lines = resolver.evaluate({
        role: 'practiced',
        base: 1_000_000,
        uvtValue: UVT,
        concepts: [retefuente, reteiva],
        appliesTo: 'rent', // neither concept is rent
        tenant: agentTenant,
        supplier: normalSupplier,
      });
      expect(lines).toHaveLength(0);
    });
  });

  describe('CASO 2 — suffered (tenant sells, customer withholds tenant)', () => {
    const agentCustomer: CustomerFiscalProfile = {
      is_withholding_agent: true,
      tax_regime: 'COMUN',
      person_type: 'JURIDICA',
    };

    it('(vi) customer not agent → empty', () => {
      const lines = resolver.evaluate({
        role: 'suffered',
        base: 1_000_000,
        uvtValue: UVT,
        concepts: [retefuente, reteiva],
        tenant: { tax_regime: 'COMUN', is_self_withholder: false },
        customer: { ...agentCustomer, is_withholding_agent: false },
      });
      expect(lines).toHaveLength(0);
    });

    it('(vii) tenant régimen simple → no retefuente suffered', () => {
      const lines = resolver.evaluate({
        role: 'suffered',
        base: 1_000_000,
        uvtValue: UVT,
        concepts: [retefuente, reteiva],
        tenant: { tax_regime: 'SIMPLIFICADO', is_self_withholder: false },
        customer: agentCustomer,
      });
      // retefuente gated; reteiva still suffered
      expect(lines.map((l) => l.withholding_type)).toEqual(['reteiva']);
    });

    it('tenant autorretenedor → no retefuente suffered', () => {
      const lines = resolver.evaluate({
        role: 'suffered',
        base: 1_000_000,
        uvtValue: UVT,
        concepts: [retefuente],
        tenant: { tax_regime: 'COMUN', is_self_withholder: true },
        customer: agentCustomer,
      });
      expect(lines).toHaveLength(0);
    });

    it('agent customer + common-regime tenant → both lines, receivable role', () => {
      const lines = resolver.evaluate({
        role: 'suffered',
        base: 1_000_000,
        uvtValue: UVT,
        concepts: [retefuente, reteiva],
        tenant: { tax_regime: 'COMUN', is_self_withholder: false },
        customer: agentCustomer,
      });
      expect(lines).toHaveLength(2);
      const rf = lines.find((l) => l.withholding_type === 'retefuente')!;
      expect(rf.role).toBe('suffered');
      expect(rf.account_role).toBe(
        'withholding.suffered.retefuente_receivable',
      );
      const riva = lines.find((l) => l.withholding_type === 'reteiva')!;
      expect(riva.account_role).toBe('withholding.suffered.reteiva_receivable');
    });
  });

  /**
   * Step 1 — plan `docs/plans/PLAN-pago-multimetodo-pendientes.md`.
   *
   * Fixtures mirroring `prisma/seeds/withholding-tax.seed.ts` (rate,
   * min_uvt_threshold, applies_to, supplier_type_filter idénticos). UVT fijado
   * en el valor 2025 real del seed ($49.799) — con el UVT 2026 ($52.374) los
   * tres montos de aceptación del plan cruzan los mismos umbrales, así que la
   * elección de año no cambia ninguna aserción.
   */
  describe('CASO 2 — suffered por operación (Step 1, RTE_COMPRAS/RTE_SERV_GEN/gate)', () => {
    const UVT_2025 = 49799;

    const commonTenant: TenantFiscalProfile = {
      tax_regime: 'COMUN',
      is_self_withholder: false,
    };
    const agentCustomer2: CustomerFiscalProfile = {
      is_withholding_agent: true,
      tax_regime: 'COMUN',
      person_type: 'JURIDICA',
    };

    const RTE_COMPRAS: EvaluableConcept = {
      id: 10,
      code: 'RTE_COMPRAS',
      rate: 0.025,
      min_uvt_threshold: 27,
      withholding_type: 'retefuente',
      applies_to: 'purchase',
      supplier_type_filter: 'any',
      account_code: null,
    };
    const RTE_SERV_GEN: EvaluableConcept = {
      id: 11,
      code: 'RTE_SERV_GEN',
      rate: 0.04,
      min_uvt_threshold: 4,
      withholding_type: 'retefuente',
      applies_to: 'service',
      supplier_type_filter: 'any',
      account_code: null,
    };
    // `withholding_type: 'retefuente'` igual que RTE_COMPRAS — así compite en
    // el MISMO bucket de desempate cuando ningún `appliesTo` los separa
    // (justo lo que hacían los 4 call sites antes de este Step 1).
    const RTE_HONOR_PN: EvaluableConcept = {
      id: 12,
      code: 'RTE_HONOR_PN',
      rate: 0.1,
      min_uvt_threshold: 0,
      withholding_type: 'retefuente',
      applies_to: 'fees',
      supplier_type_filter: 'persona_natural',
      account_code: null,
    };

    it('bien 1.500.000 (appliesTo=purchase) ⇒ RTE_COMPRAS 37.500', () => {
      const lines = resolver.evaluate({
        role: 'suffered',
        base: 1_500_000,
        uvtValue: UVT_2025,
        concepts: [RTE_COMPRAS, RTE_HONOR_PN],
        appliesTo: 'purchase',
        tenant: commonTenant,
        customer: agentCustomer2,
      });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        concept_code: 'RTE_COMPRAS',
        amount: 37_500,
      });
    });

    it('bien 1.000.000, bajo el umbral 27 UVT (≈1.344.573) ⇒ sin retefuente', () => {
      const lines = resolver.evaluate({
        role: 'suffered',
        base: 1_000_000,
        uvtValue: UVT_2025,
        concepts: [RTE_COMPRAS],
        appliesTo: 'purchase',
        tenant: commonTenant,
        customer: agentCustomer2,
      });
      expect(lines).toHaveLength(0);
    });

    it('servicio 300.000 (appliesTo=service) ⇒ RTE_SERV_GEN 12.000', () => {
      // RTE_SERV_DEC queda fuera de este fixture a propósito: el seed real lo
      // define con los MISMOS criterios de match que RTE_SERV_GEN (rate,
      // threshold, applies_to y supplier_type_filter idénticos), así que el
      // desempate por código ('RTE_SERV_DEC' < 'RTE_SERV_GEN') elegiría
      // SIEMPRE RTE_SERV_DEC — un problema de datos del seed preexistente y
      // ajeno a este Step 1 (documentado en el informe final).
      const lines = resolver.evaluate({
        role: 'suffered',
        base: 300_000,
        uvtValue: UVT_2025,
        concepts: [RTE_SERV_GEN],
        appliesTo: 'service',
        tenant: commonTenant,
        customer: agentCustomer2,
      });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        concept_code: 'RTE_SERV_GEN',
        amount: 12_000,
      });
    });

    it('RTE_HONOR_PN nunca gana en suffered, ni sin appliesTo (regresión de la causa raíz)', () => {
      // Antes del gate (c): `specificity: supplier_type_filter !== 'any' ? 1 : 0`
      // premiaba a RTE_HONOR_PN sobre RTE_COMPRAS en el desempate por
      // `withholding_type` ('retefuente' en ambos) cuando el caller no pasaba
      // `appliesTo` — exactamente los 4 call sites antes de este Step 1.
      const lines = resolver.evaluate({
        role: 'suffered',
        base: 1_500_000,
        uvtValue: UVT_2025,
        concepts: [RTE_COMPRAS, RTE_HONOR_PN],
        // appliesTo omitido a propósito: reproduce el bug de los call sites.
        tenant: commonTenant,
        customer: agentCustomer2,
      });
      expect(lines).toHaveLength(1);
      expect(lines[0].concept_code).toBe('RTE_COMPRAS');
      expect(lines.some((l) => l.concept_code === 'RTE_HONOR_PN')).toBe(
        false,
      );
    });

    it('practiced NO cambia: supplier_type_filter sigue filtrando por el proveedor (decisión #3)', () => {
      const lines = resolver.evaluate({
        role: 'practiced',
        base: 1_500_000,
        uvtValue: UVT_2025,
        concepts: [RTE_HONOR_PN],
        tenant: agentTenant,
        supplier: { tax_regime: 'COMUN', person_type: 'NATURAL' },
      });
      expect(lines).toHaveLength(1);
      expect(lines[0].concept_code).toBe('RTE_HONOR_PN');
    });
  });
});
