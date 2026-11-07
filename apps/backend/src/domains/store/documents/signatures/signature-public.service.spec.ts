import 'reflect-metadata';

jest.mock('../../../../messaging/messaging.service', () => ({ MessagingService: class {} }));
jest.mock('../../../../email/email.service', () => ({ EmailService: class {} }));

import {
  buildSignatureKit,
  codeOfError,
  DOC_SHA,
  META,
  PNG_STROKE,
  SignatureKit,
  strokeBase64,
} from './signatures.testkit';

describe('Public signing (P4.2)', () => {
  let k: SignatureKit;
  const table = (n: string) => k.kit.db.table(n);
  const types = () => table('signature_evidence_events').map((e) => e.type);
  const emailA = { name: 'Laura Pérez', document_number: '1020304050', email: 'laura@example.com', role_label: 'Empleado', slot_key: 'empleado', method: 'otp_email' as const };
  const emailB = { name: 'Carlos Gil', document_number: '79000111', email: 'carlos@example.com', role_label: 'Empleador', slot_key: 'empleador', method: 'otp_email' as const };

  /** Creates the request as an admin and returns one raw token per signer. */
  async function createRequest(signers: any[] = [emailA]) {
    k.asAdmin();
    const mails = k.sent.length;
    const wa = k.messaging.sendTemplate.mock.calls.length;
    const r = await k.requests.create({ issued_document_id: 1, signers }, { type: 'user', id: 1 });
    k.asVisitor();
    const mailTokens = k.sent.slice(mails).map((m) => k.tokenOf(m.text));
    const waTokens = (k.messaging.sendTemplate.mock.calls as any[]).slice(wa).map((c) => k.tokenOf(c[0].template.variables[2]));
    return {
      request: r,
      tokens: signers.map((s) => (s.method === 'otp_email' ? mailTokens : waTokens).shift() as string),
    };
  }
  const view = (t: string) => k.publicSvc.view(t, META);
  const askCode = async (t: string) => {
    await k.publicSvc.sendOtp(t, META);
    return k.codeOf(k.sent[k.sent.length - 1].text);
  };
  /** OTP + consent + stroke. */
  async function signFully(t: string) {
    const code = await askCode(t);
    await k.publicSvc.verifyOtp(t, code, META);
    return k.publicSvc.sign(t, { signature_png: strokeBase64(), consent: true }, META);
  }

  beforeEach(() => {
    k = buildSignatureKit();
    k.seedDocument();
  });

  describe('links: the same generic 404 for anything unavailable', () => {
    it.each([
      ['an invented token', async () => 'x'.repeat(43)],
      ['a token too short', async () => 'abc'],
      ['a cancelled request', async () => {
        const { request, tokens } = await createRequest();
        k.asAdmin();
        await k.requests.cancel(request.id, 'Cancelada por error');
        k.asVisitor();
        return tokens[0];
      }],
      ['an expired request', async () => {
        const { tokens } = await createRequest();
        table('signature_requests')[0].expires_at = new Date(Date.now() - 1000);
        return tokens[0];
      }],
      ['a request closed by the expiry job', async () => {
        const { tokens } = await createRequest();
        table('signature_requests')[0].status = 'expired';
        return tokens[0];
      }],
      ['a link of another store', async () => {
        const { tokens } = await createRequest();
        k.asVisitor(2);
        return tokens[0];
      }],
    ])('%s', async (_name, arrange) => {
      const token = await arrange();
      for (const call of [
        () => view(token),
        () => k.publicSvc.sendOtp(token, META),
        () => k.publicSvc.verifyOtp(token, '123456', META),
        () => k.publicSvc.sign(token, { signature_png: strokeBase64(), consent: true }, META),
        () => k.publicSvc.decline(token, 'No estoy de acuerdo', META),
      ]) {
        expect(await codeOfError(call())).toBe('SIGNATURE_PUBLIC_NOT_FOUND');
      }
      expect(table('stored_files').filter((f) => f.source === 'signature_image')).toHaveLength(0);
    });

    it('a store that no longer has the flows industry answers 404 too', async () => {
      const { tokens } = await createRequest();
      table('stores').find((s) => s.id === 1)!.industries = ['retail'];
      expect(await codeOfError(view(tokens[0]))).toBe('SIGNATURE_PUBLIC_NOT_FOUND');
    });
  });

  describe('view', () => {
    it('shows the document, store, signer, consent and a short PDF url, and records "opened" once', async () => {
      const { tokens } = await createRequest();
      const v = await view(tokens[0]);
      expect(v).toMatchObject({
        state: 'pending',
        store: { name: 'Taller Central' },
        document: { title: 'Contrato laboral', reference: 'DOC-000001' },
        signer: { name: 'Laura Pérez', role_label: 'Empleado', method: 'otp_email', destination: 'l***@example.com', otp_verified: false, attempts_remaining: 5 },
      });
      expect(v.consent.text).toContain('Acepto firmar electrónicamente');
      expect(v.consent.version).toBe('v1');
      expect(v.pdf_url).toMatch(/^https:\/\/signed\.example\/.*ttl=300/);
      await view(tokens[0]);
      expect(types().filter((t) => t === 'opened')).toHaveLength(1);
      expect(table('signature_evidence_events').find((e) => e.type === 'opened')).toMatchObject({ ip_address: META.ip, user_agent: META.user_agent });
      expect(table('signature_signers')[0].status).toBe('viewed');
      // Nothing sensitive: no e-mail, no hashes of the code or the link.
      expect(JSON.stringify(v)).not.toMatch(/laura@example|token_hash|otp_hash/);
    });
  });

  describe('one-time code', () => {
    it('sends 6 digits by e-mail, stores only the hash, and limits resends', async () => {
      const { tokens } = await createRequest();
      const first = await k.publicSvc.sendOtp(tokens[0], META);
      expect(first).toMatchObject({ sent: true, destination: 'l***@example.com', expires_in_seconds: 600 });
      const code = k.codeOf(k.sent[k.sent.length - 1].text);
      expect(code).toMatch(/^\d{6}$/);
      const signer = table('signature_signers')[0];
      expect(signer.otp_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(table('signature_signers'))).not.toContain(`"${code}"`);
      const ttl = new Date(signer.otp_expires_at).getTime() - new Date(signer.otp_sent_at).getTime();
      expect(ttl).toBe(10 * 60_000);
      // Too soon to ask again.
      expect(await codeOfError(k.publicSvc.sendOtp(tokens[0], META))).toBe('SIGNATURE_OTP_RATE_LIMIT');
      expect(types()).toContain('otp_sent');
      // After the wait, a resend works until the cap of codes is reached.
      for (let i = 0; i < 4; i++) {
        signer.otp_sent_at = new Date(Date.now() - 120_000);
        await k.publicSvc.sendOtp(tokens[0], META);
      }
      signer.otp_sent_at = new Date(Date.now() - 120_000);
      expect(await codeOfError(k.publicSvc.sendOtp(tokens[0], META))).toBe('SIGNATURE_OTP_RATE_LIMIT');
    });

    it('sends the code by WhatsApp when that is the method', async () => {
      const { tokens } = await createRequest([{ name: 'Mario', phone: '+573001234567', method: 'otp_whatsapp' }]);
      await k.publicSvc.sendOtp(tokens[0], META);
      const last = (k.messaging.sendTemplate.mock.calls as any[]).pop()[0];
      expect(last.template.name).toBe('vendix_firma_codigo');
      expect(last.template.variables[0]).toMatch(/^\d{6}$/);
      expect(k.sent).toHaveLength(0);
    });

    it('a wrong code says how many attempts remain; the 5th blocks the signer, even with the right code afterwards', async () => {
      const { tokens } = await createRequest();
      const code = await askCode(tokens[0]);
      const wrong = code === '000000' ? '111111' : '000000';
      const err = async () => {
        try {
          await k.publicSvc.verifyOtp(tokens[0], wrong, META);
        } catch (e: any) {
          return e;
        }
      };
      let e = await err();
      expect(e.errorCode).toBe('SIGNATURE_OTP_INVALID');
      expect(e.message).toContain('Te quedan 4 intentos');
      expect(e.getResponse()).toMatchObject({ details: { attempts_remaining: 4 } });
      for (const left of [3, 2, 1]) {
        e = await err();
        expect(e.message).toContain(left === 1 ? 'Te queda 1 intento' : `Te quedan ${left} intentos`);
      }
      e = await err();
      expect(e.errorCode).toBe('SIGNATURE_BLOCKED');
      expect(table('signature_signers')[0].status).toBe('blocked');
      // The failures were kept (the 5th is recorded too) and the right code no longer works.
      expect(types().filter((t) => t === 'otp_failed')).toHaveLength(5);
      expect(await codeOfError(k.publicSvc.verifyOtp(tokens[0], code, META))).toBe('SIGNATURE_BLOCKED');
      expect(await codeOfError(k.publicSvc.sendOtp(tokens[0], META))).toBe('SIGNATURE_BLOCKED');
      expect((await view(tokens[0])).state).toBe('blocked');
    });

    it('a right code verifies once; an expired code or one never requested is refused without costing an attempt', async () => {
      const { tokens } = await createRequest();
      expect(await codeOfError(k.publicSvc.verifyOtp(tokens[0], '123456', META))).toBe('SIGNATURE_OTP_INVALID');
      expect(table('signature_signers')[0].otp_attempts).toBe(0);
      const code = await askCode(tokens[0]);
      table('signature_signers')[0].otp_expires_at = new Date(Date.now() - 1000);
      expect(await codeOfError(k.publicSvc.verifyOtp(tokens[0], code, META))).toBe('SIGNATURE_OTP_INVALID');
      expect(table('signature_signers')[0].otp_attempts).toBe(0);
      table('signature_signers')[0].otp_sent_at = new Date(Date.now() - 120_000);
      const fresh = await askCode(tokens[0]);
      expect(await k.publicSvc.verifyOtp(tokens[0], fresh, META)).toEqual({ verified: true });
      expect(table('signature_signers')[0].otp_verified_at).toBeInstanceOf(Date);
      expect(table('signature_signers')[0].otp_hash).toBeNull();
      expect(types()).toContain('otp_verified');
      // The code of one signer is useless on another signer's link.
    });

    it("a signer's code does not verify on another signer's link", async () => {
      const { tokens } = await createRequest([emailA, emailB]);
      const codeA = await askCode(tokens[0]);
      await askCode(tokens[1]);
      const other = codeA === '000000' ? '111111' : '000000';
      expect(await codeOfError(k.publicSvc.verifyOtp(tokens[1], other, META))).toBe('SIGNATURE_OTP_INVALID');
      expect(table('signature_signers')[1].otp_verified_at).toBeNull();
    });
  });

  describe('sign', () => {
    it('refuses to sign without a verified code, without consent, or with a bad stroke', async () => {
      const { tokens } = await createRequest();
      const sign = (dto: any) => k.publicSvc.sign(tokens[0], dto, META);
      expect(await codeOfError(sign({ signature_png: strokeBase64(), consent: true }))).toBe('SIGNATURE_OTP_REQUIRED');
      const code = await askCode(tokens[0]);
      await k.publicSvc.verifyOtp(tokens[0], code, META);
      expect(await codeOfError(sign({ signature_png: strokeBase64() }))).toBe('SIGNATURE_CONSENT_REQUIRED');
      expect(await codeOfError(sign({ signature_png: strokeBase64(), consent: false }))).toBe('SIGNATURE_CONSENT_REQUIRED');
      expect(await codeOfError(sign({ signature_png: 'no-es-base64!!', consent: true }))).toBe('SIGNATURE_IMAGE_INVALID');
      expect(await codeOfError(sign({ signature_png: Buffer.from('<svg></svg>'.repeat(20)).toString('base64'), consent: true }))).toBe('SIGNATURE_IMAGE_INVALID');
      const huge = Buffer.concat([PNG_STROKE.subarray(0, 8), Buffer.alloc(210 * 1024, 1)]);
      expect(await codeOfError(sign({ signature_png: strokeBase64(huge), consent: true }))).toBe('SIGNATURE_IMAGE_INVALID');
      expect(table('signature_signers')[0].status).not.toBe('signed');
      expect(table('stored_files').filter((f) => f.source === 'signature_image')).toHaveLength(0);
      expect(types()).not.toContain('signed');
    });

    it('a verified code stops working for signing after 30 minutes', async () => {
      const { tokens } = await createRequest();
      await k.publicSvc.verifyOtp(tokens[0], await askCode(tokens[0]), META);
      table('signature_signers')[0].otp_verified_at = new Date(Date.now() - 31 * 60_000);
      expect(await codeOfError(k.publicSvc.sign(tokens[0], { signature_png: strokeBase64(), consent: true }, META))).toBe('SIGNATURE_OTP_REQUIRED');
    });

    it('stores the stroke as signature_image and the evidence of the signer; one link signs only once', async () => {
      const { tokens } = await createRequest([emailA, emailB]);
      const done = await signFully(tokens[0]);
      expect(done).toEqual({ signed: true, completed: false });
      const signer = table('signature_signers')[0];
      expect(signer).toMatchObject({ status: 'signed', signed_ip: META.ip, signed_user_agent: META.user_agent });
      expect(signer.signed_at).toBeInstanceOf(Date);
      const file = table('stored_files').find((f) => f.id === signer.signature_file_id)!;
      expect(file).toMatchObject({ source: 'signature_image', mime_type: 'image/png', uploaded_by_type: 'public' });
      expect(table('signature_requests')[0].status).toBe('partially_signed');
      expect(table('issued_documents')[0].status).toBe('pending_signature');
      const signed = table('signature_evidence_events').find((e) => e.type === 'signed')!;
      expect(signed).toMatchObject({ signer_id: signer.id, ip_address: META.ip });
      expect(signed.payload).toMatchObject({ document_sha256: DOC_SHA, signature_file_id: file.id, signature_sha256: file.sha256 });
      expect(types()).toEqual(expect.arrayContaining(['consent_accepted', 'signed']));
      // Second attempt with the same link.
      expect(await codeOfError(k.publicSvc.sign(tokens[0], { signature_png: strokeBase64(), consent: true }, META))).toBe('SIGNATURE_ALREADY_SIGNED');
      expect(await codeOfError(k.publicSvc.sendOtp(tokens[0], META))).toBe('SIGNATURE_ALREADY_SIGNED');
      expect(table('stored_files').filter((f) => f.source === 'signature_image')).toHaveLength(1);
      expect((await view(tokens[0])).state).toBe('signed');
      // The other signer is not sealed yet and the document is not signed.
      expect(k.fake.render).not.toHaveBeenCalled();
    });
  });

  describe('seal', () => {
    it('when everyone signed it renders with the signatures and the evidence sheet, files the PDF and closes', async () => {
      const { request, tokens } = await createRequest([emailA, emailB]);
      await signFully(tokens[0]);
      expect(await signFully(tokens[1])).toEqual({ signed: true, completed: true });

      // Renderer called once with both strokes in their boxes.
      expect(k.fake.render).toHaveBeenCalledTimes(1);
      const [docId, options] = k.fake.render.mock.calls[0] as any[];
      expect(docId).toBe(1);
      expect(options.signatures).toHaveLength(2);
      expect(options.signatures.map((s: any) => [s.slot_key, s.name, s.role_label])).toEqual([
        ['empleado', 'Laura Pérez', 'Empleado'],
        ['empleador', 'Carlos Gil', 'Empleador'],
      ]);
      expect(options.signatures[0].image).toEqual(PNG_STROKE);
      expect(typeof options.appendPages).toBe('function');

      // The evidence sheet carries what the criteria ask for.
      const sheet = k.fake.texts.join('\n');
      const chain = table('signature_evidence_events');
      const lastBeforeSeal = chain.filter((e) => e.type !== 'sealed').pop()!;
      expect(sheet).toContain('Hoja de evidencia de firma electrónica');
      expect(sheet).toContain('DOC-000001');
      expect(sheet).toContain(DOC_SHA);
      expect(sheet).toContain('Laura Pérez');
      expect(sheet).toContain('1020304050');
      expect(sheet).toContain('enviado por correo electrónico a l***@example.com');
      expect(sheet).toContain(META.ip);
      expect(sheet).toContain(META.user_agent);
      expect(sheet).toContain(lastBeforeSeal.event_hash);
      expect(sheet).not.toContain('laura@example.com');

      // Request, document, file and dossier.
      const req = table('signature_requests')[0];
      expect(req).toMatchObject({ id: request.id, status: 'completed' });
      expect(req.completed_at).toBeInstanceOf(Date);
      const sealedFile = table('stored_files').find((f) => f.id === req.sealed_file_id)!;
      expect(sealedFile).toMatchObject({ source: 'generated', mime_type: 'application/pdf', original_name: 'DOC-000001-firmado.pdf' });
      expect(req.sealed_sha256).toBe(sealedFile.sha256);
      expect(table('issued_documents')[0].status).toBe('signed');
      const item = table('dossier_items').find((i) => i.kind === 'signed_document')!;
      expect(item).toMatchObject({ dossier_id: 1, issued_document_id: 1, file_id: sealedFile.id, requirement_key: 'contrato', status: 'received' });

      // The chain stays valid and ends with the seal.
      expect(types().slice(-1)).toEqual(['sealed']);
      expect(chain.slice(-1)[0].payload).toMatchObject({ sealed_sha256: req.sealed_sha256, document_sha256: DOC_SHA });
      expect(await k.evidence.verify(request.id)).toMatchObject({ valid: true });

      // The flow: a timeline line and the engine tick queued for the current stage.
      expect(table('workflow_instance_events').find((e) => e.type === 'signature_completed')!.payload.label).toBe('Documento firmado');
      const advance = table('workflow_outbox').find((o) => o.kind === 'advance')!;
      expect(advance.payload).toMatchObject({ instance_id: 1, stage_key: 'firma', stage_entry_seq: 1 });
    });

    it('a seal that fails keeps the signature; the retry seals later and only once', async () => {
      const { request, tokens } = await createRequest();
      k.fake.render.mockRejectedValueOnce(new Error('render down'));
      expect(await signFully(tokens[0])).toEqual({ signed: true, completed: false });
      expect(table('signature_signers')[0].status).toBe('signed');
      expect(table('signature_requests')[0].status).toBe('partially_signed');
      expect(table('issued_documents')[0].status).toBe('pending_signature');
      expect(table('dossier_items').filter((i) => i.kind === 'signed_document')).toHaveLength(0);
      // The upkeep job seals it (and does not expire a fully signed request).
      table('signature_requests')[0].expires_at = new Date(Date.now() - 1000);
      expect(await k.cron.runOnce(new Date())).toEqual({ expired: 0, sealed: 1 });
      expect(table('signature_requests')[0].status).toBe('completed');
      expect(table('dossier_items').filter((i) => i.kind === 'signed_document')).toHaveLength(1);
      expect(await k.cron.runOnce(new Date())).toEqual({ expired: 0, sealed: 0 });
      expect(await k.seal.seal(request.id)).toBe(false);
      expect(table('stored_files').filter((f) => f.source === 'generated' && f.original_name.endsWith('-firmado.pdf'))).toHaveLength(1);
    });
  });

  describe('decline', () => {
    it('leaves the request declined, frees the document and writes the reason in the flow timeline', async () => {
      const { request, tokens } = await createRequest([emailA, emailB]);
      expect(await codeOfError(k.publicSvc.decline(tokens[0], 'ab', META))).toBe('SYS_VALIDATION_001');
      await k.publicSvc.decline(tokens[0], 'El salario no es el pactado', META);
      expect(table('signature_signers')[0]).toMatchObject({ status: 'declined', declined_reason: 'El salario no es el pactado' });
      expect(table('signature_requests')[0].status).toBe('declined');
      expect(table('issued_documents')[0].status).toBe('issued');
      const declined = table('signature_evidence_events').find((e) => e.type === 'declined')!;
      expect(declined).toMatchObject({ ip_address: META.ip, payload: { reason: 'El salario no es el pactado' } });
      const line = table('workflow_instance_events').find((e) => e.type === 'signature_declined')!;
      expect(line.payload.label).toBe('Firma rechazada: El salario no es el pactado');
      expect(await k.evidence.verify(request.id)).toMatchObject({ valid: true });
      // Nobody can sign this request any more; the declined state is shown.
      expect((await view(tokens[0])).state).toBe('declined');
      expect((await view(tokens[1])).state).toBe('declined');
      expect(await codeOfError(k.publicSvc.sendOtp(tokens[1], META))).toBe('SIGNATURE_REQUEST_CLOSED');
      expect(await codeOfError(k.publicSvc.decline(tokens[0], 'otra vez', META))).toBe('SIGNATURE_REQUEST_CLOSED');
      // The document can go out again.
      k.asAdmin();
      await k.requests.create({ issued_document_id: 1, signers: [{ ...emailA, email: 'nueva@example.com' }] }, { type: 'user', id: 1 });
      expect(table('signature_requests')).toHaveLength(2);
    });
  });
});
