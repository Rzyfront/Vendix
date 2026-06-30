import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ProductsModule } from '../../store/products/products.module';
import { PromotionsModule } from '../../store/promotions/promotions.module';
import { MenusModule } from '../../store/menus/menus.module';

@Module({
  imports: [PrismaModule, ProductsModule, PromotionsModule, MenusModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
