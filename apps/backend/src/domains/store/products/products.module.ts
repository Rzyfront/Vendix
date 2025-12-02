import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { ProductsBulkController } from './products-bulk.controller';
import { ProductsBulkService } from './products-bulk.service';
import { ProductVariantService } from './services/product-variant.service';
import { ResponseModule } from '@common/responses/response.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AccessValidationService } from '@common/services/access-validation.service';

@Module({
  imports: [ResponseModule, InventoryModule, PrismaModule],
  controllers: [ProductsController, ProductsBulkController],
  providers: [
    ProductsService,
    ProductsBulkService,
    ProductVariantService,
    AccessValidationService,
  ],
  exports: [ProductsService, ProductsBulkService, ProductVariantService],
})
export class ProductsModule {}
