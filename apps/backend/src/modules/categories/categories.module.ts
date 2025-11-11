import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { ResponseModule } from '../../common/responses/response.module';
import { AccessValidationService } from '../../common/services/access-validation.service';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [CategoriesController],
  providers: [CategoriesService, AccessValidationService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
