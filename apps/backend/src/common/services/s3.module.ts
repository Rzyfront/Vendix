import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RemoteImageService } from './remote-image.service';
import { S3Service } from './s3.service';

@Module({
  imports: [ConfigModule],
  providers: [S3Service, RemoteImageService],
  exports: [S3Service, RemoteImageService],
})
export class S3Module {}
