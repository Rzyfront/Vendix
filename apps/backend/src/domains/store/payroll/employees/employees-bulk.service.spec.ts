import * as XLSX from 'xlsx';
import { EmployeesBulkService } from './employees-bulk.service';
import { RequestContextService } from '@common/context/request-context.service';

describe('EmployeesBulkService — sesion paginada y tope', () => {
  const mockS3 = {
    uploadFile: jest.fn(),
    downloadImage: jest.fn(),
    deleteFile: jest.fn(),
  };
  let service: EmployeesBulkService;

  const xlsx = (n: number): Buffer => {
    const header = ['Nombre', 'Apellido', 'Número Documento'];
    const rows = Array.from({ length: n }, (_, i) => [
      `Nombre${i}`,
      `Apellido${i}`,
      `DOC-${i}`,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  };

  let uploadSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new EmployeesBulkService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      mockS3 as any,
      {} as any,
    );
    uploadSpy = jest
      .spyOn(service, 'uploadEmployees')
      .mockImplementation(async (dto: any) => ({
        success: true,
        total_processed: dto.employees.length,
        successful: dto.employees.length,
        failed: 0,
        updated: 0,
        associated: 0,
        users_created: 0,
        users_linked: 0,
        results: [],
      }));
  });

  it('pagina offset=100 limit=100 procesa solo las filas 100..199', async () => {
    mockS3.downloadImage.mockResolvedValue(xlsx(250));

    const res: any = await service.uploadFromSession(
      'sid',
      3,
      {},
      {
        offset: 100,
        limit: 100,
      },
    );

    const sent = uploadSpy.mock.calls[0][0].employees;
    expect(sent).toHaveLength(100);
    expect(sent[0].document_number).toBe('DOC-100');
    expect(sent[99].document_number).toBe('DOC-199');
    expect(res).toMatchObject({
      total: 250,
      offset: 100,
      limit: 100,
      done: false,
    });
    expect(mockS3.deleteFile).not.toHaveBeenCalled();
  });

  it('ultima pagina: done=true borra el archivo', async () => {
    mockS3.downloadImage.mockResolvedValue(xlsx(150));

    const res: any = await service.uploadFromSession(
      'sid',
      3,
      {},
      {
        offset: 100,
        limit: 100,
      },
    );

    expect(res.done).toBe(true);
    expect(mockS3.deleteFile).toHaveBeenCalledWith(
      'tmp/bulk-employees/3/sid.xlsx',
    );
  });

  it('si la pagina falla, el archivo NO se borra', async () => {
    mockS3.downloadImage.mockResolvedValue(xlsx(50));
    uploadSpy.mockRejectedValue(new Error('boom'));

    await expect(
      service.uploadFromSession('sid', 3, {}, { offset: 0, limit: 100 }),
    ).rejects.toThrow('boom');
    expect(mockS3.deleteFile).not.toHaveBeenCalled();
  });

  it('sesion expirada: error claro', async () => {
    mockS3.downloadImage.mockRejectedValue(new Error('NoSuchKey'));

    await expect(
      service.uploadFromSession('sid', 3, {}, { offset: 0, limit: 100 }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        error_code: 'BULK_PROD_SESSION_EXPIRED',
      }),
    });
  });

  it('sin offset/limit: modo legacy completo y borra el archivo', async () => {
    mockS3.downloadImage.mockResolvedValue(xlsx(5));

    const res: any = await service.uploadFromSession('sid', 3, {});

    expect(uploadSpy.mock.calls[0][0].employees).toHaveLength(5);
    expect(res.done).toBeUndefined();
    expect(mockS3.deleteFile).toHaveBeenCalledTimes(1);
  });

  describe('tope de 10000', () => {
    const batch = (n: number) => ({
      employees: Array.from({ length: n }, (_, i) => ({
        document_number: `D${i}`,
      })) as any[],
    });

    beforeEach(() => {
      uploadSpy.mockRestore();
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        store_id: 3,
        organization_id: 1,
      } as any);
    });

    it('rechaza 10001 filas en uploadEmployees', async () => {
      await expect(
        service.uploadEmployees(batch(10001) as any, {}),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'PAYROLL_BULK_001' }),
      });
    });

    it('analyze rechaza 10001 filas y acepta pasar el tope con 10000', async () => {
      await expect(
        service.analyzeEmployees(xlsx(10001), 3, 1),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error_code: 'BULK_PROD_LIMIT_EXCEEDED',
        }),
      });
      // 10000 no dispara el limite: llega al prefetch (prisma vacio => otro error)
      await expect(
        service.analyzeEmployees(xlsx(10000), 3, 1),
      ).rejects.not.toMatchObject({
        response: expect.objectContaining({
          error_code: 'BULK_PROD_LIMIT_EXCEEDED',
        }),
      });
    }, 60000);
  });
});
