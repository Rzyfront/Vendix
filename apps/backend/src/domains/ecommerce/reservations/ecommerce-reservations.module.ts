import { Module } from '@nestjs/common';
import { EcommerceReservationsController } from './ecommerce-reservations.controller';
import { ReservationsModule } from '../../store/reservations/reservations.module';
import { ServiceStationsModule } from '../../store/service-stations/service-stations.module';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [ReservationsModule, ServiceStationsModule, PrismaModule],
  controllers: [EcommerceReservationsController],
})
export class EcommerceReservationsModule {}
