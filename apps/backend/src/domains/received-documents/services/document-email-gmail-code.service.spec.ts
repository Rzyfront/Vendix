import { ServiceUnavailableException } from '@nestjs/common';
import { DocumentEmailGmailCodeService } from './document-email-gmail-code.service';
import { ErrorCodes } from '../../../common/errors/error-codes';
import { VendixHttpException } from '../../../common/errors/vendix-http.exception';
import type { DocumentEmailProcessingContext } from '../interfaces/document-email-reception.interface';

const ctx: DocumentEmailProcessingContext = { inbox_id: 4, organization_id: 3, store_id: 21, accounting_entity_id: 8, local_part: 'facturas-00112233445566778899aabbccddeeff', domain: 'recepcion.vendix.online', environment: 'production', recipient_alias: 'facturas-00112233445566778899aabbccddeeff@recepcion.vendix.online', fiscal_scope: 'ORGANIZATION', fiscal_identity: { nit: '900123456', nit_type: 'NIT' } as never };
const readCtx = { organization_id: 3, store_id: 21, accounting_entity_id: 8, is_organization: false, fiscal_scope: 'ORGANIZATION' as const, actor_id: 55 };
const facts = { virus_status: 'PASS' as const, spam_status: 'PASS' as const, gmail_authenticated: true };
const mail = { sender: 'forwarding-noreply@google.com', text: `You have requested to automatically forward mail to ${ctx.recipient_alias}.\nConfirmation code: 123456789\n` };
function harness() {
  const message: any = { id: 10, version: 2, processing_token: 'active-claim', status: 'processing', received_at: new Date(), gmail_code_expires_at: null };
  let inboxCurrent = true;
  const messages = {
    findFirst: jest.fn(async ({ where }) => {
      if (where.gmail_code_expires_at) {
        return message.status === 'ignored' && message.reason_code === 'GMAIL_VERIFICATION_CODE' && message.gmail_challenge_alias === where.gmail_challenge_alias && message.gmail_code_expires_at > where.gmail_code_expires_at.gt && inboxCurrent ? { ...message } : null;
      }
      return { ...message };
    }),
    updateMany: jest.fn(async ({ where, data }) => {
      if (where.version !== message.version || where.processing_token !== message.processing_token) return { count: 0 };
      Object.assign(message, data); return { count: 1 };
    }),
  };
  const inboxes = { findFirst: jest.fn(async ({ select }) => inboxCurrent ? select?.local_part ? { id: 4, local_part: ctx.local_part, domain: ctx.domain } : { id: 4 } : null) };
  const prisma: any = { document_reception_email_messages: messages, document_reception_email_inboxes: inboxes, $executeRaw: jest.fn().mockResolvedValue(1), $transaction: jest.fn() };
  prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
  const encryption = { encrypt: jest.fn(() => 'ciphertext-only'), decrypt: jest.fn(() => '123456789') };
  const service = new DocumentEmailGmailCodeService(prisma, encryption as never);
  const beforeWrite = jest.fn().mockResolvedValue(undefined);
  return { service, prisma, messages, inboxes, encryption, message, beforeWrite, rotate: () => { inboxCurrent = false; } };
}

