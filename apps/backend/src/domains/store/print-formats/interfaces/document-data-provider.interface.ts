import { print_format_type_enum } from '@prisma/client';
import { StandardPrintDataModel } from './standard-print-data.model';
import { PrintTokenDefinition } from './print-format.interface';
import { RecentDocumentSummary } from './document-index.interface';

export interface IDocumentDataProvider {
  readonly formatType: print_format_type_enum;

  fetchDocumentData(
    storeId: number,
    documentId: number | string,
  ): Promise<StandardPrintDataModel>;

  getSampleData(storeId?: number): Promise<StandardPrintDataModel>;

  getAvailableTokens(): PrintTokenDefinition[];

  /**
   * [print-editor-dsk P3.1] List the most recent documents of THIS format
   * for a store. Optional — providers that don't implement it simply omit
   * the method; `DocumentIndexService` falls back to `[]` instead of
   * throwing so the editor's preview picker degrades gracefully for formats
   * without a real reader (e.g. `transfer_note`, `kitchen_ticket`).
   *
   * `limit` is already capped at 50 by the caller — providers can rely on
   * that ceiling. Return shape is the minimum the picker needs: id,
   * human-readable number, formatted date, and optional formatted total.
   */
  listRecent?(
    storeId: number,
    limit: number,
  ): Promise<RecentDocumentSummary[]>;
}
