import { Module } from '@nestjs/common';
import { VideoLibraryController } from './video-library.controller';
import { VideoLibraryService } from './video-library.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { S3Module } from '@common/services/s3.module';
import { LearningPathsModule } from './series/learning-paths.module';

@Module({
  imports: [PrismaModule, S3Module, LearningPathsModule],
  controllers: [VideoLibraryController],
  providers: [VideoLibraryService],
  exports: [VideoLibraryService],
})
export class VideoLibraryModule {}
