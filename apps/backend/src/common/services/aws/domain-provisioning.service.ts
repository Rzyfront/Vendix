import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { AcmService } from './acm.service';
import { CloudFrontService } from './cloudfront.service';

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

    const { certificateArn } = await this.acmService.requestCertificate({
      domainName: domain.hostname,
      idempotencyToken: this.certificateToken(domain),
      tags: [
        { key: 'domain_id', value: String(domain.id) },
        { key: 'organization_id', value: String(domain.organization_id ?? '') },
        { key: 'store_id', value: String(domain.store_id ?? '') },
        { key: 'hostname', value: domain.hostname },
      ],
    });

    await this.prisma.domain_settings.update({
      where: { id: domain.id },
      data: {
        acm_certificate_arn: certificateArn,
        certificate_requested_at: new Date(),
        status: 'issuing_certificate',
        ssl_status: 'pending',
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
    const validation = cert.domainValidationOptions.find(
      (option) => option.domainName === domain.hostname,
    );
    const record = validation?.resourceRecord;

    if (TERMINAL_CERT_FAILURES.includes(cert.status)) {
      return this.prisma.domain_settings.update({
        where: { id: domain.id },
        data: {
          status: 'failed_certificate',
          ssl_status: 'error',
          validation_cname_name: record?.name ?? domain.validation_cname_name,
          validation_cname_value: record?.value ?? domain.validation_cname_value,
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
    const aliasesOutsideThisDomain = existingAliases.filter(
      (alias) => alias !== domain.hostname,
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
          viewerCertificate: config.ViewerCertificate ?? null,
        },
        status: 'pending_alias',
        updated_at: new Date(),
      },
    });

    await this.cloudFrontService.addAliasesToDistribution({
      distributionId,
      aliasesToAdd: [domain.hostname],
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
    const aliasPresent = distribution.aliases.includes(domain.hostname);
    const deployed = distribution.status === 'Deployed';

    if (aliasPresent && deployed) {
      await this.deactivateSiblingActiveDomains(domain);
      const updated = await this.prisma.domain_settings.update({
        where: { id: domain.id },
        data: {
          status: 'active',
          ssl_status: 'issued',
          cloudfront_distribution_id: distributionId,
          cloudfront_deployed_at: new Date(),
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

  private getDistributionId(): string {
    const distributionId =
      this.configService.get<string>('CLOUDFRONT_DISTRIBUTION_ID') ||
      this.configService.get<string>('AWS_CLOUDFRONT_DISTRIBUTION_ID');
    if (!distributionId) {
      throw new BadRequestException('CLOUDFRONT_DISTRIBUTION_ID is not configured');
    }
    return distributionId;
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
