import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { EcommerceController } from './ecommerce.controller';
import { EcommerceService } from './ecommerce.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { BrandingGeneratorHelper } from '../../../common/helpers/branding-generator.helper';
import { DomainGeneratorHelper } from '../../../common/helpers/domain-generator.helper';

@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    MulterModule.register(),
  ],
  controllers: [EcommerceController],
  providers: [
    EcommerceService,
    BrandingGeneratorHelper,
    DomainGeneratorHelper,
  ],
  exports: [EcommerceService],
})
export class StoreEcommerceModule { }
