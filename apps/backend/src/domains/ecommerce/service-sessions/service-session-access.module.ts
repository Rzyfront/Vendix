import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { NotificationsModule } from '../../store/notifications/notifications.module';
import { ServiceSessionAccessController } from './service-session-access.controller';
import { ServiceSessionAccessService } from './service-session-access.service';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [ServiceSessionAccessController],
  providers: [ServiceSessionAccessService],
  exports: [ServiceSessionAccessService],
})
export class ServiceSessionAccessModule {}
