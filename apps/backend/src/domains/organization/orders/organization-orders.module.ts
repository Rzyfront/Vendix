import { Module } from '@nestjs/common';
import { OrganizationOrdersController } from './organization-orders.controller';
import { OrganizationOrdersService } from './organization-orders.service';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { ResponseModule } from '@common/responses/response.module';

@Module({
  imports: [ResponseModule],
  controllers: [OrganizationOrdersController],
  providers: [OrganizationOrdersService, OrganizationPrismaService],
  exports: [OrganizationOrdersService],
})
export class OrganizationOrdersModule {}
