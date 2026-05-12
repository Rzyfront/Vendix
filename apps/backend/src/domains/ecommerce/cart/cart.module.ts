import { Module } from '@nestjs/common';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { StorageModule } from '../../../storage.module';
import { SettingsModule } from '../../store/settings/settings.module';
import { InventoryModule } from '../../store/inventory/inventory.module';
import { ProductsModule } from '../../store/products/products.module';

@Module({
  imports: [PrismaModule, StorageModule, SettingsModule, InventoryModule, ProductsModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
