import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { WithholdingCalculatorService } from './withholding-calculator.service';
import {
  WithholdingLine,
  WithholdingTypeValue,
  buildWithholdingAccountRole,
} from 'src/common/interfaces/withholding-breakdown.interface';
import {
  CounterpartyType,
  deriveCounterpartyType,
  isSimpleRegime,
} from './withholding-classification.util';

/**
 * A withholding concept as the PURE `evaluate()` core consumes it. Mirrors the
 * relevant columns of `withholding_concepts` but is plain data so the legal
 * gates are unit-testable without a DB.
 */
export interface EvaluableConcept {
  id?: number;
  code: string;
  /** decimal fraction, e.g. 0.025 */
  rate: number;
  /** threshold expressed in UVT (multiplied by uvtValue inside evaluate). */
  min_uvt_threshold: number;
  withholding_type: WithholdingTypeValue;
  /** purchase | service | rent | fees | other */
  applies_to: string;
  /** gran_contribuyente | regimen_simple | persona_natural | any */
  supplier_type_filter: CounterpartyType;
  /** per-concept PUC override; null → Block C resolves the default. */
  account_code?: string | null;
}

/** Fiscal snapshot of the tenant (from store/org fiscal_data). */
export interface TenantFiscalProfile {
  is_withholding_agent?: boolean | null;
  is_self_withholder?: boolean | null;
  /** 'COMUN' | 'SIMPLIFICADO' | 'GRAN_CONTRIBUYENTE' | free text */
  tax_regime?: string | null;
}

/** Fiscal snapshot of a supplier being paid (CASO 1). */
export interface SupplierFiscalProfile {
  tax_regime?: string | null;
  person_type?: string | null;
  is_self_withholder?: boolean | null;
}

/** Fiscal snapshot of a customer buying (CASO 2). */
export interface CustomerFiscalProfile {
  is_withholding_agent?: boolean | null;
  tax_regime?: string | null;
  person_type?: string | null;
}

/**
 * Input to the PURE `evaluate()` core. Everything is already-fetched data; no
 * I/O happens inside `evaluate`.
 */
export type EvaluateParams =
  | {
      role: 'practiced';
      base: number;
      /**
       * IVA amount of the operation. reteIVA is computed on this (15% of IVA),
       * NOT on the subtotal. retefuente/reteICA use `base`. The UVT threshold
       * gate always uses `base` (the operation value).
       */
      ivaAmount?: number;
      uvtValue: number;
      concepts: EvaluableConcept[];
      /**
       * applies_to value(s) that match this purchase. When omitted, all active
       * concepts are evaluated and gate (e) / applies_to filters them.
       */
      appliesTo?: string | string[];
      tenant: TenantFiscalProfile;
      supplier: SupplierFiscalProfile;
    }
  | {
      role: 'suffered';
      base: number;
      /**
       * IVA amount of the operation. reteIVA is computed on this (15% of IVA),
       * NOT on the subtotal. retefuente/reteICA use `base`. The UVT threshold
       * gate always uses `base` (the operation value).
       */
      ivaAmount?: number;
      uvtValue: number;
      concepts: EvaluableConcept[];
      appliesTo?: string | string[];
      tenant: TenantFiscalProfile;
      customer: CustomerFiscalProfile;
    };

