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

/**
 * Cliente Prisma mínimo que `resolve` necesita, para poder recibir el `tx` de una
 * transacción en curso en vez de salir por otra conexión del pool. Se declara acá
 * y no se importa de `withholding-flow.service` para no crear un ciclo: el flow ya
 * importa `TenantFiscalProfile` de este archivo.
 */
export interface ResolverDbClient {
  uvt_values: { findFirst: (args: any) => any };
  withholding_concepts: { findMany: (args: any) => any };
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
    }
  | {
      /**
       * CASO 3 — AUTORRETENCIÓN. La tienda vende y se retiene A SÍ MISMA.
       *
       * No lleva contraparte: quién compra es irrelevante. La autorretención
       * nace de una calidad del EMISOR (Decreto 2201/2016 para renta, régimen
       * municipal de autorretención para ICA), no de que el comprador sea
       * agente retenedor. Por eso el discriminante no declara `customer` ni
       * `supplier`: pedirlos sugeriría que la contraparte puede impedirla, y no
       * puede.
       */
      role: 'self';
      base: number;
      ivaAmount?: number;
      uvtValue: number;
      concepts: EvaluableConcept[];
      appliesTo?: string | string[];
      tenant: TenantFiscalProfile;
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
   *
   * CASO 3 — role='self' (AUTORRETENCIÓN: the tenant withholds itself):
   *   (a) tenant.is_self_withholder === true
   *   (b) NOT reteiva — ver abajo
   *   (c) NOT tenantIsSimpleRegime (el RST no es autorretenedor de renta)
   *   (d) base >= concept.min_uvt_threshold * uvtValue
   *
   * ## Por qué `self` EXCLUYE reteIVA
   *
   * La autorretención existe en renta (Decreto 2201/2016) y en ICA (régimen de
   * autorretención de varios municipios). En IVA no: el art. 437-2 E.T. lista
   * los agentes de retención de IVA y en todos los numerales quien retiene es
   * la CONTRAPARTE. La única figura parecida —el «IVA teórico» del num. 3 por
   * servicios prestados desde el exterior— es una retención ASUMIDA sobre una
   * compra, o sea `practiced`, no una autorretención sobre la propia venta.
   *
   * Y el error sería mudo: reteIVA se calcula sobre el IVA del documento, así
   * que emitir una autorretención de IVA generaría un pasivo con la DIAN que la
   * ley no exige, sin que nada falle y sin que ninguna validación del anexo lo
   * detecte —`cac:WithholdingTaxTotal` no altera el `PayableAmount`—. Se
   * descubriría al conciliar la declaración, meses después.
   *
   * ## Por qué `self` y `suffered` son MUTUAMENTE EXCLUYENTES
   *
   * La compuerta (b) de CASO 2 ya excluye retefuente cuando el emisor es
   * autorretenedor: si yo me autorretengo, mi cliente NO me retiene. Los dos
   * casos leen el MISMO flag (`tenant.is_self_withholder`) con el signo opuesto,
   * así que un concepto no puede salir por los dos caminos y la retención no se
   * puede duplicar.
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
      } else if (role === 'suffered') {
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
      } else {
        // CASO 3 — self (autorretención). Ver la nota del doc-comment.
        // (a) sólo se autorretiene quien tiene la calidad de autorretenedor.
        if (params.tenant.is_self_withholder !== true) continue;

        // (b) no hay autorretención de IVA: la figura del art. 437-2 E.T. la
        // practica siempre la contraparte.
        if (concept.withholding_type === 'reteiva') continue;

        // (c) el RST no es autorretenedor de renta (art. 911 E.T.: el régimen
        // simple sustituye el impuesto de renta y no está sujeto a retención
        // ni autorretención a ese título).
        if (isRetefuente && isSimpleRegime(params.tenant.tax_regime)) {
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
          client?: ResolverDbClient;
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
          client?: ResolverDbClient;
        }
      | {
          /** Autorretención — sin contraparte. Ver `EvaluateParams`. */
          role: 'self';
          organization_id: number;
          base: number;
          /** IVA de la operación. No lo usa `self` (reteIVA está excluido). */
          ivaAmount?: number;
          year?: number;
          appliesTo?: string | string[];
          tenant: TenantFiscalProfile;
          client?: ResolverDbClient;
        },
  ): Promise<WithholdingLine[]> {
    const year = context.year || new Date().getFullYear();

    // Reuse the calculator's UVT lookup (single source of UVT logic).
    const uvtValue = await this.calculator.getUvtValue(
      context.organization_id,
      year,
      context.client,
    );

    // `context.client` = el `tx` del llamador, para no tomar una segunda conexión
    // del pool. El `organization_id` explícito mantiene la lectura tenant-safe
    // aunque el `tx` venga sin el scoping de la extensión.
    const rows = await (
      context.client ?? this.prisma
    ).withholding_concepts.findMany({
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

    if (context.role === 'self') {
      return this.evaluate({
        role: 'self',
        base: context.base,
        ivaAmount: context.ivaAmount,
        uvtValue,
        concepts,
        appliesTo: context.appliesTo,
        tenant: context.tenant,
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

  /**
   * Atajo de `resolve({ role: 'self', ... })` para el flujo de emisión.
   *
   * Existe como método propio y no como una llamada más a `resolve` porque la
   * autorretención es la única de las tres que NO depende de una contraparte:
   * el llamador no tiene que buscar un proveedor ni un cliente antes de
   * preguntar. Un método que pide exactamente lo que necesita —el perfil fiscal
   * del emisor y la base— evita que quien lo cablee crea que le falta un dato.
   */
  async resolveSelfWithholding(context: {
    organization_id: number;
    base: number;
    year?: number;
    appliesTo?: string | string[];
    tenant: TenantFiscalProfile;
    client?: ResolverDbClient;
  }): Promise<WithholdingLine[]> {
    return this.resolve({ role: 'self', ...context });
  }

  private normalizeAppliesTo(
    appliesTo?: string | string[],
  ): Set<string> | null {
    if (appliesTo === undefined) return null;
    const arr = Array.isArray(appliesTo) ? appliesTo : [appliesTo];
    return arr.length > 0 ? new Set(arr) : null;
  }
}
