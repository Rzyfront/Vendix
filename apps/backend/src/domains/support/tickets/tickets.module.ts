import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { S3Service } from '@common/services/s3.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SupportNotificationsModule } from '../notifications/support-notifications.module';

@Module({
  imports: [
    EventEmitterModule,
    SupportNotificationsModule,
  ],
  controllers: [TicketsController],
  providers: [
    TicketsService,
    OrganizationPrismaService,
    S3Service,
    S3PathHelper,
  ],
  exports: [TicketsService],
})
export class TicketsModule {}
