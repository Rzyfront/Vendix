import { Injectable } from '@nestjs/common';
import { IssuedDocumentsService } from '../../../documents/templates/issued-documents.service';
import {
  WorkflowActionContext,
  WorkflowActionGroup,
  WorkflowActionHandlerMap,
  WorkflowActionResult,
  actionInputs,
  must,
} from './workflow-action.types';

/**
 * Vendix action `vendix.document.issue` (P4.1): issues a document from a
 * published template for the request, through the SAME service as the UI
 * route, as the person who published the flow. The document is queued for
 * render; the returned record id is the issued document.
 */
@Injectable()
export class WorkflowDocumentsActions implements WorkflowActionGroup {
  constructor(private readonly issued: IssuedDocumentsService) {}

  readonly handlers: WorkflowActionHandlerMap = {
    'vendix.document.issue': (ctx) => this.issue(ctx),
  };

  private async issue(ctx: WorkflowActionContext): Promise<WorkflowActionResult> {
    const i = actionInputs('vendix.document.issue', ctx.map);
    const templateKey = must(i.text('template_key', 80), 'template_key');
    const doc = await ctx.asPublisher(() =>
      this.issued.emit({
        instance_id: ctx.instance.id,
        template_key: templateKey,
        requirement_key: i.text('requirement_key', 80),
        title: i.text('title', 200),
        actor: { type: 'system', id: null },
      }),
    );
    return { record_id: doc.id };
  }
}
