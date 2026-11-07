import { Readable } from 'node:stream';
import { BadRequestException } from '@nestjs/common';
import { VendixHttpException } from '@common/errors';
import { WorkflowMailboxReceiverService } from './workflow-mailbox-receiver.service';
import type { WorkflowMailboxDelivery } from './workflow-mailbox.types';

const LOCAL = 'flujos-00112233445566778899aabbccddeeff';
const DOMAIN = 'recepcion.vendix.online';

function build(
  opts: {
    box?: any;
    parts?: any[];
    text?: string;
    startExternal?: jest.Mock;
    upload?: jest.Mock;
    industries?: string[];
    filedEvent?: boolean;
  } = {},
) {
  const box =
    opts.box === undefined
      ? { id: 5, store_id: 3, organization_id: 2, definition_id: 11, is_active: true }
      : opts.box;
  const messages: any[] = [];
  const unscoped: any = {
    workflow_mailboxes: { findFirst: jest.fn(async () => box) },
    workflow_mailbox_messages: {
      create: jest.fn(async ({ data }: any) => {
        messages.push(data);
        return data;
      }),
    },
    stores: { findFirst: jest.fn(async () => ({ industries: opts.industries ?? ['administration'] })) },
  };
  const scoped: any = {
    withoutScope: () => unscoped,
    workflow_mailbox_messages: {
      findFirst: jest.fn(async ({ where }: any) =>
        messages.find((m) => m.mailbox_id === where.mailbox_id && m.message_id === where.message_id) ?? null,
      ),
    },
    workflow_mailboxes: { updateMany: jest.fn(async () => ({ count: 1 })) },
    workflow_instance_events: {
      findFirst: jest.fn(async () => (opts.filedEvent ? { id: 1 } : null)),
    },
    $transaction: jest.fn(async (fn: any) => fn({})),
  };
  const instance = {
    id: 40,
    store_id: 3,
    organization_id: 2,
    reference: 'FLU-0040',
    title: 't',
    subject_type: null,
    subject_id: null,
    current_stage_key: 'request',
  };
  const engine = {
    startExternal:
      opts.startExternal ?? jest.fn(async () => ({ instance, replayed: false })),
  };
  const files = {
    upload: opts.upload ?? jest.fn(async () => ({ id: 900, s3_key: 'k' })),
    discard: jest.fn(),
  };
  const dossiers = {
    getByInstance: jest.fn(async () => ({ id: 70 })),
    createForInstance: jest.fn(),
    addFileItem: jest.fn(async () => ({ id: 1 })),
  };
  const events = { lockInstance: jest.fn(), append: jest.fn() };
  const mime = {
    parse: jest.fn(async () => ({
      sender: 'ana@proveedor.co',
      subject: 'Cotización',
      text: opts.text ?? 'Hola',
      rfc_message_id_hash: null,
      parts: opts.parts ?? [],
    })),
  };
  const service = new WorkflowMailboxReceiverService(
    scoped,
    engine as any,
    files as any,
    dossiers as any,
    events as any,
    mime as any,
  );
  const delivery = (over: Partial<WorkflowMailboxDelivery> = {}): WorkflowMailboxDelivery => ({
    recipient: `${LOCAL}@${DOMAIN}`,
    ses_message_id: 'ses-1',
    from_header: '"Ana Pérez" <ana@proveedor.co>',
    facts: { virus_status: 'PASS', spam_status: 'PASS' },
    openRaw: jest.fn(async () => Readable.from([Buffer.from('raw')])),
    ...over,
  });
  return { service, engine, files, dossiers, events, mime, messages, unscoped, scoped, delivery };
}

const pdf = (name: string, size = 10) => ({
  filename: name,
  content_type: 'application/pdf',
  bytes: Buffer.alloc(size, 1),
});

