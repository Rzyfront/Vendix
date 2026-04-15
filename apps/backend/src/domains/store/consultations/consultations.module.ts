import { Module } from '@nestjs/common';
import { ConsultationsController } from './consultations.controller';
import { ConsultationsService } from './consultations.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { DataCollectionModule } from '../data-collection/data-collection.module';
import { ReservationsModule } from '../reservations/reservations.module';

@Module({
  imports: [ResponseModule, PrismaModule, DataCollectionModule, ReservationsModule],
  controllers: [ConsultationsController],
  providers: [ConsultationsService],
  exports: [ConsultationsService],
})
export class ConsultationsModule {}
