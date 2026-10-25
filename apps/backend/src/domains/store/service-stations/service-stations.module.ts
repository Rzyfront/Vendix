import { Module } from '@nestjs/common';
import { ServiceIndustryGuard } from '../../../common/guards/service-industry.guard';
import { ResponseModule } from '@common/responses/response.module';
import { ServiceStationsController } from './service-stations.controller';
import { ServiceStationsService } from './service-stations.service';
import { ServiceStationCalendarController } from './service-station-calendar.controller';
import { ServiceStationCalendarService } from './service-station-calendar.service';
import { ServiceAllocationExpiryJob } from './jobs/service-allocation-expiry.job';

@Module({
  imports: [ResponseModule],
  controllers: [ServiceStationsController, ServiceStationCalendarController],
  providers: [
    ServiceStationsService,
    ServiceStationCalendarService,
    ServiceAllocationExpiryJob,
    ServiceIndustryGuard,
  ],
})
export class ServiceStationsModule {}
