import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RequestContext, RequestContextService } from '@common/context/request-context.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { FiscalContextResolverService } from '../../fiscal-operations/services/fiscal-context-resolver.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { ReceivedDocumentContextQueryDto } from '../dto/received-document-context.dto';
import { ReceivedDocumentsContextService } from './received-documents-context.service';

const authenticatedRequest: RequestContext = {
  user_id: 55,
  organization_id: 3,
  store_id: 21,
  is_super_admin: false,
  is_owner: true,
};
const fiscalStoreContext = {
  organization_id: 3,
  store_id: null,
  accounting_entity_id: 8,
  accounting_entity: { id: 8 },
  fiscal_scope: 'ORGANIZATION',
  operating_scope: 'ORGANIZATION',
};

describe('ReceivedDocumentsContextService', () => {
  let getContext: jest.SpyInstance;
  let resolver: { resolveForStore: jest.Mock; resolveForOrganization: jest.Mock };
  let prisma: { stores: { findFirst: jest.Mock } };
  let contexts: ReceivedDocumentsContextService;

  beforeEach(() => {
    getContext = jest.spyOn(RequestContextService, 'getContext').mockReturnValue(authenticatedRequest);
    resolver = {
      resolveForStore: jest.fn().mockResolvedValue(fiscalStoreContext),
      resolveForOrganization: jest.fn().mockResolvedValue(fiscalStoreContext),
    };
    prisma = { stores: { findFirst: jest.fn().mockResolvedValue({ id: 21 }) } };
    contexts = new ReceivedDocumentsContextService(
      resolver as unknown as FiscalContextResolverService,
      prisma as unknown as GlobalPrismaService,
    );
  });

  afterEach(() => getContext.mockRestore());

  it('retains the operational store when fiscal resolver selects the consolidated entity', async () => {
    const context = await contexts.resolveStore();

    expect(resolver.resolveForStore).toHaveBeenCalledTimes(1);
    expect(context).toEqual({
      organization_id: 3,
      accounting_entity_id: 8,
      store_id: 21,
      actor_id: 55,
      is_organization: false,
    });
  });

  it('fails closed if the authenticated store/org context is missing', async () => {
    getContext.mockReturnValue(undefined);

    await expect(contexts.resolveStore()).rejects.toThrow(ForbiddenException);
    await expect(contexts.resolveOrganization()).rejects.toThrow(ForbiddenException);
    expect(resolver.resolveForStore).not.toHaveBeenCalled();
    expect(resolver.resolveForOrganization).not.toHaveBeenCalled();
  });

  it('validates the selected organization store before fiscal resolution and preserves that scope', async () => {
    const context = await contexts.resolveOrganization(21);

    expect(prisma.stores.findFirst).toHaveBeenCalledWith({
      where: { id: 21, organization_id: 3, is_active: true },
      select: { id: true },
    });
    expect(resolver.resolveForOrganization).toHaveBeenCalledWith({ store_id: 21 });
    expect(context).toEqual({
      organization_id: 3,
      accounting_entity_id: 8,
      store_id: 21,
      actor_id: 55,
      is_organization: true,
    });
  });

  it('rejects a foreign store before passing scope to the fiscal resolver', async () => {
    prisma.stores.findFirst.mockResolvedValue(null);

    await expect(contexts.resolveOrganization(999)).rejects.toThrow(ForbiddenException);
    expect(resolver.resolveForOrganization).not.toHaveBeenCalled();
  });

  it('inherits STORE fiscal-scope selection requirements from FiscalContextResolverService', async () => {
    const actualResolver = new FiscalContextResolverService(
      {} as GlobalPrismaService,
      { requireFiscalScope: jest.fn().mockResolvedValue('STORE') } as unknown as FiscalScopeService,
      { requireOperatingScope: jest.fn().mockResolvedValue('ORGANIZATION') } as unknown as OperatingScopeService,
    );
    const actualContexts = new ReceivedDocumentsContextService(
      actualResolver,
      prisma as unknown as GlobalPrismaService,
    );

    await expect(actualContexts.resolveOrganization()).rejects.toThrow(BadRequestException);
  });

  it('validates the optional selected-store query scope as a positive integer', async () => {
    const invalid = plainToInstance(ReceivedDocumentContextQueryDto, { store_id: '0' });
    const errors = await validate(invalid);

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'store_id' }),
    ]));
  });
});

