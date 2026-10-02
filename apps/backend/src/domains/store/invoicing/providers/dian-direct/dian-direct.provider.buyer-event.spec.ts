import { createHash } from 'crypto';
import { DianDirectProvider } from './dian-direct.provider';
import { UblApplicationResponseBuilder } from './xml/ubl-application-response.builder';
import { CufeCalculator } from '../../utils/cufe-calculator';
import { HttpException } from '@nestjs/common';
import { RequestContextService } from '../../../../../common/context/request-context.service';

const issuer = { document_type: '31', nit: '900123456-8', nit_dv: '8', legal_name: 'Buyer SAS' };
const supplier = { document_type: '31', document_number: '800214345-7', document_dv: '7', legal_name: 'Supplier SAS' };
const base = {
  event_code: '030' as const, event_number: 'EV-1', generated_by: 'customer' as const,
  referenced_document_number: 'FE-1', referenced_document_key: 'cufe', referenced_document_date: '2026-01-01',
  customer: { ...issuer, document_number: '900.123.456-8' }, issue_date: '2026-01-02',
  referenced_issuer: supplier,
};
const exact_config = { configuration_id: 4, accounting_entity_id: 9, store_id: null };
const referenced_cufe = 'a'.repeat(96);

function getStatusResponse(cufe: string, statusCode = '0', isValid = 'true') {
  return {
    success: true,
    timed_out: false,
    raw_response: `<s:Envelope xmlns:s="urn:soap"><s:Body><GetStatusResponse><GetStatusResult><IsValid>${isValid}</IsValid><StatusCode>${statusCode}</StatusCode><XmlDocumentKey>${cufe}</XmlDocumentKey></GetStatusResult></GetStatusResponse></s:Body></s:Envelope>`,
  };
}

function buildProvider() {
  const soap = {
    sendEventUpdateStatus: jest.fn().mockResolvedValue({ raw_response: '<ok/>' }),
    getStatus: jest.fn(),
  };
  const parser = { parseApplicationResponse: jest.fn().mockReturnValue({ is_valid: true, errors: [], rule_messages: [], already_processed: false, document_key: 'track', status_code: '00', status_description: '' }) };
  const provider = new DianDirectProvider({} as any, {} as any, {} as any, soap as any, {} as any, parser as any, {} as any, {} as any);
  Object.assign(provider as any, {
    loadConfig: jest.fn().mockResolvedValue({ id: 4, accounting_entity_id: 9, software_id: 'software', certificate_s3_key: 'cert.p12', certificate_kms_key_id: 'kms-key', software_pin: 'pin', environment: 'test' }),
    loadIssuerData: jest.fn().mockResolvedValue(issuer),
    signXml: jest.fn().mockImplementation((xml: string) => Promise.resolve(xml)),
    compressToZipBase64: jest.fn().mockResolvedValue('zip'),
    dianFileNames: jest.fn().mockReturnValue({ xml: 'event.xml', zip: 'event.zip' }),
    createAuditLog: jest.fn().mockResolvedValue(undefined),
    validateCertificateExpiry: jest.fn(),
    loadWsCredentials: jest.fn().mockResolvedValue({ signer: {}, certificate_der_base64: 'cert' }),
  });
  return { provider, soap };
}

async function expectHttpStatus(promise: Promise<unknown>, status: number) {
  const error = await promise.catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(HttpException);
  expect((error as HttpException).getStatus()).toBe(status);
}

function respondWithEventKey(soap: { sendEventUpdateStatus: jest.Mock }, prepared: { cude: string }) {
  soap.sendEventUpdateStatus.mockResolvedValueOnce({
    raw_response: `<s:Envelope xmlns:s="urn:soap"><s:Body><x:SendEventUpdateStatusResult xmlns:x="urn:dian"><x:XmlDocumentKey>${prepared.cude}</x:XmlDocumentKey></x:SendEventUpdateStatusResult></s:Body></s:Envelope>`,
  });
}

