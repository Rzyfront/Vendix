import { Module } from '@nestjs/common';
import { LocationsModule } from './locations/locations.module';
import { StockLevelsModule } from './stock-levels/stock-levels.module';
import { MovementsModule } from './movements/movements.module';
import { SuppliersModule } from './suppliers/suppliers.module';

@Module({
  imports: [
    LocationsModule,
    StockLevelsModule,
    MovementsModule,
    SuppliersModule,
  ],
  controllers: [],
  providers: [],
  exports: [
    LocationsModule,
    StockLevelsModule,
    MovementsModule,
    SuppliersModule,
  ],
})
export class InventoryModule {}
