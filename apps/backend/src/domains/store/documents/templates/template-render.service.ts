import { Injectable, Logger } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import { S3Service } from '@common/services/s3.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { BasePdfPagesService } from './base-pdf-pages.service';
import { BasePdfBody, BlocksBody } from './template-body';
import { renderBasePdf, renderBlocksPdf } from './template-pdf';
import type { RenderIssuedOptions } from './issued-document-renderer';
import { TokenScope } from './template-tokens';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- sharp's CJS export is the function itself
const sharp: typeof import('sharp').default = require('sharp');

export interface RenderInput {
  kind: 'blocks' | 'base_pdf';
  body: unknown;
  base_file_id: number | null;
  scope: TokenScope;
  title: string;
  preview?: boolean;
  signing?: RenderIssuedOptions;
}

/** Draws a template body with pdfkit. Shared by the preview, the queue and the seal. */
@Injectable()
export class TemplateRenderService {
  private readonly logger = new Logger(TemplateRenderService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3: S3Service,
    private readonly basePages: BasePdfPagesService,
  ) {}

  /** Bytes of a stored file of the current store. */
  async fileBytes(fileId: number): Promise<Buffer> {
    const storeId = RequestContextService.getStoreId() as number;
    const file = await this.prisma.stored_files.findFirst({
      where: { id: fileId, store_id: storeId, deleted_at: null },
      select: { s3_key: true, purged_at: true },
    });
    if (!file || file.purged_at) throw new VendixHttpException(ErrorCodes.DOCTPL_BASE_PDF_REQUIRED);
    return this.s3.downloadFile(file.s3_key);
  }

  /** The logo is cosmetic: any failure renders the document without it. */
  private async logo(scope: TokenScope): Promise<Buffer | null> {
    const key = scope.values['store.logo'];
    if (typeof key !== 'string' || !key) return null;
    try {
      return await sharp(await this.s3.downloadFile(key)).png().toBuffer();
    } catch (e) {
      this.logger.warn(`Store logo not readable for a document: ${(e as Error)?.message}`);
      return null;
    }
  }

  async render(input: RenderInput): Promise<Buffer> {
    const options = {
      scope: input.scope,
      preview: input.preview,
      title: input.title,
      signatures: input.signing?.signatures,
      appendPages: input.signing?.appendPages,
    };
    if (input.kind === 'base_pdf') {
      if (!input.base_file_id) throw new VendixHttpException(ErrorCodes.DOCTPL_BASE_PDF_REQUIRED);
      const pages = await this.basePages.rasterize(await this.fileBytes(input.base_file_id));
      return renderBasePdf(input.body as BasePdfBody, pages, options);
    }
    return renderBlocksPdf(input.body as BlocksBody, { ...options, logo: await this.logo(input.scope) });
  }
}
