import { Module } from '@nestjs/common';
import { ArticlesController } from './articles.controller';
import { ArticlesService } from './articles.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { S3Module } from '../../../common/services/s3.module';

@Module({
  imports: [S3Module],
  controllers: [ArticlesController],
  providers: [ArticlesService, GlobalPrismaService],
  exports: [ArticlesService],
})
export class ArticlesModule {}
