import { Module } from '@nestjs/common';
import { EcommerceReservationsController } from './ecommerce-reservations.controller';
import { ReservationsModule } from '../../store/reservations/reservations.module';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [ReservationsModule, PrismaModule],
  controllers: [EcommerceReservationsController],
})
export class EcommerceReservationsModule {}