describe('DocumentEmailGmailCodeService', () => {
  it('stores only encrypted code with a local <=24h expiry under the current alias and active claim fence', async () => {
    const h = harness(); const start = Date.now();
    const result = await h.service.inspect(10, ctx, mail, facts, h.beforeWrite);
    expect(result).toEqual({ status: 'ignored', reason_code: 'GMAIL_VERIFICATION_CODE', retryable: false, parts: [], valid_document: false });
    expect(h.beforeWrite).toHaveBeenCalledTimes(1); expect(h.encryption.encrypt).toHaveBeenCalledWith('123456789');
    expect(h.messages.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: 10, organization_id: 3, store_id: 21, accounting_entity_id: 8, version: 2, processing_token: 'active-claim', status: 'processing' }), data: { gmail_code_encrypted: 'ciphertext-only', gmail_code_expires_at: expect.any(Date), gmail_challenge_alias: ctx.recipient_alias } });
    expect(h.message.gmail_code_expires_at.getTime()).toBe(h.message.received_at.getTime() + 24 * 60 * 60 * 1000);
    expect(h.message.gmail_code_expires_at.getTime()).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000);
    expect(JSON.stringify(h.message)).not.toContain('123456789'); expect(JSON.stringify(result)).not.toContain('123456789');
  });
  it('does not recognize a normal invoice or a non-exact sender as a Gmail challenge', async () => {
    const h = harness(); expect(await h.service.inspect(10, ctx, { ...mail, sender: 'attacker@example.invalid' }, facts, h.beforeWrite)).toBeNull();
    expect(await h.service.inspect(10, ctx, { ...mail, text: 'Invoice total 123456789' }, facts, h.beforeWrite)).toBeNull();
    expect(h.encryption.encrypt).not.toHaveBeenCalled();
  });
  it.each([
    { ...facts, gmail_authenticated: false },
    { ...facts, virus_status: 'FAIL' as const },
    { ...facts, spam_status: 'GRAY' as const },
  ])('never persists a code for an unauthenticated or unsafe transport %j', async (transport) => {
    const h = harness(); expect((await h.service.inspect(10, ctx, mail, transport, h.beforeWrite))?.reason_code).toBe('GMAIL_CODE_UNAVAILABLE');
    expect(h.messages.updateMany).not.toHaveBeenCalled(); expect(h.encryption.encrypt).not.toHaveBeenCalled(); expect(h.beforeWrite).not.toHaveBeenCalled();
  });
  it.each([
    'Forwarding confirmation: https://example.invalid/confirm',
    'Forward mail confirmation\nConfirmation code: 12345',
    'Forward mail confirmation\nConfirmation code: 1234567890123',
    'Forward mail confirmation\nConfirmation code: 123456\nConfirmation code: 987654',
    'Forward mail confirmation 123456 but no code label',
    'Forward mail confirmation\n<a href="https://example.invalid">Confirmation code: 123456</a>',
  ])('returns the honest unavailable alternative for unsupported code template %s', async (text) => {
    const h = harness(); expect((await h.service.inspect(10, ctx, { ...mail, text }, facts, h.beforeWrite))?.reason_code).toBe('GMAIL_CODE_UNAVAILABLE'); expect(h.encryption.encrypt).not.toHaveBeenCalled();
  });
  it('supports the explicit Spanish confirmation label and rejects oversized text', async () => {
    const h = harness(); expect((await h.service.inspect(10, ctx, { ...mail, text: 'Solicitaste el reenvío de correo.\nCódigo de confirmación: 123456\n' }, facts, h.beforeWrite))?.reason_code).toBe('GMAIL_VERIFICATION_CODE');
    const oversized = harness(); expect((await oversized.service.inspect(10, ctx, { ...mail, text: 'forward\n' + 'x'.repeat(256 * 1024) }, facts, oversized.beforeWrite))?.reason_code).toBe('GMAIL_CODE_UNAVAILABLE');
  });
  it('propagates missing production encryption key as technical failure without plaintext persistence', async () => {
    const h = harness(); h.encryption.encrypt.mockImplementationOnce(() => { throw new VendixHttpException(ErrorCodes.FISCAL_ENCRYPTION_KEY_MISSING); });
    await expect(h.service.inspect(10, ctx, mail, facts, h.beforeWrite)).rejects.toMatchObject({ errorCode: 'FISCAL_ENCRYPTION_KEY_MISSING' }); expect(h.messages.updateMany).not.toHaveBeenCalled();
  });
  it('rotated aliases cannot mint an exposable code; a lost CAS claim is technical', async () => {
    const h = harness(); h.rotate(); expect((await h.service.inspect(10, ctx, mail, facts, h.beforeWrite))?.reason_code).toBe('GMAIL_CODE_UNAVAILABLE'); expect(h.messages.updateMany).not.toHaveBeenCalled();
    const lost = harness(); lost.beforeWrite.mockImplementationOnce(async () => { lost.message.processing_token = 'new-owner'; });
    await expect(lost.service.inspect(10, ctx, mail, facts, lost.beforeWrite)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('never extends an earlier challenge expiry and never stores an already expired receipt challenge', async () => {
    const h = harness(); const expiry = new Date(Date.now() + 3600_000); h.message.gmail_code_expires_at = expiry;
    await h.service.inspect(10, ctx, mail, facts, h.beforeWrite); expect(h.message.gmail_code_expires_at.getTime()).toBe(expiry.getTime());
    const expired = harness(); expired.message.received_at = new Date(Date.now() - 25 * 3600_000);
    expect((await expired.service.inspect(10, ctx, mail, facts, expired.beforeWrite))?.reason_code).toBe('GMAIL_CODE_UNAVAILABLE');
    expect(expired.encryption.encrypt).not.toHaveBeenCalled(); expect(expired.messages.updateMany).not.toHaveBeenCalled(); expect(expired.beforeWrite).not.toHaveBeenCalled();
  });
  it('configure read returns only code+expiry for a durable ignored challenge of the current alias', async () => {
    const h = harness(); await h.service.inspect(10, ctx, mail, facts, h.beforeWrite); Object.assign(h.message, { status: 'ignored', reason_code: 'GMAIL_VERIFICATION_CODE' });
    expect(await h.service.current(readCtx)).toEqual({ available: true, code: '123456789', expires_at: h.message.gmail_code_expires_at });
    expect(h.messages.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ organization_id: 3, store_id: 21, accounting_entity_id: 8, gmail_challenge_alias: ctx.recipient_alias, inbox: { is: { id: 4, organization_id: 3, store_id: 21, accounting_entity_id: 8, local_part: ctx.local_part, domain: ctx.domain } } }) }));
  });
  it('expired, rotated and non-durable codes are unavailable without clearing rows on GET', async () => {
    const h = harness(); await h.service.inspect(10, ctx, mail, facts, h.beforeWrite);
    expect(await h.service.current(readCtx)).toEqual({ available: false, code: null, expires_at: null });
    Object.assign(h.message, { status: 'ignored', reason_code: 'GMAIL_VERIFICATION_CODE', gmail_code_expires_at: new Date(Date.now() - 1) });
    expect((await h.service.current(readCtx)).available).toBe(false);
    h.rotate(); expect((await h.service.current(readCtx)).available).toBe(false);
    expect(h.messages.updateMany).toHaveBeenCalledTimes(1);
  });
  it('rejects organization access and does not create data when the fiscal entity is missing', async () => {
    const h = harness(); await expect(h.service.current({ ...readCtx, is_organization: true })).rejects.toMatchObject({ errorCode: 'SYS_FORBIDDEN_001' });
    expect((await h.service.current({ ...readCtx, accounting_entity_id: null })).available).toBe(false); expect(h.inboxes.findFirst).not.toHaveBeenCalled();
  });
});
