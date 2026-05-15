import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { request as httpsRequest } from 'node:https';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { AcmCertificateDescription, AcmService } from './acm.service';
import { CloudFrontService } from './cloudfront.service';
import {
  dedupeValidationRecords,
  DomainValidationRecord,
  getCertificateDomainNames,
  getCloudFrontAliasesForDomain,
  getWildcardHostname,
  mergeDomainSslConfig,
} from '../domains/domain-custom-hosting.util';

type DomainRecord = Awaited<
  ReturnType<GlobalPrismaService['domain_settings']['findUnique']>
>;

const CUSTOM_OWNERSHIPS = ['custom_domain', 'custom_subdomain'];
const TERMINAL_CERT_FAILURES = [
  'FAILED',
  'VALIDATION_TIMED_OUT',
  'EXPIRED',
  'REVOKED',
];

@Injectable()
export class DomainProvisioningService {
  private readonly logger = new Logger(DomainProvisioningService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly acmService: AcmService,
    private readonly cloudFrontService: CloudFrontService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async startCertificateProvisioning(domainId: number) {
    const domain = await this.getDomain(domainId);
    this.assertCustomDomainReadyForCertificate(domain);

    if (domain.acm_certificate_arn) {
      return this.refreshCertificateStatus(domain.id);
    }

    const certificateDomainNames = getCertificateDomainNames(domain);
    const subjectAlternativeNames = certificateDomainNames.slice(1);
    const { certificateArn } = await this.acmService.requestCertificate({
      domainName: domain.hostname,
      subjectAlternativeNames:
        subjectAlternativeNames.length > 0 ? subjectAlternativeNames : undefined,
      idempotencyToken: this.certificateToken(domain),
      tags: [
        { key: 'domain_id', value: String(domain.id) },
        { key: 'organization_id', value: String(domain.organization_id ?? '') },
        { key: 'store_id', value: String(domain.store_id ?? '') },
        { key: 'hostname', value: domain.hostname },
        { key: 'wildcard_hostname', value: getWildcardHostname(domain) ?? '' },
      ],
    });

    await this.prisma.domain_settings.update({
      where: { id: domain.id },
      data: {
        acm_certificate_arn: certificateArn,
        certificate_requested_at: new Date(),
        status: 'issuing_certificate',
        ssl_status: 'pending',
        config: mergeDomainSslConfig(domain.config, {
          certificate_domain_names: certificateDomainNames,
          certificate_status: 'PENDING_VALIDATION',
          aws_certificate_status: 'PENDING_VALIDATION',
          wildcard_hostname: getWildcardHostname(domain),
          wildcard_status: getWildcardHostname(domain)
            ? 'pending'
            : 'not_applicable',
          certificate_requested_at: new Date().toISOString(),
          next_check_at: this.nextCheckAt(),
        }),
        last_error: null,
        last_error_code: null,
        updated_at: new Date(),
      },
    });

    return this.refreshCertificateStatus(domain.id);
  }

  async refreshCertificateStatus(domainId: number) {
    const domain = await this.getDomain(domainId);
    if (!domain.acm_certificate_arn) {
      throw new BadRequestException('Domain has no ACM certificate ARN');
    }

    const cert = await this.acmService.describeCertificate(
      domain.acm_certificate_arn,
    );
    const validationRecords = this.extractValidationRecords(cert);
    const record = this.getPrimaryValidationRecord(validationRecords, domain);
    const certificateDomainNames = getCertificateDomainNames(domain);
    const wildcardHostname = getWildcardHostname(domain);

    if (TERMINAL_CERT_FAILURES.includes(cert.status)) {
      return this.prisma.domain_settings.update({
        where: { id: domain.id },
        data: {
          status: 'failed_certificate',
          ssl_status: 'error',
          validation_cname_name: record?.name ?? domain.validation_cname_name,
          validation_cname_value: record?.value ?? domain.validation_cname_value,
          config: mergeDomainSslConfig(domain.config, {
            certificate_domain_names: certificateDomainNames,
            certificate_status: cert.status,
            aws_certificate_status: cert.status,
            validation_records: validationRecords,
            validation_refreshed_at: new Date().toISOString(),
            wildcard_hostname: wildcardHostname,
            wildcard_status: wildcardHostname ? 'error' : 'not_applicable',
            next_check_at: this.nextCheckAt(),
          }),
          last_error: `ACM certificate status: ${cert.status}`,
          last_error_code: cert.status,
          retry_count: { increment: 1 },
          updated_at: new Date(),
        },
      });
    }

    const issued = cert.status === 'ISSUED';
    return this.prisma.domain_settings.update({
      where: { id: domain.id },
      data: {
        status: issued ? 'pending_alias' : 'issuing_certificate',
        ssl_status: issued ? 'issued' : 'pending',
        validation_cname_name: record?.name ?? domain.validation_cname_name,
        validation_cname_value: record?.value ?? domain.validation_cname_value,
        cert_expires_at: cert.notAfter ?? domain.cert_expires_at,
        config: mergeDomainSslConfig(domain.config, {
          certificate_domain_names: certificateDomainNames,
          certificate_status: cert.status,
          aws_certificate_status: cert.status,
          validation_records: validationRecords,
          validation_refreshed_at: new Date().toISOString(),
          wildcard_hostname: wildcardHostname,
          wildcard_status: wildcardHostname
            ? issued
              ? 'issued'
              : 'pending'
            : 'not_applicable',
          next_check_at: issued ? this.nextCheckAt(2) : this.nextCheckAt(),
        }),
        certificate_issued_at: issued
          ? (domain.certificate_issued_at ?? new Date())
          : domain.certificate_issued_at,
        last_error: null,
        last_error_code: null,
        updated_at: new Date(),
      },
    });
  }

  async attachCloudFrontAlias(domainId: number) {
    const domain = await this.getDomain(domainId);
    if (!domain.acm_certificate_arn) {
      throw new BadRequestException('Domain has no ACM certificate ARN');
    }
    if (domain.ssl_status !== 'issued') {
      throw new BadRequestException('Certificate must be issued before aliasing');
    }

    const distributionId = this.getDistributionId();
    const { config } = await this.cloudFrontService.getDistributionConfig(
      distributionId,
    );
    const existingAliases = config.Aliases?.Items ?? [];
    const aliasesToAdd = getCloudFrontAliasesForDomain(domain);
    const routingTarget = await this.getRoutingTarget();
    const aliasesOutsideThisDomain = existingAliases.filter(
      (alias) => !aliasesToAdd.includes(alias),
    );

    if (
      aliasesOutsideThisDomain.length > 0 &&
      this.configService.get<string>('DOMAIN_ALLOW_SHARED_CERT_REPLACE') !==
        'true'
    ) {
      await this.markAliasFailed(
        domain.id,
        'SHARED_DISTRIBUTION_CERT_REPLACE_BLOCKED',
        'Shared CloudFront distribution already has aliases; refusing to replace viewer certificate without DOMAIN_ALLOW_SHARED_CERT_REPLACE=true',
      );
      throw new BadRequestException(
        'Shared CloudFront distribution already has aliases. Set DOMAIN_ALLOW_SHARED_CERT_REPLACE=true only after confirming the new certificate covers every active alias.',
      );
    }

    await this.prisma.domain_settings.update({
      where: { id: domain.id },
      data: {
        cloudfront_distribution_id: distributionId,
        cloudfront_snapshot_before: {
          aliases: existingAliases,
          viewerCertificate: (config.ViewerCertificate ?? null) as unknown,
        } as Prisma.InputJsonValue,
        config: mergeDomainSslConfig(domain.config, {
          cloudfront_aliases: aliasesToAdd,
          wildcard_hostname: getWildcardHostname(domain),
          wildcard_status: getWildcardHostname(domain) ? 'issued' : 'not_applicable',
          cloudfront_status: 'Updating',
          routing_target: routingTarget.target,
          routing_target_type: routingTarget.targetType,
          https_probe_status: 'pending',
          next_check_at: this.nextCheckAt(2),
        }),
        status: 'pending_alias',
        updated_at: new Date(),
      },
    });

    await this.cloudFrontService.addAliasesToDistribution({
      distributionId,
      aliasesToAdd,
      acmCertificateArn: domain.acm_certificate_arn,
    });

    return this.prisma.domain_settings.update({
      where: { id: domain.id },
      data: {
        status: 'propagating',
        cloudfront_alias_added_at: new Date(),
        last_error: null,
        last_error_code: null,
        updated_at: new Date(),
      },
    });
  }

  async refreshCloudFrontStatus(domainId: number) {
    const domain = await this.getDomain(domainId);
    const distributionId =
      domain.cloudfront_distribution_id || this.getDistributionId();
    const distribution = await this.cloudFrontService.getDistribution(
      distributionId,
    );
    const requiredAliases = getCloudFrontAliasesForDomain(domain);
    const aliasPresent = requiredAliases.every((alias) =>
      distribution.aliases.includes(alias),
    );
    const deployed = distribution.status === 'Deployed';

    if (aliasPresent && deployed) {
      const probes = await this.probeDomainHttps(domain);
      const httpsReady = probes.every((probe) => probe.passed);
      const probePatch = {
        cloudfront_aliases: requiredAliases,
        cloudfront_status: distribution.status,
        routing_target: distribution.domainName,
        routing_target_type: 'cloudfront_distribution',
        wildcard_hostname: getWildcardHostname(domain),
        wildcard_status: getWildcardHostname(domain)
          ? 'issued'
          : 'not_applicable',
        https_probe_status: httpsReady ? 'passed' : 'failed',
        https_probe_results: probes,
        last_probe_at: new Date().toISOString(),
        next_check_at: httpsReady ? null : this.nextCheckAt(2),
      };

      if (!httpsReady) {
        return this.prisma.domain_settings.update({
          where: { id: domain.id },
          data: {
            status: 'propagating',
            cloudfront_distribution_id: distributionId,
            config: mergeDomainSslConfig(domain.config, probePatch),
            updated_at: new Date(),
          },
        });
      }

      await this.deactivateSiblingActiveDomains(domain);
      const updated = await this.prisma.domain_settings.update({
        where: { id: domain.id },
        data: {
          status: 'active',
          ssl_status: 'issued',
          cloudfront_distribution_id: distributionId,
          cloudfront_deployed_at: new Date(),
          config: mergeDomainSslConfig(domain.config, probePatch),
          last_error: null,
          last_error_code: null,
          updated_at: new Date(),
        },
      });

      this.eventEmitter.emit('domain.activated', {
        domainId: updated.id,
        hostname: updated.hostname,
        organization_id: updated.organization_id,
        store_id: updated.store_id,
      });

      return updated;
    }

    return this.prisma.domain_settings.update({
      where: { id: domain.id },
      data: {
        status: aliasPresent ? 'propagating' : 'pending_alias',
        cloudfront_distribution_id: distributionId,
        config: mergeDomainSslConfig(domain.config, {
          cloudfront_aliases: requiredAliases,
          cloudfront_status: distribution.status,
          routing_target: distribution.domainName,
          routing_target_type: 'cloudfront_distribution',
          wildcard_hostname: getWildcardHostname(domain),
          wildcard_status: getWildcardHostname(domain) ? 'issued' : 'not_applicable',
          https_probe_status: 'pending',
          next_check_at: this.nextCheckAt(2),
        }),
        updated_at: new Date(),
      },
    });
  }

  async provisionNext(domainId: number) {
    const domain = await this.getDomain(domainId);
    if (!domain.acm_certificate_arn) {
      return this.startCertificateProvisioning(domain.id);
    }
    if (domain.ssl_status !== 'issued') {
      return this.refreshCertificateStatus(domain.id);
    }
    if (domain.status === 'pending_alias') {
      return this.attachCloudFrontAlias(domain.id);
    }
    if (domain.status === 'propagating') {
      return this.refreshCloudFrontStatus(domain.id);
    }
    return domain;
  }

  async getRoutingTarget(): Promise<{
    target: string;
    targetType: 'cloudfront_distribution' | 'legacy_edge_alias';
    legacyEdgeHost: string;
  }> {
    const legacyEdgeHost = this.getLegacyEdgeHost();
    const configuredDomain =
      this.configService.get<string>('CLOUDFRONT_DOMAIN_NAME') ||
      this.configService.get<string>('AWS_CLOUDFRONT_DOMAIN_NAME');

    if (configuredDomain) {
      return {
        target: configuredDomain,
        targetType: 'cloudfront_distribution',
        legacyEdgeHost,
      };
    }

    try {
      const distribution = await this.cloudFrontService.getDistribution(
        this.getDistributionId(),
      );
      if (distribution.domainName) {
        return {
          target: distribution.domainName,
          targetType: 'cloudfront_distribution',
          legacyEdgeHost,
        };
      }
    } catch (error) {
      this.logger.warn(
        `Could not resolve CloudFront routing target, falling back to ${legacyEdgeHost}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return {
      target: legacyEdgeHost,
      targetType: 'legacy_edge_alias',
      legacyEdgeHost,
    };
  }

  private async getDomain(domainId: number) {
    const domain = await this.prisma.domain_settings.findUnique({
      where: { id: domainId },
    });
    if (!domain) {
      throw new NotFoundException('Domain not found');
    }
    return domain;
  }

  private assertCustomDomainReadyForCertificate(domain: NonNullable<DomainRecord>) {
    if (!CUSTOM_OWNERSHIPS.includes(domain.ownership)) {
      throw new BadRequestException('Only custom domains require ACM provisioning');
    }
    if (!domain.last_verified_at) {
      throw new BadRequestException('Domain ownership must be verified first');
    }
  }

  private certificateToken(domain: NonNullable<DomainRecord>): string {
    return `vdx${domain.id}${domain.hostname.replace(/[^a-z0-9]/g, '').slice(0, 20)}`.slice(
      0,
      32,
    );
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

  private getPrimaryValidationRecord(
    records: DomainValidationRecord[],
    domain: NonNullable<DomainRecord>,
  ): DomainValidationRecord | undefined {
    return (
      records.find((record) => record.domain_name === domain.hostname) ??
      records[0]
    );
  }

  private getDistributionId(): string {
    const distributionId =
      this.configService.get<string>('CLOUDFRONT_DISTRIBUTION_ID') ||
      this.configService.get<string>('AWS_CLOUDFRONT_DISTRIBUTION_ID');
    if (!distributionId) {
      throw new BadRequestException('CLOUDFRONT_DISTRIBUTION_ID is not configured');
    }
    return distributionId;
  }

  private getLegacyEdgeHost(): string {
    return (
      this.configService.get<string>('EDGE_HOST') ||
      `edge.${this.configService.get<string>('BASE_DOMAIN') || 'vendix.online'}`
    );
  }

  private async probeDomainHttps(domain: NonNullable<DomainRecord>): Promise<
    Array<{
      hostname: string;
      passed: boolean;
      error?: string;
    }>
  > {
    const hostnames = [domain.hostname];
    const wildcardHostname = getWildcardHostname(domain);
    if (wildcardHostname) {
      hostnames.push(`vdx-health-${domain.id}.${domain.hostname}`);
    }

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

  private nextCheckAt(minutes = 5): string {
    return new Date(Date.now() + minutes * 60_000).toISOString();
  }

  private async markAliasFailed(
    domainId: number,
    code: string,
    message: string,
  ) {
    await this.prisma.domain_settings.update({
      where: { id: domainId },
      data: {
        status: 'failed_alias',
        last_error_code: code,
        last_error: message,
        retry_count: { increment: 1 },
        updated_at: new Date(),
      },
    });
  }

  private async deactivateSiblingActiveDomains(domain: NonNullable<DomainRecord>) {
    await this.prisma.domain_settings.updateMany({
      where: {
        organization_id: domain.organization_id || null,
        store_id: domain.store_id || null,
        app_type: domain.app_type,
        status: 'active',
        id: { not: domain.id },
      },
      data: {
        status: 'disabled',
        is_primary: false,
        updated_at: new Date(),
      },
    });
  }
}
