// The real modules pull in the AWS SDK and the whole invoicing graph; only the
// class tokens matter here (the handlers receive hand-made doubles).
jest.mock('../../../../../messaging/messaging.service', () => ({ MessagingService: class {} }));
jest.mock('../../../../../email/email.service', () => ({ EmailService: class {} }));
jest.mock('../../../invoicing/one-shot-emission.service', () => ({ OneShotEmissionService: class {} }));

import { RequestContextService } from '@common/context/request-context.service';
import { WorkflowConnectorsActions } from './connectors.actions';
import {
  WorkflowActionContext,
  WorkflowActionInputError,
} from './workflow-action.types';
import { WorkflowInstanceRow } from '../workflow-engine.types';

const STORE_ID = 5;
const ORG_ID = 2;

function build(overrides: { channel?: unknown; order?: unknown } = {}) {
  const prisma = {
    withoutScope: () => ({
      stores: { findFirst: jest.fn().mockResolvedValue({ name: 'Tienda <Uno>' }) },
      social_channels: {
        findFirst: jest
          .fn()
          .mockResolvedValue('channel' in overrides ? overrides.channel : { id: 3 }),
      },
    }),
    orders: {
      findFirst: jest
        .fn()
        .mockResolvedValue('order' in overrides ? overrides.order : { id: 40 }),
    },
  };
  const email = { sendEmail: jest.fn().mockResolvedValue({ success: true }) };
  const messaging = {
    sendTemplate: jest.fn().mockResolvedValue({ status: 'sent', provider: 'meta_cloud', retryable: false }),
  };
  const oneShot = {
    emitOrder: jest.fn().mockResolvedValue({
      state: 'issued',
      invoice_id: 88,
      invoice_number: 'SETT1',
      dian_status: 'accepted',
      message: null,
    }),
  };
  const moduleRef = { get: jest.fn().mockReturnValue(oneShot) };
  const actions = new WorkflowConnectorsActions(
    prisma as never,
    email as never,
    messaging as never,
    moduleRef as never,
  );
  return { actions, prisma, email, messaging, oneShot, moduleRef };
}

function ctx(map: Record<string, unknown>): WorkflowActionContext {
  return {
    instance: { id: 70, store_id: STORE_ID, organization_id: ORG_ID } as WorkflowInstanceRow,
    map,
    actingUserId: 9,
    permissions: [],
    asPublisher: (fn) =>
      RequestContextService.runIsolated(
        { store_id: STORE_ID, organization_id: ORG_ID, user_id: 9, is_super_admin: false, is_owner: false, permissions: [] },
        fn,
      ),
  };
}

