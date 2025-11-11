import { Module } from '@nestjs/common';
import { AddressesService } from './addresses.service';
import { AddressesController } from './addresses.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { ResponseModule } from '../../common/responses/response.module';
import { AccessValidationService } from '../../common/services/access-validation.service';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [AddressesController],
  providers: [AddressesService, AccessValidationService],
  exports: [AddressesService],
})
export class AddressesModule {}
