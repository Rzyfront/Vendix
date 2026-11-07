import 'reflect-metadata';

jest.mock('../../../../../messaging/messaging.service', () => ({ MessagingService: class {} }));
jest.mock('../../../../../email/email.service', () => ({ EmailService: class {} }));

import { buildSignatureKit, SignatureKit } from '../../../documents/signatures/signatures.testkit';
import { WorkflowDocumentSignActions } from './documents-sign.actions';
import { WorkflowActionContext } from './workflow-action.types';

async function failure(p: Promise<unknown>) {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e as Error;
  }
}

describe('vendix.document.request_signature (P4.2)', () => {
  let k: SignatureKit;
  let actions: WorkflowDocumentSignActions;

  const ctx = (map: Record<string, unknown>, storeId = 1): WorkflowActionContext => ({
    instance: { id: 1, store_id: storeId, organization_id: 1 } as never,
    map,
    actingUserId: 1,
    permissions: ['store:workflows:manage'],
    asPublisher: (fn) => {
      k.asAdmin(storeId);
      return fn();
    },
  });
  const base = { document_key: 'contrato', signer_name: 'Laura Pérez', signer_email: 'laura@example.com', method: 'email' };
  const run = (map: Record<string, unknown>, storeId = 1) => actions.handlers['vendix.document.request_signature']!(ctx(map, storeId));

  beforeEach(() => {
    k = buildSignatureKit();
    k.seedDocument();
    actions = new WorkflowDocumentSignActions(k.kit.prisma, k.requests);
  });

  it('sends the current document of the requirement to the signer and returns the request id', async () => {
    const result = await run({ ...base, signer_document: '1020304050', role_label: 'Empleado' });
    const request = k.kit.db.table('signature_requests')[0];
    expect(result).toEqual({ record_id: request.id });
    expect(request).toMatchObject({ issued_document_id: 1, status: 'pending', created_by_type: 'system' });
    expect(k.kit.db.table('signature_signers')[0]).toMatchObject({
      name: 'Laura Pérez', email: 'laura@example.com', document_number: '1020304050', role_label: 'Empleado', method: 'otp_email',
    });
    expect(k.kit.db.table('issued_documents')[0].status).toBe('pending_signature');
    expect(k.sent).toHaveLength(1);
  });

  it('maps method whatsapp to the WhatsApp code', async () => {
    await run({ document_key: 'contrato', signer_name: 'Mario', signer_phone: '+573001234567', method: 'whatsapp' });
    expect(k.kit.db.table('signature_signers')[0]).toMatchObject({ method: 'otp_whatsapp', phone: '+573001234567' });
    expect(k.messaging.sendTemplate).toHaveBeenCalledTimes(1);
  });

  it('fails without sending when the requirement has no issued document or the signer lacks the method data', async () => {
    expect((await failure(run({ ...base, document_key: 'otro' })))!.message).toContain('No hay un documento emitido');
    expect((await failure(run({ ...base, signer_email: '' })))!.message).toContain('correo');
    expect(k.kit.db.table('signature_requests')).toHaveLength(0);
    expect(k.sent).toHaveLength(0);
  });

  it('a request of another store never sees the document', async () => {
    expect((await failure(run(base, 2)))!.message).toContain('No hay un documento emitido');
    expect(k.kit.db.table('signature_requests')).toHaveLength(0);
  });

  it('does not run twice over the same document: it is already pending signature', async () => {
    await run(base);
    const second = await failure(run(base));
    expect(second).toBeDefined();
    expect(k.kit.db.table('signature_requests')).toHaveLength(1);
  });
});