describe('WorkflowConnectorsActions', () => {
  describe('vendix.email.send', () => {
    const run = (k: ReturnType<typeof build>, map: Record<string, unknown>) =>
      k.actions.handlers['vendix.email.send']!(ctx(map));

    it('sends the branded, HTML-escaped message to every recipient and returns no record id', async () => {
      const k = build();
      const res = await run(k, {
        to: 'a@b.co, c@d.co',
        subject: 'Hola\nmundo',
        body: 'Línea 1\nLínea 2 <script>alert(1)</script>\n\nOtro "párrafo" & más',
      });
      expect(res).toEqual({ record_id: null });
      expect(k.email.sendEmail).toHaveBeenCalledTimes(2);
      const [to, subject, html, text] = k.email.sendEmail.mock.calls[0];
      expect(to).toBe('a@b.co');
      expect(subject).toBe('Hola mundo');
      expect(html).toContain('Tienda &lt;Uno&gt;');
      expect(html).toContain('Línea 1<br>Línea 2 &lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).toContain('Otro &quot;párrafo&quot; &amp; más');
      expect(html).not.toContain('<script>');
      expect(text).toContain('<script>'); // plain text part stays literal
    });

    it.each([
      ['no valid email', { to: 'not-an-email', subject: 's', body: 'b' }],
      ['more than 10 recipients', { to: Array.from({ length: 11 }, (_, n) => `u${n}@x.co`).join(','), subject: 's', body: 'b' }],
      ['subject over 200 chars', { to: 'a@b.co', subject: 'x'.repeat(201), body: 'b' }],
      ['empty body', { to: 'a@b.co', subject: 's', body: '' }],
    ])('rejects %s without sending (permanent)', async (_name, map) => {
      const k = build();
      await expect(run(k, map)).rejects.toBeInstanceOf(WorkflowActionInputError);
      expect(k.email.sendEmail).not.toHaveBeenCalled();
    });

    it('throws a retryable error when the provider fails for the only recipient', async () => {
      const k = build();
      k.email.sendEmail.mockResolvedValue({ success: false, error: 'provider down' });
      const err = await run(k, { to: 'a@b.co', subject: 's', body: 'b' }).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(WorkflowActionInputError);
      expect(err.message).toContain('provider down');
    });

    it('does not retry (would duplicate) when only some recipients failed', async () => {
      const k = build();
      k.email.sendEmail
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, error: 'bounce' });
      const err = await run(k, { to: 'a@b.co,c@d.co', subject: 's', body: 'b' }).catch((e) => e);
      expect(err).toBeInstanceOf(WorkflowActionInputError);
      expect(err.message).toContain('c@d.co');
    });
  });

  describe('vendix.whatsapp.send', () => {
    const run = (k: ReturnType<typeof build>, map: Record<string, unknown>) =>
      k.actions.handlers['vendix.whatsapp.send']!(ctx(map));
    const good = { to: '+57 300 123 4567', template: 'pedido_listo', params: 'Ana | Pedido 12' };

    it('sends the template through the store channel with parsed params and default language', async () => {
      const k = build();
      expect(await run(k, good)).toEqual({ record_id: null });
      const input = k.messaging.sendTemplate.mock.calls[0][0];
      expect(input).toMatchObject({
        store_id: STORE_ID,
        to: '+573001234567',
        template: { name: 'pedido_listo', language: 'es', variables: ['Ana', 'Pedido 12'] },
      });
      expect(input.idempotency_key).toMatch(/^wf-70-[0-9a-f]{16}$/);
    });

    it('fails permanently when the store has no connected WhatsApp channel', async () => {
      const k = build({ channel: null });
      const err = await run(k, good).catch((e) => e);
      expect(err).toBeInstanceOf(WorkflowActionInputError);
      expect(err.message).toBe('La tienda no tiene un canal de WhatsApp conectado.');
      expect(k.messaging.sendTemplate).not.toHaveBeenCalled();
    });

    it.each(['AUTH', 'OPTED_OUT'])('provider code %s is permanent', async (code) => {
      const k = build();
      k.messaging.sendTemplate.mockResolvedValue({ status: 'failed', error_code: code, error_message: 'x', retryable: true });
      await expect(run(k, good)).rejects.toBeInstanceOf(WorkflowActionInputError);
    });

    it.each(['RATE_LIMITED', 'TIMEOUT', 'PROVIDER_ERROR'])('provider code %s is retryable', async (code) => {
      const k = build();
      k.messaging.sendTemplate.mockResolvedValue({ status: 'failed', error_code: code, error_message: 'x', retryable: true });
      const err = await run(k, good).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(WorkflowActionInputError);
    });

    it.each([
      ['bad phone', { ...good, to: '123' }],
      ['bad template name', { ...good, template: 'Pedido Listo!' }],
      ['empty param', { ...good, params: 'a||b' }],
    ])('rejects %s before touching the channel', async (_n, map) => {
      const k = build();
      await expect(run(k, map)).rejects.toBeInstanceOf(WorkflowActionInputError);
      expect(k.messaging.sendTemplate).not.toHaveBeenCalled();
    });
  });

  describe('vendix.invoice.emit_order', () => {
    const run = (k: ReturnType<typeof build>, map: Record<string, unknown>) =>
      k.actions.handlers['vendix.invoice.emit_order']!(ctx(map));

    it('emits through the Vendix service as the publisher and returns the invoice id', async () => {
      const k = build();
      let seenStore: number | undefined;
      k.oneShot.emitOrder.mockImplementation(async () => {
        seenStore = RequestContextService.getContext()?.store_id;
        return { state: 'issued', invoice_id: 88, message: null };
      });
      expect(await run(k, { order_id: '40' })).toEqual({ record_id: 88 });
      expect(k.oneShot.emitOrder).toHaveBeenCalledWith(40);
      expect(seenStore).toBe(STORE_ID);
    });

    it('a foreign order is permanent "not found" and nothing is emitted', async () => {
      const k = build({ order: null });
      const err = await run(k, { order_id: '999' }).catch((e) => e);
      expect(err).toBeInstanceOf(WorkflowActionInputError);
      expect(err.message).toBe('La venta no existe en esta tienda.');
      expect(k.oneShot.emitOrder).not.toHaveBeenCalled();
    });

    it('a failed emission is permanent and carries the reason', async () => {
      const k = build();
      k.oneShot.emitOrder.mockResolvedValue({ state: 'failed', invoice_id: null, message: 'Falta el NIT del cliente' });
      const err = await run(k, { order_id: '40' }).catch((e) => e);
      expect(err).toBeInstanceOf(WorkflowActionInputError);
      expect(err.message).toBe('Falta el NIT del cliente');
    });

    it('a pending emission still returns the invoice id', async () => {
      const k = build();
      k.oneShot.emitOrder.mockResolvedValue({ state: 'pending', invoice_id: 91, message: null });
      expect(await run(k, { order_id: '40' })).toEqual({ record_id: 91 });
    });

    it('a service error (e.g. 5xx) propagates so the dispatcher can retry', async () => {
      const k = build();
      k.oneShot.emitOrder.mockRejectedValue(new Error('db down'));
      await expect(run(k, { order_id: '40' })).rejects.toThrow('db down');
    });
  });
});
