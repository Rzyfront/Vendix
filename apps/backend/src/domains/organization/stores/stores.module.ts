import { Module } from '@nestjs/common';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { ResponseModule } from '@common/responses/response.module';
import { BrandingGeneratorHelper } from '../../../common/helpers/branding-generator.helper';
import { DomainGeneratorHelper } from '../../../common/helpers/domain-generator.helper';

@Module({
  imports: [ResponseModule],
  controllers: [StoresController],
  providers: [
    StoresService,
    OrganizationPrismaService,
    BrandingGeneratorHelper,
    DomainGeneratorHelper,
  ],
  exports: [StoresService],
})
export class StoresModule { }