describe('ReceivedDocumentsContextService read-only nullable fiscal context', () => {
  let requestSpy: jest.SpyInstance;
  function readHarness(fiscalScope: 'STORE' | 'ORGANIZATION' = 'ORGANIZATION') {
    const baseClient = {
      accounting_entities: { findFirst: jest.fn().mockResolvedValue({ id: 8 }), upsert: jest.fn() },
    };
    const db = {
      organizations: { findFirst: jest.fn().mockResolvedValue({ id: 3 }) },
      stores: { findFirst: jest.fn().mockResolvedValue({ id: 21 }) },
      withoutScope: jest.fn(() => baseClient),
    };
    const fiscalScopes = {
      requireFiscalScope: jest.fn().mockResolvedValue(fiscalScope),
      findFiscalAccountingEntityId: jest.fn().mockResolvedValue(8),
      assertValidScopeCombination: jest.fn(),
      ensureFiscalAccountingEntity: jest.fn(),
    };
    const operatingScopes = { requireOperatingScope: jest.fn().mockResolvedValue('ORGANIZATION') };
    const writerResolver = { resolveForStore: jest.fn(), resolveForOrganization: jest.fn() };
    const service = new ReceivedDocumentsContextService(writerResolver as unknown as FiscalContextResolverService, db as unknown as GlobalPrismaService);
    Object.assign(service, { fiscalScopes, operatingScopes });
    return { service, db, baseClient, fiscalScopes, writerResolver };
  }
  beforeEach(() => { requestSpy = jest.spyOn(RequestContextService, 'getContext').mockReturnValue(authenticatedRequest); });
  afterEach(() => requestSpy.mockRestore());

  it('uses a canonical active read predicate and never creates or upserts an entity', async () => {
    const h = readHarness();
    expect(await h.service.resolveStoreRead()).toEqual({
      organization_id: 3, store_id: 21, accounting_entity_id: 8, actor_id: 55,
      is_organization: false, fiscal_scope: 'ORGANIZATION',
    });
    expect(h.db).not.toHaveProperty('accounting_entities');
    expect(h.db.withoutScope).toHaveBeenCalledTimes(1);
    expect(h.baseClient.accounting_entities.findFirst).toHaveBeenCalledWith({
      where: { id: 8, organization_id: 3, store_id: null, scope: 'ORGANIZATION', fiscal_scope: 'ORGANIZATION', is_active: true }, select: { id: true },
    });
    expect(h.baseClient.accounting_entities.upsert).not.toHaveBeenCalled();
    expect(h.fiscalScopes.ensureFiscalAccountingEntity).not.toHaveBeenCalled();
    expect(h.writerResolver.resolveForStore).not.toHaveBeenCalled();
    expect(h.writerResolver.resolveForOrganization).not.toHaveBeenCalled();
  });

  it('returns a nullable entity for absent or inactive setup instead of failing authorization', async () => {
    const missing = readHarness();
    missing.fiscalScopes.findFiscalAccountingEntityId.mockResolvedValue(null);
    expect((await missing.service.resolveStoreRead()).accounting_entity_id).toBeNull();
    expect(missing.baseClient.accounting_entities.findFirst).not.toHaveBeenCalled();
    expect(missing.db.withoutScope).not.toHaveBeenCalled();
    const inactive = readHarness();
    inactive.baseClient.accounting_entities.findFirst.mockResolvedValue(null);
    expect((await inactive.service.resolveStoreRead()).accounting_entity_id).toBeNull();
    expect(inactive.baseClient.accounting_entities.upsert).not.toHaveBeenCalled();
  });

  it('rejects a foreign/inactive store before fiscal lookup', async () => {
    const h = readHarness();
    h.db.stores.findFirst.mockResolvedValue(null);
    await expect(h.service.resolveOrganizationRead(999)).rejects.toThrow(ForbiddenException);
    expect(h.db.stores.findFirst).toHaveBeenCalledWith({ where: { id: 999, organization_id: 3, is_active: true }, select: { id: true } });
    expect(h.fiscalScopes.findFiscalAccountingEntityId).not.toHaveBeenCalled();
  });

  it('rejects missing authentication or an inactive organization before querying documents', async () => {
    const h = readHarness();
    requestSpy.mockReturnValue(undefined);
    await expect(h.service.resolveStoreRead()).rejects.toThrow(ForbiddenException);
    await expect(h.service.resolveOrganizationRead()).rejects.toThrow(ForbiddenException);
    expect(h.db.organizations.findFirst).not.toHaveBeenCalled();
    requestSpy.mockReturnValue(authenticatedRequest);
    h.db.organizations.findFirst.mockResolvedValue(null);
    await expect(h.service.resolveStoreRead()).rejects.toThrow(ForbiddenException);
    expect(h.fiscalScopes.findFiscalAccountingEntityId).not.toHaveBeenCalled();
  });

  it('does not accidentally resolve a consolidated entity when STORE fiscal scope has no selected store', async () => {
    const h = readHarness('STORE');
    expect(await h.service.resolveOrganizationRead()).toMatchObject({ accounting_entity_id: null, store_id: null, fiscal_scope: 'STORE' });
    expect(h.fiscalScopes.findFiscalAccountingEntityId).not.toHaveBeenCalled();
    expect(h.writerResolver.resolveForOrganization).not.toHaveBeenCalled();
  });

  it('preserves selected operational scope for both fiscal modes and invalid-scope enforcement', async () => {
    const h = readHarness('STORE');
    expect(await h.service.resolveOrganizationRead(21)).toMatchObject({ store_id: 21, accounting_entity_id: 8 });
    expect(h.baseClient.accounting_entities.findFirst).toHaveBeenCalledWith({
      where: { id: 8, organization_id: 3, store_id: 21, scope: 'STORE', fiscal_scope: 'STORE', is_active: true }, select: { id: true },
    });
    h.fiscalScopes.assertValidScopeCombination.mockImplementation(() => { throw new BadRequestException('Invalid scopes'); });
    await expect(h.service.resolveOrganizationRead(21)).rejects.toThrow(BadRequestException);
  });
});
