import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { request as httpsRequest } from 'node:https';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { DnsResolverService } from '../dns/dns-resolver.service';
import { AcmCertificateDescription, AcmService } from './acm.service';
import { CloudFrontService } from './cloudfront.service';
import {
  DomainValidationRecord,
  dedupeValidationRecords,
  mergeDomainSslConfig,
} from '../domains/domain-custom-hosting.util';
import {
  buildDomainRootDnsInstructions,
  getRootCertificateDomainNames,
  getRootWildcardHostname,
  isHostnameCoveredByRoot,
} from '../domains/domain-root-hosting.util';

type DomainRootRecord = Awaited<
  ReturnType<GlobalPrismaService['domain_roots']['findUnique']>
>;

type DomainSettingRecord = Awaited<
  ReturnType<GlobalPrismaService['domain_settings']['findUnique']>
>;

const TERMINAL_CERT_FAILURES = [
  'FAILED',
  'VALIDATION_TIMED_OUT',
  'EXPIRED',
  'REVOKED',
];

const ROOT_PENDING_STATUSES = [
  'pending_dns',
  'pending_ssl',
  'pending_ownership',
  'verifying_ownership',
  'pending_certificate',
  'issuing_certificate',
  'pending_alias',
  'propagating',
];

@Injectable()
export class DomainRootProvisioningService {
  private readonly logger = new Logger(DomainRootProvisioningService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly acmService: AcmService,
    private readonly cloudFrontService: CloudFrontService,
    private readonly dnsResolver: DnsResolverService,
    private readonly configService: ConfigService,
  ) {}

  async createRoot(params: {
    hostname: string;
    organization_id?: number | null;
    store_id?: number | null;
    config?: Prisma.InputJsonValue;
  }) {
    const hostname = this.normalizeHostname(params.hostname);
    this.assertBaseDomain(hostname);

    const existing = await this.prisma.domain_roots.findUnique({
      where: { hostname },
    });
    if (existing) {
      throw new ConflictException(`Domain root ${hostname} already exists`);
    }

    const verification_token = this.generateVerificationToken();
    const tokenExpiryDays = parseInt(
      this.configService.get<string>('DOMAIN_TOKEN_EXPIRY_DAYS') || '7',
      10,
    );

    return this.prisma.domain_roots.create({
      data: {
        hostname,
        organization_id: params.organization_id ?? null,
        store_id: params.store_id ?? null,
        status: 'pending_ownership',
        ssl_status: 'pending',
        verification_token,
        expires_token_at: new Date(
          Date.now() + tokenExpiryDays * 24 * 60 * 60 * 1000,
        ),
        config: params.config ?? {},
        updated_at: new Date(),
      },
    });
  }

  async findRootByHostname(hostname: string) {
    return this.prisma.domain_roots.findUnique({
      where: { hostname: this.normalizeHostname(hostname) },
    });
  }

  async getRootById(rootId: number) {
    return this.getRoot(rootId);
  }

