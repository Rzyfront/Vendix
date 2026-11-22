import { Module } from '@nestjs/common';
import { S3Module } from '@common/services/s3.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { LearningPathsController } from './learning-paths.controller';
import { LearningPathsService } from './learning-paths.service';

@Module({
  imports: [PrismaModule, S3Module],
  controllers: [LearningPathsController],
  providers: [LearningPathsService],
  exports: [LearningPathsService],
})
export class LearningPathsModule {}