function configureRealLoadConfig(provider: DianDirectProvider, storeId: number | null, entityId = 9) {
  const rawConfig = {
    id: 42, organization_id: 10, store_id: storeId, accounting_entity_id: entityId,
    nit: '900123456', nit_dv: '8', software_id: 'software', software_pin_encrypted: 'encrypted-pin',
    certificate_s3_key: null, certificate_password_encrypted: null, certificate_kms_key_id: null,
    certificate_fingerprint: null, certificate_expiry: null, certificate_uploaded_at: null,
    environment: 'test', enablement_status: 'enabled', test_set_id: null,
    operation_mode: 'own_software', configuration_type: 'invoicing',
  };
  const findFirst = jest.fn().mockResolvedValue(rawConfig);
  const context = jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
    organization_id: 10, store_id: storeId,
  } as any);
  Object.assign(provider as any, {
    prisma: { dian_configurations: { findFirst } },
    fiscalScope: { resolveAccountingEntityForFiscal: jest.fn().mockResolvedValue({ id: entityId }) },
    encryption: { decrypt: jest.fn().mockReturnValue('decrypted-pin') },
    secret_envelope: { upgradeInPlace: jest.fn().mockResolvedValue(undefined) },
  });
  return { findFirst, context, rawConfig };
}

describe('DianDirectProvider buyer event transport', () => {
  it('builds a 030 from configured buyer to referenced supplier and hashes those parties', async () => {
    const { provider, soap } = buildProvider();
    const cude = jest.spyOn(CufeCalculator, 'generateEventCude').mockReturnValue('cude');
    const build = jest.spyOn(UblApplicationResponseBuilder, 'build');
    const result = await provider.sendDocumentEvent(base);
    expect(result.event_code).toBe('030');
    expect(build.mock.calls[0][0].sender).toMatchObject({ document_number: '900123456', document_dv: '8' });
    expect(build.mock.calls[0][0].receiver).toMatchObject({ document_number: '800214345', document_dv: '7' });
    expect(cude).toHaveBeenCalledWith(expect.objectContaining({ issuer_nit: '900123456', customer_nit: '800214345' }));
    expect(soap.sendEventUpdateStatus).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    cude.mockRestore(); build.mockRestore();
  });

  it('prepares a signed 030 snapshot and never calls SOAP or audits success', async () => {
    const { provider, soap } = buildProvider();
    const cude = jest.spyOn(CufeCalculator, 'generateEventCude').mockReturnValue('cude');
    const prepared = await provider.prepareDocumentEvent(base, exact_config);
    expect(prepared).toMatchObject({
      event_code: '030', event_number: 'EV-1', dian_configuration_id: 4,
      accounting_entity_id: 9, environment: 'test', cude: 'cude',
      signed_xml: expect.stringContaining('ApplicationResponse'),
      xml_filename: 'event.xml', zip_filename: 'event.zip', software_id: 'software',
      certificate_s3_key: 'cert.p12', certificate_kms_key_id: 'kms-key',
    });
    expect(prepared.signed_xml_sha256).toBe(
      createHash('sha256').update(prepared.signed_xml, 'utf8').digest('hex'),
    );
    expect((provider as any).loadConfig).toHaveBeenCalledWith('invoicing', exact_config);
    expect(soap.sendEventUpdateStatus).not.toHaveBeenCalled();
    expect((provider as any).createAuditLog).not.toHaveBeenCalled();
    cude.mockRestore();
  });

  it('fails closed when preparing a buyer event without a selected configuration', async () => {
    const { provider } = buildProvider();
    await expectHttpStatus(provider.prepareDocumentEvent(base), 400);
    expect((provider as any).loadConfig).not.toHaveBeenCalled();
  });

  it('rejects invalid exact selectors and selectors for another fiscal entity', async () => {
    const { provider } = buildProvider();
    const { context, findFirst } = configureRealLoadConfig(provider, null);
    const loadConfig = (DianDirectProvider.prototype as any).loadConfig.bind(provider);
    await expectHttpStatus(loadConfig('invoicing', {
      configuration_id: 0, accounting_entity_id: 9,
    }), 400);
    await expectHttpStatus(loadConfig('invoicing', {
      configuration_id: 4, accounting_entity_id: 10,
    }), 400);
    expect(findFirst).not.toHaveBeenCalled();
    context.mockRestore();
  });

  it('loads the exact nondefault configuration for a server-resolved organization store', async () => {
    const { provider } = buildProvider();
    const { findFirst, context, rawConfig } = configureRealLoadConfig(provider, null);
    const fiscalScope = (provider as any).fiscalScope;
    fiscalScope.resolveAccountingEntityForFiscal.mockResolvedValue({ id: 9 });
    const config = await (DianDirectProvider.prototype as any).loadConfig.call(provider, 'invoicing', {
      configuration_id: 42, accounting_entity_id: 9, store_id: 73,
    });
    expect(fiscalScope.resolveAccountingEntityForFiscal).toHaveBeenCalledWith({ organization_id: 10, store_id: 73 });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 42, accounting_entity_id: 9, configuration_type: 'invoicing' }),
    }));
    expect(config).toMatchObject({ id: rawConfig.id, accounting_entity_id: 9, software_pin: 'decrypted-pin' });
    context.mockRestore();
  });

  it('rejects a selected store that differs from the authenticated store before querying', async () => {
    const { provider } = buildProvider();
    const { findFirst, context } = configureRealLoadConfig(provider, 73);
    await expectHttpStatus((DianDirectProvider.prototype as any).loadConfig.call(provider, 'invoicing', {
      configuration_id: 42, accounting_entity_id: 9, store_id: 74,
    }), 400);
    expect(findFirst).not.toHaveBeenCalled();
    context.mockRestore();
  });

  describe('referenced invoice acceptance check', () => {
    it.each(['0', '00'])('accepts DIAN GetStatus StatusCode %s only for the exact CUFE', async (statusCode) => {
      const { provider, soap } = buildProvider();
      (provider as any).loadConfig.mockResolvedValue({
        id: 42, accounting_entity_id: 9, environment: 'production', enablement_status: 'enabled',
      });
      soap.getStatus.mockResolvedValue(getStatusResponse(referenced_cufe.toUpperCase(), statusCode));
      const proof = await provider.assertReferencedInvoiceAccepted(referenced_cufe, exact_config);
      expect(soap.getStatus).toHaveBeenCalledWith(referenced_cufe, 'production', expect.any(Object));
      expect(proof).toMatchObject({ document_key: referenced_cufe.toUpperCase() });
      expect(Number.isNaN(Date.parse(proof.checked_at))).toBe(false);
    });

    it('rejects invalid CUFE before loading config or calling DIAN', async () => {
      const { provider, soap } = buildProvider();
      await expectHttpStatus(provider.assertReferencedInvoiceAccepted('not-a-cufe', exact_config), 400);
      expect((provider as any).loadConfig).not.toHaveBeenCalled();
      expect(soap.getStatus).not.toHaveBeenCalled();
    });

    it('fails closed without WS-Security credentials before calling DIAN', async () => {
      const { provider, soap } = buildProvider();
      (provider as any).loadConfig.mockResolvedValue({
        id: 42, accounting_entity_id: 9, environment: 'production', enablement_status: 'enabled',
      });
      (provider as any).loadWsCredentials.mockResolvedValue(undefined);
      await expectHttpStatus(provider.assertReferencedInvoiceAccepted(referenced_cufe, exact_config), 503);
      expect(soap.getStatus).not.toHaveBeenCalled();
    });

    it.each([
      ['mismatched key', getStatusResponse('b'.repeat(96)), 409],
      ['not valid', getStatusResponse(referenced_cufe, '0', 'false'), 409],
      ['non-accepted status', getStatusResponse(referenced_cufe, '99'), 409],
      ['missing result', { success: true, timed_out: false, raw_response: '<Envelope/>' }, 503],
      ['SOAP fault', { success: true, timed_out: false, raw_response: '<Envelope><Fault/></Envelope>' }, 503],
      ['timeout', { success: false, timed_out: true, raw_response: '' }, 503],
    ])('fails closed on %s', async (_label, response, code) => {
      const { provider, soap } = buildProvider();
      (provider as any).loadConfig.mockResolvedValue({
        id: 42, accounting_entity_id: 9, environment: 'production', enablement_status: 'enabled',
      });
      soap.getStatus.mockResolvedValue(response);
      await expectHttpStatus(provider.assertReferencedInvoiceAccepted(referenced_cufe, exact_config), code as number);
    });

    it.each([
      ['test', 'enabled'],
      ['production', 'testing'],
    ])('blocks unverified DIAN config environment=%s status=%s', async (environment, enablement_status) => {
      const { provider, soap } = buildProvider();
      (provider as any).loadConfig.mockResolvedValue({ id: 42, accounting_entity_id: 9, environment, enablement_status });
      await expectHttpStatus(provider.assertReferencedInvoiceAccepted(referenced_cufe, exact_config), 409);
      expect(soap.getStatus).not.toHaveBeenCalled();
    });
  });

  it('rejects 034 for a received invoice before signing', async () => {
    const { provider, soap } = buildProvider();
    await expectHttpStatus(provider.prepareDocumentEvent({ ...base, event_code: '034' as any }, exact_config), 400);
    expect((provider as any).signXml).not.toHaveBeenCalled();
    expect(soap.sendEventUpdateStatus).not.toHaveBeenCalled();
  });

  it('transmits a prepared artifact unchanged without rebuilding, recalculating or signing', async () => {
    const { provider, soap } = buildProvider();
    const prepared = await provider.prepareDocumentEvent(base, exact_config);
    respondWithEventKey(soap, prepared);
    const sign = jest.spyOn(provider as any, 'signXml');
    sign.mockClear();
    const cude = jest.spyOn(CufeCalculator, 'generateEventCude');
    const builder = jest.spyOn(UblApplicationResponseBuilder, 'build');
    const result = await provider.sendPreparedDocumentEvent(prepared);
    expect((provider as any).loadConfig).toHaveBeenLastCalledWith('invoicing', exact_config);
    expect(result).toMatchObject({ success: true, delivery_status: 'accepted', cude: prepared.cude, request_xml: prepared.signed_xml });
    expect(soap.sendEventUpdateStatus).toHaveBeenCalledTimes(1);
    expect((provider as any).compressToZipBase64).toHaveBeenCalledWith(prepared.signed_xml, prepared.xml_filename);
    expect((provider as any).createAuditLog).toHaveBeenCalledTimes(1);
    expect(sign).not.toHaveBeenCalled(); expect(cude).not.toHaveBeenCalled(); expect(builder).not.toHaveBeenCalled();
    cude.mockRestore(); builder.mockRestore();
  });

  it('rejects changed config before SOAP', async () => {
    const { provider, soap } = buildProvider();
    const prepared = await provider.prepareDocumentEvent(base, exact_config);
    (provider as any).loadConfig.mockResolvedValue({ id: 5, accounting_entity_id: 9, software_id: 'software', certificate_s3_key: 'cert.p12', certificate_kms_key_id: 'kms-key', environment: 'test' });
    await expectHttpStatus(provider.sendPreparedDocumentEvent(prepared), 409);
    expect(soap.sendEventUpdateStatus).not.toHaveBeenCalled();
    (provider as any).loadConfig.mockResolvedValue({ id: 4, accounting_entity_id: 9, software_id: 'software', certificate_s3_key: 'cert.p12', certificate_kms_key_id: 'kms-key', environment: 'test', certificate_fingerprint: 'changed' });
    await expectHttpStatus(provider.sendPreparedDocumentEvent(prepared), 409);
    expect(soap.sendEventUpdateStatus).not.toHaveBeenCalled();
  });

  it('rejects tampered prepared XML/hash and unsupported 034 before SOAP', async () => {
    const { provider, soap } = buildProvider();
    const prepared = await provider.prepareDocumentEvent(base, exact_config);
    await expectHttpStatus(provider.sendPreparedDocumentEvent({ ...prepared, signed_xml: prepared.signed_xml + 'x' }), 400);
    await expectHttpStatus(provider.sendPreparedDocumentEvent({ ...prepared, event_code: '034' as any }), 400);
    const mismatchCude = prepared.signed_xml.replace(/(<cbc:UUID[^>]*>)[^<]+/, '$1different-cude');
    await expectHttpStatus(provider.sendPreparedDocumentEvent({ ...prepared, signed_xml: mismatchCude, signed_xml_sha256: createHash('sha256').update(mismatchCude).digest('hex') }), 400);
    expect(soap.sendEventUpdateStatus).not.toHaveBeenCalled();
  });

  it('returns unknown on SOAP timeout while preserving CUDE and XML', async () => {
    const { provider, soap } = buildProvider();
    const prepared = await provider.prepareDocumentEvent(base, exact_config);
    soap.sendEventUpdateStatus.mockRejectedValueOnce(new Error('timeout'));
    const result = await provider.sendPreparedDocumentEvent(prepared);
    expect(result).toMatchObject({ success: false, delivery_status: 'unknown', cude: prepared.cude, request_xml: prepared.signed_xml });
    expect(soap.sendEventUpdateStatus).toHaveBeenCalledTimes(1);
    expect((provider as any).createAuditLog).toHaveBeenCalledTimes(1);
  });

  it('preserves accepted DIAN result when audit write fails', async () => {
    const { provider, soap } = buildProvider();
    const prepared = await provider.prepareDocumentEvent(base, exact_config);
    respondWithEventKey(soap, prepared);
    (provider as any).createAuditLog.mockRejectedValueOnce(new Error('audit unavailable'));
    const result = await provider.sendPreparedDocumentEvent(prepared);
    expect(result).toMatchObject({ success: true, delivery_status: 'accepted', cude: prepared.cude, request_xml: prepared.signed_xml });
    expect(soap.sendEventUpdateStatus).toHaveBeenCalledTimes(1);
    expect((provider as any).createAuditLog).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['malformed/unknown response', { is_valid: false, status_code: 'unknown', errors: [], rule_messages: [], already_processed: false }],
    ['already processed response', { is_valid: false, status_code: '99', errors: [], rule_messages: [{ severity: 'rechazo' }], already_processed: true }],
  ])('returns unknown for %s', async (_label, parsed) => {
    const { provider, soap } = buildProvider();
    const prepared = await provider.prepareDocumentEvent(base, exact_config);
    respondWithEventKey(soap, prepared);
    (provider as any).response_parser.parseApplicationResponse.mockReturnValue(parsed);
    const result = await provider.sendPreparedDocumentEvent(prepared);
    expect(result.delivery_status).toBe('unknown');
    expect(result.cude).toBe(prepared.cude);
    expect(result.request_xml).toBe(prepared.signed_xml);
  });

  it('returns rejected only for an explicit DIAN rejection', async () => {
    const { provider, soap } = buildProvider();
    const prepared = await provider.prepareDocumentEvent(base, exact_config);
    respondWithEventKey(soap, prepared);
    (provider as any).response_parser.parseApplicationResponse.mockReturnValue({
      is_valid: false, status_code: '99', status_description: 'Rejected',
      errors: [{ code: 'R1', message: 'Rejected' }],
      rule_messages: [{ code: 'R1', text: 'Rejected', severity: 'rechazo' }],
      already_processed: false,
    });
    const result = await provider.sendPreparedDocumentEvent(prepared);
    expect(result.delivery_status).toBe('rejected');
  });

  it.each([undefined, 'foreign-cude'])('keeps IsValid=true inconclusive with SOAP event key %s', async (soapKey) => {
    const { provider, soap } = buildProvider();
    const prepared = await provider.prepareDocumentEvent(base, exact_config);
    soap.sendEventUpdateStatus.mockResolvedValueOnce({
      raw_response: soapKey
        ? `<s:Envelope><SendEventUpdateStatusResult><XmlDocumentKey>${soapKey}</XmlDocumentKey></SendEventUpdateStatusResult></s:Envelope>`
        : '<s:Envelope><IsValid>true</IsValid><SendEventUpdateStatusResult/></s:Envelope>',
    });
    const result = await provider.sendPreparedDocumentEvent(prepared);
    expect(result).toMatchObject({ success: false, delivery_status: 'unknown', cude: prepared.cude });
    expect(result.message).toContain('conciliar');
    expect(result.tracking_id).toBeUndefined();
  });

  it('keeps IsValid=false rejection inconclusive when SOAP event key mismatches', async () => {
    const { provider, soap } = buildProvider();
    const prepared = await provider.prepareDocumentEvent(base, exact_config);
    soap.sendEventUpdateStatus.mockResolvedValueOnce({ raw_response: '<s:Envelope><SendEventUpdateStatusResult><XmlDocumentKey>foreign-cude</XmlDocumentKey></SendEventUpdateStatusResult></s:Envelope>' });
    (provider as any).response_parser.parseApplicationResponse.mockReturnValue({
      is_valid: false, status_code: '99', status_description: 'Rejected',
      errors: [{ code: 'R1', message: 'Rejected' }],
      rule_messages: [{ code: 'R1', text: 'Rejected', severity: 'rechazo' }],
      already_processed: false,
    });
    const result = await provider.sendPreparedDocumentEvent(prepared);
    expect(result.delivery_status).toBe('unknown');
    expect(result.tracking_id).toBeUndefined();
  });

  it('keeps a SOAP Fault inconclusive even if it contains a matching CUDE', async () => {
    const { provider, soap } = buildProvider();
    const prepared = await provider.prepareDocumentEvent(base, exact_config);
    soap.sendEventUpdateStatus.mockResolvedValueOnce({
      raw_response: `<s:Envelope xmlns:s="urn:soap"><s:Body><s:Fault><faultstring>DIAN fault</faultstring><XmlDocumentKey>${prepared.cude}</XmlDocumentKey></s:Fault></s:Body></s:Envelope>`,
    });
    const result = await provider.sendPreparedDocumentEvent(prepared);
    expect(result).toMatchObject({ success: false, delivery_status: 'unknown', cude: prepared.cude });
    expect(result.tracking_id).toBeUndefined();
    expect(result.message).toContain('conciliar');
  });

  it('blocks a buyer identity mismatch before SOAP', async () => {
    const { provider, soap } = buildProvider();
    await expectHttpStatus(provider.sendDocumentEvent({ ...base, customer: { ...base.customer, document_number: '800214345-7' } }), 422);
    expect(soap.sendEventUpdateStatus).not.toHaveBeenCalled();
  });

  it('blocks a buyer NIT with an invalid provided verification digit', async () => {
    const { provider, soap } = buildProvider();
    await expectHttpStatus(provider.sendDocumentEvent({ ...base, customer: { ...base.customer, document_number: '900123456-7' } }), 422);
    expect(soap.sendEventUpdateStatus).not.toHaveBeenCalled();
  });

  it('blocks a supplier NIT with an invalid provided verification digit', async () => {
    const { provider, soap } = buildProvider();
    await expectHttpStatus(provider.sendDocumentEvent({ ...base, referenced_issuer: { ...supplier, document_number: '800214345-8' } }), 422);
    expect(soap.sendEventUpdateStatus).not.toHaveBeenCalled();
  });

  it('blocks tacit acceptance 034 for received invoices before SOAP', async () => {
    const { provider, soap } = buildProvider();
    await expectHttpStatus(provider.sendDocumentEvent({ ...base, event_code: '034' as any }), 400);
    expect(soap.sendEventUpdateStatus).not.toHaveBeenCalled();
  });

  it('preserves legacy emitted-invoice sender/receiver mapping without referenced_issuer', async () => {
    const { provider } = buildProvider();
    const build = jest.spyOn(UblApplicationResponseBuilder, 'build');
    await provider.sendDocumentEvent({ ...base, referenced_issuer: undefined, generated_by: 'customer' });
    expect(build.mock.calls[0][0].sender).toMatchObject({ legal_name: base.customer.legal_name });
    expect(build.mock.calls[0][0].receiver).toMatchObject({ document_number: '9001234568' });
    build.mockRestore();
  });
});
