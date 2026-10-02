import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
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
});
