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
