import 'reflect-metadata';

jest.mock('../../../messaging/messaging.service', () => ({ MessagingService: class {} }));
jest.mock('../../../email/email.service', () => ({ EmailService: class {} }));

import { IS_PUBLIC_KEY } from '@common/decorators/public.decorator';
import { ResponseService } from '@common/responses/response.service';
import {
  buildSignatureKit,
  codeOfError,
  SignatureKit,
  strokeBase64,
} from '../../store/documents/signatures/signatures.testkit';
import { EcommerceDocumentsSigningController } from './ecommerce-documents-signing.controller';

const req = (ip = '198.51.100.9', ua = 'Safari iOS') => ({ ip, headers: { 'user-agent': ua } }) as any;

describe('EcommerceDocumentsSigningController (P4.2)', () => {
  let k: SignatureKit;
  let controller: EcommerceDocumentsSigningController;
  let token: string;

  beforeEach(async () => {
    k = buildSignatureKit();
    k.seedDocument();
    controller = new EcommerceDocumentsSigningController(k.publicSvc, new ResponseService());
    k.asAdmin();
    await k.requests.create(
      { issued_document_id: 1, signers: [{ name: 'Laura Pérez', email: 'laura@example.com', method: 'otp_email' }] },
      { type: 'user', id: 1 },
    );
    token = k.tokenOf(k.sent[0].text);
    k.asVisitor();
  });

  it('is public (no session) and never cacheable', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, EcommerceDocumentsSigningController)).toBe(true);
    for (const method of ['view', 'sendOtp', 'verifyOtp', 'sign', 'decline'] as const) {
      const headers = Reflect.getMetadata('__headers__', EcommerceDocumentsSigningController.prototype[method]);
      expect(headers).toEqual(expect.arrayContaining([{ name: 'Cache-Control', value: 'no-store' }]));
    }
  });

  it('signs end to end through the endpoints and records the caller IP and device', async () => {
    const view = await controller.view(token, req());
    expect(view.data).toMatchObject({ state: 'pending', document: { reference: 'DOC-000001' } });
    await controller.sendOtp(token, req());
    const code = k.codeOf(k.sent[k.sent.length - 1].text);
    expect((await controller.verifyOtp(token, { code }, req())).data).toEqual({ verified: true });
    const signed = await controller.sign(token, { signature_png: strokeBase64(), consent: true }, req());
    expect(signed.data).toEqual({ signed: true, completed: true });
    expect(k.kit.db.table('signature_signers')[0]).toMatchObject({ signed_ip: '198.51.100.9', signed_user_agent: 'Safari iOS' });
    expect(k.kit.db.table('issued_documents')[0].status).toBe('signed');
  });

  it('declines with a reason through the endpoint', async () => {
    await controller.decline(token, { reason: 'Los datos son incorrectos' }, req());
    expect(k.kit.db.table('signature_requests')[0].status).toBe('declined');
  });

  it('any bad token is the same 404 on every endpoint, from another store too', async () => {
    k.asVisitor(2);
    for (const call of [
      () => controller.view(token, req()),
      () => controller.sendOtp(token, req()),
      () => controller.verifyOtp(token, { code: '123456' }, req()),
      () => controller.sign(token, { signature_png: strokeBase64(), consent: true }, req()),
      () => controller.decline(token, { reason: 'No firmo' }, req()),
    ]) {
      expect(await codeOfError(call())).toBe('SIGNATURE_PUBLIC_NOT_FOUND');
    }
  });
});
