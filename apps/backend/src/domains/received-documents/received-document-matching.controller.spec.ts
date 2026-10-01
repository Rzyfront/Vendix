import { BadRequestException, HttpStatus, RequestMethod } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ResponseService } from '../../common/responses/response.service';
import { ReceivedDocumentsService } from './received-documents.service';
import { ReceivedDocumentsContextService } from './services/received-documents-context.service';
import { ReceivedDocumentScanQueueService } from './services/received-document-scan-queue.service';
import { ReceivedDocumentMatchCandidatesService } from './services/received-document-match-candidates.service';
import { ReceivedDocumentMatchAllocationsService } from './services/received-document-match-allocations.service';
import { ReceivedDocumentMatchExpensesService } from './services/received-document-match-expenses.service';
import { StoreReceivedDocumentsController } from './store-received-documents.controller';
import { OrganizationReceivedDocumentsController } from './organization-received-documents.controller';

const storeContext = {
  organization_id: 3,
  accounting_entity_id: 8,
  store_id: 21,
  actor_id: 55,
  is_organization: false,
};
const organizationContext = { ...storeContext, is_organization: true };

function dependencies() {
  const documents = {};
  const contexts = {
    resolveStore: jest.fn().mockResolvedValue(storeContext),
    resolveOrganization: jest.fn().mockResolvedValue(organizationContext),
  };
  const responses = {
    success: jest.fn((data) => ({ success: true, data })),
    created: jest.fn((data) => ({ success: true, data })),
    updated: jest.fn((data) => ({ success: true, data })),
  };
  const scans = {};
  const candidates = { list: jest.fn().mockResolvedValue({ candidates: [{ purchase_order_id: 4 }], warnings: [] }) };
  const allocations = {
    list: jest.fn().mockResolvedValue({ allocations: [{ id: 12 }] }),
    confirm: jest.fn().mockResolvedValue({ allocation: { id: 13 }, duplicate: false }),
    revoke: jest.fn().mockResolvedValue({ allocation: { id: 13 }, duplicate: false }),
  };
  const expenses = {
    list: jest.fn().mockResolvedValue({ data: [{ id: 15 }], total: 1, page: 1, limit: 20, warnings: ['MANUAL_SUPPLIER_IDENTITY_UNVERIFIED'] }),
  };
  return { documents, contexts, responses, scans, candidates, allocations, expenses };
}

function store(deps: ReturnType<typeof dependencies>) {
  return new StoreReceivedDocumentsController(
    deps.documents as unknown as ReceivedDocumentsService,
    deps.contexts as unknown as ReceivedDocumentsContextService,
    deps.responses as unknown as ResponseService,
    deps.scans as unknown as ReceivedDocumentScanQueueService,
    deps.candidates as unknown as ReceivedDocumentMatchCandidatesService,
    deps.allocations as unknown as ReceivedDocumentMatchAllocationsService,
    deps.expenses as unknown as ReceivedDocumentMatchExpensesService,
  );
}
function organization(deps: ReturnType<typeof dependencies>) {
  return new OrganizationReceivedDocumentsController(
    deps.documents as unknown as ReceivedDocumentsService,
    deps.contexts as unknown as ReceivedDocumentsContextService,
    deps.responses as unknown as ResponseService,
    deps.scans as unknown as ReceivedDocumentScanQueueService,
    deps.candidates as unknown as ReceivedDocumentMatchCandidatesService,
    deps.allocations as unknown as ReceivedDocumentMatchAllocationsService,
    deps.expenses as unknown as ReceivedDocumentMatchExpensesService,
  );
}

