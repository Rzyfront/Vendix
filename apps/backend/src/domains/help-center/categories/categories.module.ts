import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';

@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService, GlobalPrismaService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
