import { Module } from '@nestjs/common';
import { AddressesService } from './addresses.service';
import { DianMunicipalitiesService } from './dian-municipalities.service';
import { AddressesController } from './addresses.controller';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [AddressesController],
  providers: [AddressesService, DianMunicipalitiesService],
  exports: [AddressesService, DianMunicipalitiesService],
})
export class AddressesModule {}
