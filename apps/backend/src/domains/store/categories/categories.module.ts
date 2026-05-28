import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';

import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [ResponseModule, PrismaModule, MulterModule.register()],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
