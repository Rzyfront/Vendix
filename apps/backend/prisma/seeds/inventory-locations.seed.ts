import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';

export interface SeedInventoryLocationsResult {
  locationsCreated: number;
}

/**
 * DEPENDENCIES: This seed function must be called AFTER:
 * 1. seedOrganizationsAndStores() - Organizations and stores must exist
 *
 * Creates inventory locations (warehouses and store locations)
 */
export async function seedInventoryLocations(
  prisma?: PrismaClient,
): Promise<SeedInventoryLocationsResult> {
  const client = prisma || getPrismaClient();

  // Fetch required organizations and stores
  const techSolutionsOrg = await client.organizations.findUnique({
    where: { slug: 'tech-solutions' },
  });
  const fashionRetailOrg = await client.organizations.findUnique({
    where: { slug: 'fashion-retail' },
  });

  if (!techSolutionsOrg || !fashionRetailOrg) {
    throw new Error(
      'Required organizations not found. Please run seedOrganizationsAndStores() first.',
    );
  }

  const techStore1 = await client.stores.findFirst({
    where: {
      organization_id: techSolutionsOrg.id,
      slug: 'tech-bogota',
    },
  });
  const techStore2 = await client.stores.findFirst({
    where: {
      organization_id: techSolutionsOrg.id,
      slug: 'tech-medellin',
    },
  });
  const fashionStore1 = await client.stores.findFirst({
    where: {
      organization_id: fashionRetailOrg.id,
      slug: 'fashion-norte',
    },
  });

  if (!techStore1 || !techStore2 || !fashionStore1) {
    throw new Error(
      'Required stores not found. Please run seedOrganizationsAndStores() first.',
    );
  }

  const locations = [
    // Locations for Tech Solutions
    {
      name: 'Bodega Principal Bogotá',
      code: 'TECH-BOG-001',
      type: 'warehouse',
      organization_id: techSolutionsOrg.id,
      store_id: techStore1.id,
      is_active: true,
    },
    {
      name: 'Tienda Tech Bogotá',
      code: 'TECH-BOG-STORE',
      type: 'store',
      organization_id: techSolutionsOrg.id,
      store_id: techStore1.id,
      is_active: true,
    },
    {
      name: 'Bodega Medellín',
      code: 'TECH-MED-001',
      type: 'warehouse',
      organization_id: techSolutionsOrg.id,
      store_id: techStore2.id,
      is_active: true,
    },
    // Locations for Fashion Retail
    {
      name: 'Bodega Principal',
      code: 'FASH-BOG-001',
      type: 'warehouse',
      organization_id: fashionRetailOrg.id,
      store_id: fashionStore1.id,
      is_active: true,
    },
    {
      name: 'Tienda Fashion Norte',
      code: 'FASH-BOG-STORE',
      type: 'store',
      organization_id: fashionRetailOrg.id,
      store_id: fashionStore1.id,
      is_active: true,
    },
  ];

  let locationsCreated = 0;

  for (const location of locations) {
    const existing = await client.inventory_locations.findUnique({
      where: {
        organization_id_code: {
          organization_id: location.organization_id,
          code: location.code,
        },
      },
    });

    if (existing) {
      continue;
    }

    await client.inventory_locations.create({
      data: {
        name: location.name,
        code: location.code,
        type: location.type as any,
        store_id: location.store_id,
        organization_id: location.organization_id,
        is_active: location.is_active,
      },
    });
    locationsCreated++;
  }

  return {
    locationsCreated,
  };
}
