import { RouteFlowController } from './route-flow.controller';

// The async-scan job service drags the e-mail stack in; this spec only needs
// the controller's own validation.
jest.mock('@common/ai-scan-jobs/ai-scan-job.service', () => ({
  AiScanJobService: class {},
}));

/**
 * `POST :id/scan/confirm` arrives as multipart, so the global ValidationPipe
 * never sees the DTO. The controller validates it itself: a value that does
 * not fit its column (the P2020 of the incident) must be a 400 BEFORE the
 * scanner — and therefore the database — is ever reached.
 */
describe('RouteFlowController.confirmRouteSheet (validación del multipart)', () => {
  let controller: RouteFlowController;
  let scanner: any;
  let response: any;

  const file = {
    buffer: Buffer.from([0xff, 0xd8, 0xff]),
    mimetype: 'image/jpeg',
    originalname: 'p.jpg',
    size: 3,
  } as Express.Multer.File;

  beforeEach(() => {
    scanner = { confirmAndSettle: jest.fn().mockResolvedValue({ settled: [] }) };
    response = { success: jest.fn((d) => ({ success: true, data: d })) };
    controller = new RouteFlowController(
      {} as any,
      scanner,
      {} as any,
      {} as any,
      response,
    );
  });

  const confirm = (stops: unknown, scan_result?: unknown) =>
    controller.confirmRouteSheet(7, file, {
      stops: JSON.stringify(stops),
      ...(scan_result ? { scan_result: JSON.stringify(scan_result) } : {}),
    });

  it.each([
    ['monto mayor a Decimal(14,2)', { stop_id: 1, result: 'delivered', collected_amount: 1e13 }],
    ['monto negativo', { stop_id: 1, result: 'delivered', collected_amount: -5 }],
    ['monto con 3 decimales', { stop_id: 1, result: 'delivered', collected_amount: 1.005 }],
    ['stop_id fuera de int4', { stop_id: 3_000_000_000, result: 'delivered' }],
    ['retención fuera de rango', { stop_id: 1, result: 'delivered', withholding_breakdown: { retefuente: 1e13 } }],
    ['resultado inválido', { stop_id: 1, result: 'partial' }],
    ['método de pago > 40', { stop_id: 1, result: 'delivered', payment_method: 'x'.repeat(41) }],
  ])('%s → 400 RTSCAN_CONFIRM_INVALID sin llegar al scanner', async (_label, stop) => {
    await expect(confirm([stop])).rejects.toMatchObject({
      errorCode: 'RTSCAN_CONFIRM_INVALID',
    });
    expect(scanner.confirmAndSettle).not.toHaveBeenCalled();
  });

  it('JSON inválido → 400 claro', async () => {
    await expect(
      controller.confirmRouteSheet(7, file, { stops: '[{oops' }),
    ).rejects.toMatchObject({ errorCode: 'RTSCAN_CONFIRM_INVALID' });
    expect(scanner.confirmAndSettle).not.toHaveBeenCalled();
  });

  it('payload válido llega tipado al scanner (montos numéricos, motivo)', async () => {
    await confirm(
      [
        { stop_id: 1, result: 'delivered', collected_amount: '150.50', payment_method: 'cash' },
        { stop_id: 2, result: 'rejected', reason: 'Cerrado' },
      ],
      { stops: [], confidence: 92 },
    );

    expect(scanner.confirmAndSettle).toHaveBeenCalledTimes(1);
    const dto = scanner.confirmAndSettle.mock.calls[0][2];
    expect(dto.stops[0]).toMatchObject({ stop_id: 1, collected_amount: 150.5 });
    expect(dto.stops[1]).toMatchObject({ stop_id: 2, result: 'rejected', reason: 'Cerrado' });
    expect(dto.scan_result).toMatchObject({ confidence: 92 });
  });
});
