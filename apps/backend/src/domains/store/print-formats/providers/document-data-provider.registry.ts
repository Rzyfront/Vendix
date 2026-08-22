import { Injectable, Logger } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';

@Injectable()
export class DocumentDataProviderRegistry {
  private readonly logger = new Logger(DocumentDataProviderRegistry.name);
  private readonly providers = new Map<print_format_type_enum, IDocumentDataProvider>();

  register(provider: IDocumentDataProvider): void {
    this.providers.set(provider.formatType, provider);
    this.logger.log(`Registered data provider for format type: ${provider.formatType}`);
  }

  getProvider(formatType: print_format_type_enum): IDocumentDataProvider {
    const provider = this.providers.get(formatType);
    if (!provider) {
      throw new VendixHttpException(
        ErrorCodes.PRINT_DATA_PROVIDER_MISSING_001,
        `No document data provider registered for format type: ${formatType}`,
      );
    }
    return provider;
  }

  hasProvider(formatType: print_format_type_enum): boolean {
    return this.providers.has(formatType);
  }

  getAllRegisteredTypes(): print_format_type_enum[] {
    return Array.from(this.providers.keys());
  }
}
