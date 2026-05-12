import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';

@Injectable()
export class DataRetentionJob {
  private readonly logger = new Logger(DataRetentionJob.name);

  constructor(private readonly prisma: GlobalPrismaService) {}

  @Cron('0 3 * * 0') // Sundays at 3 AM
  async handleDataRetention() {
    this.logger.log('Starting data retention job...');

    try {
      const now = new Date();

      // 1. Delete expired user_sessions (expires_at < now)
      const expired_sessions = await this.prisma.user_sessions.deleteMany({
        where: { expires_at: { lt: now } },
      });
      this.logger.log(
        `Deleted ${expired_sessions.count} expired user sessions`,
      );

      // 2. Delete login_attempts older than 1 year
      const one_year_ago = new Date();
      one_year_ago.setFullYear(one_year_ago.getFullYear() - 1);

      const old_login_attempts = await this.prisma.login_attempts.deleteMany({
        where: { attempted_at: { lt: one_year_ago } },
      });
      this.logger.log(
        `Deleted ${old_login_attempts.count} login attempts older than 1 year`,
      );

      // 3. Delete audit_logs older than 5 years
      const five_years_ago = new Date();
      five_years_ago.setFullYear(five_years_ago.getFullYear() - 5);

      const old_audit_logs = await this.prisma.audit_logs.deleteMany({
        where: { created_at: { lt: five_years_ago } },
      });
      this.logger.log(
        `Deleted ${old_audit_logs.count} audit logs older than 5 years`,
      );

      // Log summary
      this.logger.log(
        `Data retention job completed. Sessions: ${expired_sessions.count}, ` +
          `Login attempts: ${old_login_attempts.count}, ` +
          `Audit logs: ${old_audit_logs.count}`,
      );
    } catch (error) {
      this.logger.error('Error in data retention job', error);
    }
  }
}