@Injectable()
export class WithholdingResolverService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly calculator: WithholdingCalculatorService,
  ) {}

  /**
   * PURE deterministic core. Applies the Colombian legal gates and returns the
   * withholding lines that apply. NO DB access — fully unit-testable.
   *
   * CASO 1 — role='practiced' (tenant buys, may withhold a SUPPLIER):
   *   (a) tenant.is_withholding_agent === true
   *   (b) NOT (retefuente AND supplier.is_self_withholder)        // autorretenedor
   *   (c) NOT (retefuente AND supplierType === 'regimen_simple')  // RST no retefuente renta
   *   (d) base >= concept.min_uvt_threshold * uvtValue
   *   (e) concept.supplier_type_filter === 'any' OR === supplierType
   *
   * CASO 2 — role='suffered' (tenant sells, a CUSTOMER withholds the tenant):
   *   (a) customer.is_withholding_agent === true
   *   (b) NOT (retefuente AND (tenantIsSimpleRegime OR tenant.is_self_withholder))
   *   (c) base >= concept.min_uvt_threshold * uvtValue
   *   (d) concept matches applies_to for the sale
   */
  evaluate(params: EvaluateParams): WithholdingLine[] {
    const { role, base, uvtValue, concepts } = params;
    const ivaAmount = Number(params.ivaAmount ?? 0);
    const appliesToSet = this.normalizeAppliesTo(params.appliesTo);
    // Collect every concept that passes the gates, then keep AT MOST ONE per
    // withholding_type (deterministic selection below) to avoid double-applying
    // e.g. two retefuente concepts to the same operation.
    const candidates: Array<{
      line: WithholdingLine;
      specificity: number;
      threshold: number;
      code: string;
    }> = [];

    for (const concept of concepts) {
      // Gate (d/c): applies_to must match the operation when a filter is given.
      if (appliesToSet && !appliesToSet.has(concept.applies_to)) {
        continue;
      }

      // Gate: minimum UVT threshold in COP.
      const threshold_cop = concept.min_uvt_threshold * uvtValue;
      if (base < threshold_cop) {
        continue;
      }

      const isRetefuente = concept.withholding_type === 'retefuente';

      if (role === 'practiced') {
        // (a) I only retain if I am an agente retenedor.
        if (params.tenant.is_withholding_agent !== true) continue;

        const supplierType = deriveCounterpartyType(
          params.supplier.tax_regime,
          params.supplier.person_type,
        );

        // (b) autorretenedor: no se le practica retefuente.
        if (isRetefuente && params.supplier.is_self_withholder === true) {
          continue;
        }
        // (c) régimen simple no sujeto a retefuente renta.
        if (isRetefuente && supplierType === 'regimen_simple') {
          continue;
        }
        // (e) concept supplier_type_filter must match.
        if (
          concept.supplier_type_filter !== 'any' &&
          concept.supplier_type_filter !== supplierType
        ) {
          continue;
        }
      } else {
        // CASO 2 — suffered.
        // (a) only an agent customer withholds me.
        if (params.customer.is_withholding_agent !== true) continue;

        // (b) régimen simple no le retienen renta; autorretenedor se autorretiene.
        const tenantIsSimpleRegime = isSimpleRegime(params.tenant.tax_regime);
        if (
          isRetefuente &&
          (tenantIsSimpleRegime || params.tenant.is_self_withholder === true)
        ) {
          continue;
        }
      }

      // reteIVA is computed on the IVA amount of the operation; retefuente and
      // reteICA are computed on the operation subtotal (`base`). The UVT
      // threshold gate above always uses `base` (the operation value).
      const effectiveBase =
        concept.withholding_type === 'reteiva' ? ivaAmount : base;
      const amount = Math.round(effectiveBase * concept.rate * 100) / 100;
      candidates.push({
        line: {
          withholding_type: concept.withholding_type,
          concept_code: concept.code,
          concept_id: concept.id,
          rate: concept.rate,
          base: effectiveBase,
          amount,
          role,
          account_role: buildWithholdingAccountRole(
            role,
            concept.withholding_type,
          ),
          account_code: concept.account_code ?? null,
        },
        specificity: concept.supplier_type_filter !== 'any' ? 1 : 0,
        threshold: concept.min_uvt_threshold,
        code: concept.code,
      });
    }

    // Deterministic selection: at most one line per withholding_type. Prefer an
    // exact supplier_type_filter match over 'any', then the highest UVT
    // threshold, then the lexicographically lowest concept code.
    const best = new Map<string, (typeof candidates)[number]>();
    for (const cand of candidates) {
      const key = cand.line.withholding_type;
      const cur = best.get(key);
      if (
        !cur ||
        cand.specificity > cur.specificity ||
        (cand.specificity === cur.specificity &&
          cand.threshold > cur.threshold) ||
        (cand.specificity === cur.specificity &&
          cand.threshold === cur.threshold &&
          cand.code < cur.code)
      ) {
        best.set(key, cand);
      }
    }

    return Array.from(best.values()).map((c) => c.line);
  }

  /**
   * Thin I/O wrapper: loads the org's active concepts + UVT value, maps them to
   * `EvaluableConcept`, then delegates to the PURE `evaluate()` core.
   */
  async resolve(
    context:
      | {
          role: 'practiced';
          organization_id: number;
          base: number;
          /** IVA amount of the operation; reteIVA is computed on this. */
          ivaAmount?: number;
          year?: number;
          appliesTo?: string | string[];
          tenant: TenantFiscalProfile;
          supplier: SupplierFiscalProfile;
        }
      | {
          role: 'suffered';
          organization_id: number;
          base: number;
          /** IVA amount of the operation; reteIVA is computed on this. */
          ivaAmount?: number;
          year?: number;
          appliesTo?: string | string[];
          tenant: TenantFiscalProfile;
          customer: CustomerFiscalProfile;
        },
  ): Promise<WithholdingLine[]> {
    const year = context.year || new Date().getFullYear();

    // Reuse the calculator's UVT lookup (single source of UVT logic).
    const uvtValue = await this.calculator.getUvtValue(
      context.organization_id,
      year,
    );

    const rows = await this.prisma.withholding_concepts.findMany({
      where: { organization_id: context.organization_id, is_active: true },
    });

    const concepts: EvaluableConcept[] = rows.map((c) => ({
      id: c.id,
      code: c.code,
      rate: Number(c.rate),
      min_uvt_threshold: Number(c.min_uvt_threshold),
      withholding_type: c.withholding_type as WithholdingTypeValue,
      applies_to: c.applies_to as string,
      supplier_type_filter: c.supplier_type_filter as CounterpartyType,
      account_code: c.account_code ?? null,
    }));

    if (context.role === 'practiced') {
      return this.evaluate({
        role: 'practiced',
        base: context.base,
        ivaAmount: context.ivaAmount,
        uvtValue,
        concepts,
        appliesTo: context.appliesTo,
        tenant: context.tenant,
        supplier: context.supplier,
      });
    }

    return this.evaluate({
      role: 'suffered',
      base: context.base,
      ivaAmount: context.ivaAmount,
      uvtValue,
      concepts,
      appliesTo: context.appliesTo,
      tenant: context.tenant,
      customer: context.customer,
    });
  }

  private normalizeAppliesTo(
    appliesTo?: string | string[],
  ): Set<string> | null {
    if (appliesTo === undefined) return null;
    const arr = Array.isArray(appliesTo) ? appliesTo : [appliesTo];
    return arr.length > 0 ? new Set(arr) : null;
  }
}
