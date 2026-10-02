import { createHash } from 'crypto';
import { DianDirectProvider } from './dian-direct.provider';
import { UblApplicationResponseBuilder } from './xml/ubl-application-response.builder';
import { CufeCalculator } from '../../utils/cufe-calculator';
import { HttpException } from '@nestjs/common';

const issuer = { document_type: '31', nit: '900123456-8', nit_dv: '8', legal_name: 'Buyer SAS' };
const supplier = { document_type: '31', document_number: '800214345-7', document_dv: '7', legal_name: 'Supplier SAS' };
const base = {
  event_code: '030' as const, event_number: 'EV-1', generated_by: 'customer' as const,
  referenced_document_number: 'FE-1', referenced_document_key: 'cufe', referenced_document_date: '2026-01-01',
  customer: { ...issuer, document_number: '900.123.456-8' }, issue_date: '2026-01-02',
  referenced_issuer: supplier,
};

function buildProvider() {
  const soap = { sendEventUpdateStatus: jest.fn().mockResolvedValue({ raw_response: '<ok/>' }) };
  const parser = { parseApplicationResponse: jest.fn().mockReturnValue({ is_valid: true, errors: [], document_key: 'track' }) };
  const provider = new DianDirectProvider({} as any, {} as any, {} as any, soap as any, {} as any, parser as any, {} as any, {} as any);
  Object.assign(provider as any, {
    loadConfig: jest.fn().mockResolvedValue({ id: 4, accounting_entity_id: 9, software_id: 'software', certificate_s3_key: 'cert.p12', certificate_kms_key_id: 'kms-key', software_pin: 'pin', environment: 'test' }),
    loadIssuerData: jest.fn().mockResolvedValue(issuer),
    signXml: jest.fn().mockImplementation((xml: string) => Promise.resolve(xml)),
    compressToZipBase64: jest.fn().mockResolvedValue('zip'),
    loadWsCredentials: jest.fn().mockResolvedValue(undefined),
    dianFileNames: jest.fn().mockReturnValue({ xml: 'event.xml', zip: 'event.zip' }),
    createAuditLog: jest.fn().mockResolvedValue(undefined),
  });
  return { provider, soap };
}

async function expectHttpStatus(promise: Promise<unknown>, status: number) {
  const error = await promise.catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(HttpException);
  expect((error as HttpException).getStatus()).toBe(status);
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
    cude.mockRestore(); build.mockRestore();
  });

  it('prepares a signed 030 snapshot and never calls SOAP or audits success', async () => {
    const { provider, soap } = buildProvider();
    const cude = jest.spyOn(CufeCalculator, 'generateEventCude').mockReturnValue('cude');
    const prepared = await provider.prepareDocumentEvent(base);
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
    expect(soap.sendEventUpdateStatus).not.toHaveBeenCalled();
    expect((provider as any).createAuditLog).not.toHaveBeenCalled();
    cude.mockRestore();
  });

  it('rejects 034 for a received invoice before signing', async () => {
    const { provider, soap } = buildProvider();
    await expectHttpStatus(provider.prepareDocumentEvent({ ...base, event_code: '034' as any }), 400);
    expect((provider as any).signXml).not.toHaveBeenCalled();
    expect(soap.sendEventUpdateStatus).not.toHaveBeenCalled();
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
