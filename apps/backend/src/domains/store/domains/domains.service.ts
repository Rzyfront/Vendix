import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { BlocklistService } from '../../../common/services/blocklist/blocklist.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { DnsResolverService } from '../../../common/services/dns/dns-resolver.service';
import { DomainProvisioningService } from '../../../common/services/aws/domain-provisioning.service';
import { DomainRootProvisioningService } from '../../../common/services/aws/domain-root-provisioning.service';
import {
  buildDomainDnsInstructions,
  buildInheritedDomainConfig,
  decorateDomainWithSslFields,
  enrichDomainDnsInstructionsWithDiagnostics,
  getInheritedFromHostname,
  getOneLevelSubdomainLabel,
  hasIssuedWildcardSsl,
  mergeDomainSslConfig,
} from '../../../common/services/domains/domain-custom-hosting.util';
import {
  getRootWildcardHostname,
  isHostnameCoveredByRoot,
} from '../../../common/services/domains/domain-root-hosting.util';

const STORE_APP_TYPES = ['STORE_ECOMMERCE', 'STORE_LANDING', 'STORE_ADMIN'];
const CUSTOM_OWNERSHIPS = ['custom_domain', 'custom_subdomain'];

@Injectable()
export class StoreDomainsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly globalPrisma: GlobalPrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly blocklist: BlocklistService,
    private readonly dnsResolver: DnsResolverService,
    private readonly domainProvisioning: DomainProvisioningService,
    private readonly domainRootProvisioning: DomainRootProvisioningService,
  ) {}

  private generateVerificationToken(): string {
    return (
      'vdx_' +
      Math.random().toString(36).substring(2, 12) +
      Date.now().toString(36)
    );
  }

  private getTxtRecordName(hostname: string): string {
    return `_vendix-verify.${hostname}`;
  }

  private getEdgeHost(): string {
    return (
      process.env.EDGE_HOST ||
      `edge.${process.env.BASE_DOMAIN || 'vendix.online'}`
    );
  }

  private async findActiveWildcardParentForSubdomain(hostname: string) {
    const parents = await this.prisma.domain_settings.findMany({
      where: {
        ownership: 'custom_domain',
        status: 'active',
        ssl_status: 'issued',
      },
    });

    return (
      parents
        .filter(
          (parent) =>
            getOneLevelSubdomainLabel(hostname, parent.hostname) !== null &&
            hasIssuedWildcardSsl(parent),
        )
        .sort((a, b) => b.hostname.length - a.hostname.length)[0] ?? null
    );
  }

  private getStoreScope() {
    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new BadRequestException('Store context is required');
    }

    return {
      organization_id: context.organization_id ?? null,
      store_id: context.store_id,
    };
  }

  private rootBelongsToStoreScope(
    root: { organization_id?: number | null; store_id?: number | null },
    scope: { organization_id?: number | null; store_id?: number | null },
  ) {
    return (
      root.store_id === scope.store_id ||
      (!!scope.organization_id &&
        root.organization_id === scope.organization_id &&
        root.store_id === null)
    );
  }

  private async findAccessibleRootForHostname(
    hostname: string,
    scope: { organization_id?: number | null; store_id?: number | null },
  ) {
    const roots = await this.globalPrisma.domain_roots.findMany({
      where: {
        OR: [
          { store_id: scope.store_id },
          scope.organization_id
            ? { organization_id: scope.organization_id, store_id: null }
            : undefined,
        ].filter(Boolean) as Prisma.domain_rootsWhereInput[],
      },
      orderBy: { hostname: 'desc' },
    });

    return (
      roots
        .filter((root) => isHostnameCoveredByRoot(hostname, root.hostname))
        .sort((a, b) => b.hostname.length - a.hostname.length)[0] ?? null
    );
  }

  private async getAccessibleRoot(rootId: number) {
    const scope = this.getStoreScope();
    const root = await this.domainRootProvisioning.getRootById(rootId);
    if (!this.rootBelongsToStoreScope(root, scope)) {
      throw new NotFoundException('Domain root not found');
    }
    return root;
  }

  private buildRootAssignmentConfig(
    config: Prisma.JsonValue | Prisma.InputJsonValue | null | undefined,
    root: {
      id: number;
      hostname: string;
      status: string;
      ssl_status: string;
      routing_endpoint?: string | null;
    },
    inherited: boolean,
  ): Prisma.InputJsonValue {
    const shared = {
      domain_root_id: root.id,
      root_hostname: root.hostname,
      wildcard_hostname: getRootWildcardHostname(root),
      wildcard_status: root.ssl_status === 'issued' ? 'issued' : 'pending',
      certificate_status:
        root.ssl_status === 'issued' ? 'inherited' : 'pending',
      routing_target: root.routing_endpoint ?? undefined,
      routing_target_type: 'cloudfront_distribution',
    };

    return mergeDomainSslConfig(config, {
      ...shared,
      ...(inherited
        ? {
            inherited: root.status === 'active' && root.ssl_status === 'issued',
            inherited_from_domain_root_id: root.id,
            inherited_from_hostname: root.hostname,
          }
        : {}),
    });
  }

  private decorateDomain(domain: any) {
    return decorateDomainWithSslFields(domain);
  }

  private inferDomainType(appType: string, provided?: string): string {
    if (provided) return provided;
    return appType === 'STORE_ECOMMERCE' ? 'ecommerce' : 'store';
  }

  private validateStoreAppType(appType: string): void {
    if (!STORE_APP_TYPES.includes(appType)) {
      throw new BadRequestException(
        'Store domains only support STORE_ECOMMERCE, STORE_LANDING or STORE_ADMIN',
      );
    }
  }

  private async ensureVerificationToken(domain: {
    id: number;
    verification_token: string | null;
  }): Promise<string> {
    if (domain.verification_token) return domain.verification_token;

    const verification_token = this.generateVerificationToken();
    await this.prisma.domain_settings.update({
      where: { id: domain.id },
      data: { verification_token, updated_at: new Date() },
    });

    return verification_token;
  }

  /**
   * Create a new domain for the current store
   */
  async create(create_domain_dto: {
    hostname: string;
    domain_type?: string;
    app_type?: string;
    is_primary?: boolean;
    ownership?: string;
    domain_root_id?: number;
    config: Record<string, any>;
  }) {
    create_domain_dto.hostname = create_domain_dto.hostname
      .trim()
      .toLowerCase();
    const scope = this.getStoreScope();

    // Blocklist check — reject brand/financial/gov patterns
    const blockResult = await this.blocklist.isBlocked(
      create_domain_dto.hostname,
    );
    if (blockResult.blocked) {
      throw new VendixHttpException(
        ErrorCodes.ORG_DOMAIN_003,
        `Hostname ${create_domain_dto.hostname} is blocked: ${blockResult.reason ?? 'policy'}`,
        { hostname: create_domain_dto.hostname, pattern: blockResult.pattern },
      );
    }

    // Check for existing hostname (excluyendo terminales — pueden re-claimarse)
    const existing_domain = await this.prisma.domain_settings.findFirst({
      where: {
        hostname: { equals: create_domain_dto.hostname, mode: 'insensitive' },
        status: {
          notIn: [
            'disabled',
            'failed_ownership',
            'failed_certificate',
            'failed_alias',
          ],
        },
      },
    });

    if (existing_domain) {
      throw new ConflictException('Domain with this hostname already exists');
    }

    const app_type = create_domain_dto.app_type || 'STORE_ECOMMERCE';
    this.validateStoreAppType(app_type);

    const domain_type = this.inferDomainType(
      app_type,
      create_domain_dto.domain_type,
    ) as any;
    const ownership = (create_domain_dto.ownership ||
      'vendix_subdomain') as any;

    let domainRoot: Awaited<
      ReturnType<DomainRootProvisioningService['findRootByHostname']>
    > | null = null;

    if (ownership === 'custom_domain') {
      const existingRoot = await this.domainRootProvisioning.findRootByHostname(
        create_domain_dto.hostname,
      );

      if (existingRoot && !this.rootBelongsToStoreScope(existingRoot, scope)) {
        throw new ConflictException(
          'Domain root with this hostname already exists',
        );
      }

      domainRoot =
        existingRoot ??
        (await this.domainRootProvisioning.createRoot({
          hostname: create_domain_dto.hostname,
          organization_id: scope.organization_id,
          store_id: scope.store_id,
          config: create_domain_dto.config as Prisma.InputJsonValue,
        }));
    }

    if (create_domain_dto.domain_root_id) {
      const requestedRoot = await this.domainRootProvisioning.getRootById(
        create_domain_dto.domain_root_id,
      );
      if (!this.rootBelongsToStoreScope(requestedRoot, scope)) {
        throw new ConflictException(
          'Domain root does not belong to this store',
        );
      }
      if (
        !isHostnameCoveredByRoot(
          create_domain_dto.hostname,
          requestedRoot.hostname,
        )
      ) {
        throw new BadRequestException(
          'Hostname is not covered by the domain root',
        );
      }
      domainRoot = requestedRoot;
    }

    if (ownership === 'custom_subdomain' && !domainRoot) {
      domainRoot = await this.findAccessibleRootForHostname(
        create_domain_dto.hostname,
        scope,
      );
    }

    const inheritedParent =
      ownership === 'custom_subdomain' && !domainRoot
        ? await this.findActiveWildcardParentForSubdomain(
            create_domain_dto.hostname,
          )
        : null;

    // Vendix subdomains: Vendix controla el DNS, activación inmediata.
    // Custom subdomains under an already-active wildcard root inherit SSL/DNS.
    // Other custom domains enter pending_ownership until TXT proves ownership.
    const isVendixSubdomain = ownership === 'vendix_subdomain';
    const isRootInheritedSubdomain =
      ownership === 'custom_subdomain' &&
      !!domainRoot &&
      domainRoot.status === 'active' &&
      domainRoot.ssl_status === 'issued';
    const isInheritedSubdomain = !!inheritedParent || isRootInheritedSubdomain;
    const status =
      isVendixSubdomain || isInheritedSubdomain
        ? 'active'
        : domainRoot
          ? domainRoot.status
          : 'pending_ownership';

    const is_primary =
      status === 'active' ? create_domain_dto.is_primary || false : false;

    if (status === 'active' && is_primary) {
      await this.ensureSingleActiveApp(app_type);
    }

    const tokenExpiryDays = parseInt(
      process.env.DOMAIN_TOKEN_EXPIRY_DAYS || '7',
      10,
    );
    const expires_token_at =
      status === 'active'
        ? null
        : (domainRoot?.expires_token_at ??
          new Date(Date.now() + tokenExpiryDays * 24 * 60 * 60 * 1000));
    const config = domainRoot
      ? this.buildRootAssignmentConfig(
          create_domain_dto.config as Prisma.JsonValue,
          domainRoot,
          ownership === 'custom_subdomain',
        )
      : isInheritedSubdomain
        ? buildInheritedDomainConfig(
            create_domain_dto.config as Prisma.JsonValue,
            inheritedParent,
          )
        : (create_domain_dto.config as any);

    // Create domain - store_id is auto-injected by StorePrismaService
    const created = await this.prisma.domain_settings.create({
      data: {
        hostname: create_domain_dto.hostname,
        domain_type,
        app_type: app_type as any,
        is_primary,
        status: status as any,
        ssl_status:
          status === 'active'
            ? ('issued' as any)
            : domainRoot
              ? (domainRoot.ssl_status as any)
              : ('pending' as any),
        ownership,
        config,
        domain_root_id: domainRoot?.id,
        organization_id: scope.organization_id,
        verification_token:
          status === 'active'
            ? null
            : (domainRoot?.verification_token ??
              this.generateVerificationToken()),
        last_verified_at:
          domainRoot?.last_verified_at ??
          (isInheritedSubdomain ? new Date() : undefined),
        expires_token_at,
      },
    });

    if (status === 'active') {
      this.eventEmitter.emit('domain.activated', {
        domainId: created.id,
        hostname: created.hostname,
        organization_id: created.organization_id,
        store_id: created.store_id,
      });
    } else {
      this.eventEmitter.emit('domain.updated', {
        domainId: created.id,
        hostname: created.hostname,
      });
    }

    return this.decorateDomain(created);
  }

  private async ensureSingleActiveType(domain_type: any, exclude_id?: number) {
    // Find existing active domains of the same type and deactivate them
    await this.prisma.domain_settings.updateMany({
      where: {
        domain_type,
        status: 'active',
        id: exclude_id ? { not: exclude_id } : undefined,
      },
      data: {
        status: 'disabled',
        is_primary: false,
        updated_at: new Date(),
      },
    });
  }

  private async ensureSingleActiveApp(app_type: string, exclude_id?: number) {
    await this.prisma.domain_settings.updateMany({
      where: {
        app_type: app_type as any,
        status: 'active',
        id: exclude_id ? { not: exclude_id } : undefined,
      },
      data: {
        status: 'disabled',
        is_primary: false,
        updated_at: new Date(),
      },
    });
  }

  /**
   * Get all domains for the current store with pagination
   */
  async findAll(query: {
    page?: number;
    limit?: number;
    search?: string;
    domain_type?: string;
    app_type?: string;
    status?: string;
  }) {
    const {
      page = 1,
      limit = 10,
      search,
      domain_type,
      app_type,
      status,
    } = query;
    const skip = (page - 1) * limit;
    const take = Number(limit);

    const where: Prisma.domain_settingsWhereInput = {};

    if (search) {
      where.OR = [{ hostname: { contains: search, mode: 'insensitive' } }];
    }

    if (domain_type) {
      where.domain_type = domain_type as any;
    }

    if (app_type) {
      where.app_type = app_type as any;
    }

    if (status) {
      where.status = status as any;
    }

    // store_id filter is auto-applied by StorePrismaService
    const [data, total] = await Promise.all([
      this.prisma.domain_settings.findMany({
        where,
        skip,
        take,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.domain_settings.count({ where }),
    ]);

    return {
      data: data.map((domain) => this.decorateDomain(domain)),
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a single domain by ID
   */
  async findOne(id: number) {
    const domain = await this.prisma.domain_settings.findFirst({
      where: { id },
    });

    if (!domain) {
      throw new NotFoundException('Domain not found');
    }

    return this.decorateDomain(domain);
  }

  /**
   * Update a domain
   */
  async update(
    id: number,
    update_domain_dto: {
      domain_type?: string;
      app_type?: string;
      is_primary?: boolean;
      status?: string;
      ssl_status?: string;
      ownership?: string;
      config?: Record<string, any>;
    },
  ) {
    const existing_domain = await this.findOne(id);

    const update_data: any = {
      updated_at: new Date(),
    };

    const app_type = update_domain_dto.app_type || existing_domain.app_type;
    this.validateStoreAppType(app_type);

    const domain_type =
      update_domain_dto.domain_type ||
      this.inferDomainType(app_type, existing_domain.domain_type);

    if (update_domain_dto.domain_type !== undefined) {
      update_data.domain_type = update_domain_dto.domain_type as any;
    }

    if (update_domain_dto.app_type !== undefined) {
      update_data.app_type = update_domain_dto.app_type as any;
    }

    if (
      update_domain_dto.status === 'active' &&
      CUSTOM_OWNERSHIPS.includes(existing_domain.ownership) &&
      existing_domain.status !== 'active'
    ) {
      throw new ConflictException(
        'Custom domains must be verified before being activated',
      );
    }

    if (update_domain_dto.status === 'active') {
      await this.ensureSingleActiveApp(app_type, id);
    }

    if (update_domain_dto.is_primary === true) {
      update_data.is_primary = true;
      // Sólo elevar a 'active' si la propiedad ya está probada
      // (vendix_subdomain o ya estaba activo). Custom domains en pending_*
      // deben pasar por verify() antes — no atajos vía is_primary.
      const isVendixSubdomain =
        existing_domain.ownership === 'vendix_subdomain';
      if (isVendixSubdomain || existing_domain.status === 'active') {
        update_data.status = 'active';
      }
      await this.ensureSingleActiveApp(app_type, id);
    } else if (update_domain_dto.is_primary === false) {
      update_data.is_primary = false;
    }

    if (update_domain_dto.status !== undefined) {
      update_data.status = update_domain_dto.status as any;
    }

    if (update_domain_dto.ssl_status !== undefined) {
      update_data.ssl_status = update_domain_dto.ssl_status as any;
    }

    if (update_domain_dto.ownership !== undefined) {
      update_data.ownership = update_domain_dto.ownership as any;
    }

    if (update_domain_dto.config !== undefined) {
      update_data.config = update_domain_dto.config as any;
    }

    const updated = await this.prisma.domain_settings.update({
      where: { id },
      data: update_data,
    });

    const transitioned_to_active =
      existing_domain.status !== 'active' && updated.status === 'active';
    const transitioned_to_disabled =
      existing_domain.status !== 'disabled' && updated.status === 'disabled';

    if (transitioned_to_active) {
      this.eventEmitter.emit('domain.activated', {
        domainId: updated.id,
        hostname: updated.hostname,
        organization_id: updated.organization_id,
        store_id: updated.store_id,
      });
    } else if (transitioned_to_disabled) {
      this.eventEmitter.emit('domain.disabled', {
        domainId: updated.id,
        hostname: updated.hostname,
      });
    } else {
      this.eventEmitter.emit('domain.updated', {
        domainId: updated.id,
        hostname: updated.hostname,
      });
    }

    return this.decorateDomain(updated);
  }

  /**
   * Delete a domain
   */
  async remove(id: number) {
    const existing_domain = await this.findOne(id);

    if (existing_domain.is_primary) {
      throw new ConflictException('Cannot delete primary domain');
    }

    const removed = await this.prisma.domain_settings.delete({
      where: { id },
    });

    this.eventEmitter.emit('domain.disabled', {
      domainId: removed.id,
      hostname: removed.hostname,
    });

    return removed;
  }

  /**
   * Set a domain as primary for the store.
   * IMPORTANTE: sólo puede activar dominios cuya propiedad ya esté probada
   * (status active o vendix_subdomain). Custom domains en pending_ownership
   * NO pueden saltar a active vía este endpoint — deben pasar por verify().
   */
  async setAsPrimary(id: number) {
    const domain = await this.findOne(id);

    const isVendixSubdomain = domain.ownership === 'vendix_subdomain';
    if (!isVendixSubdomain && domain.status !== 'active') {
      throw new ConflictException(
        'Custom domains must be verified (DNS proof of ownership) before being set as primary',
      );
    }

    // Deactivate other domains of the same app target for this store.
    await this.ensureSingleActiveApp(domain.app_type, id);

    const updated = await this.prisma.domain_settings.update({
      where: { id },
      data: {
        is_primary: true,
        status: 'active' as any,
        updated_at: new Date(),
      },
    });

    if (domain.status !== 'active') {
      this.eventEmitter.emit('domain.activated', {
        domainId: updated.id,
        hostname: updated.hostname,
        organization_id: updated.organization_id,
        store_id: updated.store_id,
      });
    } else {
      this.eventEmitter.emit('domain.updated', {
        domainId: updated.id,
        hostname: updated.hostname,
      });
    }

    return this.decorateDomain(updated);
  }

  async verifyDomain(id: number) {
    const domain = await this.findOne(id);

    if (!CUSTOM_OWNERSHIPS.includes(domain.ownership)) {
      throw new BadRequestException('Domain type not verifiable');
    }

    if (domain.domain_root_id) {
      const root = await this.getAccessibleRoot(domain.domain_root_id);
      const isRootSubdomain =
        domain.hostname !== root.hostname &&
        isHostnameCoveredByRoot(domain.hostname, root.hostname);

      if (
        isRootSubdomain &&
        root.status === 'active' &&
        root.ssl_status === 'issued'
      ) {
        return {
          hostname: domain.hostname,
          status_before: domain.status,
          status_after: domain.status,
          ssl_status: domain.ssl_status,
          verified: true,
          checks: {
            parent: {
              valid: true,
              name: root.hostname,
              reason: `Cubierto por el certificado wildcard de ${root.hostname}`,
            },
          },
          suggested_fixes: [],
          timestamp: new Date().toISOString(),
        };
      }

      return this.domainRootProvisioning.verifyRoot(root.id);
    }

    const inheritedFrom = getInheritedFromHostname(domain);
    if (inheritedFrom) {
      return {
        hostname: domain.hostname,
        status_before: domain.status,
        status_after: domain.status,
        ssl_status: domain.ssl_status,
        verified: true,
        checks: {
          parent: {
            valid: true,
            name: inheritedFrom,
            reason: `Cubierto por el wildcard SSL de ${inheritedFrom}`,
          },
        },
        suggested_fixes: [],
        timestamp: new Date().toISOString(),
      };
    }

    const verification_token = await this.ensureVerificationToken(domain);
    const txt_name = this.getTxtRecordName(domain.hostname);
    const txt = await this.dnsResolver.hasTxtRecord(
      txt_name,
      verification_token,
    );
    const status_before = domain.status;

    const checks: Record<string, any> = {
      txt: {
        valid: txt.found,
        name: txt_name,
        expected: verification_token,
        seenIn: txt.seenIn,
        reason: txt.found ? undefined : 'TXT ownership record not found',
      },
    };

    let status_after = status_before;
    let ssl_status = domain.ssl_status;

    if (txt.found) {
      const updated = await this.prisma.domain_settings.update({
        where: { id: domain.id },
        data: {
          status: 'pending_certificate',
          ssl_status: 'pending',
          last_verified_at: new Date(),
          last_error: null,
          updated_at: new Date(),
        },
      });
      status_after = updated.status;
      ssl_status = updated.ssl_status;

      this.eventEmitter.emit('domain.updated', {
        domainId: updated.id,
        hostname: updated.hostname,
      });
    } else {
      await this.prisma.domain_settings.update({
        where: { id: domain.id },
        data: {
          status: 'failed_ownership',
          last_error: 'TXT ownership record not found',
          updated_at: new Date(),
        },
      });
      status_after = 'failed_ownership';
    }

    return {
      hostname: domain.hostname,
      status_before,
      status_after,
      ssl_status,
      verified: txt.found,
      checks,
      suggested_fixes: txt.found
        ? []
        : [
            `Create a TXT record named ${txt_name} with value ${verification_token}`,
            'Wait for DNS propagation and retry verification.',
          ],
      timestamp: new Date().toISOString(),
    };
  }

  async startCertificateProvisioning(id: number) {
    const domain = await this.findOne(id);
    if (domain.domain_root_id || domain.ownership === 'custom_domain') {
      const root = domain.domain_root_id
        ? await this.getAccessibleRoot(domain.domain_root_id)
        : await this.domainRootProvisioning.ensureRootForDomainSetting(
            domain as any,
          );
      if (!root) {
        throw new BadRequestException('Domain root is required');
      }
      await this.domainRootProvisioning.startCertificateProvisioning(root.id);
      return this.findOne(id);
    }
    return this.domainProvisioning.startCertificateProvisioning(id);
  }

  async refreshCertificateStatus(id: number) {
    const domain = await this.findOne(id);
    if (domain.domain_root_id || domain.ownership === 'custom_domain') {
      const root = domain.domain_root_id
        ? await this.getAccessibleRoot(domain.domain_root_id)
        : await this.domainRootProvisioning.ensureRootForDomainSetting(
            domain as any,
          );
      if (!root) {
        throw new BadRequestException('Domain root is required');
      }
      await this.domainRootProvisioning.refreshCertificateStatus(root.id);
      return this.findOne(id);
    }
    return this.domainProvisioning.refreshCertificateStatus(id);
  }

  async attachCloudFrontAlias(id: number) {
    const domain = await this.findOne(id);
    if (domain.domain_root_id || domain.ownership === 'custom_domain') {
      const root = domain.domain_root_id
        ? await this.getAccessibleRoot(domain.domain_root_id)
        : await this.domainRootProvisioning.ensureRootForDomainSetting(
            domain as any,
          );
      if (!root) {
        throw new BadRequestException('Domain root is required');
      }
      await this.domainRootProvisioning.ensureDistributionTenant(root.id);
      return this.findOne(id);
    }
    return this.domainProvisioning.attachCloudFrontAlias(id);
  }

  async refreshCloudFrontStatus(id: number) {
    const domain = await this.findOne(id);
    if (domain.domain_root_id || domain.ownership === 'custom_domain') {
      const root = domain.domain_root_id
        ? await this.getAccessibleRoot(domain.domain_root_id)
        : await this.domainRootProvisioning.ensureRootForDomainSetting(
            domain as any,
          );
      if (!root) {
        throw new BadRequestException('Domain root is required');
      }
      await this.domainRootProvisioning.refreshDistributionTenant(root.id);
      return this.findOne(id);
    }
    return this.domainProvisioning.refreshCloudFrontStatus(id);
  }

  async provisionNext(id: number) {
    const domain = await this.findOne(id);
    if (domain.domain_root_id || domain.ownership === 'custom_domain') {
      const root = domain.domain_root_id
        ? await this.getAccessibleRoot(domain.domain_root_id)
        : await this.domainRootProvisioning.ensureRootForDomainSetting(
            domain as any,
          );
      if (!root) {
        throw new BadRequestException('Domain root is required');
      }
      await this.domainRootProvisioning.provisionNext(root.id);
      return this.findOne(id);
    }
    return this.domainProvisioning.provisionNext(id);
  }

  async getDnsInstructions(id: number) {
    const domain = await this.findOne(id);
    if (domain.domain_root_id) {
      const root = await this.getAccessibleRoot(domain.domain_root_id);
      const payload = await this.domainRootProvisioning.getDnsInstructions(
        root.id,
      );
      return enrichDomainDnsInstructionsWithDiagnostics(
        payload,
        this.dnsResolver,
        { legacyEdgeHost: this.getEdgeHost() },
      );
    }

    const inheritedFrom = getInheritedFromHostname(domain);
    const verification_token =
      CUSTOM_OWNERSHIPS.includes(domain.ownership) && !inheritedFrom
        ? domain.verification_token ||
          (!domain.last_verified_at
            ? await this.ensureVerificationToken(domain)
            : null)
        : domain.verification_token;
    const routingTarget = await this.domainProvisioning.getRoutingTarget();
    const legacyEdgeHost = this.getEdgeHost();

    const payload = buildDomainDnsInstructions({
      domain,
      edgeHost: routingTarget.target,
      verificationToken: verification_token,
      routingTargetType: routingTarget.targetType,
      legacyEdgeHost,
    });

    return enrichDomainDnsInstructionsWithDiagnostics(
      payload,
      this.dnsResolver,
      {
        legacyEdgeHost,
      },
    );
  }

  async createRoot(create_root_dto: {
    hostname: string;
    config?: Record<string, any>;
  }) {
    const scope = this.getStoreScope();
    const hostname = create_root_dto.hostname.trim().toLowerCase();
    const blockResult = await this.blocklist.isBlocked(hostname);
    if (blockResult.blocked) {
      throw new VendixHttpException(
        ErrorCodes.ORG_DOMAIN_003,
        `Hostname ${hostname} is blocked: ${blockResult.reason ?? 'policy'}`,
        { hostname, pattern: blockResult.pattern },
      );
    }

    return this.domainRootProvisioning.createRoot({
      hostname,
      organization_id: scope.organization_id,
      store_id: scope.store_id,
      config: (create_root_dto.config ?? {}) as Prisma.InputJsonValue,
    });
  }

  async findRoots() {
    const scope = this.getStoreScope();
    return this.globalPrisma.domain_roots.findMany({
      where: {
        OR: [
          { store_id: scope.store_id },
          scope.organization_id
            ? { organization_id: scope.organization_id, store_id: null }
            : undefined,
        ].filter(Boolean) as Prisma.domain_rootsWhereInput[],
      },
      include: {
        assignments: {
          select: {
            id: true,
            hostname: true,
            app_type: true,
            status: true,
            is_primary: true,
          },
          orderBy: { created_at: 'asc' },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async findRoot(rootId: number) {
    const root = await this.getAccessibleRoot(rootId);
    return this.globalPrisma.domain_roots.findUnique({
      where: { id: root.id },
      include: {
        assignments: {
          select: {
            id: true,
            hostname: true,
            app_type: true,
            status: true,
            is_primary: true,
          },
          orderBy: { created_at: 'asc' },
        },
      },
    });
  }

  async getRootDnsInstructions(rootId: number) {
    const root = await this.getAccessibleRoot(rootId);
    const payload = await this.domainRootProvisioning.getDnsInstructions(
      root.id,
    );
    return enrichDomainDnsInstructionsWithDiagnostics(
      payload,
      this.dnsResolver,
      {
        legacyEdgeHost: this.getEdgeHost(),
      },
    );
  }

  async verifyRoot(rootId: number) {
    const root = await this.getAccessibleRoot(rootId);
    return this.domainRootProvisioning.verifyRoot(root.id);
  }

  async provisionRootNext(rootId: number) {
    const root = await this.getAccessibleRoot(rootId);
    await this.domainRootProvisioning.provisionNext(root.id);
    return this.findRoot(root.id);
  }

  async createRootAssignment(
    rootId: number,
    create_domain_dto: {
      hostname: string;
      domain_type?: string;
      app_type?: string;
      is_primary?: boolean;
      config?: Record<string, any>;
    },
  ) {
    const root = await this.getAccessibleRoot(rootId);
    const hostname = create_domain_dto.hostname.trim().toLowerCase();

    if (!isHostnameCoveredByRoot(hostname, root.hostname)) {
      throw new BadRequestException(
        'Hostname is not covered by the domain root',
      );
    }

    return this.create({
      ...create_domain_dto,
      hostname,
      ownership:
        hostname === root.hostname ? 'custom_domain' : 'custom_subdomain',
      domain_root_id: root.id,
      config: create_domain_dto.config ?? {},
    });
  }
}
