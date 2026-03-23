import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';

/**
 * Withholding Tax (Retención en la Fuente) Seed
 *
 * Seeds UVT values and default withholding concepts for Colombian tax compliance.
 * Uses upsert for idempotency based on unique constraints:
 * - uvt_values: [organization_id, year]
 * - withholding_concepts: [organization_id, code]
 */
export async function seedWithholdingTax(
  prisma?: PrismaClient,
  organization_id: number = 1,
) {
  const client = prisma || getPrismaClient();
  console.log('🌱 Seeding withholding tax data...');

  // ===== UVT Values =====
  const uvt_values = [
    { year: 2025, value_cop: 47065 },
    { year: 2026, value_cop: 49799 },
  ];

  for (const uvt of uvt_values) {
    await client.uvt_values.upsert({
      where: {
        organization_id_year: {
          organization_id,
          year: uvt.year,
        },
      },
      update: {
        value_cop: uvt.value_cop,
      },
      create: {
        organization_id,
        year: uvt.year,
        value_cop: uvt.value_cop,
      },
    });
    console.log(`  ✅ UVT ${uvt.year}: $${uvt.value_cop.toLocaleString('es-CO')}`);
  }

  // ===== Withholding Concepts =====
  const concepts = [
    {
      code: 'RTE_COMPRAS',
      name: 'Retención en Compras',
      rate: 0.025,
      min_uvt_threshold: 27,
      applies_to: 'purchase' as const,
      supplier_type_filter: 'any' as const,
    },
    {
      code: 'RTE_SERV_GEN',
      name: 'Retención en Servicios Generales',
      rate: 0.04,
      min_uvt_threshold: 4,
      applies_to: 'service' as const,
      supplier_type_filter: 'any' as const,
    },
    {
      code: 'RTE_SERV_DEC',
      name: 'Retención en Servicios Declarantes',
      rate: 0.04,
      min_uvt_threshold: 4,
      applies_to: 'service' as const,
      supplier_type_filter: 'any' as const,
    },
    {
      code: 'RTE_HONOR',
      name: 'Retención en Honorarios',
      rate: 0.11,
      min_uvt_threshold: 0,
      applies_to: 'fees' as const,
      supplier_type_filter: 'any' as const,
    },
    {
      code: 'RTE_HONOR_PN',
      name: 'Retención en Honorarios Persona Natural',
      rate: 0.10,
      min_uvt_threshold: 0,
      applies_to: 'fees' as const,
      supplier_type_filter: 'persona_natural' as const,
    },
    {
      code: 'RTE_ARREND',
      name: 'Retención en Arrendamientos',
      rate: 0.035,
      min_uvt_threshold: 27,
      applies_to: 'rent' as const,
      supplier_type_filter: 'any' as const,
    },
    {
      code: 'RTE_OTROS',
      name: 'Retención Otros Conceptos',
      rate: 0.035,
      min_uvt_threshold: 0,
      applies_to: 'other' as const,
      supplier_type_filter: 'any' as const,
    },
  ];

  for (const concept of concepts) {
    await client.withholding_concepts.upsert({
      where: {
        organization_id_code: {
          organization_id,
          code: concept.code,
        },
      },
      update: {
        name: concept.name,
        rate: concept.rate,
        min_uvt_threshold: concept.min_uvt_threshold,
        applies_to: concept.applies_to,
        supplier_type_filter: concept.supplier_type_filter,
        is_active: true,
      },
      create: {
        organization_id,
        code: concept.code,
        name: concept.name,
        rate: concept.rate,
        min_uvt_threshold: concept.min_uvt_threshold,
        applies_to: concept.applies_to,
        supplier_type_filter: concept.supplier_type_filter,
        is_active: true,
      },
    });
    console.log(`  ✅ Concept ${concept.code}: ${concept.name} (${concept.rate * 100}%)`);
  }

  console.log('✅ Withholding tax seed completed');
}
