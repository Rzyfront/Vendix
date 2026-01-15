import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';

export interface SeedDomainsResult {
  domainsCreated: number;
}

/**
 * DEPENDENCIES: This seed function must be called AFTER:
 * 1. seedOrganizationsAndStores() - Organizations and stores must exist
 *
 * Creates domain settings for organizations and stores
 */
export async function seedDomains(
  prisma?: PrismaClient,
): Promise<SeedDomainsResult> {
  const client = prisma || getPrismaClient();

  // Fetch required organizations and stores
  const vendixOrg = await client.organizations.findUnique({
    where: { slug: 'vendix-corp' },
  });
  const techSolutionsOrg = await client.organizations.findUnique({
    where: { slug: 'tech-solutions' },
  });
  const fashionRetailOrg = await client.organizations.findUnique({
    where: { slug: 'fashion-retail' },
  });
  const gourmetFoodsOrg = await client.organizations.findUnique({
    where: { slug: 'gourmet-foods' },
  });

  if (!vendixOrg || !techSolutionsOrg || !fashionRetailOrg || !gourmetFoodsOrg) {
    throw new Error(
      'Required organizations not found. Please run seedOrganizationsAndStores() first.',
    );
  }

  const techStore3 = await client.stores.findFirst({
    where: {
      organization_id: techSolutionsOrg.id,
      slug: 'tech-online',
    },
  });
  const fashionStore2 = await client.stores.findFirst({
    where: {
      organization_id: fashionRetailOrg.id,
      slug: 'fashion-online',
    },
  });

  const domainSettings = [
    // Vendix core domains
    {
      hostname: 'vendix.online',
      organization_id: vendixOrg.id,
      store_id: null,
      domain_type: 'vendix_core',
      is_primary: true,
      status: 'active',
      ssl_status: 'issued',
      config: {
        branding: {
          name: 'Vendix',
          primary_color: '#7ED7A5',
          secondary_color: '#2F6F4E',
          background_color: '#F4F4F4',
          accent_color: '#FFFFFF',
          border_color: '#B0B0B0',
          text_color: '#222222',
          theme: 'light',
          logo_url: null,
          favicon_url: null,
        },
        security: {
          cors_origins: [
            'http://vendix.online',
            'https://vendix.online',
            'http://api.vendix.online',
            'https://api.vendix.online',
          ],
          session_timeout: 3600000,
          max_login_attempts: 5,
        },
        app: 'VENDIX_LANDING',
      },
    },
    {
      hostname: 'vendix.com',
      organization_id: vendixOrg.id,
      store_id: null,
      domain_type: 'vendix_core',
      is_primary: false,
      status: 'active',
      ssl_status: 'issued',
      config: {
        branding: {
          name: 'Vendix Corp',
          primary_color: '#7ED7A5',
          secondary_color: '#2F6F4E',
          background_color: '#F4F4F4',
          accent_color: '#FFFFFF',
          border_color: '#B0B0B0',
          text_color: '#222222',
          theme: 'light',
          logo_url: null,
          favicon_url: null,
        },
        security: {
          session_timeout: 3600000,
          max_login_attempts: 5,
        },
        app: 'VENDIX_LANDING',
      },
    },
    // Organization domains
    {
      hostname: 'techsolutions.vendix.com',
      organization_id: techSolutionsOrg.id,
      store_id: null,
      domain_type: 'organization',
      is_primary: true,
      status: 'active',
      ssl_status: 'issued',
      config: {
        branding: {
          name: 'Tech Solutions',
          primary_color: '#4A90E2',
          secondary_color: '#2C5282',
          background_color: '#F7FAFC',
          accent_color: '#FFFFFF',
          border_color: '#CBD5E0',
          text_color: '#2D3748',
          theme: 'light',
        },
        security: {
          cors_origins: [
            'https://techsolutions.vendix.com',
            'https://admin-techsolutions.vendix.com',
          ],
          session_timeout: 7200000,
          max_login_attempts: 3,
        },
        app: 'ORG_LANDING',
      },
    },
    {
      hostname: 'admin-techsolutions.vendix.com',
      organization_id: techSolutionsOrg.id,
      store_id: null,
      domain_type: 'organization',
      is_primary: false,
      status: 'active',
      ssl_status: 'issued',
      config: {
        app: 'ORG_ADMIN',
      },
    },
    {
      hostname: 'fashionretail.vendix.com',
      organization_id: fashionRetailOrg.id,
      store_id: null,
      domain_type: 'organization',
      is_primary: true,
      status: 'active',
      ssl_status: 'issued',
      config: {
        branding: {
          name: 'Fashion Retail',
          primary_color: '#E53E3E',
          secondary_color: '#C53030',
          background_color: '#FFF5F5',
          accent_color: '#FFFFFF',
          border_color: '#FED7D7',
          text_color: '#2D3748',
          theme: 'light',
        },
        app: 'ORG_LANDING',
      },
    },
    // Store domains
    {
      hostname: 'tienda-techsolutions.vendix.com',
      organization_id: techSolutionsOrg.id,
      store_id: techStore3?.id,
      domain_type: 'ecommerce',
      is_primary: true,
      status: 'active',
      ssl_status: 'issued',
      config: {
        app: 'STORE_ECOMMERCE',
      },
    },
    {
      hostname: 'moda-fashionretail.vendix.com',
      organization_id: fashionRetailOrg.id,
      store_id: fashionStore2?.id,
      domain_type: 'ecommerce',
      is_primary: true,
      status: 'active',
      ssl_status: 'issued',
      config: {
        app: 'STORE_ECOMMERCE',
      },
    },
    // Pending domain
    {
      hostname: 'gourmetfoods.vendix.com',
      organization_id: gourmetFoodsOrg.id,
      store_id: null,
      domain_type: 'organization',
      is_primary: true,
      status: 'pending_dns',
      ssl_status: 'pending',
      config: {
        app: 'ORG_LANDING',
      },
    },
  ];

  let domainsCreated = 0;

  for (const domain of domainSettings) {
    // Check if domain already exists
    const existing = await client.domain_settings.findUnique({
      where: { hostname: domain.hostname },
    });

    if (existing) {
      continue;
    }

    // Infer ownership based on hostname
    let ownership = 'custom_domain';
    if (
      domain.hostname.endsWith('.vendix.com') ||
      domain.hostname.endsWith('.vendix.online')
    ) {
      const parts = domain.hostname.split('.');
      if (parts.length === 2) {
        ownership = 'vendix_core';
      } else {
        ownership = 'vendix_subdomain';
      }
    } else {
      const parts = domain.hostname.split('.');
      if (parts.length > 2) {
        ownership = 'custom_subdomain';
      } else {
        ownership = 'custom_domain';
      }
    }

    await client.domain_settings.create({
      data: {
        hostname: domain.hostname,
        store_id: domain.store_id,
        domain_type: domain.domain_type as any,
        is_primary: domain.is_primary,
        status: domain.status as any,
        ssl_status: domain.ssl_status as any,
        ownership: ownership as any,
        config: domain.config,
      },
    });
    domainsCreated++;
  }

  return {
    domainsCreated,
  };
}
