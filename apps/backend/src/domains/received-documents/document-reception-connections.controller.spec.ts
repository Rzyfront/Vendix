import {
  BadRequestException,
  HttpStatus,
  RequestMethod,
} from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ResponseService } from '../../common/responses/response.service';
import { MODULE_FLOW_KEY } from '../../common/guards/module-flow.guard';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AI_FEATURE_KEY, AiAccessGuard } from '../store/subscriptions/guards/ai-access.guard';
import { OrgInvoicingModule } from '../organization/invoicing/invoicing.module';
import { InvoicingModule as StoreInvoicingModule } from '../store/invoicing/invoicing.module';
import { ReceivedDocumentsContext } from './received-documents.service';
import { ReceivedDocumentsContextService } from './services/received-documents-context.service';
import { DocumentReceptionConnectionsService } from './services/document-reception-connections.service';
import { OrganizationReceivedDocumentsController } from './organization-received-documents.controller';
import { StoreReceivedDocumentsController } from './store-received-documents.controller';
import {
  OrganizationDocumentReceptionConnectionsController,
  OrganizationDocumentReceptionConnectionsQueryDto,
} from './organization-document-reception-connections.controller';
import {
  DocumentReceptionConnectionsQueryDto,
  StoreDocumentReceptionConnectionsController,
} from './store-document-reception-connections.controller';

const STORE_CONTEXT: ReceivedDocumentsContext = {
  organization_id: 3,
  accounting_entity_id: 8,
  store_id: 21,
  actor_id: 55,
  is_organization: false,
};
const ORG_CONTEXT: ReceivedDocumentsContext = {
  ...STORE_CONTEXT,
  is_organization: true,
};

function dependencies() {
  const connections = {
    list: jest.fn().mockResolvedValue({ data: [{ id: 31 }], total: 1, page: 2, limit: 10 }),
    findOne: jest.fn().mockResolvedValue({ id: 31 }),
    listRuns: jest.fn().mockResolvedValue({ data: [{ id: 61 }], total: 1, page: 2, limit: 10 }),
    create: jest.fn().mockResolvedValue({ id: 31 }),
    update: jest.fn().mockResolvedValue({ id: 31 }),
  };
  const contexts = {
    resolveStore: jest.fn().mockResolvedValue(STORE_CONTEXT),
    resolveOrganization: jest.fn().mockResolvedValue(ORG_CONTEXT),
  };
  const responses = {
    paginated: jest.fn((data, total, page, limit) => ({ data, total, page, limit })),
    created: jest.fn((data) => ({ data })),
    updated: jest.fn((data) => ({ data })),
    success: jest.fn((data) => ({ data })),
  };
  return { connections, contexts, responses };
}

function storeController(deps: ReturnType<typeof dependencies>) {
  return new StoreDocumentReceptionConnectionsController(
    deps.connections as unknown as DocumentReceptionConnectionsService,
    deps.contexts as unknown as ReceivedDocumentsContextService,
    deps.responses as unknown as ResponseService,
  );
}

function organizationController(deps: ReturnType<typeof dependencies>) {
  return new OrganizationDocumentReceptionConnectionsController(
    deps.connections as unknown as DocumentReceptionConnectionsService,
    deps.contexts as unknown as ReceivedDocumentsContextService,
    deps.responses as unknown as ResponseService,
  );
}

