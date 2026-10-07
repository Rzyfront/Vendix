import { RouteFlowController } from './route-flow.controller';
import { RouteSheetScannerService } from './route-sheet-scanner.service';
import { VendixHttpException } from '@common/errors';

describe('RouteFlowController.scanRouteSheetAsync', () => {
  let controller: RouteFlowController;
  let scanner: any;
  let routes: any;
  let jobs: any;
  let response: any;

  const file = (mimetype = 'image/jpeg') =>
    ({
      buffer: Buffer.from('x'),
      mimetype,
      originalname: 'p.jpg',
      size: 1,
    }) as Express.Multer.File;

  beforeEach(() => {
    // scanner real solo para validacion/conversion (sin dependencias en esos metodos)
    scanner = Object.create(RouteSheetScannerService.prototype);
    routes = { findOne: jest.fn().mockResolvedValue({ id: 7 }) };
    jobs = { enqueue: jest.fn().mockResolvedValue({ job_id: 'j1' }) };
    response = { success: jest.fn((d) => ({ success: true, data: d })) };
    controller = new RouteFlowController(
      {} as any,
      scanner,
      routes,
      jobs,
      response,
    );
  });

  it('mime invalido -> VendixHttpException sin encolar', async () => {
    await expect(
      controller.scanRouteSheetAsync(7, file('text/plain')),
    ).rejects.toBeInstanceOf(VendixHttpException);
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('ruta inexistente -> error sin encolar', async () => {
    routes.findOne.mockRejectedValue(new Error('404'));
    await expect(controller.scanRouteSheetAsync(7, file())).rejects.toThrow(
      '404',
    );
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('OK -> enqueue route_sheet con {route_id} y devuelve job_id', async () => {
    const res = await controller.scanRouteSheetAsync(7, file());
    expect(jobs.enqueue).toHaveBeenCalledWith(
      'route_sheet',
      [
        {
          buffer: expect.any(Buffer),
          mimeType: 'image/jpeg',
          originalName: 'p.jpg',
          size: 1,
        },
      ],
      { route_id: 7 },
    );
    expect(res).toEqual({ success: true, data: { job_id: 'j1' } });
  });
});
