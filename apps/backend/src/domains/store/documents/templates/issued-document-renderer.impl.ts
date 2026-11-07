import { Injectable } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { IssuedDocumentRenderer, RenderIssuedOptions } from './issued-document-renderer';
import { TemplateRenderService } from './template-render.service';
import { snapshotScope } from './issued-snapshot';

/**
 * Renders an issued document again from its frozen template version and
 * `data_snapshot` (the signature seal needs the same pages with the signatures
 * drawn in). Nothing is read from the live template or request.
 */
@Injectable()
export class FrozenIssuedDocumentRenderer extends IssuedDocumentRenderer {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly renderer: TemplateRenderService,
  ) {
    super();
  }

  async render(issuedDocumentId: number, options?: RenderIssuedOptions): Promise<Buffer> {
    const storeId = RequestContextService.getStoreId() as number;
    const doc = await this.prisma.issued_documents.findFirst({
      where: { id: issuedDocumentId, store_id: storeId },
      include: { template_version: true },
    });
    if (!doc) throw new VendixHttpException(ErrorCodes.DOCISSUE_NOT_FOUND);
    return this.renderer.render({
      kind: doc.template_version.kind,
      body: doc.template_version.body,
      base_file_id: doc.template_version.base_file_id,
      scope: snapshotScope(doc.data_snapshot),
      title: `${doc.reference} ${doc.title}`,
      signing: options,
    });
  }
}
