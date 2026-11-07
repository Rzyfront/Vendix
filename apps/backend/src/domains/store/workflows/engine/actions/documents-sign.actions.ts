import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { SignatureRequestsService } from '../../../documents/signatures/signature-requests.service';
import {
  WorkflowActionContext,
  WorkflowActionGroup,
  WorkflowActionHandlerMap,
  WorkflowActionInputError,
  WorkflowActionResult,
  actionInputs,
  must,
  returnedId,
} from './workflow-action.types';

/**
 * Vendix action of the electronic signature (P4.2): sends the current issued
 * document of a requirement to one signer, through the same service the UI
 * uses, so every rule (status, channel, link) applies.
 */
@Injectable()
export class WorkflowDocumentSignActions implements WorkflowActionGroup {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly signatures: SignatureRequestsService,
  ) {}

  readonly handlers: WorkflowActionHandlerMap = {
    'vendix.document.request_signature': (ctx) => this.requestSignature(ctx),
  };

  private async requestSignature(ctx: WorkflowActionContext): Promise<WorkflowActionResult> {
    const i = actionInputs('vendix.document.request_signature', ctx.map);
    const documentKey = must(i.text('document_key', 80), 'document_key');
    const name = must(i.text('signer_name', 160), 'signer_name');
    const method = must(i.enum<'email' | 'whatsapp'>('method'), 'method');
    const created = await ctx.asPublisher(async () => {
      const document = await this.prisma.issued_documents.findFirst({
        where: {
          workflow_instance_id: ctx.instance.id,
          requirement_key: documentKey,
          status: { notIn: ['superseded', 'voided'] },
        },
        orderBy: { id: 'desc' },
        select: { id: true },
      });
      if (!document) {
        throw new WorkflowActionInputError(
          `No hay un documento emitido para el requisito "${documentKey}" en esta solicitud.`,
        );
      }
      return this.signatures.create(
        {
          issued_document_id: document.id,
          signers: [
            {
              name,
              document_number: i.text('signer_document', 30),
              email: i.text('signer_email', 160),
              phone: i.text('signer_phone', 30),
              role_label: i.text('role_label', 80),
              method: method === 'email' ? 'otp_email' : 'otp_whatsapp',
            },
          ],
        },
        { type: 'system', id: null },
      );
    });
    return { record_id: returnedId(created, 'Signature request') };
  }
}
