import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { ServiceStationsController } from './service-stations.controller';
import { ServiceStationsService } from './service-stations.service';

@Module({
  imports: [ResponseModule],
  controllers: [ServiceStationsController],
  providers: [ServiceStationsService],
})
export class ServiceStationsModule {}
