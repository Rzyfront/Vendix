import { Prisma, PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';

interface FiscalRuleSeed {
  rule_type: string;
  name: string;
  version: string;
  rules: Prisma.InputJsonObject;
}

/**
 * Seeds global Colombian fiscal rule sets used by Fiscal Operations snapshots.
 *
 * These are operational baselines, not a substitute for accountant review.
 * Entity-specific overrides are created by the application at runtime.
 */
export async function seedFiscalRuleSets(prisma?: PrismaClient) {
  const client = prisma || getPrismaClient();
  console.log('🌱 Seeding fiscal rule sets...');

  const year = 2026;
  const effectiveFrom = new Date('2026-01-01T00:00:00.000Z');
  const rules: FiscalRuleSeed[] = [
    {
      rule_type: 'vat',
      name: 'IVA Colombia 2026',
      version: '2026.1',
      rules: {
        rates: [19, 5, 0],
        categories: ['gravado', 'exento', 'excluido'],
        generated_source_types: ['sales_invoice', 'debit_note', 'credit_note'],
        deductible_source_types: ['purchase_invoice', 'support_document'],
        requires_accepted_electronic_documents: true,
        disclaimer:
          'Borrador interno. Validar con contador antes de presentar.',
      },
    },
    {
      rule_type: 'withholding',
      name: 'Retención en la fuente Colombia 2026',
      version: '2026.1',
      rules: {
        source: 'withholding_concepts',
        supports_uvt: true,
        requires_third_party_tax_id: true,
        groups_by: ['concept_code', 'third_party_tax_id'],
        disclaimer: 'Usa conceptos configurados por entidad fiscal.',
      },
    },
    {
      rule_type: 'reteiva',
      name: 'ReteIVA Colombia 2026',
      version: '2026.1',
      rules: {
        source: 'withholding_concepts',
        concept_match: ['iva', 'reteiva'],
        supports_uvt: true,
        requires_third_party_tax_id: true,
      },
    },
    {
      rule_type: 'reteica',
      name: 'ReteICA Colombia 2026',
      version: '2026.1',
      rules: {
        source: 'withholding_concepts',
        concept_match: ['ica', 'reteica'],
        municipality_required: true,
        requires_third_party_tax_id: true,
      },
    },
    {
      rule_type: 'ica',
      name: 'ICA Colombia 2026',
      version: '2026.1',
      rules: {
        source: 'ica_municipal_rates',
        rate_unit: 'per_mil',
        groups_by: ['municipality_code', 'ciiu_code'],
        fallback_allowed: true,
      },
    },
    {
      rule_type: 'exogenous',
      name: 'Información exógena Colombia 2026',
      version: '2026.1',
      rules: {
        supported_formats: [
          '1001',
          '1003',
          '1005',
          '1006',
          '1007',
          '1008',
          '1009',
        ],
        requires_third_party_tax_id: true,
        requires_concept_code: true,
        output_evidence_types: ['exogenous_txt', 'declaration_excel'],
      },
    },
    {
      rule_type: 'income_tax',
      name: 'Pre-cierre renta Colombia 2026',
      version: '2026.1',
      rules: {
        source: 'posted_accounting_entries',
        revenue_account_types: ['revenue'],
        deduction_account_types: ['expense'],
        output: 'preclose_workpaper',
        disclaimer: 'Pre-cierre operativo, no declaración oficial automática.',
      },
    },
    {
      rule_type: 'payroll',
      name: 'Nómina fiscal Colombia 2026',
      version: '2026.1',
      rules: {
        source: 'payroll_system_defaults',
        electronic_payroll_required_for_close: true,
        supports_adjustment_notes: false,
        output_evidence_types: ['xml_signed', 'xml_response', 'pdf'],
      },
    },
    {
      rule_type: 'obligation_calendar',
      name: 'Calendario fiscal base Colombia 2026',
      version: '2026.1',
      rules: {
        monthly_due_day: 20,
        quarterly_due_day: 20,
        exogenous_due_month: 4,
        exogenous_due_day: 30,
        income_precierre_month: 3,
        income_precierre_day: 31,
        note: 'Fecha base operativa. Ajustar por NIT y calendario DIAN real al configurar la entidad.',
      },
    },
  ];

  let created = 0;
  let updated = 0;

  for (const rule of rules) {
    const existing = await client.fiscal_rule_sets.findFirst({
      where: {
        organization_id: null,
        accounting_entity_id: null,
        country_code: 'CO',
        year,
        rule_type: rule.rule_type,
        version: rule.version,
      },
      select: { id: true },
    });

    if (existing) {
      await client.fiscal_rule_sets.update({
        where: { id: existing.id },
        data: {
          status: 'active',
          name: rule.name,
          effective_from: effectiveFrom,
          rules: rule.rules,
        },
      });
      updated += 1;
    } else {
      await client.fiscal_rule_sets.create({
        data: {
          organization_id: null,
          accounting_entity_id: null,
          country_code: 'CO',
          year,
          rule_type: rule.rule_type,
          status: 'active',
          name: rule.name,
          version: rule.version,
          effective_from: effectiveFrom,
          rules: rule.rules,
        },
      });
      created += 1;
    }
  }

  console.log(`  ✅ Fiscal rule sets: ${created} created, ${updated} updated`);
  return { created, updated };
}
