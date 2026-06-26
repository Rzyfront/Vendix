import { Module } from '@nestjs/common';
import { SuperadminSupportController } from './support.controller';
import { SuperadminSupportService } from './support.service';
import { SuperadminPqrsController } from './pqrs.controller';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { S3Module } from '../../../common/services/s3.module';
import { SupportNotificationsModule } from '../../support/notifications/support-notifications.module';
import { PqrModule } from '../../support/pqr/pqr.module';

@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    S3Module,
    SupportNotificationsModule,
    // Required so SuperadminPqrsController can inject PqrService and
    // reuse the same write surface (comments / status / assign) as the
    // store-admin controller — super-admin is the actual recipient of
    // platform-wide PQRs that arrive via POST /pqr.
    PqrModule,
  ],
  controllers: [SuperadminSupportController, SuperadminPqrsController],
  providers: [SuperadminSupportService],
  exports: [SuperadminSupportService],
})
export class SuperadminSupportModule {}
