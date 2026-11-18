import { Global, Module } from '@nestjs/common';
import { EmailModule } from '../../email/email.module';
import { PlatformIncidentService } from './platform-incident.service';

/**
 * Global: any domain (bulk uploads today, the API monitoring bot next) injects
 * `PlatformIncidentService` without importing this module. Prisma, Redis and
 * Config come from their own global modules.
 */
@Global()
@Module({
  imports: [EmailModule],
  providers: [PlatformIncidentService],
  exports: [PlatformIncidentService],
})
export class PlatformIncidentsModule {}
