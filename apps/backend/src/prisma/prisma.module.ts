import { Module } from '@nestjs/common';
import { GlobalPrismaService } from './services/global-prisma.service';
import { OrganizationPrismaService } from './services/organization-prisma.service';
import { StorePrismaService } from './services/store-prisma.service';
import { EcommercePrismaService } from './services/ecommerce-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AccessValidationService } from '@common/services/access-validation.service';
import { StoreContextRunner } from '@common/context/store-context-runner.service';

@Module({
  providers: [
    GlobalPrismaService,
    OrganizationPrismaService,
    StorePrismaService,
    EcommercePrismaService,
    RequestContextService,
    AccessValidationService,
    StoreContextRunner,
  ],
  exports: [
    GlobalPrismaService,
    OrganizationPrismaService,
    StorePrismaService,
    EcommercePrismaService,
    RequestContextService,
    AccessValidationService,
    StoreContextRunner,
  ],
})
export class PrismaModule {}