  async ensureRootForDomainSetting(domain: NonNullable<DomainSettingRecord>) {
    if (domain.domain_root_id) {
      return this.getRoot(domain.domain_root_id);
    }

    if (domain.ownership !== 'custom_domain') {
      const root = await this.findActiveRootForHostname(domain.hostname, {
        organization_id: domain.organization_id,
        store_id: domain.store_id,
      });
      if (!root) return null;

      await this.prisma.domain_settings.update({
        where: { id: domain.id },
        data: {
          domain_root_id: root.id,
          ssl_status: 'issued',
          status: 'active',
          last_verified_at: domain.last_verified_at ?? new Date(),
          config: mergeDomainSslConfig(domain.config, {
            inherited: true,
            inherited_from_domain_root_id: root.id,
            inherited_from_hostname: root.hostname,
            wildcard_hostname: getRootWildcardHostname(root),
            wildcard_status: 'issued',
            certificate_status: 'inherited',
          }),
          updated_at: new Date(),
        },
      });
      return root;
    }

    const existingRoot = await this.findRootByHostname(domain.hostname);
    if (existingRoot) {
      await this.prisma.domain_settings.update({
        where: { id: domain.id },
        data: {
          domain_root_id: existingRoot.id,
          status: existingRoot.status as any,
          ssl_status: existingRoot.ssl_status as any,
          verification_token:
            domain.verification_token ?? existingRoot.verification_token,
          updated_at: new Date(),
        },
      });
      return existingRoot;
    }

    const root = await this.prisma.domain_roots.create({
      data: {
        hostname: domain.hostname,
        organization_id: domain.organization_id,
        store_id: domain.store_id,
        status: domain.last_verified_at
          ? ('pending_certificate' as any)
          : ('pending_ownership' as any),
        ssl_status: 'pending',
        verification_token:
          domain.verification_token || this.generateVerificationToken(),
        last_verified_at: domain.last_verified_at,
        expires_token_at: domain.expires_token_at,
        config: mergeDomainSslConfig(domain.config, {
          adopted_from_domain_setting_id: domain.id,
          wildcard_hostname: `*.${domain.hostname}`,
          wildcard_status: 'pending',
        }),
        updated_at: new Date(),
      },
    });

    await this.prisma.domain_settings.update({
      where: { id: domain.id },
      data: {
        domain_root_id: root.id,
        acm_certificate_arn: null,
        validation_cname_name: null,
        validation_cname_value: null,
        certificate_requested_at: null,
        certificate_issued_at: null,
        cloudfront_distribution_id: null,
        cloudfront_alias_added_at: null,
        cloudfront_deployed_at: null,
        ssl_status: 'pending',
        status: root.status as any,
        updated_at: new Date(),
      },
    });

    return root;
  }

  async findActiveRootForHostname(
    hostname: string,
    scope: { organization_id?: number | null; store_id?: number | null },
  ) {
    const normalized = this.normalizeHostname(hostname);
    const roots = await this.prisma.domain_roots.findMany({
      where: {
        status: 'active',
        ssl_status: 'issued',
        OR: [
          scope.store_id ? { store_id: scope.store_id } : undefined,
          scope.organization_id
            ? { organization_id: scope.organization_id, store_id: null }
            : undefined,
        ].filter(Boolean) as Prisma.domain_rootsWhereInput[],
      },
      orderBy: { hostname: 'desc' },
    });

    return (
      roots
        .filter((root) => isHostnameCoveredByRoot(normalized, root.hostname))
        .sort((a, b) => b.hostname.length - a.hostname.length)[0] ?? null
    );
  }

  async verifyRoot(rootId: number) {
    const root = await this.getRoot(rootId);
    const verificationToken = await this.ensureVerificationToken(root);
    const txtName = `_vendix-verify.${root.hostname}`;
    const txt = await this.dnsResolver.hasTxtRecord(txtName, verificationToken);
    const statusBefore = root.status;

    if (!txt.found) {
      await this.prisma.domain_roots.update({
        where: { id: root.id },
        data: {
          status: 'failed_ownership',
          last_error: 'TXT ownership record not found',
          last_error_code: 'OWNERSHIP_TXT_MISSING',
          retry_count: { increment: 1 },
          updated_at: new Date(),
        },
      });

      return {
        hostname: root.hostname,
        status_before: statusBefore,
        status_after: 'failed_ownership',
        ssl_status: root.ssl_status,
        verified: false,
        checks: {
          txt: {
            valid: false,
            name: txtName,
            expected: verificationToken,
            seenIn: txt.seenIn,
            reason: 'TXT ownership record not found',
          },
        },
        suggested_fixes: [
          `Create a TXT record named ${txtName} with value ${verificationToken}`,
          'Wait for DNS propagation and retry verification.',
        ],
        timestamp: new Date().toISOString(),
      };
    }

    const updated = await this.prisma.domain_roots.update({
      where: { id: root.id },
      data: {
        status: 'pending_certificate',
        ssl_status: 'pending',
        last_verified_at: new Date(),
        last_error: null,
        last_error_code: null,
        updated_at: new Date(),
      },
    });

    await this.syncAssignmentsFromRoot(updated);

    return {
      hostname: root.hostname,
      status_before: statusBefore,
      status_after: updated.status,
      ssl_status: updated.ssl_status,
      verified: true,
      checks: {
        txt: {
          valid: true,
          name: txtName,
          expected: verificationToken,
          seenIn: txt.seenIn,
        },
      },
      suggested_fixes: [],
      timestamp: new Date().toISOString(),
    };
  }

