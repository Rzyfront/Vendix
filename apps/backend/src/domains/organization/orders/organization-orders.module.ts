import { Module } from '@nestjs/common';
import { OrganizationOrdersController } from './organization-orders.controller';
import { OrganizationOrdersService } from './organization-orders.service';

@Module({
  controllers: [OrganizationOrdersController],
  providers: [OrganizationOrdersService],
  exports: [OrganizationOrdersService],
})
export class OrganizationOrdersModule {}
