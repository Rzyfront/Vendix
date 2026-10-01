import { BadRequestException } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { StoreReceivedDocumentAccountingController } from './store-received-document-accounting.controller';
import { OrganizationReceivedDocumentAccountingController } from './organization-received-document-accounting.controller';

describe('received document accounting evidence controllers', () => {
  const context = { organization_id: 4, accounting_entity_id: 7, store_id: 9 } as any;
  const evidenceResult = { ledger_evidence_complete: false, evidence: [], unresolved_allocation_ids: [], fiscal_eligibility: 'pending' };
  const setup = (ControllerClass: any) => {
    const evidence = { list: jest.fn().mockResolvedValue(evidenceResult) };
    const contexts = { resolveStore: jest.fn().mockResolvedValue(context), resolveOrganization: jest.fn().mockResolvedValue(context) };
    const responses = { success: jest.fn((data) => ({ data })) };
    return { controller: new ControllerClass(evidence, contexts, responses), evidence, contexts, responses };
  };
  const handler = (klass: any) => klass.prototype.accountingEvidence;

  it('declares scoped guarded GET routes with existing read permissions and integer ids', () => {
    const storeHandler = handler(StoreReceivedDocumentAccountingController);
    const orgHandler = handler(OrganizationReceivedDocumentAccountingController);
    expect(Reflect.getMetadata(PATH_METADATA, StoreReceivedDocumentAccountingController)).toBe('store/invoicing/received-documents');
    expect(Reflect.getMetadata(PATH_METADATA, OrganizationReceivedDocumentAccountingController)).toBe('organization/invoicing/received-documents');
    for (const [klass, fn, permission] of [
      [StoreReceivedDocumentAccountingController, storeHandler, 'invoicing:received:read'],
      [OrganizationReceivedDocumentAccountingController, orgHandler, 'organization:invoicing:received:read'],
    ] as const) {
      expect(Reflect.getMetadata(GUARDS_METADATA, klass)).toHaveLength(1);
      expect(Reflect.getMetadata(METHOD_METADATA, fn)).toBe(0);
      expect(Reflect.getMetadata(PATH_METADATA, fn)).toBe(':id/accounting-evidence');
      expect(Reflect.getMetadata(PERMISSIONS_KEY, fn)).toEqual([permission]);
    }
  });

  it('rejects store selector override before resolving context or querying evidence', async () => {
    const { controller, contexts, evidence } = setup(StoreReceivedDocumentAccountingController);
    await expect(controller.accountingEvidence(12, { store_id: 9 })).rejects.toBeInstanceOf(BadRequestException);
    expect(contexts.resolveStore).not.toHaveBeenCalled();
    expect(evidence.list).not.toHaveBeenCalled();
  });

  it('resolves store context and calls evidence with exact scope and id', async () => {
    const { controller, contexts, evidence, responses } = setup(StoreReceivedDocumentAccountingController);
    await expect(controller.accountingEvidence(12, {})).resolves.toEqual({ data: evidenceResult });
    expect(contexts.resolveStore).toHaveBeenCalledTimes(1);
    expect(evidence.list).toHaveBeenCalledWith(context, 12);
    expect(responses.success).toHaveBeenCalledWith(evidenceResult);
  });

  it('resolves organization context with optional store selector and propagates scoped service errors', async () => {
    const { controller, contexts, evidence } = setup(OrganizationReceivedDocumentAccountingController);
    await controller.accountingEvidence(13, { store_id: 22 });
    expect(contexts.resolveOrganization).toHaveBeenCalledWith(22);
    expect(evidence.list).toHaveBeenCalledWith(context, 13);
    const failure = new BadRequestException('scope denied');
    evidence.list.mockRejectedValueOnce(failure);
    await expect(controller.accountingEvidence(99, {})).rejects.toBe(failure);
  });
});
