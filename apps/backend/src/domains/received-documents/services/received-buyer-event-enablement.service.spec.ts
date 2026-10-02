import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';
import { ReceivedBuyerEventEnablementService } from './received-buyer-event-enablement.service';

describe('ReceivedBuyerEventEnablementService', () => {
  const context: ReceivedDocumentsContext = { organization_id: 5, accounting_entity_id: 7, store_id: 11, is_organization: false };
  const validRow = () => ({
    organization_id: 5, accounting_entity_id: 7, status: 'verified', event_codes: ['030', '031'], verification_source: 'test_set',
    software_id_snapshot: 'software-id', certificate_fingerprint_snapshot: 'fingerprint',
    verified_by_user_id: 9, verified_at: new Date(),
    dian_configuration: { organization_id: 5, accounting_entity_id: 7, configuration_type: 'invoicing', operation_mode: 'own_software', environment: 'production', enablement_status: 'enabled', software_id: 'software-id', certificate_fingerprint: 'fingerprint', certificate_s3_key: 'secret-cert-key', certificate_password_encrypted: 'secret-password', certificate_kms_key_id: null, certificate_expiry: new Date(Date.now() + 86400000), nit: '900123456-8', nit_dv: '8' },
    evidence: { organization_id: 5, accounting_entity_id: 7, evidence_type: 'test_set', storage_key: 'secret-evidence-key', content_hash: null },
  });
  let findEnablement: jest.Mock;
  let db: { received_buyer_event_enablements: { findFirst: jest.Mock }; accounting_entities: { findFirst: jest.Mock } };
  let findEntity: jest.Mock;
  let assertContext: jest.Mock;
  let service: ReceivedBuyerEventEnablementService;

  beforeEach(() => {
    findEnablement = jest.fn().mockResolvedValue(validRow());
    findEntity = jest.fn().mockResolvedValue({ tax_id: '900123456-8' });
    assertContext = jest.fn().mockResolvedValue(undefined);
    db = { received_buyer_event_enablements: { findFirst: findEnablement }, accounting_entities: { findFirst: findEntity } };
    service = new ReceivedBuyerEventEnablementService(
      { withoutScope: jest.fn().mockReturnValue(db) } as unknown as GlobalPrismaService,
      { assertContext } as unknown as ReceivedDocumentsService,
    );
  });

  it('fails closed for missing activation without writes', async () => {
    findEnablement.mockResolvedValue(null);
    expect(await service.getReadiness(context, '030')).toEqual({ status: 'not_started', ready: false, blockers: ['not_configured'], event_codes: [] });
    expect(findEntity).not.toHaveBeenCalled();
    expect(findEnablement.mock.calls[0][0].where).toEqual({ organization_id: 5, accounting_entity_id: 7 });
    expect(Object.keys(findEnablement.mock.calls[0][0])).toEqual(['where', 'select']);
  });

  it('returns ready only when verified evidence, exact fiscal entity, certificate and event all match', async () => {
    const result = await service.getReadiness(context, '030');
    expect(result).toEqual({ status: 'verified', ready: true, blockers: [], event_codes: ['030', '031'] });
    expect(assertContext).toHaveBeenCalledWith(context);
    expect(findEntity).toHaveBeenCalledWith({ where: { id: 7, organization_id: 5, is_active: true }, select: { tax_id: true } });
    expect(JSON.stringify(result)).not.toMatch(/secret-cert-key|secret-password|software-id|fingerprint\":/i);
  });

  it('fails closed when linked config or evidence belong to another tenant/entity', async () => {
    const row = validRow();
    row.dian_configuration.organization_id = 99;
    row.evidence.accounting_entity_id = 88;
    findEnablement.mockResolvedValue(row);
    const result = await service.getReadiness(context, '030');
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining(['configuration_missing', 'evidence_missing']));
  });

  it('rejects a context that the documents scope guard rejects before reading activation', async () => {
    assertContext.mockRejectedValue(new Error('foreign context'));
    await expect(service.getReadiness({ ...context, organization_id: 99 }, '030')).rejects.toThrow('foreign context');
    expect(findEnablement).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong NIT', (row: any) => { row.dian_configuration.nit = '800987654-3'; }],
    ['wrong DV', (row: any) => { row.dian_configuration.nit_dv = '9'; }],
    ['stale certificate fingerprint', (row: any) => { row.dian_configuration.certificate_fingerprint = 'other'; }],
    ['stale software id', (row: any) => { row.dian_configuration.software_id = 'other'; }],
    ['missing evidence', (row: any) => { row.evidence = null; }],
    ['unrelated payment evidence', (row: any) => { row.evidence.evidence_type = 'payment_receipt'; }],
    ['missing verification source', (row: any) => { row.verification_source = null; }],
    ['expired certificate', (row: any) => { row.dian_configuration.certificate_expiry = new Date(Date.now() - 1000); }],
    ['KMS-only certificate without S3 credentials', (row: any) => { row.dian_configuration.certificate_s3_key = null; row.dian_configuration.certificate_password_encrypted = null; row.dian_configuration.certificate_kms_key_id = 'kms-secret'; }],
    ['missing event code', (row: any) => { row.event_codes = ['031']; }],
    ['suspended activation', (row: any) => { row.status = 'suspended'; }],
    ['testing activation', (row: any) => { row.status = 'testing'; }],
  ])('blocks readiness for %s', async (_label, mutate) => {
    const row = validRow(); mutate(row); findEnablement.mockResolvedValue(row);
    const result = await service.getReadiness(context, '030');
    expect(result.ready).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
    if (_label === 'testing activation') expect(result.status).toBe('testing');
    if (_label === 'KMS-only certificate without S3 credentials') expect(result.blockers).toEqual(expect.arrayContaining(['certificate_missing', 'credentials_missing']));
    if (_label === 'unrelated payment evidence') expect(result.blockers).toContain('evidence_type_invalid');
    if (_label === 'missing verification source') expect(result.blockers).toContain('verification_source_invalid');
    expect(JSON.stringify(result)).not.toMatch(/secret-cert-key|secret-password|software-id|fingerprint\":/i);
  });

  it('never performs writes', async () => {
    const result = await service.getReadiness(context, '030');
    expect(Object.keys(findEnablement.mock.calls[0][0])).toEqual(['where', 'select']);
    expect(findEntity.mock.calls[0][0]).toEqual({ where: { id: 7, organization_id: 5, is_active: true }, select: { tax_id: true } });
    expect(result.ready).toBe(true);
  });

  describe('requestVerification', () => {
    const input = { expected_version: 0, dian_configuration_id: 20, evidence_id: 30, event_codes: ['030', '031'] as ('030' | '031')[] };
    const makeTx = (existing: any = null) => {
      const created = { id: 4, organization_id: 5, accounting_entity_id: 7, version: 1, status: 'testing', event_codes: input.event_codes, dian_configuration_id: 20, evidence_id: 30 };
      const tx: any = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
        received_buyer_event_enablements: { findFirst: jest.fn().mockResolvedValue(existing).mockResolvedValueOnce(existing).mockResolvedValueOnce({ ...created, version: 5 }), create: jest.fn().mockResolvedValue(created), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        dian_configurations: { findFirst: jest.fn().mockResolvedValue({ id: 20, configuration_type: 'invoicing', operation_mode: 'own_software' }) },
        fiscal_evidences: { findFirst: jest.fn().mockResolvedValue({ id: 30, evidence_type: 'test_set', storage_key: 'secret-key', content_hash: null }) },
        audit_logs: { create: jest.fn().mockResolvedValue({}) },
      };
      return { tx, created };
    };
    const request = (tx: any) => {
      (service as any).prisma.$transaction = jest.fn((cb: (inner: any) => unknown) => cb(tx));
      (service as any).prisma.withoutScope = jest.fn().mockReturnValue((service as any).prisma);
    };

    it('creates request under entity lock, audits safely in the same transaction, and returns only the allowlisted snapshot', async () => {
      const { tx, created } = makeTx(); request(tx);
      const result = await service.requestVerification({ ...context, actor_id: 9 }, input);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.received_buyer_event_enablements.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organization_id: 5, accounting_entity_id: 7, status: 'testing', version: 1 }) }));
      expect(tx.audit_logs.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ user_id: 9, resource: 'received_buyer_event_enablements', new_values: { organization_id: 5, accounting_entity_id: 7, status: 'testing', version: 1, dian_configuration_id: 20, evidence_id: 30, event_codes: input.event_codes } }) }));
      expect(result).toEqual({ status: 'testing', version: 1, event_codes: input.event_codes, dian_configuration_id: 20, evidence_id: 30 });
      expect(JSON.stringify([result, tx.audit_logs.create.mock.calls[0][0]])).not.toMatch(/secret-key|password|certificate|software_id/i);
      expect(created.status).toBe('testing');
    });

    it('rejects actorless requests before transaction', async () => {
      const { tx } = makeTx(); request(tx);
      await expect(service.requestVerification(context, input)).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });
    it('rejects invalid codes', async () => {
      const { tx } = makeTx(); request(tx);
      await expect(service.requestVerification({ ...context, actor_id: 9 }, { ...input, event_codes: ['099'] as any })).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });
    it('rejects foreign configuration and evidence', async () => {
      const configFixture = makeTx(); request(configFixture.tx);
      configFixture.tx.dian_configurations.findFirst.mockResolvedValue(null);
      await expect(service.requestVerification({ ...context, actor_id: 9 }, input)).rejects.toBeInstanceOf(BadRequestException);
      expect(configFixture.tx.fiscal_evidences.findFirst).not.toHaveBeenCalled();
      const evidenceFixture = makeTx(); request(evidenceFixture.tx);
      evidenceFixture.tx.fiscal_evidences.findFirst.mockResolvedValue(null);
      await expect(service.requestVerification({ ...context, actor_id: 9 }, input)).rejects.toBeInstanceOf(BadRequestException);
    });
    it('detects version conflicts and resets verified readiness on resubmission', async () => {
      const stale = makeTx({ version: 3, id: 1 }); request(stale.tx);
      await expect(service.requestVerification({ ...context, actor_id: 9 }, input)).rejects.toBeInstanceOf(ConflictException);
      expect(stale.tx.received_buyer_event_enablements.updateMany).not.toHaveBeenCalled();
      const verified = makeTx({ id: 1, version: 4, status: 'verified', organization_id: 5, accounting_entity_id: 7, verification_source: 'test_set', verified_at: new Date(), verified_by_user_id: 9, software_id_snapshot: 'x', certificate_fingerprint_snapshot: 'y' }); request(verified.tx);
      const result = await service.requestVerification({ ...context, actor_id: 9 }, { ...input, expected_version: 4 });
      expect(verified.tx.received_buyer_event_enablements.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'testing', verification_source: null, verified_at: null, verified_by_user_id: null, software_id_snapshot: null, certificate_fingerprint_snapshot: null, version: { increment: 1 } }) }));
      expect(verified.tx.received_buyer_event_enablements.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1, organization_id: 5, accounting_entity_id: 7, version: 4 }, data: expect.objectContaining({ status: 'testing', version: { increment: 1 } }) }));
      expect(result.version).toBe(5);
      expect(verified.tx.audit_logs.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'UPDATE', old_values: expect.objectContaining({ status: 'verified', version: 4 }) }) }));
    });
    it('fails closed when audit insertion fails (transaction callback rejects)', async () => {
      const { tx } = makeTx(); tx.audit_logs.create.mockRejectedValue(new Error('db details')); request(tx);
      await expect(service.requestVerification({ ...context, actor_id: 9 }, input)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(tx.received_buyer_event_enablements.create).toHaveBeenCalled();
    });
    it('maps unique evidence/entity races to a safe conflict', async () => {
      const { tx } = makeTx(); tx.received_buyer_event_enablements.create.mockRejectedValue({ code: 'P2002' }); request(tx);
      await expect(service.requestVerification({ ...context, actor_id: 9 }, input)).rejects.toBeInstanceOf(ConflictException);
      expect(tx.audit_logs.create).not.toHaveBeenCalled();
    });
  });

  describe('verifyAsPlatformReviewer', () => {
    const verifyInput = { expected_version: 3, verification_source: 'test_set' as const, review_note: 'Revisé respuesta DIAN y set de pruebas.' };
    const makeReviewTx = () => {
      const pending = { id: 4, organization_id: 5, accounting_entity_id: 7, status: 'testing', version: 3, event_codes: ['030', '031'], dian_configuration_id: 20, evidence_id: 30, verification_source: null, verified_by_user_id: null, verified_at: null, software_id_snapshot: null, certificate_fingerprint_snapshot: null };
      const verifiedAt = new Date();
      const fresh = { ...pending, status: 'verified', version: 4, verification_source: 'test_set', verified_by_user_id: 9, verified_at: verifiedAt, software_id_snapshot: 'secret-software', certificate_fingerprint_snapshot: 'secret-fingerprint' };
      const tx: any = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
        accounting_entities: { findFirst: jest.fn().mockResolvedValue({ id: 7, tax_id: '900123456-8' }) },
        received_buyer_event_enablements: { findFirst: jest.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(fresh), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        dian_configurations: { findFirst: jest.fn().mockResolvedValue({ id: 20, organization_id: 5, accounting_entity_id: 7, configuration_type: 'invoicing', operation_mode: 'own_software', environment: 'production', enablement_status: 'enabled', software_id: 'secret-software', certificate_fingerprint: 'secret-fingerprint', certificate_s3_key: 'secret-cert-key', certificate_password_encrypted: 'secret-password', certificate_expiry: new Date(Date.now() + 86400000), nit: '900123456-8', nit_dv: '8' }) },
        fiscal_evidences: { findFirst: jest.fn().mockResolvedValue({ id: 30, organization_id: 5, accounting_entity_id: 7, evidence_type: 'test_set', storage_key: 'secret-evidence-key', content_hash: null }) },
        audit_logs: { create: jest.fn().mockResolvedValue({}) },
      };
      return { tx, pending, fresh };
    };
    const useTx = (tx: any) => {
      (service as any).prisma.$transaction = jest.fn((cb: (inner: any) => unknown) => cb(tx));
      (service as any).prisma.withoutScope = jest.fn().mockReturnValue((service as any).prisma);
    };
    const perform = (tx: any, input = verifyInput) => {
      useTx(tx);
      return service.verifyAsPlatformReviewer(5, 7, 9, input);
    };

    it('verifies transactionally with entity lock, scoped mutation, safe audit and safe view', async () => {
      const { tx } = makeReviewTx();
      const result = await perform(tx);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.accounting_entities.findFirst).toHaveBeenCalledWith({ where: { id: 7, organization_id: 5, is_active: true }, select: { id: true, tax_id: true } });
      expect(tx.dian_configurations.findFirst.mock.calls[0][0].where).toEqual({ id: 20, organization_id: 5, accounting_entity_id: 7 });
      expect(tx.fiscal_evidences.findFirst.mock.calls[0][0].where).toEqual({ id: 30, organization_id: 5, accounting_entity_id: 7 });
      expect(tx.received_buyer_event_enablements.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 4, organization_id: 5, accounting_entity_id: 7, version: 3, status: 'testing' }, data: expect.objectContaining({ status: 'verified', verification_source: 'test_set', verified_by_user_id: 9, software_id_snapshot: 'secret-software', certificate_fingerprint_snapshot: 'secret-fingerprint', version: { increment: 1 } }) }));
      expect(result).toEqual({ status: 'verified', version: 4, event_codes: ['030', '031'], dian_configuration_id: 20, evidence_id: 30, verified_at: expect.any(Date) });
      const audit = tx.audit_logs.create.mock.calls[0][0].data;
      expect(audit.metadata.review_note).toBe(verifyInput.review_note);
      expect(audit.new_values).toEqual(expect.objectContaining({ status: 'verified', version: 4, has_software_id_snapshot: true, has_certificate_fingerprint_snapshot: true }));
      expect(JSON.stringify([result, audit])).not.toMatch(/secret-software|secret-fingerprint|secret-cert-key|secret-password|secret-evidence-key/);
    });

    it('rejects missing/short reviewer attestation before opening the transaction', async () => {
      const { tx } = makeReviewTx(); useTx(tx);
      await expect(service.verifyAsPlatformReviewer(5, 7, 9, { ...verifyInput, review_note: 'too short' })).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });
    it.each([
      ['wrong status', { status: 'verified', version: 3 }],
      ['stale version', { status: 'testing', version: 2 }],
    ])('rejects %s', async (_label, patch) => {
      const { tx, pending } = makeReviewTx(); tx.received_buyer_event_enablements.findFirst.mockReset().mockResolvedValue({ ...pending, ...patch });
      await expect(perform(tx)).rejects.toBeInstanceOf(ConflictException);
      expect(tx.received_buyer_event_enablements.updateMany).not.toHaveBeenCalled();
    });
    it('rejects cross-tenant configuration/evidence, missing or expired certificates, and NIT mismatch', async () => {
      const invalidConfig = makeReviewTx(); invalidConfig.tx.dian_configurations.findFirst.mockResolvedValue(null);
      await expect(perform(invalidConfig.tx)).rejects.toBeInstanceOf(ConflictException);
      const invalidEvidence = makeReviewTx(); invalidEvidence.tx.fiscal_evidences.findFirst.mockResolvedValue(null);
      await expect(perform(invalidEvidence.tx)).rejects.toBeInstanceOf(ConflictException);
      const missingCert = makeReviewTx(); missingCert.tx.dian_configurations.findFirst.mockResolvedValue({ ...await missingCert.tx.dian_configurations.findFirst(), certificate_s3_key: null });
      await expect(perform(missingCert.tx)).rejects.toBeInstanceOf(ConflictException);
      const expired = makeReviewTx(); expired.tx.dian_configurations.findFirst.mockResolvedValue({ ...await expired.tx.dian_configurations.findFirst(), certificate_expiry: new Date(Date.now() - 1) });
      await expect(perform(expired.tx)).rejects.toBeInstanceOf(ConflictException);
      const wrongNit = makeReviewTx(); wrongNit.tx.dian_configurations.findFirst.mockResolvedValue({ ...await wrongNit.tx.dian_configurations.findFirst(), nit: '800987654-3' });
      await expect(perform(wrongNit.tx)).rejects.toBeInstanceOf(ConflictException);
    });
    it('fails closed on audit failure and gates readiness from the verified row actually returned by the transaction', async () => {
      const failure = makeReviewTx(); failure.tx.audit_logs.create.mockRejectedValue(new Error('sensitive db error'));
      await expect(perform(failure.tx)).rejects.toBeInstanceOf(ServiceUnavailableException);
      const success = makeReviewTx();
      await perform(success.tx);
      const readRow = {
        ...success.fresh,
        dian_configuration: { organization_id: 5, accounting_entity_id: 7, configuration_type: 'invoicing', operation_mode: 'own_software', environment: 'production', enablement_status: 'enabled', software_id: success.fresh.software_id_snapshot, certificate_fingerprint: success.fresh.certificate_fingerprint_snapshot, certificate_s3_key: 'secret-cert-key', certificate_password_encrypted: 'secret-password', certificate_kms_key_id: null, certificate_expiry: new Date(Date.now() + 86400000), nit: '900123456-8', nit_dv: '8' },
        evidence: { organization_id: 5, accounting_entity_id: 7, evidence_type: 'test_set', storage_key: 'secret-evidence-key', content_hash: null },
      };
      const readEnablement = jest.fn().mockResolvedValue(readRow);
      (service as any).prisma.withoutScope.mockReturnValue({ received_buyer_event_enablements: { findFirst: readEnablement }, accounting_entities: { findFirst: jest.fn().mockResolvedValue({ tax_id: '900123456-8' }) } });
      expect((await service.getReadiness(context, '030')).ready).toBe(true);
      const unapproved = await service.getReadiness(context, '032');
      expect(unapproved.ready).toBe(false);
      expect(unapproved.blockers).toContain('event_code_not_approved');
      expect(readEnablement).toHaveBeenCalledTimes(2);
    });
    it('rejects invalid organization, entity, reviewer IDs and versions', async () => {
      const { tx } = makeReviewTx(); useTx(tx);
      await expect(service.verifyAsPlatformReviewer(0, 7, 9, verifyInput)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.verifyAsPlatformReviewer(5, 0, 9, verifyInput)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.verifyAsPlatformReviewer(5, 7, -1, verifyInput)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.verifyAsPlatformReviewer(5, 7, 9, { ...verifyInput, expected_version: 0 })).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
