import { BadRequestException, NotFoundException, StreamableFile } from '@nestjs/common';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ResponseService } from '../../common/responses/response.service';
import { ManualReceivedDocumentDto, ReceivedDocumentQueryDto, UpdateReceivedDocumentReviewDto } from './dto/received-document.dto';
import { OrganizationReceivedDocumentsController } from './organization-received-documents.controller';
import { StoreReceivedDocumentsController } from './store-received-documents.controller';
import { ReceivedDocumentsService } from './received-documents.service';
import { ReceivedDocumentsContextService } from './services/received-documents-context.service';
import { ReceivedDocumentsContext } from './received-documents.service';

const STORE_CONTEXT: ReceivedDocumentsContext = {
  organization_id: 3,
  accounting_entity_id: 8,
  store_id: 21,
  actor_id: 55,
  is_organization: false,
};
const ORG_CONTEXT: ReceivedDocumentsContext = {
  organization_id: 3,
  accounting_entity_id: 8,
  store_id: 21,
  actor_id: 55,
  is_organization: true,
};

function dependencies() {
  const documents = {
    list: jest.fn().mockResolvedValue({ data: [{ id: 1 }], total: 1, page: 1, limit: 25 }),
    findOne: jest.fn().mockResolvedValue({ id: 1, files: [] }),
    createManual: jest.fn().mockResolvedValue({ id: 1 }),
    importXml: jest.fn().mockResolvedValue({ id: 1 }),
    updateReview: jest.fn().mockResolvedValue({ id: 1 }),
    getFile: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7')),
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
  return { documents, contexts, responses };
}

describe('received-document route controllers', () => {
  it('keeps store reads pinned to the authenticated operational store', async () => {
    const deps = dependencies();
    const controller = new StoreReceivedDocumentsController(
      deps.documents as unknown as ReceivedDocumentsService,
      deps.contexts as unknown as ReceivedDocumentsContextService,
      deps.responses as unknown as ResponseService,
    );
    const query = { page: 1, limit: 25 } as ReceivedDocumentQueryDto;

    await controller.list(query);

    expect(deps.contexts.resolveStore).toHaveBeenCalledTimes(1);
    expect(deps.documents.list).toHaveBeenCalledWith(
      STORE_CONTEXT,
      expect.objectContaining({ page: 1, store_id: undefined }),
    );
    expect(deps.responses.paginated).toHaveBeenCalledWith(
      [{ id: 1 }], 1, 1, 25, 'Documentos recibidos obtenidos',
    );
  });

  it('rejects an explicit store override on store-admin list requests', async () => {
    const deps = dependencies();
    const controller = new StoreReceivedDocumentsController(
      deps.documents as unknown as ReceivedDocumentsService,
      deps.contexts as unknown as ReceivedDocumentsContextService,
      deps.responses as unknown as ResponseService,
    );

    await expect(controller.list({ store_id: 99 } as ReceivedDocumentQueryDto)).rejects.toThrow(BadRequestException);
    expect(deps.contexts.resolveStore).not.toHaveBeenCalled();
    expect(deps.documents.list).not.toHaveBeenCalled();
  });

  it('passes organization-selected store scope through context and list service', async () => {
    const deps = dependencies();
    const controller = new OrganizationReceivedDocumentsController(
      deps.documents as unknown as ReceivedDocumentsService,
      deps.contexts as unknown as ReceivedDocumentsContextService,
      deps.responses as unknown as ResponseService,
    );
    const query = { page: 2, limit: 10, store_id: 21 } as ReceivedDocumentQueryDto;

    await controller.list(query);

    expect(deps.contexts.resolveOrganization).toHaveBeenCalledWith(21);
    expect(deps.documents.list).toHaveBeenCalledWith(ORG_CONTEXT, query);
    expect(deps.responses.paginated).toHaveBeenCalledWith(
      [{ id: 1 }], 1, 1, 25, 'Documentos recibidos obtenidos',
    );
  });

  it('uses intent-specific ResponseService helpers for create, review, and detail', async () => {
    const deps = dependencies();
    const store = new StoreReceivedDocumentsController(
      deps.documents as unknown as ReceivedDocumentsService,
      deps.contexts as unknown as ReceivedDocumentsContextService,
      deps.responses as unknown as ResponseService,
    );
    const org = new OrganizationReceivedDocumentsController(
      deps.documents as unknown as ReceivedDocumentsService,
      deps.contexts as unknown as ReceivedDocumentsContextService,
      deps.responses as unknown as ResponseService,
    );

    await store.createManual({} as ManualReceivedDocumentDto);
    await store.findOne(1);
    await org.updateReview(1, {} as UpdateReceivedDocumentReviewDto, { store_id: 21 });

    expect(deps.responses.created).toHaveBeenCalledWith(
      { id: 1 },
      'Documento recibido guardado para revisión',
    );
    expect(deps.responses.success).toHaveBeenCalledWith(
      { id: 1, files: [] },
      'Documento recibido obtenido',
    );
    expect(deps.responses.updated).toHaveBeenCalledWith(
      { id: 1 },
      'Revisión del documento guardada',
    );
  });

  it('rejects a missing XML upload before invoking tenant context or the service', async () => {
    const deps = dependencies();
    const controller = new OrganizationReceivedDocumentsController(
      deps.documents as unknown as ReceivedDocumentsService,
      deps.contexts as unknown as ReceivedDocumentsContextService,
      deps.responses as unknown as ResponseService,
    );

    await expect(controller.importXml(undefined as never, {})).rejects.toThrow(BadRequestException);
    expect(deps.contexts.resolveOrganization).not.toHaveBeenCalled();
    expect(deps.documents.importXml).not.toHaveBeenCalled();
  });

  it('scopes downloads by the authorized document and file id, without exposing storage keys', async () => {
    const deps = dependencies();
    const controller = new StoreReceivedDocumentsController(
      deps.documents as unknown as ReceivedDocumentsService,
      deps.contexts as unknown as ReceivedDocumentsContextService,
      deps.responses as unknown as ResponseService,
    );
    deps.documents.findOne.mockResolvedValue({
      id: 1,
      files: [{ id: 7, file_name: 'proveedor-01.pdf', mime_type: 'application/pdf', file_key: 'internal-key' }],
    });
    const response = { setHeader: jest.fn() };

    const streamable = await controller.downloadFile(1, 7, response as never);
    const chunks: Buffer[] = [];
    for await (const chunk of streamable.getStream()) chunks.push(Buffer.from(chunk));

    expect(streamable).toBeInstanceOf(StreamableFile);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from('%PDF-1.7'));
    expect(deps.documents.getFile).toHaveBeenCalledWith(STORE_CONTEXT, 1, 7);
    expect(response.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="proveedor-01.pdf"');
    expect(response.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });

  it('does not request a file when the id is absent from the scoped document', async () => {
    const deps = dependencies();
    const controller = new OrganizationReceivedDocumentsController(
      deps.documents as unknown as ReceivedDocumentsService,
      deps.contexts as unknown as ReceivedDocumentsContextService,
      deps.responses as unknown as ResponseService,
    );
    deps.documents.findOne.mockResolvedValue({ id: 1, files: [] });

    await expect(controller.downloadFile(1, 9, { store_id: 21 }, { setHeader: jest.fn() } as never))
      .rejects.toThrow(NotFoundException);
    expect(deps.documents.getFile).not.toHaveBeenCalled();
  });

  it('declares explicit guards and operation-specific named permissions', () => {
    expect(Reflect.getMetadata('__guards__', StoreReceivedDocumentsController)).toContain(PermissionsGuard);
    expect(Reflect.getMetadata('__guards__', OrganizationReceivedDocumentsController)).toContain(PermissionsGuard);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, StoreReceivedDocumentsController.prototype.list))
      .toEqual(['invoicing:received:read']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, StoreReceivedDocumentsController.prototype.importXml))
      .toEqual(['invoicing:received:import']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, StoreReceivedDocumentsController.prototype.updateReview))
      .toEqual(['invoicing:received:review']);
    expect(Reflect.getMetadata('path', StoreReceivedDocumentsController.prototype.createManual))
      .toBe('manual');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, OrganizationReceivedDocumentsController.prototype.list))
      .toEqual(['organization:invoicing:received:read']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, OrganizationReceivedDocumentsController.prototype.importXml))
      .toEqual(['organization:invoicing:received:import']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, OrganizationReceivedDocumentsController.prototype.updateReview))
      .toEqual(['organization:invoicing:received:review']);
    expect(Reflect.getMetadata('path', OrganizationReceivedDocumentsController.prototype.createManual))
      .toBe('manual');
  });
});