describe('document reception connection controllers', () => {
  it('delegates store list/detail/runs/create/update using authenticated store context and response envelopes', async () => {
    const deps = dependencies();
    const controller = storeController(deps);
    const createDto = {
      name: 'Supplier API', connection_type: 'api_poll', endpoint: 'https://supplier.example.test/docs', secret: 'secret',
    } as any;
    const updateDto = { expected_version: 1, name: 'Supplier API v2' } as any;

    await expect(controller.list({ page: 2, limit: 10 })).resolves.toEqual({
      data: [{ id: 31 }], total: 1, page: 2, limit: 10,
    });
    await expect(controller.create(createDto, {})).resolves.toEqual({ data: { id: 31 } });
    await expect(controller.findOne(31, {})).resolves.toEqual({ data: { id: 31 } });
    await expect(controller.listRuns(31, { page: 2, limit: 10 })).resolves.toEqual({
      data: [{ id: 61 }], total: 1, page: 2, limit: 10,
    });
    await expect(controller.update(31, updateDto, {})).resolves.toEqual({ data: { id: 31 } });

    expect(deps.contexts.resolveStore).toHaveBeenCalledTimes(5);
    expect(deps.connections.list).toHaveBeenCalledWith(STORE_CONTEXT, { page: 2, limit: 10 });
    expect(deps.connections.create).toHaveBeenCalledWith(STORE_CONTEXT, createDto);
    expect(deps.connections.findOne).toHaveBeenCalledWith(STORE_CONTEXT, 31);
    expect(deps.connections.listRuns).toHaveBeenCalledWith(STORE_CONTEXT, 31, { page: 2, limit: 10 });
    expect(deps.connections.update).toHaveBeenCalledWith(STORE_CONTEXT, 31, updateDto);
    expect(deps.responses.created).toHaveBeenCalledWith({ id: 31 }, 'Conexión de recepción creada');
    expect(deps.responses.updated).toHaveBeenCalledWith({ id: 31 }, 'Conexión de recepción actualizada');
  });

  it('rejects a store_id query override before context resolution or service calls', async () => {
    const deps = dependencies();
    const controller = storeController(deps);

    await expect(controller.list({ store_id: 22, page: 1, limit: 25 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.findOne(31, { store_id: 22 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create({} as any, { store_id: 22 })).rejects.toBeInstanceOf(BadRequestException);
    expect(deps.contexts.resolveStore).not.toHaveBeenCalled();
    expect(deps.connections.list).not.toHaveBeenCalled();
    expect(deps.connections.findOne).not.toHaveBeenCalled();
    expect(deps.connections.create).not.toHaveBeenCalled();
  });

  it('resolves the selected organization store independently for every action', async () => {
    const deps = dependencies();
    const controller = organizationController(deps);
    const scope = { store_id: 21 };
    const createDto = {
      name: 'Organization API', connection_type: 'api_poll', endpoint: 'https://supplier.example.test/docs', secret: 'secret',
    } as any;
    const updateDto = { expected_version: 1, enabled: false } as any;

    await controller.list({ ...scope, page: 2, limit: 10 });
    await controller.create(createDto, scope);
    await controller.findOne(31, scope);
    await controller.listRuns(31, { ...scope, page: 2, limit: 10 });
    await controller.update(31, updateDto, scope);

    expect(deps.contexts.resolveOrganization).toHaveBeenNthCalledWith(1, 21);
    expect(deps.contexts.resolveOrganization).toHaveBeenNthCalledWith(2, 21);
    expect(deps.contexts.resolveOrganization).toHaveBeenNthCalledWith(3, 21);
    expect(deps.contexts.resolveOrganization).toHaveBeenNthCalledWith(4, 21);
    expect(deps.contexts.resolveOrganization).toHaveBeenNthCalledWith(5, 21);
    expect(deps.connections.list).toHaveBeenCalledWith(ORG_CONTEXT, { ...scope, page: 2, limit: 10 });
    expect(deps.connections.create).toHaveBeenCalledWith(ORG_CONTEXT, createDto);
    expect(deps.connections.update).toHaveBeenCalledWith(ORG_CONTEXT, 31, updateDto);
  });

  it('leaves a missing organization store selection to the connection service failsafe', async () => {
    const deps = dependencies();
    const controller = organizationController(deps);
    const noOperationalStore = { ...ORG_CONTEXT, store_id: null };
    deps.contexts.resolveOrganization.mockResolvedValueOnce(noOperationalStore);
    deps.connections.create.mockRejectedValueOnce(new BadRequestException('store_id is required'));

    await expect(controller.create({} as any, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(deps.contexts.resolveOrganization).toHaveBeenCalledWith(undefined);
    expect(deps.connections.create).toHaveBeenCalledWith(noOperationalStore, {});
  });

  it('validates merged list paging and optional selected-store query fields', async () => {
    const storeInvalid = plainToInstance(DocumentReceptionConnectionsQueryDto, {
      page: '0', limit: '101', store_id: '0',
    });
    const orgInvalid = plainToInstance(OrganizationDocumentReceptionConnectionsQueryDto, {
      page: '1', limit: '10', store_id: 'not-an-id',
    });
    const [storeErrors, orgErrors] = await Promise.all([validate(storeInvalid), validate(orgInvalid)]);

    expect(storeErrors.map((error) => error.property)).toEqual(expect.arrayContaining(['page', 'limit', 'store_id']));
    expect(orgErrors.map((error) => error.property)).toContain('store_id');
  });

  it('declares configured-only routes, status codes, and no AI or fiscal activation guards', () => {
    const routeSpecs = [
      [StoreDocumentReceptionConnectionsController.prototype.list, '/', RequestMethod.GET],
      [StoreDocumentReceptionConnectionsController.prototype.create, '/', RequestMethod.POST],
      [StoreDocumentReceptionConnectionsController.prototype.findOne, ':id', RequestMethod.GET],
      [StoreDocumentReceptionConnectionsController.prototype.update, ':id', RequestMethod.PATCH],
      [StoreDocumentReceptionConnectionsController.prototype.listRuns, ':id/runs', RequestMethod.GET],
      [OrganizationDocumentReceptionConnectionsController.prototype.list, '/', RequestMethod.GET],
      [OrganizationDocumentReceptionConnectionsController.prototype.create, '/', RequestMethod.POST],
      [OrganizationDocumentReceptionConnectionsController.prototype.findOne, ':id', RequestMethod.GET],
      [OrganizationDocumentReceptionConnectionsController.prototype.update, ':id', RequestMethod.PATCH],
      [OrganizationDocumentReceptionConnectionsController.prototype.listRuns, ':id/runs', RequestMethod.GET],
    ] as const;

    for (const [handler, path, method] of routeSpecs) {
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
      expect(Reflect.getMetadata(AI_FEATURE_KEY, handler)).toBeUndefined();
      expect(Reflect.getMetadata(MODULE_FLOW_KEY, handler)).toBeUndefined();
      expect(Reflect.getMetadata('__guards__', handler) ?? []).not.toContain(AiAccessGuard);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([
        handler === StoreDocumentReceptionConnectionsController.prototype.list ||
        handler === StoreDocumentReceptionConnectionsController.prototype.create ||
        handler === StoreDocumentReceptionConnectionsController.prototype.findOne ||
        handler === StoreDocumentReceptionConnectionsController.prototype.update ||
        handler === StoreDocumentReceptionConnectionsController.prototype.listRuns
          ? 'invoicing:received:connections:configure'
          : 'organization:invoicing:received:connections:configure',
      ]);
    }
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, StoreDocumentReceptionConnectionsController.prototype.create)).toBe(HttpStatus.CREATED);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, OrganizationDocumentReceptionConnectionsController.prototype.create)).toBe(HttpStatus.CREATED);
    expect(Reflect.getMetadata(PATH_METADATA, StoreDocumentReceptionConnectionsController)).toBe('store/invoicing/received-documents/connections');
    expect(Reflect.getMetadata(PATH_METADATA, OrganizationDocumentReceptionConnectionsController)).toBe('organization/invoicing/received-documents/connections');
    expect(Reflect.getMetadata('__guards__', StoreDocumentReceptionConnectionsController)).toContain(PermissionsGuard);
    expect(Reflect.getMetadata('__guards__', OrganizationDocumentReceptionConnectionsController)).toContain(PermissionsGuard);
  });

  it('registers both connection controllers before the parent received-document id routes', () => {
    const storeControllers = Reflect.getMetadata('controllers', StoreInvoicingModule) as unknown[];
    const organizationControllers = Reflect.getMetadata('controllers', OrgInvoicingModule) as unknown[];

    expect(storeControllers.indexOf(StoreDocumentReceptionConnectionsController)).toBeLessThan(
      storeControllers.indexOf(StoreReceivedDocumentsController),
    );
    expect(organizationControllers.indexOf(OrganizationDocumentReceptionConnectionsController)).toBeLessThan(
      organizationControllers.indexOf(OrganizationReceivedDocumentsController),
    );
  });
});
