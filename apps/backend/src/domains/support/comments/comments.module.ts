import { Module } from '@nestjs/common';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { S3Service } from '@common/services/s3.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [EventEmitterModule],
  controllers: [CommentsController],
  providers: [
    CommentsService,
    OrganizationPrismaService,
    S3Service,
    S3PathHelper,
  ],
  exports: [CommentsService],
})
export class CommentsModule {}
