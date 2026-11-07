import { Injectable } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { ReceivedDocumentPagesService } from '../../../received-documents/services/received-document-pages.service';
import { BasePageImage } from './template-pdf';

export interface BasePdfPage extends BasePageImage {
  page: number;
  /** `data:image/jpeg;base64,...`, for the editor. */
  data_uri: string;
}

/**
 * Rasterizes the pages of a base PDF (P4.5) with the same bounded
 * `pdfjs-dist` + `@napi-rs/canvas` pipeline the received-documents block
 * uses: at most 10 pages and 10 MiB.
 */
@Injectable()
export class BasePdfPagesService {
  constructor(private readonly pages: ReceivedDocumentPagesService) {}

  async rasterize(buffer: Buffer): Promise<BasePdfPage[]> {
    let prepared;
    try {
      prepared = await this.pages.prepare({
        buffer,
        mimetype: 'application/pdf',
        size: buffer.length,
        originalname: 'base.pdf',
      });
    } catch (e) {
      throw new VendixHttpException(
        ErrorCodes.DOCTPL_INVALID,
        (e as Error)?.message || 'No se pudo leer el PDF base.',
      );
    }
    return prepared.pages.map((p) => ({
      page: p.page_number,
      image: Buffer.from(p.data_uri.slice(p.data_uri.indexOf(',') + 1), 'base64'),
      width_pt: p.width_pt ?? 612,
      height_pt: p.height_pt ?? 792,
      data_uri: p.data_uri,
    }));
  }
}
