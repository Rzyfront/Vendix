import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { EmailModule } from '../../../email/email.module';
import { PqrController } from './pqr.controller';
import { StorePqrController } from './store-pqr.controller';
import { AdminPqrController } from './admin-pqr.controller';
import { PqrService } from './pqr.service';
import { PqrEmailService } from './pqr-email.service';

/**
 * PQR module. Exposes:
 * - `PqrController` mounted at `/pqr` (public POST + GET tracking).
 * - `StorePqrController` mounted at `/store/support/pqr` (store-admin CRUD).
 * - `AdminPqrController` mounted at `/admin/support/pqr` (org-admin oversight).
 * - `PqrEmailService` as an event listener (no controller) that sends the
 *   admin-vendix notification on `pqr.created` and requester notifications
 *   on `pqr.response_sent` / `pqr.status_changed`.
 */
@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [PqrController, StorePqrController, AdminPqrController],
  providers: [PqrService, PqrEmailService],
  exports: [PqrService],
})
export class PqrModule {}