  async provisionNext(rootId: number) {
    const root = await this.getRoot(rootId);
    if (!root.last_verified_at) {
      return this.verifyRoot(root.id);
    }
    if (!root.acm_certificate_arn) {
      return this.startCertificateProvisioning(root.id);
    }
    if (root.ssl_status !== 'issued') {
      return this.refreshCertificateStatus(root.id);
    }
    if (!root.cloudfront_distribution_tenant_id) {
      return this.ensureDistributionTenant(root.id);
    }
    return this.refreshDistributionTenant(root.id);
  }

  async startCertificateProvisioning(rootId: number) {
    const root = await this.getRoot(rootId);
    if (!root.last_verified_at) {
      throw new BadRequestException(
        'Domain root ownership must be verified first',
      );
    }
    if (root.acm_certificate_arn) {
      return this.refreshCertificateStatus(root.id);
    }

    const names = getRootCertificateDomainNames(root);
    const { certificateArn } = await this.acmService.requestCertificate({
      domainName: root.hostname,
      subjectAlternativeNames: names.slice(1),
      idempotencyToken: this.certificateToken(root),
      tags: [
        { key: 'domain_root_id', value: String(root.id) },
        { key: 'organization_id', value: String(root.organization_id ?? '') },
        { key: 'store_id', value: String(root.store_id ?? '') },
        { key: 'hostname', value: root.hostname },
        { key: 'wildcard_hostname', value: getRootWildcardHostname(root) },
      ],
    });

    await this.prisma.domain_roots.update({
      where: { id: root.id },
      data: {
        acm_certificate_arn: certificateArn,
        certificate_requested_at: new Date(),
        status: 'issuing_certificate',
        ssl_status: 'pending',
        config: mergeDomainSslConfig(root.config, {
          certificate_domain_names: names,
          aws_certificate_status: 'PENDING_VALIDATION',
          certificate_status: 'PENDING_VALIDATION',
          wildcard_hostname: getRootWildcardHostname(root),
          wildcard_status: 'pending',
          next_check_at: this.nextCheckAt(),
        }),
        last_error: null,
        last_error_code: null,
        updated_at: new Date(),
      },
    });

    return this.refreshCertificateStatus(root.id);
  }

  async refreshCertificateStatus(rootId: number) {
    const root = await this.getRoot(rootId);
    if (!root.acm_certificate_arn) {
      throw new BadRequestException('Domain root has no ACM certificate ARN');
    }

    const cert = await this.acmService.describeCertificate(
      root.acm_certificate_arn,
    );
    const validationRecords = this.extractValidationRecords(cert);
    const primaryRecord =
      validationRecords.find(
        (record) => record.domain_name === root.hostname,
      ) ?? validationRecords[0];
    const failed = TERMINAL_CERT_FAILURES.includes(cert.status);
    const issued = cert.status === 'ISSUED';

    const updated = await this.prisma.domain_roots.update({
      where: { id: root.id },
      data: {
        status: failed
          ? ('failed_certificate' as any)
          : issued
            ? ('pending_alias' as any)
            : ('issuing_certificate' as any),
        ssl_status: failed ? 'error' : issued ? 'issued' : 'pending',
        validation_cname_name:
          primaryRecord?.name ?? root.validation_cname_name,
        validation_cname_value:
          primaryRecord?.value ?? root.validation_cname_value,
        cert_expires_at: cert.notAfter ?? root.cert_expires_at,
        certificate_issued_at: issued
          ? (root.certificate_issued_at ?? new Date())
          : root.certificate_issued_at,
        config: mergeDomainSslConfig(root.config, {
          certificate_domain_names: getRootCertificateDomainNames(root),
          certificate_status: cert.status,
          aws_certificate_status: cert.status,
          validation_records: validationRecords,
          validation_refreshed_at: new Date().toISOString(),
          wildcard_hostname: getRootWildcardHostname(root),
          wildcard_status: failed ? 'error' : issued ? 'issued' : 'pending',
          next_check_at: issued ? this.nextCheckAt(2) : this.nextCheckAt(),
        }),
        last_error: failed ? `ACM certificate status: ${cert.status}` : null,
        last_error_code: failed ? cert.status : null,
        retry_count: failed ? { increment: 1 } : undefined,
        updated_at: new Date(),
      },
    });

    await this.syncAssignmentsFromRoot(updated);
    return updated;
  }

