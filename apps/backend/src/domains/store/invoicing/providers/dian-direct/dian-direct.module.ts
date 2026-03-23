import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../../../prisma/prisma.module';
import { S3Module } from '../../../../../common/services/s3.module';
import { DianDirectProvider } from './dian-direct.provider';
import { DianSoapClient } from './dian-soap.client';
import { DianXmlSignerService } from './dian-xml-signer.service';
import { DianResponseParserService } from './dian-response-parser.service';

/**
 * Internal module for the DIAN Direct provider.
 * Encapsulates all DIAN-specific services (SOAP, signing, parsing).
 */
@Module({
  imports: [PrismaModule, S3Module],
  providers: [
    DianDirectProvider,
    DianSoapClient,
    DianXmlSignerService,
    DianResponseParserService,
  ],
  exports: [
    DianDirectProvider,
    DianSoapClient,
    DianXmlSignerService,
    DianResponseParserService,
  ],
})
export class DianDirectModule {}
