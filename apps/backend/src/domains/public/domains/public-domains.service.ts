import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';

/**
 * 🌐 Public Domains Service
 *
 * Handles domain resolution logic for public endpoints.
 * Uses GlobalPrismaService to avoid organization context requirements.
 */
@Injectable()
export class PublicDomainsService {
  private readonly logger = new Logger(PublicDomainsService.name);

  constructor(private readonly globalPrisma: GlobalPrismaService) {}

  /**
   * Resolve domain configuration by hostname
   */
  async resolveDomain(
    hostname: string,
    subdomain?: string,
    forwardedHost?: string,
  ) {
    this.logger.log(`🔍 Resolving domain: ${hostname}`);

    const domain = await this.globalPrisma.domain_settings.findUnique({
      where: { hostname },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        store: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    if (!domain) {
      throw new NotFoundException(`Domain ${hostname} not found`);
    }

    return {
      id: domain.id,
      hostname: domain.hostname,
      organization_id: domain.organization_id!,
      store_id: domain.store_id ?? undefined,
      config: domain.config,
      created_at: domain.created_at?.toISOString() || new Date().toISOString(),
      updated_at: domain.updated_at?.toISOString() || new Date().toISOString(),
      store_name: domain.store?.name,
      store_slug: domain.store?.slug,
      organization_name: domain.organization?.name,
      organization_slug: domain.organization?.slug,
      domain_type: domain.domain_type,
      status: domain.status,
      ssl_status: domain.ssl_status,
      is_primary: domain.is_primary,
      ownership: domain.ownership,
    };
  }

  /**
   * Check if a hostname is available
   */
  async checkHostnameAvailability(hostname: string) {
    this.logger.log(`🔍 Checking hostname availability: ${hostname}`);

    const existing = await this.globalPrisma.domain_settings.findUnique({
      where: { hostname },
    });

    return {
      available: !existing,
      reason: existing ? 'Hostname already exists' : undefined,
    };
  }
}