  async ensureDistributionTenant(rootId: number) {
    const root = await this.getRoot(rootId);
    if (!root.acm_certificate_arn || root.ssl_status !== 'issued') {
      throw new BadRequestException(
        'Domain root certificate must be issued before tenant provisioning',
      );
    }

    const distributionId = this.getSaasDistributionId();
    const connectionGroupId = this.getSaasConnectionGroupId();
    const connectionGroup =
      await this.cloudFrontService.getConnectionGroup(connectionGroupId);
    const routingEndpoint =
      this.configService.get<string>('CLOUDFRONT_SAAS_ROUTING_ENDPOINT') ||
      connectionGroup.routingEndpoint;

    if (!routingEndpoint) {
      throw new BadRequestException(
        'CLOUDFRONT_SAAS_ROUTING_ENDPOINT is not configured and connection group returned no endpoint',
      );
    }

    const domains = getRootCertificateDomainNames(root);
    const tenantName = this.tenantName(root);
    const tenant = root.cloudfront_distribution_tenant_id
      ? await this.updateExistingTenant(root, {
          distributionId,
          connectionGroupId,
          domains,
        })
      : await this.cloudFrontService.createDistributionTenant({
          distributionId,
          connectionGroupId,
          name: tenantName,
          domains,
          acmCertificateArn: root.acm_certificate_arn,
          tags: [
            { key: 'vendix:managed', value: 'true' },
            { key: 'domain_root_id', value: String(root.id) },
            {
              key: 'organization_id',
              value: String(root.organization_id ?? ''),
            },
            { key: 'store_id', value: String(root.store_id ?? '') },
            { key: 'hostname', value: root.hostname },
          ],
        });

    const updated = await this.prisma.domain_roots.update({
      where: { id: root.id },
      data: {
        status: 'propagating',
        cloudfront_saas_distribution_id: distributionId,
        cloudfront_saas_connection_group_id: connectionGroupId,
        cloudfront_distribution_tenant_id: tenant.id,
        cloudfront_distribution_tenant_arn: tenant.arn,
        cloudfront_distribution_tenant_status: tenant.status,
        cloudfront_distribution_tenant_etag: tenant.etag,
        routing_endpoint: routingEndpoint,
        config: mergeDomainSslConfig(root.config, {
          cloudfront_tenant_status: tenant.status,
          cloudfront_tenant_domains: tenant.domains,
          routing_target: routingEndpoint,
          routing_target_type: 'cloudfront_distribution',
          routing_status: 'pending',
          https_probe_status: 'pending',
          next_check_at: this.nextCheckAt(2),
        }),
        last_error: null,
        last_error_code: null,
        updated_at: new Date(),
      },
    });

    await this.syncAssignmentsFromRoot(updated);
    return updated;
  }

  async refreshDistributionTenant(rootId: number) {
    const root = await this.getRoot(rootId);
    if (!root.cloudfront_distribution_tenant_id) {
      return this.ensureDistributionTenant(root.id);
    }

    const tenant = await this.cloudFrontService.getDistributionTenant(
      root.cloudfront_distribution_tenant_id,
    );
    const routing = await this.checkRouting(root);
    const tenantReady =
      tenant.status === 'Deployed' ||
      tenant.status === 'active' ||
      tenant.domains.every((domain) => domain.status === 'active');
    const probes = tenantReady ? await this.probeRootHttps(root) : [];
    const httpsReady =
      probes.length > 0 && probes.every((probe) => probe.passed);

    const updated = await this.prisma.domain_roots.update({
      where: { id: root.id },
      data: {
        status: httpsReady ? 'active' : 'propagating',
        ssl_status: 'issued',
        cloudfront_distribution_tenant_status: tenant.status,
        cloudfront_distribution_tenant_etag: tenant.etag,
        cloudfront_deployed_at: httpsReady
          ? (root.cloudfront_deployed_at ?? new Date())
          : root.cloudfront_deployed_at,
        config: mergeDomainSslConfig(root.config, {
          cloudfront_tenant_status: tenant.status,
          cloudfront_tenant_domains: tenant.domains,
          routing_status: routing.complete ? 'complete' : 'pending',
          routing_results: routing,
          https_probe_status: tenantReady
            ? httpsReady
              ? 'passed'
              : 'failed'
            : 'pending',
          https_probe_results: probes,
          last_probe_at: new Date().toISOString(),
          next_check_at: httpsReady ? null : this.nextCheckAt(2),
        }),
        last_error: httpsReady ? null : root.last_error,
        last_error_code: httpsReady ? null : root.last_error_code,
        updated_at: new Date(),
      },
    });

    await this.syncAssignmentsFromRoot(updated);
    return updated;
  }

