import { BulkUploadLogsController } from './bulk-upload-logs.controller';
import { BulkUploadLogsService } from './bulk-upload-logs.service';
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
    controller = new BulkUploadLogsController(
      service as unknown as BulkUploadLogsService,
      new ResponseService(),
    );
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
