import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { VideoSeriesController } from './video-series.controller';
import { VideoSeriesService } from './video-series.service';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [VideoSeriesController],
  providers: [VideoSeriesService],
  exports: [VideoSeriesService],
})
export class VideoSeriesModule {}
