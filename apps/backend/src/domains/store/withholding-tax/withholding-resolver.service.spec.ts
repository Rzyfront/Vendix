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
});