describe('WorkflowMailboxReceiverService (P3.3 correo entrante)', () => {
  it('starts the flow once with subject, sender and text, then files the attachments and logs the mail', async () => {
    const h = build({ parts: [pdf('rut.pdf'), pdf('cotizacion.pdf')], text: 'x'.repeat(12_000) });
    const out = await h.service.receive(h.delivery());
    expect(out).toEqual({ status: 'accepted', instance_id: 40 });
    expect(h.engine.startExternal).toHaveBeenCalledTimes(1);
    const call = h.engine.startExternal.mock.calls[0][0];
    expect(call).toMatchObject({
      definitionId: 11,
      kind: 'email',
      idempotencyKey: '5:ses-1',
      context: { subject: 'Cotización', from: 'ana@proveedor.co', from_name: 'Ana Pérez' },
    });
    expect(call.context.text).toHaveLength(10_000);
    expect(h.files.upload).toHaveBeenCalledTimes(2);
    expect(h.files.upload.mock.calls[0][0]).toMatchObject({
      source: 'public_form',
      actor: { type: 'system', id: null },
      originalName: 'rut.pdf',
    });
    expect(h.dossiers.addFileItem).toHaveBeenCalledTimes(2);
    const keys = h.dossiers.addFileItem.mock.calls.map((c: any) => c[1].requirement_key);
    expect(new Set(keys).size).toBe(2);
    expect(h.events.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'email_received',
        actor: { type: 'system', id: null },
        payload: { attachments: ['rut.pdf', 'cotizacion.pdf'], skipped: [] },
      }),
    );
    expect(h.messages).toEqual([
      expect.objectContaining({ mailbox_id: 5, message_id: 'ses-1', status: 'accepted', instance_id: 40 }),
    ]);
  });

  it('the same SES message id starts nothing the second time', async () => {
    const h = build({ parts: [pdf('rut.pdf')] });
    await h.service.receive(h.delivery());
    const again = await h.service.receive(h.delivery());
    expect(again).toEqual({ status: 'duplicate' });
    expect(h.engine.startExternal).toHaveBeenCalledTimes(1);
    expect(h.files.upload).toHaveBeenCalledTimes(1);
    expect(h.messages).toHaveLength(1);
  });

  it('skips attachments over 25 MB and notes them in the timeline', async () => {
    const h = build({ parts: [pdf('grande.pdf', 25 * 1024 * 1024 + 1), pdf('ok.pdf')] });
    await h.service.receive(h.delivery());
    expect(h.files.upload).toHaveBeenCalledTimes(1);
    expect(h.events.append.mock.calls[0][1].payload).toEqual({
      attachments: ['ok.pdf'],
      skipped: [{ name: 'grande.pdf', reason: 'TOO_LARGE' }],
    });
  });

  it('an attachment the file store refuses is skipped, the request still starts', async () => {
    const upload = jest.fn(async () => {
      throw new VendixHttpException({ code: 'DOCUMENT_TYPE_NOT_ALLOWED', httpStatus: 415, devMessage: 'x' } as any);
    });
    const h = build({ parts: [pdf('virus.exe')], upload });
    const out = await h.service.receive(h.delivery());
    expect(out.status).toBe('accepted');
    expect(h.events.append.mock.calls[0][1].payload.skipped).toEqual([
      { name: 'virus.exe', reason: 'DOCUMENT_TYPE_NOT_ALLOWED' },
    ]);
  });

  it('records rejected and does not throw when the engine refuses the mail', async () => {
    const startExternal = jest.fn(async () => {
      throw new VendixHttpException({ code: 'WORKFLOW_NOT_ACTIVE', httpStatus: 409, devMessage: 'x' } as any);
    });
    const h = build({ startExternal });
    await expect(h.service.receive(h.delivery())).resolves.toEqual({ status: 'rejected' });
    expect(h.messages[0]).toMatchObject({ status: 'rejected', error: expect.stringContaining('WORKFLOW_NOT_ACTIVE') });
  });

  it('a mail that fails the virus scan is rejected without reading the raw message', async () => {
    const h = build();
    const delivery = h.delivery({ facts: { virus_status: 'FAIL', spam_status: 'PASS' } });
    await expect(h.service.receive(delivery)).resolves.toEqual({ status: 'rejected' });
    expect(delivery.openRaw).not.toHaveBeenCalled();
    expect(h.engine.startExternal).not.toHaveBeenCalled();
  });

  it('an unknown address is ignored and an inactive mailbox records a rejection', async () => {
    const unknown = build({ box: null });
    await expect(unknown.service.receive(unknown.delivery())).resolves.toEqual({ status: 'ignored' });
    expect(unknown.messages).toHaveLength(0);
    const inactive = build({ box: { id: 5, store_id: 3, organization_id: 2, definition_id: 11, is_active: false } });
    await expect(inactive.service.receive(inactive.delivery())).resolves.toEqual({ status: 'rejected' });
    expect(inactive.engine.startExternal).not.toHaveBeenCalled();
  });
  it('a transient failure before the start records nothing and throws, so the queue delivers the mail again', async () => {
    const h = build({ parts: [pdf('rut.pdf')] });
    const flaky = h.delivery({ openRaw: jest.fn(async () => Promise.reject(new Error('S3 read timed out'))) });
    await expect(h.service.receive(flaky)).rejects.toThrow('S3 read timed out');
    expect(h.messages).toHaveLength(0);
    expect(h.engine.startExternal).not.toHaveBeenCalled();

    await expect(h.service.receive(h.delivery())).resolves.toEqual({ status: 'accepted', instance_id: 40 });
    expect(h.files.upload).toHaveBeenCalledTimes(1);
  });

  it('a malformed mail is still a final rejection', async () => {
    const h = build();
    h.mime.parse.mockRejectedValueOnce(
      new BadRequestException({ reason_code: 'CORRUPT_OR_ENCRYPTED_FILE', message: 'x' }),
    );
    await expect(h.service.receive(h.delivery())).resolves.toEqual({ status: 'rejected' });
    expect(h.messages[0]).toMatchObject({ status: 'rejected', error: 'CORRUPT_OR_ENCRYPTED_FILE' });
  });

  it('once the request started, a failure filing its attachments keeps the mail accepted', async () => {
    const h = build({ parts: [pdf('rut.pdf')] });
    h.events.append.mockRejectedValueOnce(new Error('database blip'));
    await expect(h.service.receive(h.delivery())).resolves.toEqual({ status: 'accepted', instance_id: 40 });
    expect(h.messages).toEqual([expect.objectContaining({ status: 'accepted', instance_id: 40 })]);
  });

  it('a retried mail whose request already started files the attachments the first attempt missed, once', async () => {
    const replayed = jest.fn(async () => ({
      instance: { id: 40, store_id: 3, current_stage_key: 'request' },
      replayed: true,
    }));
    const missing = build({ parts: [pdf('rut.pdf')], startExternal: replayed });
    await expect(missing.service.receive(missing.delivery())).resolves.toMatchObject({ status: 'accepted' });
    expect(missing.files.upload).toHaveBeenCalledTimes(1);
    expect(missing.scoped.workflow_instance_events.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { store_id: 3, instance_id: 40, type: 'email_received' } }),
    );

    const filed = build({ parts: [pdf('rut.pdf')], startExternal: replayed, filedEvent: true });
    await expect(filed.service.receive(filed.delivery())).resolves.toMatchObject({ status: 'accepted' });
    expect(filed.files.upload).not.toHaveBeenCalled();
  });
});
