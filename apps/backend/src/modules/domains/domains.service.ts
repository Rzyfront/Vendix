import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import * as dns from 'node:dns/promises';
import {
  CreateDomainSettingDto,
  UpdateDomainSettingDto,
  DuplicateDomainDto,
  VerifyDomainDto,
  VerifyDomainResult,
} from './dto/domain-settings.dto';

interface DomainStats {
  total: number;
  active: number;
  pending: number;
  verified: number;
  platformSubdomains: number;
  customDomains: number;
  clientSubdomains: number;
  aliasDomains: number;
}

@Injectable()
export class DomainsService implements OnModuleInit {
  private readonly logger = new Logger(DomainsService.name);

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit() {
    this.logger.log('🚀 DomainsService initialized');
  }

  // ==================== VALIDATION METHODS ====================

  private validateHostnameFormat(hostname: string): void {
    // Basic hostname validation
    const hostnameRegex =
      /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!hostnameRegex.test(hostname)) {
      throw new BadRequestException('Invalid hostname format');
    }

    // Check for reserved subdomains
    const reserved = ['www', 'api', 'admin', 'app', 'mail', 'ftp', 'localhost'];
    const parts = hostname.split('.');
    if (parts.length > 1 && reserved.includes(parts[0].toLowerCase())) {
      throw new BadRequestException('Reserved subdomain not allowed');
    }
  }

  private inferDomainType(
    hostname: string,
    hasStore: boolean,
    provided?: string,
  ): string {
    if (provided) return provided;

    // If has store, it's store-specific
    if (hasStore) return 'store_domain';

    // Check if it's a subdomain
    const parts = hostname.split('.');
    if (parts.length > 2) return 'subdomain';

    return 'primary_domain';
  }

  private inferOwnership(
    hostname: string,
    domainType: string,
    provided?: string,
  ): string {
    if (provided) return provided;

    // Platform subdomains
    if (hostname.includes('vendix')) return 'vendix_subdomain';

    // Custom domains
    if (domainType === 'primary_domain') return 'custom_domain';

    // Subdomains
    return 'custom_subdomain';
  }

  // ==================== PRIMARY DOMAIN MANAGEMENT ====================

  private async clearExistingPrimary(
    orgId: number | undefined,
    storeId: number | undefined,
    domainType: string,
  ) {
    await this.prisma.domain_settings.updateMany({
      where: {
        ...(orgId && { organization_id: orgId }),
        store_id: storeId || null,
        domain_type: domainType as any,
        is_primary: true,
      },
      data: { is_primary: false },
    });
  }

  private generateVerificationToken(): string {
    return (
      'vdx_' +
      Math.random().toString(36).substring(2, 12) +
      Date.now().toString(36)
    );
  }

  // ==================== ESTADÍSTICAS DE DOMINIOS ====================

  async getDomainStats(): Promise<DomainStats> {
    this.logger.log('📊 Fetching domain statistics');

    // Obtener todos los dominios con sus estados
    const domains = await this.prisma.domain_settings.findMany({
      select: {
        status: true,
        ssl_status: true,
        ownership: true,
        domain_type: true,
        last_verified_at: true,
      },
    });

    // Calcular estadísticas
    const stats: DomainStats = {
      total: domains.length,
      active: 0,
      pending: 0,
      verified: 0,
      platformSubdomains: 0,
      customDomains: 0,
      clientSubdomains: 0,
      aliasDomains: 0,
    };

    domains.forEach((domain) => {
      // Estadísticas por estado
      if (domain.status === 'active') {
        stats.active++;
      } else if (
        domain.status === 'pending_dns' ||
        domain.status === 'pending_ssl'
      ) {
        stats.pending++;
      }

      // Estadísticas de verificación (SSL)
      if (domain.ssl_status === 'issued' || domain.last_verified_at) {
        stats.verified++;
      }

      // Estadísticas por ownership
      switch (domain.ownership) {
        case 'vendix_subdomain':
          stats.platformSubdomains++;
          break;
        case 'custom_domain':
          stats.customDomains++;
          break;
        case 'custom_subdomain':
          stats.clientSubdomains++;
          break;
        case 'third_party_subdomain':
          stats.aliasDomains++;
          break;
        case 'vendix_core':
          stats.platformSubdomains++;
          break;
      }
    });

    this.logger.log(
      `✅ Domain stats calculated: Total=${stats.total}, Active=${stats.active}, Pending=${stats.pending}`,
    );

    return stats;
  }

  // ==================== DOMAIN RESOLUTION ====================

  async resolveDomain(
    hostname: string,
    subdomain?: string,
    forwardedHost?: string,
  ) {
    // Implementation for domain resolution
    this.logger.log(`🔍 Resolving domain: ${hostname}`);

    const domain = await this.prisma.domain_settings.findUnique({
      where: { hostname },
      include: {
        organization: true,
        store: true,
      },
    });

    if (!domain) {
      throw new NotFoundException(`Domain ${hostname} not found`);
    }

    return {
      id: domain.id,
      hostname: domain.hostname,
      organization_id: domain.organization_id,
      store_id: domain.store_id,
      config: domain.config,
      created_at: domain.created_at.toISOString(),
      updated_at: domain.updated_at.toISOString(),
      store_name: domain.store_id ? 'Store Name' : undefined, // Would need to join stores table
      store_slug: domain.store_id ? 'store-slug' : undefined,
      organization_name: domain.organizations?.name,
      organization_slug: domain.organizations?.slug,
      domain_type: domain.domain_type,
      status: domain.status,
      ssl_status: domain.ssl_status,
      is_primary: domain.is_primary,
      ownership: domain.ownership,
    };
  }

  async checkHostnameAvailability(hostname: string) {
    this.logger.log(`🔍 Checking hostname availability: ${hostname}`);

    const existing = await this.prisma.domain_settings.findUnique({
      where: { hostname },
    });

    return {
      available: !existing,
      reason: existing ? 'Hostname already exists' : undefined,
    };
  }

  // ==================== CRUD OPERATIONS ====================

  async createDomainSetting(data: CreateDomainSettingDto) {
    this.logger.log(`➕ Creating domain setting for: ${data.hostname}`);

    // Validate hostname
    this.validateHostnameFormat(data.hostname);

    // Check if hostname already exists
    const existing = await this.prisma.domain_settings.findUnique({
      where: { hostname: data.hostname },
    });

    if (existing) {
      throw new ConflictException(`Domain ${data.hostname} already exists`);
    }

    // Infer domain type and ownership
    const inferredType = this.inferDomainType(
      data.hostname,
      !!data.store_id,
      data.domain_type,
    );
    const inferredOwnership = this.inferOwnership(
      data.hostname,
      inferredType,
      data.ownership,
    );

    // Handle primary domain logic
    const is_primary = data.is_primary || false;
    if (is_primary) {
      await this.clearExistingPrimary(
        data.organization_id,
        data.store_id,
        inferredType,
      );
    }

    // Generate verification token
    const verificationToken = this.generateVerificationToken();

    // Create domain setting
    const domainSetting = await this.prisma.domain_settings.create({
      data: {
        hostname: data.hostname,
        ...(data.organization_id && { organization_id: data.organization_id }),
        store_id: data.store_id,
        config: data.config as any,
        domain_type: inferredType as any,
        status: 'pending_dns' as any,
        ssl_status: 'pending' as any,
        is_primary,
        ownership: inferredOwnership as any,
        verification_token: verificationToken,
        updated_at: new Date(),
      },
    });

    this.logger.log(`✅ Domain setting created: ${domainSetting.hostname}`);
    return domainSetting;
  }

  async getAllDomainSettings(filters: any) {
    this.logger.log('📋 Getting all domain settings');

    const { page = 1, limit = 10 } = filters;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (filters.search) {
      where.hostname = { contains: filters.search, mode: 'insensitive' };
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.ownership) {
      where.ownership = filters.ownership;
    }

    const [domainSettings, total] = await Promise.all([
      this.prisma.domain_settings.findMany({
        where,
        skip,
        take: limit,
        include: {
          organizations: {
            select: { id: true, name: true, slug: true },
          },
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.domain_settings.count({ where }),
    ]);

    return {
      data: domainSettings,
      total,
      limit,
      offset: skip,
    };
  }

  async getDomainSettingByHostname(hostname: string) {
    this.logger.log(`🔍 Getting domain setting by hostname: ${hostname}`);

    const domainSetting = await this.prisma.domain_settings.findUnique({
      where: { hostname },
      include: {
        organizations: true,
      },
    });

    if (!domainSetting) {
      throw new NotFoundException(`Domain ${hostname} not found`);
    }

    return domainSetting;
  }

  async getDomainSettingById(id: number) {
    this.logger.log(`🔍 Getting domain setting by ID: ${id}`);

    const domainSetting = await this.prisma.domain_settings.findUnique({
      where: { id },
      include: {
        organizations: true,
      },
    });

    if (!domainSetting) {
      throw new NotFoundException(`Domain with ID ${id} not found`);
    }

    return domainSetting;
  }

  async updateDomainSetting(
    hostname: string,
    updateData: UpdateDomainSettingDto,
  ) {
    this.logger.log(`✏️ Updating domain setting: ${hostname}`);

    const existingRecord = await this.getDomainSettingByHostname(hostname);

    // Handle primary domain changes
    if (updateData.is_primary && !existingRecord.is_primary) {
      await this.clearExistingPrimary(
        existingRecord.organization_id,
        existingRecord.store_id,
        existingRecord.domain_type,
      );
    }

    const updates: any = {
      ...updateData,
      updated_at: new Date(),
    };

    const updated = await this.prisma.domain_settings.update({
      where: { hostname },
      data: updates,
    });

    this.logger.log(`✅ Domain setting updated: ${hostname}`);
    return updated;
  }

  async deleteDomainSetting(hostname: string) {
    this.logger.log(`🗑️ Deleting domain setting: ${hostname}`);

    const domainSetting = await this.getDomainSettingByHostname(hostname);

    await this.prisma.domain_settings.delete({
      where: { hostname },
    });

    this.logger.log(`✅ Domain setting deleted: ${hostname}`);
  }

  async duplicateDomainSetting(hostname: string, newHostname: string) {
    this.logger.log(
      `📋 Duplicating domain setting: ${hostname} -> ${newHostname}`,
    );

    const source = await this.getDomainSettingByHostname(hostname);

    // Check if new hostname is available
    const available = await this.checkHostnameAvailability(newHostname);
    if (!available) {
      throw new ConflictException(`Hostname ${newHostname} is not available`);
    }

    return this.createDomainSetting({
      hostname: newHostname,
      organization_id: source.organization_id,
      store_id: source.store_id,
      config: source.config,
      domain_type: source.domain_type,
      ownership: source.ownership,
      is_primary: false, // Duplicates are not primary by default
    });
  }

  async validateHostname(hostname: string) {
    this.logger.log(`✅ Validating hostname: ${hostname}`);

    const exists = await this.prisma.domain_settings.findUnique({
      where: { hostname },
    });

    return {
      valid: !exists,
      hostname,
      ...(exists && { reason: 'Hostname already exists' }),
    };
  }

  async verifyDomain(
    hostname: string,
    body: VerifyDomainDto,
  ): Promise<VerifyDomainResult> {
    this.logger.log(`🔍 Verifying domain: ${hostname}`);

    const domain = await this.getDomainSettingByHostname(hostname);

    // Basic verification logic
    const verifiableTypes = ['custom_domain', 'custom_subdomain'];
    if (!verifiableTypes.includes(domain.ownership)) {
      throw new BadRequestException('Domain type not verifiable');
    }

    const statusBefore = domain.status;

    // Simulate verification checks
    const checksToRun = body.checks || ['cname'];

    const results: any = {};

    if (checksToRun.includes('cname')) {
      try {
        const records = await dns.resolveCname(hostname);
        results.cname = { valid: records.length > 0 };
      } catch (error) {
        results.cname = { valid: false, reason: 'CNAME resolution failed' };
      }
    }

    const allValid = Object.values(results).every((check: any) => check.valid);

    let statusAfter = statusBefore;
    let sslStatus = domain.ssl_status;

    if (allValid) {
      statusAfter = 'active';
      sslStatus = 'issued';
      await this.prisma.domain_settings.update({
        where: { hostname },
        data: {
          status: 'active',
          ssl_status: 'issued',
          last_verified_at: new Date(),
        },
      });
    }

    return {
      hostname,
      status_before: statusBefore,
      status_after: statusAfter,
      ssl_status: sslStatus,
      verified: allValid,
      checks: results,
      timestamp: new Date().toISOString(),
    };
  }
}