  async getDnsInstructions(rootId: number) {
    const root = await this.getRoot(rootId);
    const assignments = await this.prisma.domain_settings.findMany({
      where: { domain_root_id: root.id },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        hostname: true,
        app_type: true,
        status: true,
        is_primary: true,
      },
    });
    const routingEndpoint = await this.getRoutingEndpoint(root);
    const verificationToken =
      root.verification_token ||
      (!root.last_verified_at
        ? await this.ensureVerificationToken(root)
        : null);

    return buildDomainRootDnsInstructions({
      root,
      assignments,
      verificationToken,
      routingEndpoint,
    });
  }

  private async updateExistingTenant(
    root: NonNullable<DomainRootRecord>,
    params: {
      distributionId: string;
      connectionGroupId: string;
      domains: string[];
    },
  ) {
    const current = await this.cloudFrontService.getDistributionTenant(
      root.cloudfront_distribution_tenant_id!,
    );
    if (!current.etag) {
      throw new BadRequestException('Distribution tenant ETag is required');
    }
    return this.cloudFrontService.updateDistributionTenant({
      tenantId: current.id,
      distributionId: params.distributionId,
      connectionGroupId: params.connectionGroupId,
      domains: params.domains,
      acmCertificateArn: root.acm_certificate_arn!,
      ifMatch: current.etag,
    });
  }

  private async getRoot(rootId: number) {
    const root = await this.prisma.domain_roots.findUnique({
      where: { id: rootId },
    });
    if (!root) throw new NotFoundException('Domain root not found');
    return root;
  }

  private async ensureVerificationToken(
    root: NonNullable<DomainRootRecord>,
  ): Promise<string> {
    if (root.verification_token) return root.verification_token;

    const verification_token = this.generateVerificationToken();
    await this.prisma.domain_roots.update({
      where: { id: root.id },
      data: { verification_token, updated_at: new Date() },
    });
    return verification_token;
  }

  private async syncAssignmentsFromRoot(root: NonNullable<DomainRootRecord>) {
    const sslPatch = {
      inherited: root.status === 'active',
      inherited_from_domain_root_id: root.id,
      inherited_from_hostname: root.hostname,
      wildcard_hostname: getRootWildcardHostname(root),
      wildcard_status: root.ssl_status === 'issued' ? 'issued' : 'pending',
      certificate_status:
        root.ssl_status === 'issued' ? 'inherited' : 'pending',
      routing_target: root.routing_endpoint,
      routing_target_type: 'cloudfront_distribution',
    };

    const assignments = await this.prisma.domain_settings.findMany({
      where: { domain_root_id: root.id },
    });

    await Promise.all(
      assignments.map((assignment) => {
        const shouldActivate =
          root.status === 'active' &&
          ROOT_PENDING_STATUSES.includes(assignment.status);

        return this.prisma.domain_settings.update({
          where: { id: assignment.id },
          data: {
            status: shouldActivate ? 'active' : assignment.status,
            ssl_status:
              root.ssl_status === 'issued' ? 'issued' : assignment.ssl_status,
            last_verified_at:
              root.last_verified_at ?? assignment.last_verified_at,
            config: mergeDomainSslConfig(assignment.config, sslPatch),
            updated_at: new Date(),
          },
        });
      }),
    );
  }

  private async checkRouting(root: NonNullable<DomainRootRecord>) {
    const endpoint = await this.getRoutingEndpoint(root);
    const apex = await this.dnsResolver.resolveA(root.hostname);
    const healthHostname = `vdx-health-${root.id}.${root.hostname}`;
    const wildcardCname = await this.dnsResolver.resolveCname(healthHostname);
    const wildcardA = wildcardCname.records.length
      ? null
      : await this.dnsResolver.resolveA(healthHostname);

    const wildcardComplete =
      wildcardCname.records.some((record) => record === endpoint) ||
      (wildcardA?.records.length ?? 0) > 0;

    return {
      complete: apex.records.length > 0 && wildcardComplete,
      endpoint,
      apex,
      wildcard: wildcardCname.records.length ? wildcardCname : wildcardA,
    };
  }

  private async probeRootHttps(root: NonNullable<DomainRootRecord>) {
    const hostnames = [root.hostname, `vdx-health-${root.id}.${root.hostname}`];
    return Promise.all(
      hostnames.map(async (hostname) => {
        try {
          await this.httpsHead(hostname);
          return { hostname, passed: true };
        } catch (error) {
          return {
            hostname,
            passed: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
  }

  private httpsHead(hostname: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        {
          hostname,
          method: 'HEAD',
          path: '/',
          timeout: 8_000,
          servername: hostname,
        },
        (res) => {
          res.resume();
          resolve();
        },
      );
      req.on('timeout', () => {
        req.destroy(new Error(`HTTPS probe timed out for ${hostname}`));
      });
      req.on('error', reject);
      req.end();
    });
  }

  private extractValidationRecords(
    cert: AcmCertificateDescription,
  ): DomainValidationRecord[] {
    const records: DomainValidationRecord[] = [];
    for (const option of cert.domainValidationOptions) {
      const record = option.resourceRecord;
      if (!record?.name || !record.value) continue;
      records.push({
        domain_name: option.domainName,
        record_type: record.type || 'CNAME',
        name: record.name,
        value: record.value,
        validation_status: option.validationStatus,
      });
    }
    return dedupeValidationRecords(records);
  }

  private async getRoutingEndpoint(
    root: NonNullable<DomainRootRecord>,
  ): Promise<string> {
    if (root.routing_endpoint) return root.routing_endpoint;

    const configured =
      this.configService.get<string>('CLOUDFRONT_SAAS_ROUTING_ENDPOINT') ||
      undefined;
    if (configured) return configured;

    const connectionGroup = await this.cloudFrontService.getConnectionGroup(
      this.getSaasConnectionGroupId(),
    );
    return connectionGroup.routingEndpoint;
  }

  private getSaasDistributionId(): string {
    const value = this.configService.get<string>(
      'CLOUDFRONT_SAAS_DISTRIBUTION_ID',
    );
    if (!value) {
      throw new BadRequestException(
        'CLOUDFRONT_SAAS_DISTRIBUTION_ID is not configured',
      );
    }
    return value;
  }

  private getSaasConnectionGroupId(): string {
    const value = this.configService.get<string>(
      'CLOUDFRONT_SAAS_CONNECTION_GROUP_ID',
    );
    if (!value) {
      throw new BadRequestException(
        'CLOUDFRONT_SAAS_CONNECTION_GROUP_ID is not configured',
      );
    }
    return value;
  }

  private normalizeHostname(hostname: string): string {
    return hostname.trim().toLowerCase().replace(/\.$/, '');
  }

  private assertBaseDomain(hostname: string) {
    const labels = hostname.split('.');
    if (labels.length < 2 || labels.some((label) => label.length === 0)) {
      throw new BadRequestException('Invalid domain root hostname');
    }
  }

  private certificateToken(root: NonNullable<DomainRootRecord>): string {
    return `vdxr${root.id}${root.hostname.replace(/[^a-z0-9]/g, '').slice(0, 20)}`.slice(
      0,
      32,
    );
  }

  private tenantName(root: NonNullable<DomainRootRecord>): string {
    return `vendix-${root.id}-${root.hostname.replace(/[^a-z0-9-.]/g, '-')}`.slice(
      0,
      126,
    );
  }

  private generateVerificationToken(): string {
    return (
      'vdx_' +
      Math.random().toString(36).substring(2, 12) +
      Date.now().toString(36)
    );
  }

  private nextCheckAt(minutes = 5): string {
    return new Date(Date.now() + minutes * 60 * 1000).toISOString();
  }
}
