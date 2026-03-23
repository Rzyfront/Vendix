import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../../../prisma/prisma.module';
import { S3Module } from '../../../../../common/services/s3.module';
import { DianDirectModule } from '../../../../store/invoicing/providers/dian-direct/dian-direct.module';
import { DianPayrollProvider } from './dian-payroll.provider';

/**
 * Module for the DIAN DSPNE payroll provider.
 *
 * Imports:
 * - DianDirectModule: reuses DianSoapClient and DianXmlSignerService
 * - S3Module: for downloading .p12 certificates from S3
 * - PrismaModule: for database access (StorePrismaService)
 * - EncryptionService: available globally via @Global() EncryptionModule
 */
@Module({
  imports: [PrismaModule, S3Module, DianDirectModule],
  providers: [DianPayrollProvider],
  exports: [DianPayrollProvider],
})
export class DianPayrollModule {}
