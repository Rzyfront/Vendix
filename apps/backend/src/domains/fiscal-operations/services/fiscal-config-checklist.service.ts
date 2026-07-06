import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { FiscalStatusService } from '@common/services/fiscal-status.service';
import { FiscalOperationsContext } from './fiscal-context-resolver.service';

export interface FiscalConfigChecklistItem {
  key: string;
  label: string;
  complete: boolean;
  detail: string;
  /** Semantic navigation key — the frontend maps it to a concrete route. */
  link_hint: string;
  /**
   * Severity of the requirement:
   * - `blocker`: a hard requirement of an *active* fiscal area (fiscal
   *   identity, DIAN/PUC/period/mappings/invoice-resolution while their area
   *   is active). Missing it prevents operating fiscally.
   * - `required`: still needed for a complete setup but not a hard blocker.
   */
  severity: 'blocker' | 'required';
  /**
   * Present only when the item is incomplete and has a clear destination.
   * `navigate` is the wizard step id / route (mirrors `link_hint`).
   */
  action?: { label: string; navigate: string };
}

export interface FiscalConfigChecklist {
  completion_pct: number;
  items: FiscalConfigChecklistItem[];
}

/**
 * Read-only fiscal configuration checklist for the Centro Fiscal.
 *
 * Re-uses {@link FiscalStatusService.buildWizardPrefill} as the single source
 * of truth for everything the activation wizard already verifies (identity,
 * DIAN, PUC, period, taxes, mappings, payroll) and only adds the read-only
 * counters the wizard does not cover: active withholding concepts, active
 * invoice resolutions and the current-year UVT value.
 *
 * Conditional items (`withholding_concepts`, `payroll_config`) depend on the
 * tenant's fiscal_status: when the related fiscal area (accounting / payroll)
 * is INACTIVE they are reported as not-applicable — kept in the array with
 * `complete = true` and an explanatory `detail` — so the completion
 * percentage never penalizes areas the tenant has not opted into.
 */
