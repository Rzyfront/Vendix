import { Module } from '@nestjs/common';
import { ServiceIndustryGuard } from '../../../common/guards/service-industry.guard';
import { ResponseModule } from '@common/responses/response.module';
import { ServiceStationsController } from './service-stations.controller';
import { ServiceStationsService } from './service-stations.service';
import { ServiceAllocationExpiryJob } from './jobs/service-allocation-expiry.job';
import { ShippingModule } from '../shipping/shipping.module'; // ShippingTaxService: impuesto del alquiler de estación

@Module({
  imports: [ResponseModule, ShippingModule],
  controllers: [ServiceStationsController],
  providers: [
    ServiceStationsService,
    ServiceAllocationExpiryJob,
    ServiceIndustryGuard,
  ],
})
export class ServiceStationsModule {}
