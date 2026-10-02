import { BadRequestException, HttpStatus } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { StoreReceivedDocumentsController } from './store-received-documents.controller';
import { OrganizationReceivedDocumentsController } from './organization-received-documents.controller';
import { ReceivedBuyerEventCommandDto } from './dto/received-buyer-event-command.dto';
import { PermissionsGuard } from '../auth/guards/permissions.guard';

const storeContext = { organization_id: 3, accounting_entity_id: 8, store_id: 21, actor_id: 55, is_organization: false };
const orgContext = { ...storeContext, is_organization: true };
const dto = { event_code: '030', idempotency_key: 'buyer:event-1' } as const;

function dependencies() {
  const contexts = {
    resolveStore: jest.fn().mockResolvedValue(storeContext),
    resolveOrganization: jest.fn().mockResolvedValue(orgContext),
  };
  const dispatch = { execute: jest.fn().mockResolvedValue({ status: 'accepted', duplicate: false, event_id: 7, event_number: 'EVT-7' }) };
  const responses = { updated: jest.fn((data) => ({ success: true, data })) };
  return { contexts, dispatch, responses };
}

describe('received buyer-event command controllers', () => {
  it('declares the protected POST endpoint and exact authorization on each route', () => {
    const store = StoreReceivedDocumentsController.prototype.emitBuyerEvent;
    const organization = OrganizationReceivedDocumentsController.prototype.emitBuyerEvent;
    expect(Reflect.getMetadata(PATH_METADATA, store)).toBe(':id/buyer-events');
    expect(Reflect.getMetadata(PATH_METADATA, organization)).toBe(':id/buyer-events');
    expect(Reflect.getMetadata(METHOD_METADATA, store)).toBe(1);
    expect(Reflect.getMetadata(METHOD_METADATA, organization)).toBe(1);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, store)).toBe(HttpStatus.OK);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, organization)).toBe(HttpStatus.OK);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, store)).toEqual(['invoicing:received:events:emit']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, organization)).toEqual(['organization:invoicing:received:events:emit']);
    expect(Reflect.getMetadata('__guards__', StoreReceivedDocumentsController)).toContain(PermissionsGuard);
    expect(Reflect.getMetadata('__guards__', OrganizationReceivedDocumentsController)).toContain(PermissionsGuard);
  });

  it('resolves tenant contexts, blocks store override, and delegates dispatch without DIAN details', async () => {
    const deps = dependencies();
    const store = new StoreReceivedDocumentsController({} as never, deps.contexts as never, deps.responses as never, {} as never, {} as never, {} as never, {} as never, {} as never, deps.dispatch as never);
    const organization = new OrganizationReceivedDocumentsController({} as never, deps.contexts as never, deps.responses as never, {} as never, {} as never, {} as never, {} as never, {} as never, deps.dispatch as never);
    await expect(store.emitBuyerEvent(41, dto as never, {})).resolves.toEqual({ success: true, data: expect.objectContaining({ status: 'accepted' }) });
    await organization.emitBuyerEvent(42, dto as never, { store_id: 21 });
    await expect(store.emitBuyerEvent(41, dto as never, { store_id: 99 })).rejects.toThrow(BadRequestException);
    expect(deps.contexts.resolveStore).toHaveBeenCalledTimes(1);
    expect(deps.contexts.resolveOrganization).toHaveBeenCalledWith(21);
    expect(deps.dispatch.execute).toHaveBeenNthCalledWith(1, storeContext, 41, dto);
    expect(deps.dispatch.execute).toHaveBeenNthCalledWith(2, orgContext, 42, dto);
    expect(deps.responses.updated).toHaveBeenCalledTimes(2);
  });

  it('validates event codes, safe idempotency keys, and event 031 description requirements', () => {
    const valid = (value: object) => validateSync(plainToInstance(ReceivedBuyerEventCommandDto, value));
    expect(valid(dto)).toHaveLength(0);
    expect(valid({ ...dto, event_code: '034' })).not.toHaveLength(0);
    expect(valid({ ...dto, idempotency_key: 'bad/key' })).not.toHaveLength(0);
    expect(valid({ ...dto, event_code: '031' })).not.toHaveLength(0);
    expect(valid({ ...dto, event_code: '031', description: 'Reclamo' })).not.toHaveLength(0);
    expect(valid({ ...dto, event_code: '031', description: 'Reclamo', claim_concept_code: '01' })).toHaveLength(0);
    expect(valid({ ...dto, event_code: '031', description: 'x'.repeat(1001) })).not.toHaveLength(0);
    expect(valid({ ...dto, claim_concept_code: '05' })).not.toHaveLength(0);
  });
});
