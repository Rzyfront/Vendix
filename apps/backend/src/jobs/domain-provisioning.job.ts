import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { DomainProvisioningService } from '../common/services/aws/domain-provisioning.service';
import { DomainRootProvisioningService } from '../common/services/aws/domain-root-provisioning.service';

const PROVISIONING_STATUSES = [
  'pending_certificate',
  'issuing_certificate',
  'pending_alias',
  'propagating',
] as const;

@Injectable()
export class DomainProvisioningJob {
  private readonly logger = new Logger(DomainProvisioningJob.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly domainProvisioning: DomainProvisioningService,
    private readonly domainRootProvisioning: DomainRootProvisioningService,
  ) {}

  @Cron('*/5 * * * *')
  async handleDomainProvisioningQueue() {
    try {
      const [roots, domains] = await Promise.all([
        this.prisma.domain_roots.findMany({
          where: {
            status: { in: [...PROVISIONING_STATUSES] },
            last_verified_at: { not: null },
          },
          select: {
            id: true,
            hostname: true,
            status: true,
          },
          orderBy: { updated_at: 'asc' },
          take: 25,
        }),
        this.prisma.domain_settings.findMany({
          where: {
            ownership: { in: ['custom_domain', 'custom_subdomain'] },
            status: { in: [...PROVISIONING_STATUSES] },
            last_verified_at: { not: null },
            domain_root_id: null,
          },
          select: {
            id: true,
            hostname: true,
            status: true,
          },
          orderBy: { updated_at: 'asc' },
          take: 25,
        }),
      ]);

      if (roots.length === 0 && domains.length === 0) {
        this.logger.debug('No domains pending provisioning');
        return;
      }

      this.logger.log(
        `Advancing ${roots.length} domain root job(s) and ${domains.length} legacy domain job(s)`,
      );

      for (const root of roots) {
        try {
          await this.domainRootProvisioning.provisionNext(root.id);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Unknown root provisioning error';

          this.logger.warn(
            `Failed to advance domain root ${root.hostname} (${root.id}): ${message}`,
          );

          await this.prisma.domain_roots.update({
            where: { id: root.id },
            data: {
              last_error: message.slice(0, 255),
              retry_count: { increment: 1 },
              updated_at: new Date(),
            },
          });
        }
      }

      for (const domain of domains) {
        try {
          await this.domainProvisioning.provisionNext(domain.id);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Unknown provisioning error';

          this.logger.warn(
            `Failed to advance domain ${domain.hostname} (${domain.id}): ${message}`,
          );

          await this.prisma.domain_settings.update({
            where: { id: domain.id },
            data: {
              last_error: message.slice(0, 255),
              retry_count: { increment: 1 },
              updated_at: new Date(),
            },
          });
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown domain job error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Domain provisioning job failed: ${message}`, stack);
    }
  }
}
