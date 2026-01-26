import { Module } from '@nestjs/common';
import { ShippingController } from './controllers/shipping.controller';
import { ShippingService } from './services/shipping.service';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ShippingController],
  providers: [ShippingService],
  exports: [ShippingService],
})
export class ShippingModule {}
