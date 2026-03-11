import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../../../prisma/prisma.module';
import { DianDirectProvider } from './dian-direct.provider';
import { DianSoapClient } from './dian-soap.client';
import { DianXmlSignerService } from './dian-xml-signer.service';
import { DianResponseParserService } from './dian-response-parser.service';

/**
 * Internal module for the DIAN Direct provider.
 * Encapsulates all DIAN-specific services (SOAP, signing, parsing).
 */
@Module({
  imports: [PrismaModule],
  providers: [
    DianDirectProvider,
    DianSoapClient,
    DianXmlSignerService,
    DianResponseParserService,
  ],
  exports: [DianDirectProvider],
})
export class DianDirectModule {}
