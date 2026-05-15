import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { DomainProvisioningService } from '../common/services/aws/domain-provisioning.service';

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
  ) {}

  @Cron('*/5 * * * *')
  async handleDomainProvisioningQueue() {
    try {
      const domains = await this.prisma.domain_settings.findMany({
        where: {
          ownership: { in: ['custom_domain', 'custom_subdomain'] },
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
      });

      if (domains.length === 0) {
        this.logger.debug('No domains pending provisioning');
        return;
      }

      this.logger.log(`Advancing ${domains.length} domain provisioning job(s)`);

      for (const domain of domains) {
        try {
          await this.domainProvisioning.provisionNext(domain.id);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown provisioning error';

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
