import { Module } from '@nestjs/common';
import { EcommerceReservationsController } from './ecommerce-reservations.controller';
import { ReservationsModule } from '../../store/reservations/reservations.module';

@Module({
  imports: [ReservationsModule],
  controllers: [EcommerceReservationsController],
})
export class EcommerceReservationsModule {}
