import { Module } from '@nestjs/common';
import { ServiceIndustryGuard } from '../../../common/guards/service-industry.guard';
import { ResponseModule } from '@common/responses/response.module';
import { ServiceStationsController } from './service-stations.controller';
import { ServiceStationsService } from './service-stations.service';
import { ServiceAllocationExpiryJob } from './jobs/service-allocation-expiry.job';
import { RateWindowsController } from './rate-windows/rate-windows.controller';
import { RateWindowsService } from './rate-windows/rate-windows.service';
import { RentalQuoteService } from './rental-quote/rental-quote.service';
import { ShippingModule } from '../shipping/shipping.module'; // ShippingTaxService: impuesto del alquiler de estación

@Module({
  imports: [ResponseModule, ShippingModule],
  controllers: [ServiceStationsController, RateWindowsController],
  providers: [
    ServiceStationsService,
    ServiceAllocationExpiryJob,
    ServiceIndustryGuard,
    RateWindowsService,
    RentalQuoteService,
  ],
  exports: [RentalQuoteService],
})
export class ServiceStationsModule {}