describe('received document matching API', () => {
  it('serves store candidate and allocation reads from authenticated store context', async () => {
    const deps = dependencies();
    const controller = store(deps);
    await expect(controller.matchCandidatesForDocument(90, { search: ' FAC-9 ', limit: 4 })).resolves.toEqual({
      success: true,
      data: { candidates: [{ purchase_order_id: 4 }], warnings: [] },
    });
    await controller.listMatchAllocations(90, {});
    expect(deps.contexts.resolveStore).toHaveBeenCalledTimes(2);
    expect(deps.candidates.list).toHaveBeenCalledWith(storeContext, 90, { search: ' FAC-9 ', limit: 4 });
    expect(deps.allocations.list).toHaveBeenCalledWith(storeContext, 90);
  });

  it('resolves organization-selected operational store for all four matching operations', async () => {
    const deps = dependencies();
    const controller = organization(deps);
    await controller.matchCandidatesForDocument(90, { search: 'FAC', limit: 5, store_id: 21 });
    await controller.listMatchAllocations(90, { store_id: 21 });
    const proposal = { expected_version: 2, idempotency_key: 'key' } as never;
    await controller.confirmMatchAllocation(90, proposal, { store_id: 21 });
    await controller.revokeMatchAllocation(90, 15, { expected_version: 3, reason: 'Corrección manual suficientemente descrita' }, { store_id: 21 });
    expect(deps.contexts.resolveOrganization).toHaveBeenCalledTimes(4);
    expect(deps.contexts.resolveOrganization).toHaveBeenCalledWith(21);
    expect(deps.candidates.list).toHaveBeenCalledWith(organizationContext, 90, { search: 'FAC', limit: 5 });
    expect(deps.allocations.list).toHaveBeenCalledWith(organizationContext, 90);
    expect(deps.allocations.confirm).toHaveBeenCalledWith(organizationContext, 90, proposal);
    expect(deps.allocations.revoke).toHaveBeenCalledWith(organizationContext, 90, 15, expect.objectContaining({ expected_version: 3 }));
  });

  it('rejects store selector overrides on store candidates, allocation reads, and writes', async () => {
    const deps = dependencies();
    const controller = store(deps);
    await expect(controller.matchCandidatesForDocument(90, { store_id: 99 })).rejects.toThrow(BadRequestException);
    await expect(controller.listMatchAllocations(90, { store_id: 99 })).rejects.toThrow(BadRequestException);
    await expect(controller.confirmMatchAllocation(90, {} as never, { store_id: 99 })).rejects.toThrow(BadRequestException);
    await expect(controller.revokeMatchAllocation(90, 12, {} as never, { store_id: 99 })).rejects.toThrow(BadRequestException);
    expect(deps.contexts.resolveStore).not.toHaveBeenCalled();
    expect(deps.candidates.list).not.toHaveBeenCalled();
    expect(deps.allocations.confirm).not.toHaveBeenCalled();
    expect(deps.allocations.revoke).not.toHaveBeenCalled();
  });

  it('serves the manual expense picker with store context and only its supported query fields', async () => {
    const deps = dependencies();
    const controller = store(deps);
    const response = await controller.listMatchExpenseCandidates(90, { search: ' café ', limit: 10, page: 2 });
    expect(response).toMatchObject({ data: { data: [{ id: 15 }], warnings: ['MANUAL_SUPPLIER_IDENTITY_UNVERIFIED'] } });
    expect(deps.contexts.resolveStore).toHaveBeenCalledTimes(1);
    expect(deps.expenses.list).toHaveBeenCalledWith(storeContext, 90, { search: ' café ', limit: 10, page: 2 });
  });

  it('uses organization-selected operational store and rejects store-admin overrides', async () => {
    const deps = dependencies();
    const org = organization(deps);
    await org.listMatchExpenseCandidates(90, { search: '15', store_id: 21 });
    expect(deps.contexts.resolveOrganization).toHaveBeenCalledWith(21);
    expect(deps.expenses.list).toHaveBeenCalledWith(organizationContext, 90, { search: '15', limit: undefined, page: undefined });

    const storeController = store(deps);
    await expect(storeController.listMatchExpenseCandidates(90, { store_id: 99 })).rejects.toThrow(BadRequestException);
    expect(deps.expenses.list).toHaveBeenCalledTimes(1);
  });

  it('uses scoped read and distinct confirm/revoke permissions with explicit HTTP semantics', () => {
    const candidateRead = StoreReceivedDocumentsController.prototype.matchCandidatesForDocument;
    const allocationRead = OrganizationReceivedDocumentsController.prototype.listMatchAllocations;
    const confirm = StoreReceivedDocumentsController.prototype.confirmMatchAllocation;
    const revoke = OrganizationReceivedDocumentsController.prototype.revokeMatchAllocation;
    const expenses = StoreReceivedDocumentsController.prototype.listMatchExpenseCandidates;
    expect(Reflect.getMetadata('__guards__', StoreReceivedDocumentsController)).toContain(PermissionsGuard);
    expect(Reflect.getMetadata(PATH_METADATA, candidateRead)).toBe(':id/match-candidates');
    expect(Reflect.getMetadata(METHOD_METADATA, candidateRead)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, candidateRead)).toEqual(['invoicing:received:read']);
    expect(Reflect.getMetadata(PATH_METADATA, allocationRead)).toBe(':id/match-allocations');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, allocationRead)).toEqual(['organization:invoicing:received:read']);
    expect(Reflect.getMetadata(PATH_METADATA, confirm)).toBe(':id/match-allocations');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, confirm)).toBe(HttpStatus.CREATED);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, confirm)).toEqual(['invoicing:received:match:confirm']);
    expect(Reflect.getMetadata(PATH_METADATA, revoke)).toBe(':id/match-allocations/:allocationId/revoke');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, revoke)).toBe(HttpStatus.OK);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, revoke)).toEqual(['organization:invoicing:received:match:revoke']);
    expect(Reflect.getMetadata(PATH_METADATA, expenses)).toBe(':id/match-expenses');
    expect(Reflect.getMetadata(METHOD_METADATA, expenses)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, expenses)).toEqual(['invoicing:received:read']);
  });
});
