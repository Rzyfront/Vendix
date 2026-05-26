import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { EcommerceController } from './ecommerce.controller';
import { EcommerceService } from './ecommerce.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { DomainGeneratorHelper } from '../../../common/helpers/domain-generator.helper';
import { QrService } from '../../../common/services/qr.service';

@Module({
  imports: [PrismaModule, ResponseModule, MulterModule.register()],
  controllers: [EcommerceController],
  providers: [EcommerceService, DomainGeneratorHelper, QrService],
  exports: [EcommerceService],
})
export class StoreEcommerceModule {}
