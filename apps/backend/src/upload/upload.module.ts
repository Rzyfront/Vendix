import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { S3Module } from '@common/services/s3.module';

@Module({
  imports: [PrismaModule, S3Module],
  controllers: [UploadController],
})
export class UploadModule {}
