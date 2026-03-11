import { Module } from '@nestjs/common';
import { HelpCenterAdminController } from './help-center-admin.controller';
import { HelpCenterAdminService } from './help-center-admin.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { S3Module } from '@common/services/s3.module';

@Module({
  imports: [PrismaModule, ResponseModule, S3Module],
  controllers: [HelpCenterAdminController],
  providers: [HelpCenterAdminService],
  exports: [HelpCenterAdminService],
})
export class HelpCenterAdminModule {}
