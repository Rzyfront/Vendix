import { Module } from '@nestjs/common';
import { ServiceAllocationCoordinator } from './service-allocation-coordinator.service';
import { BusinessHoursService } from './business-hours/business-hours.service';

@Module({
  providers: [ServiceAllocationCoordinator, BusinessHoursService],
  exports: [ServiceAllocationCoordinator, BusinessHoursService],
})
export class ServiceAllocationModule {}
