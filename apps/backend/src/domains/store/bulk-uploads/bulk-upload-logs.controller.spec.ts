import { BulkUploadLogsController } from './bulk-upload-logs.controller';
import { BulkUploadLogsService } from './bulk-upload-logs.service';
import { BulkUploadJobsService } from './bulk-upload-jobs.service';
import { ResponseService } from '@common/responses/response.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterBulkUploadDto } from './dto/bulk-upload-log.dto';

/**
 * QUI-1004 — consultar si un archivo está repetido o registrar una carga exige
 * el permiso de ESA carga, no basta con tener el de otra.
 */
describe('BulkUploadLogsController · permiso por tipo de carga', () => {
  const HASH = 'c'.repeat(64);
  let service: jest.Mocked<Pick<BulkUploadLogsService, 'findDuplicate' | 'register'>>;
  let jobs: jest.Mocked<
    Pick<BulkUploadJobsService, 'getType' | 'getView' | 'getActive' | 'getResults' | 'retry'>
  >;
  let controller: BulkUploadLogsController;

  const requestWith = (...names: string[]) => ({
    user: {
      id: 1,
      roles: ['manager'],
      permissions: names.map((name) => ({ name, status: 'active' })),
    },
  });

  beforeEach(() => {
    service = {
      findDuplicate: jest.fn().mockResolvedValue(null),
      register: jest.fn().mockResolvedValue({ id: 7, status: 'completed' }),
    };
    jobs = {
      getType: jest.fn().mockResolvedValue('products'),
      getView: jest.fn().mockResolvedValue({ id: 5, upload_type: 'products' } as any),
      getActive: jest.fn().mockResolvedValue(null),
      getResults: jest.fn().mockResolvedValue({ rows: [] }),
      retry: jest.fn().mockResolvedValue({ id: 5, status: 'queued' } as any),
    };
    controller = new BulkUploadLogsController(
      service as unknown as BulkUploadLogsService,
      new ResponseService(),
      jobs as unknown as BulkUploadJobsService,
    );
  });

  describe('QUI-1009 · trabajos durables', () => {
    it('jobs/active devuelve el trabajo activo del tipo con el permiso del tipo', async () => {
      await expect(
        controller.activeJob({ upload_type: 'products' }, requestWith('store:products:create')),
      ).resolves.toMatchObject({ success: true, data: null });
      expect(jobs.getActive).toHaveBeenCalledWith('products');
    });

    it('jobs/active de otro tipo sin su permiso: 403 y no consulta', async () => {
      await expect(
        controller.activeJob({ upload_type: 'customers' }, requestWith('store:products:create')),
      ).rejects.toMatchObject({ status: 403 });
      expect(jobs.getActive).not.toHaveBeenCalled();
    });

    it('jobs/:id, results y retry exigen el permiso del tipo de la FILA antes de leerla o reintentarla', async () => {
      jobs.getType.mockResolvedValue('employees');
      const req = requestWith('store:products:create');
      await expect(controller.jobStatus(5, req)).rejects.toMatchObject({ status: 403 });
      await expect(controller.jobResults(5, req)).rejects.toMatchObject({ status: 403 });
      await expect(controller.retryJob(5, req)).rejects.toMatchObject({ status: 403 });
      expect(jobs.getView).not.toHaveBeenCalled();
      expect(jobs.getResults).not.toHaveBeenCalled();
      expect(jobs.retry).not.toHaveBeenCalled();
    });

    it('con el permiso del tipo, jobs/:id, results y retry responden el envoltorio con los datos', async () => {
      const req = requestWith('store:products:create');
      await expect(controller.jobStatus(5, req)).resolves.toMatchObject({ data: { id: 5 } });
      await expect(controller.jobResults(5, req)).resolves.toMatchObject({ data: { rows: [] } });
      await expect(controller.retryJob(5, req)).resolves.toMatchObject({ data: { status: 'queued' } });
      expect(jobs.retry).toHaveBeenCalledWith(5);
    });

    it('una carga de otra tienda propaga el 404 del servicio', async () => {
      jobs.getType.mockRejectedValue(
        Object.assign(new Error('nf'), { status: 404, errorCode: 'BULK_JOB_NOT_FOUND' }),
      );
      await expect(controller.jobStatus(9, requestWith('store:products:create'))).rejects.toMatchObject({
        status: 404,
      });
    });

    it('las rutas de jobs se declaran antes de `:id`', () => {
      const names = Object.getOwnPropertyNames(BulkUploadLogsController.prototype);
      expect(names.indexOf('retryJob')).toBeGreaterThan(-1);
      expect(names.indexOf('activeJob')).toBeLessThan(names.indexOf('findOne'));
      expect(names.indexOf('retryJob')).toBeLessThan(names.indexOf('findOne'));
    });
  });

  it('con el permiso de compras consulta repetidos de compras', async () => {
    await expect(
      controller.checkDuplicate(
        { upload_type: 'purchase_orders', file_hash: HASH },
        requestWith('store:orders:purchase_orders:create'),
      ),
    ).resolves.toMatchObject({ data: { duplicate_of: null } });
    expect(service.findDuplicate).toHaveBeenCalledWith('purchase_orders', HASH);
  });

  it('con solo el permiso de productos NO consulta repetidos de compras: 403', async () => {
    await expect(
      controller.checkDuplicate(
        { upload_type: 'purchase_orders', file_hash: HASH },
        requestWith('store:products:create'),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(service.findDuplicate).not.toHaveBeenCalled();
  });

  it('registrar una carga de compras exige el permiso de compras', async () => {
    const dto = {
      upload_type: 'purchase_orders' as const,
      file_name: 'compras.xlsx',
      file_hash: HASH,
      total_rows: 1,
      successful_rows: 1,
      failed_rows: 0,
      skipped_rows: 0,
    };
    await expect(
      controller.register(dto, requestWith('store:customers:create')),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      controller.register(dto, requestWith('store:orders:purchase_orders:create')),
    ).resolves.toMatchObject({ data: { id: 7, status: 'completed' } });
  });

  it('QUI-1004: la importación Excel de notas de despacho se registra con el permiso de notas de despacho', async () => {
    const dto = {
      upload_type: 'dispatch_notes' as const,
      file_name: 'recibo.xlsx',
      file_hash: HASH,
      total_rows: 3,
      successful_rows: 3,
      failed_rows: 0,
      skipped_rows: 0,
      result_reference: 'RM-0001',
    };
    expect(
      await validate(plainToInstance(RegisterBulkUploadDto, dto)),
    ).toEqual([]);
    await expect(
      controller.register(dto, requestWith('store:orders:purchase_orders:create')),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      controller.register(dto, requestWith('store:dispatch_notes:create')),
    ).resolves.toMatchObject({ data: { id: 7, status: 'completed' } });
    expect(service.register).toHaveBeenCalledWith(dto);
  });
});
