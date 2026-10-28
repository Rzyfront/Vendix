import { Module } from '@nestjs/common';
import { LodgingReservationsModule } from '../../store/hospitality/reservations/reservations.module';
import { EcommerceHospitalityController } from './ecommerce-hospitality.controller';

@Module({
  imports: [LodgingReservationsModule],
  controllers: [EcommerceHospitalityController],
})
export class EcommerceHospitalityModule {}
