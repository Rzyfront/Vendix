import { Module } from '@nestjs/common';
import { BrandsService } from './brands.service';
import { BrandsController } from './brands.controller';
import { ResponseModule } from '@common/responses/response.module';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [BrandsController],
  providers: [BrandsService, PermissionsGuard],
  exports: [BrandsService],
})
export class BrandsModule { }
