import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';

/**
 * ICA Municipal Rates Seed
 * Seeds ICA (Impuesto de Industria y Comercio) rates for major Colombian municipalities.
 * Includes general fallback rates (ciiu_code = null) and specific CIIU rates for Bogota and Medellin.
 */
export async function seedIcaMunicipalRates(prisma?: PrismaClient) {
  const client = prisma || getPrismaClient();
  console.log('🌱 Seeding ICA municipal rates...');

  const effective_date = new Date('2026-01-01T00:00:00.000Z');

  // General rates (ciiu_code = null) for major municipalities
  const general_rates = [
    {
      municipality_code: '11001',
      municipality_name: 'Bogotá D.C.',
      department_code: '11',
      department_name: 'Bogotá D.C.',
      rate_per_mil: 11.04,
    },
    {
      municipality_code: '05001',
      municipality_name: 'Medellín',
      department_code: '05',
      department_name: 'Antioquia',
      rate_per_mil: 10.0,
    },
    {
      municipality_code: '76001',
      municipality_name: 'Cali',
      department_code: '76',
      department_name: 'Valle del Cauca',
      rate_per_mil: 10.0,
    },
    {
      municipality_code: '08001',
      municipality_name: 'Barranquilla',
      department_code: '08',
      department_name: 'Atlántico',
      rate_per_mil: 7.0,
    },
    {
      municipality_code: '13001',
      municipality_name: 'Cartagena',
      department_code: '13',
      department_name: 'Bolívar',
      rate_per_mil: 7.0,
    },
    {
      municipality_code: '68001',
      municipality_name: 'Bucaramanga',
      department_code: '68',
      department_name: 'Santander',
      rate_per_mil: 7.0,
    },
    {
      municipality_code: '66001',
      municipality_name: 'Pereira',
      department_code: '66',
      department_name: 'Risaralda',
      rate_per_mil: 7.0,
    },
    {
      municipality_code: '17001',
      municipality_name: 'Manizales',
      department_code: '17',
      department_name: 'Caldas',
      rate_per_mil: 7.0,
    },
    {
      municipality_code: '50001',
      municipality_name: 'Villavicencio',
      department_code: '50',
      department_name: 'Meta',
      rate_per_mil: 7.0,
    },
    {
      municipality_code: '73001',
      municipality_name: 'Ibagué',
      department_code: '73',
      department_name: 'Tolima',
      rate_per_mil: 7.0,
    },
  ];

  // Specific CIIU rates for Bogota
  const bogota_ciiu_rates = [
    {
      ciiu_code: '4711',
      ciiu_description: 'Comercio al por menor (retail)',
      rate_per_mil: 11.04,
    },
    {
      ciiu_code: '5611',
      ciiu_description: 'Restaurantes',
      rate_per_mil: 13.8,
    },
    {
      ciiu_code: '6201',
      ciiu_description: 'Desarrollo informático',
      rate_per_mil: 9.66,
    },
    {
      ciiu_code: '6311',
      ciiu_description: 'Procesamiento de datos',
      rate_per_mil: 9.66,
    },
    {
      ciiu_code: '4719',
      ciiu_description: 'Otros comercios no especializados',
      rate_per_mil: 11.04,
    },
  ];

  // Specific CIIU rates for Medellin
  const medellin_ciiu_rates = [
    {
      ciiu_code: '4711',
      ciiu_description: 'Comercio al por menor',
      rate_per_mil: 10.0,
    },
    {
      ciiu_code: '5611',
      ciiu_description: 'Restaurantes',
      rate_per_mil: 10.0,
    },
    {
      ciiu_code: '6201',
      ciiu_description: 'Desarrollo informático',
      rate_per_mil: 7.0,
    },
  ];

  let upserted_count = 0;

  /**
   * Helper to upsert an ICA rate.
   * For rates with ciiu_code = null, Prisma's @@unique treats NULLs as distinct,
   * so we use findFirst + create/update instead of upsert.
   */
  async function upsertRate(data: {
    municipality_code: string;
    municipality_name: string;
    department_code: string;
    department_name: string;
    ciiu_code: string | null;
    ciiu_description: string | null;
    rate_per_mil: number;
  }) {
    const existing = await client.ica_municipal_rates.findFirst({
      where: {
        municipality_code: data.municipality_code,
        ciiu_code: data.ciiu_code,
        effective_date,
      },
    });

    if (existing) {
      await client.ica_municipal_rates.update({
        where: { id: existing.id },
        data: {
          municipality_name: data.municipality_name,
          department_code: data.department_code,
          department_name: data.department_name,
          ciiu_description: data.ciiu_description,
          rate_per_mil: data.rate_per_mil,
          is_active: true,
        },
      });
    } else {
      await client.ica_municipal_rates.create({
        data: {
          municipality_code: data.municipality_code,
          municipality_name: data.municipality_name,
          department_code: data.department_code,
          department_name: data.department_name,
          ciiu_code: data.ciiu_code,
          ciiu_description: data.ciiu_description,
          rate_per_mil: data.rate_per_mil,
          effective_date,
          is_active: true,
        },
      });
    }
  }

  // Upsert general rates (ciiu_code = null)
  for (const rate of general_rates) {
    await upsertRate({
      ...rate,
      ciiu_code: null,
      ciiu_description: null,
    });
    upserted_count++;
  }

  // Upsert Bogota CIIU rates
  for (const ciiu_rate of bogota_ciiu_rates) {
    await upsertRate({
      municipality_code: '11001',
      municipality_name: 'Bogotá D.C.',
      department_code: '11',
      department_name: 'Bogotá D.C.',
      ciiu_code: ciiu_rate.ciiu_code,
      ciiu_description: ciiu_rate.ciiu_description,
      rate_per_mil: ciiu_rate.rate_per_mil,
    });
    upserted_count++;
  }

  // Upsert Medellin CIIU rates
  for (const ciiu_rate of medellin_ciiu_rates) {
    await upsertRate({
      municipality_code: '05001',
      municipality_name: 'Medellín',
      department_code: '05',
      department_name: 'Antioquia',
      ciiu_code: ciiu_rate.ciiu_code,
      ciiu_description: ciiu_rate.ciiu_description,
      rate_per_mil: ciiu_rate.rate_per_mil,
    });
    upserted_count++;
  }

  console.log(`✅ ICA municipal rates seeded: ${upserted_count} rates upserted`);

  return { upserted: upserted_count };
}
