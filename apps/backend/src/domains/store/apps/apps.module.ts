import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AppsController } from './apps.controller';
import { AppsService } from './apps.service';

/** Apps — catálogo de aplicaciones web por tienda (odd/tasks/apps-module.md). */
@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [AppsController],
  providers: [AppsService],
  exports: [AppsService],
})
export class AppsModule {}
