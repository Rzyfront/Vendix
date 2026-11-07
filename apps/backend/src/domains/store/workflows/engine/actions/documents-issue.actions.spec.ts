// The real service pulls in S3 and the PDF stack; only the class token matters.
jest.mock('../../../documents/templates/issued-documents.service', () => ({ IssuedDocumentsService: class {} }));

import { WorkflowDocumentsActions } from './documents-issue.actions';
import { WorkflowActionContext, WorkflowActionInputError } from './workflow-action.types';
import { WorkflowInstanceRow } from '../workflow-engine.types';

function build(emit = jest.fn().mockResolvedValue({ id: 321 })) {
  const actions = new WorkflowDocumentsActions({ emit } as never);
  const asPublisher = jest.fn(async (fn: () => Promise<unknown>) => fn());
  const ctx = (map: Record<string, unknown>): WorkflowActionContext =>
    ({
      instance: { id: 70, store_id: 5, organization_id: 2 } as WorkflowInstanceRow,
      map,
      actingUserId: 9,
      permissions: ['store:workflows:manage'],
      asPublisher,
    }) as never;
  return { actions, emit, ctx, asPublisher };
}

describe('vendix.document.issue', () => {
  it('issues from the template as the publisher and returns the issued document id', async () => {
    const { actions, emit, ctx, asPublisher } = build();
    const result = await actions.handlers['vendix.document.issue']!(
      ctx({ template_key: 'contrato-laboral', requirement_key: 'contrato', title: 'Contrato de Ana' }),
    );
    expect(result).toEqual({ record_id: 321 });
    expect(asPublisher).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({
      instance_id: 70,
      template_key: 'contrato-laboral',
      requirement_key: 'contrato',
      title: 'Contrato de Ana',
      actor: { type: 'system', id: null },
    });
  });

  it('the requirement and the title are optional', async () => {
    const { actions, emit, ctx } = build();
    await actions.handlers['vendix.document.issue']!(ctx({ template_key: 'carta' }));
    expect(emit.mock.calls[0][0]).toMatchObject({ template_key: 'carta', requirement_key: undefined, title: undefined });
  });

  it('a template key that resolved empty is a permanent input error and nothing is issued', async () => {
    const { actions, emit, ctx } = build();
    await expect(actions.handlers['vendix.document.issue']!(ctx({ template_key: '  ' }))).rejects.toBeInstanceOf(
      WorkflowActionInputError,
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it('propagates the strict emission error (missing data) so the timeline shows it', async () => {
    const error = new Error("Falta el dato 'Salario' para emitir 'Contrato laboral'");
    const { actions, ctx } = build(jest.fn().mockRejectedValue(error));
    await expect(actions.handlers['vendix.document.issue']!(ctx({ template_key: 'contrato-laboral' }))).rejects.toBe(error);
  });
});
