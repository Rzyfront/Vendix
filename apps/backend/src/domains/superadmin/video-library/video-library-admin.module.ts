import { Module } from '@nestjs/common';
import { VideoLibraryAdminController } from './video-library-admin.controller';
import { VideoLibraryAdminService } from './video-library-admin.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { S3Module } from '@common/services/s3.module';
import { VideoSeriesModule } from './series/video-series.module';

@Module({
  imports: [PrismaModule, ResponseModule, S3Module, VideoSeriesModule],
  controllers: [VideoLibraryAdminController],
  providers: [VideoLibraryAdminService],
  exports: [VideoLibraryAdminService],
})
export class VideoLibraryAdminModule {}
