import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';

@Injectable()
export class CertificateExpiryAlertJob {
  private readonly logger = new Logger(CertificateExpiryAlertJob.name);

  constructor(private readonly prisma: GlobalPrismaService) {}

  /**
   * Runs daily at 8 AM to check DIAN certificate expiry.
   * Creates notifications for certificates expiring in <=30, <=15, <=7 days or already expired.
   */
  @Cron('0 8 * * *')
  async handleCertificateExpiryCheck() {
    this.logger.log('Running DIAN certificate expiry check...');

    try {
      const configs = await this.prisma.dian_configurations.findMany({
        where: {
          enablement_status: { in: ['testing', 'enabled'] },
          certificate_expiry: { not: null },
        },
        select: {
          id: true,
          store_id: true,
          name: true,
          nit: true,
          certificate_expiry: true,
        },
      });

      if (configs.length === 0) {
        this.logger.debug(
          'No active DIAN configurations with certificate expiry found',
        );
        return;
      }

      const now = new Date();
      let alerts_sent = 0;

      for (const config of configs) {
        const expiry = config.certificate_expiry!;
        const diff_ms = expiry.getTime() - now.getTime();
        const days_remaining = Math.ceil(diff_ms / (1000 * 60 * 60 * 24));

        let title: string | null = null;
        let body: string | null = null;

        if (days_remaining <= 0) {
          title = `Certificado DIAN expirado`;
          body = `El certificado digital "${config.name}" (NIT: ${config.nit}) ha expirado. No podrá emitir facturas electrónicas hasta renovarlo.`;
        } else if (days_remaining <= 7) {
          title = `Certificado DIAN expira en ${days_remaining} día(s)`;
          body = `El certificado digital "${config.name}" (NIT: ${config.nit}) expira en ${days_remaining} día(s). Renuévelo urgentemente para evitar interrupciones en la facturación.`;
        } else if (days_remaining <= 15) {
          title = `Certificado DIAN expira en ${days_remaining} días`;
          body = `El certificado digital "${config.name}" (NIT: ${config.nit}) expira en ${days_remaining} días. Planifique su renovación pronto.`;
        } else if (days_remaining <= 30) {
          title = `Certificado DIAN expira en ${days_remaining} días`;
          body = `El certificado digital "${config.name}" (NIT: ${config.nit}) expira en ${days_remaining} días. Recuerde renovarlo a tiempo.`;
        }

        if (title && body) {
          try {
            await this.prisma.notifications.create({
              data: {
                store_id: config.store_id,
                type: 'low_stock' as any, // Reusing existing enum — no migration needed
                title,
                body,
                data: {
                  dian_configuration_id: config.id,
                  days_remaining,
                  certificate_expiry: expiry.toISOString(),
                  alert_type: 'certificate_expiry',
                },
              },
            });
            alerts_sent++;
          } catch (err) {
            this.logger.error(
              `Failed to create notification for config ${config.id}: ${err.message}`,
            );
          }
        }
      }

      if (alerts_sent > 0) {
        this.logger.log(`Sent ${alerts_sent} certificate expiry alert(s)`);
      }
    } catch (error) {
      this.logger.error(
        `Certificate expiry check failed: ${error.message}`,
        error.stack,
      );
    }
  }
}
