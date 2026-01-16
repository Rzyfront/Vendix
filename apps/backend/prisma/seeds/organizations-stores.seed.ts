import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';

/**
 * Seed organizations and stores data
 * Creates 5 organizations with their respective stores and settings
 */
export async function seedOrganizationsAndStores(
  prisma?: PrismaClient,
): Promise<{
  organizationsCreated: number;
  storesCreated: number;
  settingsCreated: number;
}> {
  const client = prisma || getPrismaClient();

  // Organizations data
  const organizations = [
    {
      name: 'Vendix Corp',
      slug: 'vendix-corp',
      email: 'admin@vendix.com',
      legal_name: 'Vendix Corporation S.A.S.',
      tax_id: '900123456-7',
      phone: '+57-1-1234567',
      website: 'https://vendix.com',
      description: 'Corporación principal de Vendix - Plataforma multitenant',
      state: 'active',
    },
    {
      name: 'Tech Solutions S.A.',
      slug: 'tech-solutions',
      email: 'contacto@techsolutions.co',
      legal_name: 'Tech Solutions Sociedad Anónima',
      tax_id: '800987654-3',
      phone: '+57-4-7654321',
      website: 'https://techsolutions.vendix.com',
      description: 'Empresa de tecnología y soluciones digitales',
      state: 'active',
    },
    {
      name: 'Fashion Retail Group',
      slug: 'fashion-retail',
      email: 'info@fashionretail.com',
      legal_name: 'Fashion Retail Group Ltda.',
      tax_id: '811223344-5',
      phone: '+57-2-3344556',
      website: 'https://fashionretail.vendix.com',
      description: 'Grupo de retail especializado en moda',
      state: 'active',
    },
    {
      name: 'Gourmet Foods',
      slug: 'gourmet-foods',
      email: 'ventas@gourmetfoods.com',
      legal_name: 'Gourmet Foods Internacional',
      tax_id: '822334455-6',
      phone: '+57-5-4455667',
      website: 'https://gourmetfoods.vendix.com',
      description: 'Distribuidor de alimentos gourmet',
      state: 'draft',
    },
    {
      name: 'Home & Living',
      slug: 'home-living',
      email: 'servicio@homeliving.co',
      legal_name: 'Home & Living Colombia',
      tax_id: '833445566-7',
      phone: '+57-6-5566778',
      website: 'https://homeliving.co',
      description: 'Tienda especializada en hogar y decoración',
      state: 'suspended',
    },
  ];

  const createdOrganizations: any[] = [];
  for (const org of organizations) {
    const createdOrg = await client.organizations.upsert({
      where: { slug: org.slug },
      update: {},
      create: {
        name: org.name,
        slug: org.slug,
        email: org.email,
        legal_name: org.legal_name,
        tax_id: org.tax_id,
        phone: org.phone,
        website: org.website,
        description: org.description,
        state: org.state as any,
      },
    });
    createdOrganizations.push(createdOrg);
  }

  const vendixOrg: any = createdOrganizations[0];
  const techSolutionsOrg: any = createdOrganizations[1];
  const fashionRetailOrg: any = createdOrganizations[2];
  const gourmetFoodsOrg: any = createdOrganizations[3];
  const homeLivingOrg: any = createdOrganizations[4];

  // Stores data
  const stores = [
    // Stores for Vendix Corp
    {
      name: 'Tienda Principal Vendix',
      slug: 'tienda-principal',
      organization_id: vendixOrg.id,
      store_code: 'VNDX001',
      store_type: 'online',
      is_active: true,
      timezone: 'America/Bogota',
    },
    {
      name: 'Vendix Centro',
      slug: 'vendix-centro',
      organization_id: vendixOrg.id,
      store_code: 'VNDX002',
      store_type: 'physical',
      is_active: true,
      timezone: 'America/Bogota',
    },

    // Stores for Tech Solutions
    {
      name: 'Tech Solutions Bogotá',
      slug: 'tech-bogota',
      organization_id: techSolutionsOrg.id,
      store_code: 'TECH001',
      store_type: 'physical',
      is_active: true,
      timezone: 'America/Bogota',
    },
    {
      name: 'Tech Solutions Medellín',
      slug: 'tech-medellin',
      organization_id: techSolutionsOrg.id,
      store_code: 'TECH002',
      store_type: 'physical',
      is_active: true,
      timezone: 'America/Bogota',
    },
    {
      name: 'Tienda Online Tech',
      slug: 'tech-online',
      organization_id: techSolutionsOrg.id,
      store_code: 'TECH003',
      store_type: 'online',
      is_active: true,
      timezone: 'America/Bogota',
    },

    // Stores for Fashion Retail
    {
      name: 'Fashion Retail Norte',
      slug: 'fashion-norte',
      organization_id: fashionRetailOrg.id,
      store_code: 'FSHN001',
      store_type: 'physical',
      is_active: true,
      timezone: 'America/Bogota',
    },
    {
      name: 'Fashion E-commerce',
      slug: 'fashion-online',
      organization_id: fashionRetailOrg.id,
      store_code: 'FSHN002',
      store_type: 'online',
      is_active: true,
      timezone: 'America/Bogota',
    },

    // Stores for Gourmet Foods
    {
      name: 'Gourmet Foods Principal',
      slug: 'gourmet-principal',
      organization_id: gourmetFoodsOrg.id,
      store_code: 'GRMT001',
      store_type: 'physical',
      is_active: false,
      timezone: 'America/Bogota',
    },

    // Stores for Home & Living
    {
      name: 'Home & Living Centro',
      slug: 'home-centro',
      organization_id: homeLivingOrg.id,
      store_code: 'HOME001',
      store_type: 'physical',
      is_active: true,
      timezone: 'America/Bogota',
    },
  ];

  const createdStores: any[] = [];
  for (const store of stores) {
    const createdStore = await client.stores.upsert({
      where: {
        organization_id_slug: {
          organization_id: store.organization_id,
          slug: store.slug,
        },
      },
      update: {},
      create: {
        name: store.name,
        slug: store.slug,
        organization_id: store.organization_id,
        store_code: store.store_code,
        store_type: store.store_type as any,
        is_active: store.is_active,
        timezone: store.timezone,
      },
    });
    createdStores.push(createdStore);
  }

  const vendixStore1: any = createdStores[0];
  const vendixStore2: any = createdStores[1];
  const techStore1: any = createdStores[2];
  const techStore2: any = createdStores[3];
  const techStore3: any = createdStores[4];
  const fashionStore1: any = createdStores[5];
  const fashionStore2: any = createdStores[6];
  const gourmetStore1: any = createdStores[7];
  const homeStore1: any = createdStores[8];

  // Store settings for main stores
  let settingsCreated = 0;

  // Settings for Tech Solutions Bogotá
  await client.store_settings.upsert({
    where: { store_id: techStore1.id },
    update: {},
    create: {
      store_id: techStore1.id,
      settings: {
        currency: 'COP',
        language: 'es',
        timezone: 'America/Bogota',
        business_hours: {
          monday: { open: '09:00', close: '19:00' },
          tuesday: { open: '09:00', close: '19:00' },
          wednesday: { open: '09:00', close: '19:00' },
          thursday: { open: '09:00', close: '19:00' },
          friday: { open: '09:00', close: '20:00' },
          saturday: { open: '10:00', close: '18:00' },
          sunday: { open: '11:00', close: '16:00' },
        },
        shipping: {
          enabled: true,
          free_shipping_threshold: 100000,
          shipping_zones: ['Bogotá', 'Medellín', 'Cali'],
        },
        payments: {
          accepted_methods: ['credit_card', 'debit_card', 'cash'],
          cash_on_delivery: true,
        },
      },
    },
  });
  settingsCreated++;

  // Settings for Fashion Retail Norte
  await client.store_settings.upsert({
    where: { store_id: fashionStore1.id },
    update: {},
    create: {
      store_id: fashionStore1.id,
      settings: {
        currency: 'COP',
        language: 'es',
        timezone: 'America/Bogota',
        business_hours: {
          monday: { open: '10:00', close: '20:00' },
          tuesday: { open: '10:00', close: '20:00' },
          wednesday: { open: '10:00', close: '20:00' },
          thursday: { open: '10:00', close: '20:00' },
          friday: { open: '10:00', close: '21:00' },
          saturday: { open: '10:00', close: '21:00' },
          sunday: { open: '11:00', close: '19:00' },
        },
        shipping: {
          enabled: true,
          free_shipping_threshold: 150000,
          shipping_zones: ['Nacional'],
        },
        payments: {
          accepted_methods: ['credit_card', 'debit_card'],
          cash_on_delivery: false,
        },
      },
    },
  });
  settingsCreated++;

  return {
    organizationsCreated: createdOrganizations.length,
    storesCreated: createdStores.length,
    settingsCreated,
  };
}
