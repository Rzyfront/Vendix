import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '@common/context/request-context.service';
import { FiscalObligationService } from './fiscal-obligation.service';
import { FiscalOperationsContext } from './fiscal-context-resolver.service';

describe('FiscalObligationService', () => {
  const context: FiscalOperationsContext = {
    organization_id: 1,
    store_id: null,
    fiscal_scope: 'ORGANIZATION',
    operating_scope: 'ORGANIZATION',
    accounting_entity_id: 77,
    accounting_entity: { id: 77 },
  };

  const baseObligation = {
    id: 100,
    organization_id: 1,
    store_id: null,
    accounting_entity_id: 77,
    status: 'ready',
    evidence_id: null,
    notes: null,
    blocking_reason: null,
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
        findFirst: jest.fn().mockResolvedValue(baseObligation),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            ...baseObligation,
            ...data,
            evidence_id:
              data.evidence?.connect?.id ?? baseObligation.evidence_id,
          }),
        ),
      },
      fiscal_evidences: {
        findFirst: jest.fn().mockResolvedValue({ id: 500 }),
      },
      ...overrides,
    };
    const fiscalStatus = { getStatusBlock: jest.fn() };
    const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;
    const audit = { logForResource: jest.fn().mockResolvedValue(undefined) };

    return {
      service: new FiscalObligationService(
        client as any,
        fiscalStatus as any,
        eventEmitter,
        audit as any,
      ),
      client,
      eventEmitter,
      audit,
    };
  };

  it('requires evidence before moving an obligation to submitted', async () => {
    const { service, client } = createService();

    await expect(
      service.updateStatus([context], 100, { status: 'submitted' }),
    ).rejects.toThrow(BadRequestException);
    expect(client.fiscal_obligations.update).not.toHaveBeenCalled();
  });

  it('rejects evidence from another fiscal accounting entity', async () => {
    const { service, client } = createService({
      fiscal_evidences: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });

    await expect(
      service.updateStatus([context], 100, {
        status: 'submitted',
        evidence_id: 999,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(client.fiscal_evidences.findFirst).toHaveBeenCalledWith({
      where: {
        id: 999,
        organization_id: 1,
        accounting_entity_id: 77,
      },
      select: { id: true },
    });
    expect(client.fiscal_obligations.update).not.toHaveBeenCalled();
  });

  it('does not allow terminal obligations to move backwards', async () => {
    const { service } = createService({
      fiscal_obligations: {
        findFirst: jest.fn().mockResolvedValue({
          ...baseObligation,
          status: 'paid',
          evidence_id: 500,
        }),
        update: jest.fn(),
      },
      fiscal_evidences: {
        findFirst: jest.fn().mockResolvedValue({ id: 500 }),
      },
    });

    await expect(
      service.updateStatus([context], 100, { status: 'in_progress' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('updates status, emits event, and audits valid submitted transitions', async () => {
    const { service, client, eventEmitter, audit } = createService();

    const result = await RequestContextService.run(requestContext, () =>
      service.updateStatus([context], 100, {
        status: 'submitted',
        evidence_id: 500,
        notes: 'Presentada en portal DIAN',
      }),
    );

    expect(result).toMatchObject({
      status: 'submitted',
      evidence_id: 500,
      notes: 'Presentada en portal DIAN',
    });
    expect(client.fiscal_obligations.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: expect.objectContaining({
        status: 'submitted',
        evidence: { connect: { id: 500 } },
        notes: 'Presentada en portal DIAN',
      }),
      include: { accounting_entity: true, store: true, evidence: true },
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'fiscal.obligation.status_changed',
      expect.objectContaining({
        id: 100,
        status: 'submitted',
        accounting_entity_id: 77,
      }),
    );
    expect(audit.logForResource).toHaveBeenCalledWith(
      expect.objectContaining({ id: 100 }),
      expect.objectContaining({
        event_type: 'fiscal.obligation.status_changed',
        previous_status: 'ready',
        new_status: 'submitted',
        evidence_id: 500,
      }),
    );
  });
});
