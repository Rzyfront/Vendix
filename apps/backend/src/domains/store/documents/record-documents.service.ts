import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import type { AttachableEntityType } from './documents.constants';
import { DocumentSearchService } from './search/document-search.service';
import { StoredFilesService } from './stored-files.service';

/**
 * Documents of one business record (order, customer, …), for its own detail
 * page (B1). Unlike the document library (`store/documents/*`, gated on the
 * `documents` industry module), this is reachable in every industry: whoever
 * can read the record can read what was filed against it. The permission is
 * enforced by `RecordDocumentsController`, one route per record type.
 */
@Injectable()
export class RecordDocumentsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly search: DocumentSearchService,
    private readonly storedFiles: StoredFilesService,
  ) {}

  /** Files in the record's folders, newest first (same shape as the library). */
  list(
    subjectType: AttachableEntityType,
    subjectId: number,
    input: { page?: number; limit?: number } = {},
  ) {
    return this.search.search({
      subject_type: subjectType,
      subject_id: subjectId,
      page: input.page,
      limit: input.limit,
    });
  }

  /**
   * Signed URL of a file, only when it is filed against this record: the
   * record permission must not open any other file of the store by id.
   */
  async download(
    subjectType: AttachableEntityType,
    subjectId: number,
    fileId: number,
  ) {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    const file = await this.prisma.stored_files.findFirst({
      where: {
        id: fileId,
        store_id: storeId,
        deleted_at: null,
        purged_at: null,
        items: {
          some: {
            store_id: storeId,
            dossier: {
              store_id: storeId,
              subject_type: subjectType,
              subject_id: subjectId,
            },
          },
        },
      },
      select: { id: true },
    });
    if (!file) throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    return this.storedFiles.signedDownloadUrl(file.id);
  }
}
