import { BadRequestException } from '@nestjs/common';
import { LegalDocumentsService } from './legal-documents.service';

describe('LegalDocumentsService.createSystemDocument', () => {
  let service: LegalDocumentsService;
  let prisma: any;
  let audit: any;
  let s3: any;

  const dto: any = {
    document_type: 'PRIVACY_POLICY',
    title: 'Política de privacidad',
    version: '1.0',
    content: '# Privacidad',
    effective_date: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    prisma = {
      legal_documents: {
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 10 }),
      },
    };
    audit = { logCreate: jest.fn().mockResolvedValue(undefined) };
    s3 = { uploadFile: jest.fn().mockResolvedValue('key') };
    service = new LegalDocumentsService(prisma, audit, s3);
  });

  it('permite la misma versión en un tipo de documento distinto', async () => {
    prisma.legal_documents.findFirst.mockResolvedValue(null);

    await service.createSystemDocument(1, dto);

    expect(prisma.legal_documents.findFirst).toHaveBeenCalledWith({
      where: {
        version: '1.0',
        document_type: 'PRIVACY_POLICY',
        is_system: true,
        organization_id: null,
        store_id: null,
      },
    });
    expect(prisma.legal_documents.create).toHaveBeenCalledTimes(1);
  });

  it('rechaza la misma versión del mismo tipo sin subir a S3 ni crear', async () => {
    prisma.legal_documents.findFirst.mockResolvedValue({ id: 1 });

    await expect(service.createSystemDocument(1, dto)).rejects.toThrow(
      BadRequestException,
    );
    expect(s3.uploadFile).not.toHaveBeenCalled();
    expect(prisma.legal_documents.create).not.toHaveBeenCalled();
  });
});

/**
 * Aceptación de documentos del sistema: población = usuarios de Vendix. Los
 * clientes finales de las tiendas no entran ni en el denominador, ni en las
 * aceptaciones contadas, ni en los listados de pendientes/aceptaciones.
 */
describe('LegalDocumentsService — acceptance over Vendix users only', () => {
  const vendixUser = {
    user_roles: { some: { roles: { name: { not: 'customer' } } } },
  };
  let service: LegalDocumentsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      users: {
        count: jest.fn().mockResolvedValue(4),
        findMany: jest.fn().mockResolvedValue([]),
      },
      document_acceptances: {
        groupBy: jest.fn().mockResolvedValue([
          { acceptance_version: '1.0', _count: { acceptance_version: 3 } },
        ]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      legal_documents: {
        findFirst: jest.fn().mockResolvedValue({ id: 10, version: '1.0' }),
      },
    };
    service = new LegalDocumentsService(prisma, {} as any, {} as any);
  });

  it('computes the acceptance rate over Vendix users on both sides', async () => {
    const result = await service.getAcceptanceStats(10);

    expect(prisma.users.count).toHaveBeenCalledWith({
      where: { AND: [vendixUser, { state: 'active', email_verified: true }] },
    });
    expect(prisma.document_acceptances.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { document_id: 10, user: vendixUser },
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        total_users: 4,
        total_acceptances: 3,
        acceptance_rate: 0.75,
      }),
    );
  });

  it('lists pending users only among Vendix users', async () => {
    prisma.users.findMany.mockResolvedValue([
      { id: 5, email: 'ana@example.com', document_acceptances: [] },
    ]);

    const result = await service.getUsersPendingAcceptance(
      'TERMS_OF_SERVICE' as any,
    );

    expect(prisma.users.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [vendixUser, { state: 'active', email_verified: true }] },
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({ id: 5, required_version: '1.0' }),
    ]);
  });

  it('lists acceptances only from Vendix users', async () => {
    await service.getDocumentAcceptances(10);

    expect(prisma.document_acceptances.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { document_id: 10, user: vendixUser },
      }),
    );
  });
});
