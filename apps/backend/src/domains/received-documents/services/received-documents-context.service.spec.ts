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
