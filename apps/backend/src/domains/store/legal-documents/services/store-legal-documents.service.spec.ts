import { BadRequestException } from '@nestjs/common';
import { StoreLegalDocumentsService } from './store-legal-documents.service';
import { RequestContextService } from '../../../../common/context/request-context.service';

describe('StoreLegalDocumentsService.createDocument', () => {
  let service: StoreLegalDocumentsService;
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
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(5);
    jest.spyOn(RequestContextService, 'getOrganizationId').mockReturnValue(2);
    service = new StoreLegalDocumentsService(prisma, audit, s3);
  });

  afterEach(() => jest.restoreAllMocks());

  it('permite la misma versión en un tipo de documento distinto', async () => {
    prisma.legal_documents.findFirst.mockResolvedValue(null);

    await service.createDocument(1, dto);

    expect(prisma.legal_documents.findFirst).toHaveBeenCalledWith({
      where: { version: '1.0', store_id: 5, document_type: 'PRIVACY_POLICY' },
    });
    expect(prisma.legal_documents.create).toHaveBeenCalledTimes(1);
  });

  it('rechaza la misma versión del mismo tipo sin subir a S3 ni crear', async () => {
    prisma.legal_documents.findFirst.mockResolvedValue({ id: 1 });

    await expect(service.createDocument(1, dto)).rejects.toThrow(
      BadRequestException,
    );
    expect(s3.uploadFile).not.toHaveBeenCalled();
    expect(prisma.legal_documents.create).not.toHaveBeenCalled();
  });
});
