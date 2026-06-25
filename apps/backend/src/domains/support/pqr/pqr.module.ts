import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { EmailModule } from '../../../email/email.module';
import { PqrController } from './pqr.controller';
import { StorePqrController } from './store-pqr.controller';
import { PqrService } from './pqr.service';
import { PqrEmailService } from './pqr-email.service';

/**
 * PQR module. Exposes:
 * - `PqrController` mounted at `/pqr` (public POST + GET tracking).
 * - `StorePqrController` mounted at `/store/support/pqr` (store-admin CRUD).
 * - `PqrEmailService` as an event listener (no controller) that sends the
 *   admin-vendix notification on `pqr.created` and requester notifications
 *   on `pqr.response_sent` / `pqr.status_changed`.
 *
 * Note: org-admin PQR oversight was scoped out and will land in a
 * follow-up iteration — see comment in pqr.service.ts createPublic for
 * the multi-tenant attribution groundwork already in place.
 */
@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [PqrController, StorePqrController],
  providers: [PqrService, PqrEmailService],
  exports: [PqrService],
})
export class PqrModule {}