@Injectable()
export class FiscalConfigChecklistService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly fiscalStatus: FiscalStatusService,
  ) {}

  async build(context: FiscalOperationsContext): Promise<FiscalConfigChecklist> {
    const { organization_id, store_id, accounting_entity_id } = context;
    const client = this.prisma.withoutScope();
    const currentYear = new Date().getFullYear();
    const entityScope = {
      OR: [
        { accounting_entity_id: null },
        { accounting_entity_id },
      ],
    };

    const [prefill, status, withholdingCount, resolutionCount, uvtRow] =
      await Promise.all([
        this.fiscalStatus.buildWizardPrefill({ organization_id, store_id }),
        this.fiscalStatus.read(organization_id, store_id),
        client.withholding_concepts.count({
          where: { organization_id, is_active: true, ...entityScope },
        }),
        client.invoice_resolutions.count({
          where: { accounting_entity_id, is_active: true },
        }),
        client.uvt_values.findFirst({
          where: { organization_id, year: currentYear, ...entityScope },
          select: { id: true, value_cop: true },
        }),
      ]);

    const accountingActive =
      status.fiscal_status.accounting.state !== 'INACTIVE';
    const payrollActive = status.fiscal_status.payroll.state !== 'INACTIVE';
    const invoicingActive =
      status.fiscal_status.invoicing.state !== 'INACTIVE';

    const identityComplete = Boolean(
      prefill.legal_data?.nit &&
        prefill.legal_data?.nit_dv &&
        prefill.legal_data?.fiscal_regime,
    );
    const dianComplete = Boolean(
      prefill.dian_config?.has_certificate &&
        prefill.dian_config?.certificate_expiry &&
        new Date(prefill.dian_config.certificate_expiry).getTime() >
          Date.now(),
    );
    const pucComplete = Boolean(prefill.puc?.exists);
    const periodComplete = Boolean(prefill.accounting_period);
    const taxesComplete = (prefill.default_taxes?.total_categories ?? 0) > 0;
    const mappingsComplete = (prefill.accounting_mappings?.total ?? 0) > 0;
    const payrollComplete = Boolean(
      prefill.payroll_config?.has_minimal || prefill.payroll_config?.enabled,
    );

    const items: FiscalConfigChecklistItem[] = [
      {
        key: 'fiscal_identity',
        label: 'Identidad fiscal',
        complete: identityComplete,
        detail: identityComplete
          ? `NIT ${prefill.legal_data!.nit}-${prefill.legal_data!.nit_dv}, régimen ${prefill.legal_data!.fiscal_regime}`
          : 'Faltan NIT, dígito de verificación o régimen tributario',
        link_hint: 'settings/fiscal',
        // Fiscal identity is the base requirement for every fiscal area.
        severity: 'blocker',
        action: this.actionFor(
          identityComplete,
          'Completar identidad',
          'settings/fiscal',
        ),
      },
      {
        key: 'dian_config',
        label: 'Configuración DIAN',
        complete: dianComplete,
        detail: dianComplete
          ? `Certificado vigente hasta ${prefill.dian_config!.certificate_expiry}`
          : prefill.dian_config?.has_certificate
            ? 'El certificado digital está vencido'
            : 'Falta cargar el certificado digital DIAN',
        link_hint: 'fiscal/dian',
        // The DIAN certificate is a hard requirement only while invoicing is
        // an active area.
        severity: invoicingActive ? 'blocker' : 'required',
        action: this.actionFor(dianComplete, 'Configurar DIAN', 'fiscal/dian'),
      },
      {
        key: 'puc',
        label: 'Plan único de cuentas (PUC)',
        complete: pucComplete,
        detail: pucComplete
          ? `${prefill.puc!.total_accounts} cuentas (${prefill.puc!.postable_accounts} imputables)`
          : 'No hay cuentas contables creadas',
        link_hint: 'accounting/chart-of-accounts',
        severity: accountingActive ? 'blocker' : 'required',
        action: this.actionFor(
          pucComplete,
          'Crear cuentas',
          'accounting/chart-of-accounts',
        ),
      },
      {
        key: 'accounting_period',
        label: 'Período contable abierto',
        complete: periodComplete,
        detail: periodComplete
          ? `Período abierto: ${prefill.accounting_period!.name}`
          : 'No existe un período fiscal abierto',
        link_hint: 'accounting/periods',
        severity: accountingActive ? 'blocker' : 'required',
        action: this.actionFor(
          periodComplete,
          'Abrir período',
          'accounting/periods',
        ),
      },
      {
        key: 'default_taxes',
        label: 'Impuestos configurados',
        complete: taxesComplete,
        detail: taxesComplete
          ? `${prefill.default_taxes!.total_categories} categorías y ${prefill.default_taxes!.total_rates} tarifas`
          : 'No hay categorías de impuestos configuradas',
        link_hint: 'taxes',
        severity: 'required',
        action: this.actionFor(
          taxesComplete,
          'Configurar impuestos',
          'taxes',
        ),
      },
      {
        key: 'accounting_mappings',
        label: 'Mapeos contables',
        complete: mappingsComplete,
        detail: mappingsComplete
          ? `${prefill.accounting_mappings!.total} mapeos activos`
          : 'No hay mapeos contables activos',
        link_hint: 'accounting/mappings',
        severity: accountingActive ? 'blocker' : 'required',
        action: this.actionFor(
          mappingsComplete,
          'Configurar mapeos',
          'accounting/mappings',
        ),
      },
      this.conditionalItem({
        key: 'withholding_concepts',
        label: 'Conceptos de retención',
        severity: 'required',
        actionLabel: 'Configurar retenciones',
        applicable: accountingActive,
        complete: withholdingCount > 0,
        completeDetail: `${withholdingCount} conceptos de retención activos`,
        incompleteDetail: 'No hay conceptos de retención activos',
        notApplicableDetail:
          'No aplica: el área contable está inactiva en fiscal_status',
        link_hint: 'fiscal/withholding',
      }),
      {
        key: 'invoice_resolution',
        label: 'Resolución de facturación activa',
        complete: resolutionCount > 0,
        detail:
          resolutionCount > 0
            ? `${resolutionCount} resoluciones activas`
            : 'No hay resoluciones de facturación activas',
        link_hint: 'invoicing/resolutions',
        // The invoicing resolution is a hard requirement only while invoicing
        // is an active area.
        severity: invoicingActive ? 'blocker' : 'required',
        action: this.actionFor(
          resolutionCount > 0,
          'Crear resolución',
          'invoicing/resolutions',
        ),
      },
      {
        key: 'uvt_current_year',
        label: `Valor UVT ${currentYear}`,
        complete: Boolean(uvtRow),
        detail: uvtRow
          ? `UVT ${currentYear} registrada: ${uvtRow.value_cop}`
          : `No hay valor UVT registrado para ${currentYear}`,
        link_hint: 'fiscal/uvt',
        severity: 'required',
        action: this.actionFor(Boolean(uvtRow), 'Registrar UVT', 'fiscal/uvt'),
      },
      this.conditionalItem({
        key: 'payroll_config',
        label: 'Configuración de nómina',
        severity: 'required',
        actionLabel: 'Configurar nómina',
        applicable: payrollActive,
        complete: payrollComplete,
        completeDetail: 'Configuración mínima de nómina registrada',
        incompleteDetail:
          'Falta la configuración mínima de nómina (frecuencia de pago)',
        notApplicableDetail:
          'No aplica: el área de nómina está inactiva en fiscal_status',
        link_hint: 'payroll/settings',
      }),
    ];

    const completed = items.filter((item) => item.complete).length;
    return {
      completion_pct: Math.round((completed / items.length) * 100),
      items,
    };
  }

  /**
   * Conditional item rule: when the backing fiscal area is inactive the item
   * stays in the array as not-applicable (`complete = true` + explanatory
   * detail) so the frontend can render it greyed-out and the percentage is
   * not penalized. Documented choice over removing it from the array — the
   * UI keeps a stable, predictable set of keys.
   */
  private conditionalItem(params: {
    key: string;
    label: string;
    severity: 'blocker' | 'required';
    actionLabel: string;
    applicable: boolean;
    complete: boolean;
    completeDetail: string;
    incompleteDetail: string;
    notApplicableDetail: string;
    link_hint: string;
  }): FiscalConfigChecklistItem {
    if (!params.applicable) {
      // Not-applicable items are reported complete (never penalized) and carry
      // no action — there is nothing for the operator to do.
      return {
        key: params.key,
        label: params.label,
        complete: true,
        detail: params.notApplicableDetail,
        link_hint: params.link_hint,
        severity: params.severity,
      };
    }
    return {
      key: params.key,
      label: params.label,
      complete: params.complete,
      detail: params.complete
        ? params.completeDetail
        : params.incompleteDetail,
      link_hint: params.link_hint,
      severity: params.severity,
      action: this.actionFor(
        params.complete,
        params.actionLabel,
        params.link_hint,
      ),
    };
  }

  /**
   * Builds the `action` for an item: only present when the item is incomplete
   * (there is something to do). `navigate` mirrors the item's `link_hint`.
   */
  private actionFor(
    complete: boolean,
    label: string,
    navigate: string,
  ): { label: string; navigate: string } | undefined {
    return complete ? undefined : { label, navigate };
  }
}
