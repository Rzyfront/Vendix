import { Module } from '@nestjs/common';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { ResponseModule } from '@common/responses/response.module';

@Module({
  imports: [ResponseModule],
  controllers: [StoresController],
  providers: [StoresService, OrganizationPrismaService],
  exports: [StoresService],
})
export class StoresModule {}
