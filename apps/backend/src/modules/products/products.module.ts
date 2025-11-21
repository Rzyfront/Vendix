import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { ProductVariantService } from './services/product-variant.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ResponseModule } from '../../common/responses/response.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [PrismaModule, ResponseModule, InventoryModule],
  controllers: [ProductsController],
  providers: [ProductsService, ProductVariantService],
  exports: [ProductsService, ProductVariantService],
})
export class ProductsModule {}
