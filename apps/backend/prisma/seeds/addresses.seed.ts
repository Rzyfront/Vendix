import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';

export interface SeedAddressesResult {
  addressesCreated: number;
}

/**
 * DEPENDENCIES: This seed function must be called AFTER:
 * 1. seedOrganizationsAndStores() - Organizations and stores must exist
 * 2. seedUsers() - Users must exist
 *
 * Creates addresses for organizations, stores, and users
 */
export async function seedAddresses(
  prisma?: PrismaClient,
): Promise<SeedAddressesResult> {
  const client = prisma || getPrismaClient();

  // Fetch required organizations, stores, and users
  const vendixOrg = await client.organizations.findUnique({
    where: { slug: 'vendix-corp' },
  });
  const techSolutionsOrg = await client.organizations.findUnique({
    where: { slug: 'tech-solutions' },
  });
  const fashionRetailOrg = await client.organizations.findUnique({
    where: { slug: 'fashion-retail' },
  });

  const techStore1 = await client.stores.findFirst({
    where: {
      organization_id: techSolutionsOrg?.id,
      slug: 'tech-bogota',
    },
  });
  const techStore2 = await client.stores.findFirst({
    where: {
      organization_id: techSolutionsOrg?.id,
      slug: 'tech-medellin',
    },
  });
  const fashionStore1 = await client.stores.findFirst({
    where: {
      organization_id: fashionRetailOrg?.id,
      slug: 'fashion-norte',
    },
  });

  const customer1 = await client.users.findFirst({
    where: { username: 'miguel.santos' },
  });
  const customer2 = await client.users.findFirst({
    where: { username: 'isabella.vargas' },
  });

  const addresses = [
    // Organization addresses
    {
      address_line1: 'Carrera 15 # 88-64',
      address_line2: 'Piso 8',
      city: 'Bogotá',
      state_province: 'Bogotá D.C.',
      country_code: 'COL',
      postal_code: '110221',
      phone_number: '+57-1-1234567',
      type: 'headquarters',
      is_primary: true,
      organization_id: vendixOrg?.id,
    },
    {
      address_line1: 'Calle 10 # 42-28',
      address_line2: 'Edificio Tech Tower',
      city: 'Medellín',
      state_province: 'Antioquia',
      country_code: 'COL',
      postal_code: '050021',
      phone_number: '+57-4-7654321',
      type: 'headquarters',
      is_primary: true,
      organization_id: techSolutionsOrg?.id,
    },
    {
      address_line1: 'Avenida 68 # 22-45',
      city: 'Bogotá',
      state_province: 'Bogotá D.C.',
      country_code: 'COL',
      postal_code: '110231',
      phone_number: '+57-2-3344556',
      type: 'headquarters',
      is_primary: true,
      organization_id: fashionRetailOrg?.id,
    },
    // Store addresses
    {
      address_line1: 'Centro Comercial Santafé',
      address_line2: 'Local 205, Nivel 2',
      city: 'Bogotá',
      state_province: 'Bogotá D.C.',
      country_code: 'COL',
      postal_code: '110221',
      phone_number: '+57-1-9876543',
      type: 'store_physical',
      is_primary: true,
      store_id: techStore1?.id,
    },
    {
      address_line1: 'Centro Comercial Oviedo',
      address_line2: 'Local 112',
      city: 'Medellín',
      state_province: 'Antioquia',
      country_code: 'COL',
      postal_code: '050021',
      phone_number: '+57-4-8765432',
      type: 'store_physical',
      is_primary: true,
      store_id: techStore2?.id,
    },
    {
      address_line1: 'Centro Comercial Andino',
      address_line2: 'Local 305, Nivel 3',
      city: 'Bogotá',
      state_province: 'Bogotá D.C.',
      country_code: 'COL',
      postal_code: '110231',
      phone_number: '+57-1-7654321',
      type: 'store_physical',
      is_primary: true,
      store_id: fashionStore1?.id,
    },
    // User addresses
    {
      address_line1: 'Carrera 7 # 125-30',
      address_line2: 'Apartamento 501',
      city: 'Bogotá',
      state_province: 'Bogotá D.C.',
      country_code: 'COL',
      postal_code: '110111',
      phone_number: '+57-300-1234567',
      type: 'home',
      is_primary: true,
      user_id: customer1?.id,
    },
    {
      address_line1: 'Calle 85 # 12-45',
      address_line2: 'Apartamento 202',
      city: 'Medellín',
      state_province: 'Antioquia',
      country_code: 'COL',
      postal_code: '050022',
      phone_number: '+57-301-9876543',
      type: 'home',
      is_primary: true,
      user_id: customer2?.id,
    },
  ];

  let addressesCreated = 0;

  for (const address of addresses) {
    const existing = await client.addresses.findFirst({
      where: {
        address_line1: address.address_line1,
        city: address.city,
        ...(address.organization_id && { organization_id: address.organization_id }),
        ...(address.store_id && { store_id: address.store_id }),
        ...(address.user_id && { user_id: address.user_id }),
      },
    });

    if (existing) {
      continue;
    }

    await client.addresses.create({
      data: {
        address_line1: address.address_line1,
        address_line2: address.address_line2,
        city: address.city,
        state_province: address.state_province,
        country_code: address.country_code,
        postal_code: address.postal_code,
        phone_number: address.phone_number,
        type: address.type as any,
        is_primary: address.is_primary,
        store_id: address.store_id,
        user_id: address.user_id,
      },
    });
    addressesCreated++;
  }

  return {
    addressesCreated,
  };
}
