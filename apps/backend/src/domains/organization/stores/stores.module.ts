import { Module } from '@nestjs/common';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';
import { ResponseModule } from '@common/responses/response.module';
import { BrandingGeneratorHelper } from '../../../common/helpers/branding-generator.helper';
import { DomainGeneratorHelper } from '../../../common/helpers/domain-generator.helper';
import { StoreBootstrapHelper } from '@common/helpers/store-bootstrap.helper';

@Module({
  imports: [ResponseModule],
  controllers: [StoresController],
  providers: [
    StoresService,
    BrandingGeneratorHelper,
    DomainGeneratorHelper,
    StoreBootstrapHelper,
  ],
  exports: [StoresService],
})
export class StoresModule {}
