import { print_format_type_enum } from '@prisma/client';
import { StandardPrintDataModel } from './standard-print-data.model';
import { PrintTokenDefinition } from './print-format.interface';

export interface IDocumentDataProvider {
  readonly formatType: print_format_type_enum;

  fetchDocumentData(
    storeId: number,
    documentId: number | string,
  ): Promise<StandardPrintDataModel>;

  getSampleData(storeId?: number): Promise<StandardPrintDataModel>;

  getAvailableTokens(): PrintTokenDefinition[];
}
