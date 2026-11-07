import 'reflect-metadata';

jest.mock('../../../../messaging/messaging.service', () => ({ MessagingService: class {} }));
jest.mock('../../../../email/email.service', () => ({ EmailService: class {} }));

import { createHash } from 'crypto';
import { CONSENT_TEXT, CONSENT_TEXT_VERSION } from './signature.constants';
import { buildSignatureKit, codeOfError, SignatureKit, DOC_SHA } from './signatures.testkit';

describe('Signature requests (P4.2)', () => {
  let k: SignatureKit;
  const emailSigner = { name: 'Laura Pérez', document_number: '1020304050', email: 'laura@example.com', role_label: 'Empleado', method: 'otp_email' as const };
  const create = (signers: any[] = [emailSigner], id = 1) =>
    k.requests.create({ issued_document_id: id, signers }, { type: 'user', id: 1 });
  const table = (n: string) => k.kit.db.table(n);

  beforeEach(() => {
    k = buildSignatureKit();
    k.asAdmin();
  });

  it('sends a document to sign: freezes the hash, the consent and 15 days, emails the link', async () => {
    k.seedDocument();
    const r = await create();
    const row = table('signature_requests')[0];
    expect(row.document_sha256).toBe(DOC_SHA);
    expect(row.consent_text).toBe(CONSENT_TEXT);
    expect(row.consent_text_version).toBe(CONSENT_TEXT_VERSION);
    expect(CONSENT_TEXT).toContain('Vendix actúa como custodio');
    expect(CONSENT_TEXT).toContain('SHA-256');
    const days = (new Date(row.expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(14.9);
    expect(days).toBeLessThanOrEqual(15);
    expect(table('issued_documents')[0].status).toBe('pending_signature');
    expect(r.status).toBe('pending');
    expect(r.signers).toHaveLength(1);
    expect(r.signers[0]).toMatchObject({ name: 'Laura Pérez', method: 'otp_email', status: 'pending', destination: 'l***@example.com' });
    // The response never carries a token or a hash of one.
    expect(JSON.stringify(r)).not.toMatch(/token/);

    expect(k.sent).toHaveLength(1);
    expect(k.sent[0].to).toBe('laura@example.com');
    const token = k.tokenOf(k.sent[0].text);
    expect(k.sent[0].text).toContain('https://taller.example.com/firmar/');
    // Only the hash of the token is stored.
    const signer = table('signature_signers')[0];
    expect(signer.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(table('signature_signers'))).not.toContain(token);
    expect(table('signature_evidence_events').map((e) => e.type)).toEqual(['created', 'sent']);
    expect(await k.evidence.verify(row.id)).toMatchObject({ valid: true, count: 2 });
    // The flow request gets a line in its timeline.
    expect(table('workflow_instance_events').map((e) => e.type)).toContain('signature_requested');
  });

  it('sends by WhatsApp through the store channel', async () => {
    k.seedDocument();
    await create([{ name: 'Mario', phone: '+57 300 123 4567', method: 'otp_whatsapp' }]);
    expect(k.messaging.sendTemplate).toHaveBeenCalledTimes(1);
    const call = (k.messaging.sendTemplate.mock.calls as any[])[0][0];
    expect(call).toMatchObject({ store_id: 1, to: '+573001234567' });
    expect(call.template.name).toBe('vendix_firma_enlace');
    expect(call.template.variables[2]).toContain('https://taller.example.com/firmar/');
    expect(k.email.sendEmail).not.toHaveBeenCalled();
  });

  it('without a WhatsApp channel it fails clearly and creates nothing', async () => {
    k.seedDocument();
    table('social_channels').length = 0;
    expect(await codeOfError(create([{ name: 'Mario', phone: '+573001234567', method: 'otp_whatsapp' }]))).toBe('SIGNATURE_NO_WHATSAPP_CHANNEL');
    expect(table('signature_requests')).toHaveLength(0);
    expect(table('signature_signers')).toHaveLength(0);
    expect(table('issued_documents')[0].status).toBe('issued');
  });

  it('rejects a method without its data, duplicate boxes and bad phones', async () => {
    k.seedDocument();
    expect(await codeOfError(create([{ name: 'Ana', method: 'otp_email' }]))).toBe('SIGNATURE_SIGNER_INVALID');
    expect(await codeOfError(create([{ name: 'Ana', email: 'no-es-correo', method: 'otp_email' }]))).toBe('SIGNATURE_SIGNER_INVALID');
    expect(await codeOfError(create([{ name: 'Ana', method: 'otp_whatsapp' }]))).toBe('SIGNATURE_SIGNER_INVALID');
    expect(await codeOfError(create([{ name: 'Ana', phone: 'abc', method: 'otp_whatsapp' }]))).toBe('SIGNATURE_SIGNER_INVALID');
    expect(await codeOfError(create([]))).toBe('SIGNATURE_SIGNER_INVALID');
    expect(
      await codeOfError(create([{ ...emailSigner, slot_key: 'empleado' }, { ...emailSigner, email: 'b@example.com', slot_key: 'empleado' }])),
    ).toBe('SIGNATURE_SIGNER_INVALID');
    expect(table('signature_requests')).toHaveLength(0);
  });

  it('only a document in "issued" can be sent; another store sees a 404', async () => {
    k.seedDocument({ status: 'rendering' });
    expect(await codeOfError(create())).toBe('SIGNATURE_DOCUMENT_NOT_SIGNABLE');
    table('issued_documents')[0].status = 'signed';
    expect(await codeOfError(create())).toBe('SIGNATURE_DOCUMENT_NOT_SIGNABLE');
    table('issued_documents')[0].status = 'issued';
    k.asAdmin(2);
    expect(await codeOfError(create())).toBe('DOCUMENT_NOT_FOUND');
    expect(table('signature_requests')).toHaveLength(0);
    // A second request over a document already pending is refused.
    k.asAdmin(1);
    await create();
    expect(await codeOfError(create([{ ...emailSigner, email: 'otro@example.com' }]))).toBe('SIGNATURE_DOCUMENT_NOT_SIGNABLE');
    expect(table('signature_requests')).toHaveLength(1);
  });

  it('a store without a public domain cannot send links', async () => {
    k.seedDocument();
    table('domain_settings').length = 0;
    expect(await codeOfError(create())).toBe('SIGNATURE_NO_PUBLIC_DOMAIN');
    expect(table('signature_requests')).toHaveLength(0);
  });

  it('a failed delivery cancels the request and gives the document back', async () => {
    k.seedDocument();
    k.email.sendEmail.mockResolvedValueOnce({ success: false, error: 'smtp down' } as never);
    expect(await codeOfError(create())).toBe('SIGNATURE_DELIVERY_FAILED');
    expect(table('signature_requests')[0].status).toBe('cancelled');
    expect(table('issued_documents')[0].status).toBe('issued');
  });

  it('cancels with a reason: the document is free again, the link stops working, a second cancel is refused', async () => {
    k.seedDocument();
    const r = await create();
    const token = k.tokenOf(k.sent[0].text);
    k.asAdmin(2);
    expect(await codeOfError(k.requests.cancel(r.id, 'Error en el contrato'))).toBe('SIGNATURE_REQUEST_NOT_FOUND');
    k.asAdmin(1);
    const cancelled = await k.requests.cancel(r.id, 'Error en el contrato');
    expect(cancelled.status).toBe('cancelled');
    expect(table('issued_documents')[0].status).toBe('issued');
    expect(table('signature_evidence_events').map((e) => e.type)).toContain('cancelled');
    expect(table('workflow_instance_events').find((e) => e.type === 'signature_cancelled')!.payload.label).toBe('Firma cancelada: Error en el contrato');
    k.asVisitor();
    expect(await codeOfError(k.publicSvc.view(token, { ip: null, user_agent: null }))).toBe('SIGNATURE_PUBLIC_NOT_FOUND');
    k.asAdmin();
    expect(await codeOfError(k.requests.cancel(r.id, 'otra vez'))).toBe('SIGNATURE_REQUEST_CLOSED');
    // The document can go out to sign again.
    await create([{ ...emailSigner, email: 'nueva@example.com' }]);
    expect(table('signature_requests')).toHaveLength(2);
  });

  it('expires only the due requests of its store and gives the document back', async () => {
    k.seedDocument();
    const r = await create();
    expect(await k.requests.expireDue(new Date())).toBe(0);
    k.asAdmin(2);
    expect(await k.requests.expireDue(new Date(Date.now() + 20 * 86_400_000))).toBe(0);
    k.asAdmin(1);
    expect(await k.requests.expireDue(new Date(Date.now() + 20 * 86_400_000))).toBe(1);
    expect(table('signature_requests')[0].status).toBe('expired');
    expect(table('signature_signers')[0].status).toBe('expired');
    expect(table('issued_documents')[0].status).toBe('issued');
    expect(table('signature_evidence_events').map((e) => e.type)).toContain('expired');
    expect((await k.requests.get(r.id)).chain.valid).toBe(true);
  });

  it('lists the documents of a flow request with their requests, signers and evidence', async () => {
    k.seedDocument();
    const r = await create();
    const list = await k.requests.listByInstance(1);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ reference: 'DOC-000001', status: 'pending_signature', requirement_key: 'contrato' });
    expect(list[0].requests[0].id).toBe(r.id);
    expect(list[0].requests[0].events.map((e: any) => e.type)).toEqual(['created', 'sent']);
    k.asAdmin(2);
    expect(await k.requests.listByInstance(1)).toEqual([]);
  });
});
