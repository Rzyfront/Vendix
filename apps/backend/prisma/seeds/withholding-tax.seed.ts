import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';

/**
 * Withholding Tax (Retención en la Fuente) Seed
 *
 * Seeds UVT values and default withholding concepts for Colombian tax compliance.
 * Keeps legacy organization defaults with accounting_entity_id=null.
 * Entity-specific records are managed at runtime by fiscal scope services.
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
    const existing = await client.uvt_values.findFirst({
      where: {
        organization_id,
        accounting_entity_id: null,
        year: uvt.year,
      },
      select: { id: true },
    });

    if (existing) {
      await client.uvt_values.update({
        where: { id: existing.id },
        data: { value_cop: uvt.value_cop },
      });
    } else {
      await client.uvt_values.create({
        data: {
          organization_id,
          accounting_entity_id: null,
          year: uvt.year,
          value_cop: uvt.value_cop,
        },
      });
    }
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
    const existing = await client.withholding_concepts.findFirst({
      where: {
        organization_id,
        accounting_entity_id: null,
        code: concept.code,
      },
      select: { id: true },
    });

    const data = {
      name: concept.name,
      rate: concept.rate,
      min_uvt_threshold: concept.min_uvt_threshold,
      applies_to: concept.applies_to,
      supplier_type_filter: concept.supplier_type_filter,
      is_active: true,
    };

    if (existing) {
      await client.withholding_concepts.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await client.withholding_concepts.create({
        data: {
          organization_id,
          accounting_entity_id: null,
          code: concept.code,
          ...data,
        },
      });
    }

    console.log(`  ✅ Concept ${concept.code}: ${concept.name} (${concept.rate * 100}%)`);
  }

  console.log('✅ Withholding tax seed completed');
}
