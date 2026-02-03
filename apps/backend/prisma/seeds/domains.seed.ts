import { PrismaClient, app_type_enum } from '@prisma/client';
import { getPrismaClient } from './shared/client';

const baseDomain = process.env.BASE_DOMAIN || 'vendix.com';

export interface SeedDomainsResult {
  domainsCreated: number;
}

/**
 * DEPENDENCIES: This seed function must be called AFTER:
 * 1. seedOrganizationsAndStores() - Organizations and stores must exist
 *
 * Creates domain settings for organizations and stores
 *
 * NUEVO ESTÁNDAR:
 * - app_type es la única fuente de verdad para el tipo de aplicación
 * - config solo contiene metadata de routing/security (no branding ni app)
 * - branding ahora vive en store_settings
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

  // NUEVO ESTÁNDAR: Dominios con app_type explícito
  const domainSettings = [
    // ============================================================================
    // Vendix core domains
    // ============================================================================
    {
      hostname: baseDomain,
      organization_id: vendixOrg.id,
      store_id: null,
      app_type: app_type_enum.VENDIX_LANDING,
      domain_type: 'vendix_core',
      is_primary: true,
      status: 'active',
      ssl_status: 'issued',
      config: {
        security: {
          cors_origins: [
            `http://${baseDomain}`,
            `https://${baseDomain}`,
            `http://api.${baseDomain}`,
            `https://api.${baseDomain}`,
          ],
          session_timeout: 3600000,
          max_login_attempts: 5,
        },
      },
    },
    {
      hostname: 'vendix.com',
      organization_id: vendixOrg.id,
      store_id: null,
      app_type: app_type_enum.VENDIX_LANDING,
      domain_type: 'vendix_core',
      is_primary: false,
      status: 'active',
      ssl_status: 'issued',
      config: {
        security: {
          session_timeout: 3600000,
          max_login_attempts: 5,
        },
      },
    },
    {
      hostname: 'vendix.online',
      organization_id: vendixOrg.id,
      store_id: null,
      app_type: app_type_enum.VENDIX_LANDING,
      domain_type: 'vendix_core',
      is_primary: true,
      status: 'active',
      ssl_status: 'issued',
      config: {
        security: {
          session_timeout: 3600000,
          max_login_attempts: 5,
        },
      },
    },

    // ============================================================================
    // Organization domains - Tech Solutions
    // ============================================================================
    {
      hostname: 'techsolutions.vendix.com',
      organization_id: techSolutionsOrg.id,
      store_id: null,
      app_type: app_type_enum.ORG_LANDING,
      domain_type: 'organization',
      is_primary: true,
      status: 'active',
      ssl_status: 'issued',
      config: {
        security: {
          cors_origins: [
            'https://techsolutions.vendix.com',
            'https://admin-techsolutions.vendix.com',
          ],
          session_timeout: 7200000,
          max_login_attempts: 3,
        },
      },
    },
    {
      hostname: 'admin-techsolutions.vendix.com',
      organization_id: techSolutionsOrg.id,
      store_id: null,
      app_type: app_type_enum.ORG_ADMIN,
      domain_type: 'organization',
      is_primary: false,
      status: 'active',
      ssl_status: 'issued',
      config: {},
    },

    // ============================================================================
    // Organization domains - Fashion Retail
    // ============================================================================
    {
      hostname: 'fashionretail.vendix.com',
      organization_id: fashionRetailOrg.id,
      store_id: null,
      app_type: app_type_enum.ORG_LANDING,
      domain_type: 'organization',
      is_primary: true,
      status: 'active',
      ssl_status: 'issued',
      config: {},
    },

    // ============================================================================
    // Store/Ecommerce domains
    // ============================================================================
    {
      hostname: 'tienda-techsolutions.vendix.com',
      organization_id: techSolutionsOrg.id,
      store_id: techStore3?.id,
      app_type: app_type_enum.STORE_ECOMMERCE,
      domain_type: 'ecommerce',
      is_primary: true,
      status: 'active',
      ssl_status: 'issued',
      config: {}, // Branding ahora está en store_settings
    },
    {
      hostname: 'admin-tienda-techsolutions.vendix.com',
      organization_id: techSolutionsOrg.id,
      store_id: techStore3?.id,
      app_type: app_type_enum.STORE_ADMIN,
      domain_type: 'store',
      is_primary: false,
      status: 'active',
      ssl_status: 'issued',
      config: {},
    },
    {
      hostname: 'moda-fashionretail.vendix.com',
      organization_id: fashionRetailOrg.id,
      store_id: fashionStore2?.id,
      app_type: app_type_enum.STORE_ECOMMERCE,
      domain_type: 'ecommerce',
      is_primary: true,
      status: 'active',
      ssl_status: 'issued',
      config: {}, // Branding ahora está en store_settings
    },

    // ============================================================================
    // Pending domains
    // ============================================================================
    {
      hostname: 'gourmetfoods.vendix.com',
      organization_id: gourmetFoodsOrg.id,
      store_id: null,
      app_type: app_type_enum.ORG_LANDING,
      domain_type: 'organization',
      is_primary: true,
      status: 'pending_dns',
      ssl_status: 'pending',
      config: {},
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
      domain.hostname.endsWith(`.${baseDomain}`)
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
        organization_id: domain.organization_id,
        store_id: domain.store_id,
        // NUEVO: app_type es la fuente de verdad
        app_type: domain.app_type,
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
