import { NotFoundException } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { FiscalEvidenceService } from './fiscal-evidence.service';
import { FiscalOperationsContext } from './fiscal-context-resolver.service';

describe('FiscalEvidenceService', () => {
  const context: FiscalOperationsContext = {
    organization_id: 1,
    store_id: null,
    fiscal_scope: 'ORGANIZATION',
    operating_scope: 'ORGANIZATION',
    accounting_entity_id: 77,
    accounting_entity: { id: 77 },
  };

  const requestContext = {
    user_id: 9,
    organization_id: 1,
    is_super_admin: false,
    is_owner: true,
  };

  const createService = (overrides: any = {}) => {
    const client = {
      fiscal_obligations: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      tax_declaration_drafts: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      fiscal_close_sessions: {
        findFirst: jest.fn(),
      },
      fiscal_evidences: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 500,
            ...data,
          }),
        ),
        findMany: jest.fn().mockResolvedValue([]),
      },
      ...overrides,
    };
    const audit = { logForResource: jest.fn().mockResolvedValue(undefined) };

    return {
      service: new FiscalEvidenceService(client as any, audit as any),
      client,
      audit,
    };
  };

  it('attaches evidence to an obligation in the same accounting entity', async () => {
    const { service, client, audit } = createService();
    client.fiscal_obligations.findFirst.mockResolvedValue({
      id: 100,
      organization_id: 1,
      store_id: null,
      accounting_entity_id: 77,
      status: 'ready',
    });
    client.fiscal_obligations.update.mockResolvedValue({ id: 100 });

    const result = await RequestContextService.run(requestContext, () =>
      service.attachToObligation([context], 100, {
        evidence_type: 'manual_support',
        content_hash: 'abc',
      }),
    );

    expect(result).toMatchObject({
      id: 500,
      organization_id: 1,
      accounting_entity_id: 77,
      evidence_type: 'manual_support',
      content_hash: 'abc',
    });
    expect(client.fiscal_obligations.findFirst).toHaveBeenCalledWith({
      where: {
        organization_id: 1,
        accounting_entity_id: 77,
        id: 100,
      },
    });
    expect(client.fiscal_obligations.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { evidence_id: 500 },
    });
    expect(audit.logForResource).toHaveBeenCalledWith(
      expect.objectContaining({ id: 500 }),
      expect.objectContaining({
        event_type: 'fiscal.obligation.evidence_attached',
        resource_type: 'fiscal_obligation',
        obligation_id: 100,
        evidence_id: 500,
      }),
    );
  });

  it('rejects evidence attachment when the obligation is outside the fiscal scope', async () => {
    const { service, client } = createService();
    client.fiscal_obligations.findFirst.mockResolvedValue(null);

    await expect(
      service.attachToObligation([context], 999, {
        evidence_type: 'manual_support',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(client.fiscal_evidences.create).not.toHaveBeenCalled();
  });

  it('links declaration evidence and stores source metadata', async () => {
    const { service, client } = createService();
    client.tax_declaration_drafts.findFirst.mockResolvedValue({
      id: 200,
      organization_id: 1,
      store_id: null,
      accounting_entity_id: 77,
      obligation_id: 100,
      status: 'ready',
    });

    await service.attachToDeclaration([context], 200, {
      evidence_type: 'declaration_pdf',
      storage_key: 'fiscal/declarations/200.pdf',
    });

    expect(client.fiscal_evidences.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organization_id: 1,
        accounting_entity_id: 77,
        evidence_type: 'declaration_pdf',
        storage_key: 'fiscal/declarations/200.pdf',
        metadata: {
          source_type: 'tax_declaration_draft',
          source_id: 200,
        },
      }),
    });
    expect(client.tax_declaration_drafts.update).toHaveBeenCalledWith({
      where: { id: 200 },
      data: { evidence_id: 500 },
    });
  });
});
