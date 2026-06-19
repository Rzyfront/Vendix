import { Prisma } from '@prisma/client';
import { RouteSheetScannerService } from './route-sheet-scanner.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';

/**
 * Unit tests for the route-sheet AI scanner.
 *
 * Dev has 0 ai_engine_configs, so the real AI returns AI_PROVIDER_002. We mock
 * AIEngineService with a fixture JSON, mock S3, and mock RouteFlowService.settleStop
 * (settlement is delegated, not reimplemented).
 */
describe('RouteSheetScannerService', () => {
  const STORE_ID = 100;
  const ROUTE_ID = 7;

  let service: RouteSheetScannerService;
  let aiMock: any;
  let prismaMock: any;
  let routeFlowMock: any;
  let s3Mock: any;

  // The AI app returns a JSON string matching the route_sheet_ocr schema.
  const AI_FIXTURE = JSON.stringify({
    stops: [
      {
        stop_sequence: 1,
        remision_number: 'REM-1',
        delivered: true,
        collected_amount: 200,
        payment_method: 'efectivo',
        notes: 'pagó completo',
      },
      {
        stop_sequence: 2,
        remision_number: 'REM-2',
        delivered: false,
        collected_amount: null,
        payment_method: null,
        notes: 'no estaba',
      },
    ],
    confidence: 92,
  });

  const file = (mimetype = 'image/jpeg'): Express.Multer.File =>
    ({
      buffer: Buffer.from('fake'),
      mimetype,
      originalname: 'planilla.jpg',
      size: 4,
    }) as Express.Multer.File;

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: STORE_ID,
      organization_id: 1,
      user_id: 1,
      is_super_admin: false,
    } as any);

    aiMock = {
      run: jest.fn().mockResolvedValue({
        success: true,
        content: AI_FIXTURE,
        model: 'MiniMax-VL-01',
      }),
    };

    prismaMock = {
      dispatch_routes: {
        findFirst: jest.fn().mockResolvedValue({ id: ROUTE_ID }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      dispatch_route_stops: {
        findMany: jest.fn(),
      },
    };

    routeFlowMock = { settleStop: jest.fn().mockResolvedValue({}) };
    s3Mock = { uploadFile: jest.fn().mockResolvedValue('s3/key/planilla.jpg') };

    service = new RouteSheetScannerService(
      aiMock as any,
      prismaMock as any,
      routeFlowMock as any,
      s3Mock as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('scanRouteSheet', () => {
    it('normalizes the AI fixture into a RouteSheetScanResult', async () => {
      const result = await service.scanRouteSheet(ROUTE_ID, file());

      expect(aiMock.run).toHaveBeenCalledWith(
        'route_sheet_ocr',
        {},
        expect.any(Array),
      );
      expect(result.confidence).toBe(92);
      expect(result.stops).toHaveLength(2);
      // payment_method normalized efectivo → cash
      expect(result.stops[0]).toMatchObject({
        stop_sequence: 1,
        remision_number: 'REM-1',
        delivered: true,
        collected_amount: 200,
        payment_method: 'cash',
      });
      // not delivered, no amount
      expect(result.stops[1]).toMatchObject({
        delivered: false,
        collected_amount: null,
        payment_method: null,
      });
    });

    it('throws RTSCAN_NO_FILE when no file is provided', async () => {
      await expect(
        service.scanRouteSheet(ROUTE_ID, undefined as any),
      ).rejects.toBeInstanceOf(VendixHttpException);
    });

    it('throws RTSCAN_AI_FAIL when the AI call fails', async () => {
      aiMock.run.mockResolvedValueOnce({ success: false, error: 'boom' });
      await expect(
        service.scanRouteSheet(ROUTE_ID, file()),
      ).rejects.toBeInstanceOf(VendixHttpException);
    });

    it('throws RTSCAN_PARSE_FAIL when the AI returns invalid JSON', async () => {
      aiMock.run.mockResolvedValueOnce({ success: true, content: 'not json' });
      await expect(
        service.scanRouteSheet(ROUTE_ID, file()),
      ).rejects.toBeInstanceOf(VendixHttpException);
    });
  });

  describe('matchStops', () => {
    it('maps extracted rows to real stops by remision then sequence', async () => {
      prismaMock.dispatch_route_stops.findMany.mockResolvedValue([
        {
          id: 51,
          stop_sequence: 1,
          status: 'pending',
          result: null,
          collected_amount: new Prisma.Decimal(0),
          dispatch_note: {
            dispatch_number: 'REM-1',
            grand_total: new Prisma.Decimal(200),
          },
        },
        {
          id: 52,
          stop_sequence: 2,
          status: 'pending',
          result: null,
          collected_amount: new Prisma.Decimal(0),
          dispatch_note: {
            dispatch_number: 'REM-2',
            grand_total: new Prisma.Decimal(150),
          },
        },
      ]);

      const scan = await service.scanRouteSheet(ROUTE_ID, file());
      const match = await service.matchStops(ROUTE_ID, scan);

      expect(match.stops).toHaveLength(2);
      expect(match.stops[0]).toMatchObject({
        stop_id: 51,
        match_method: 'remision',
        suggested_result: 'delivered',
      });
      expect(match.stops[1]).toMatchObject({
        stop_id: 52,
        suggested_result: 'rejected',
      });
      expect(match.warnings).toHaveLength(0);
    });

    it('throws RTSCAN_MATCH_001 when no row maps to any stop', async () => {
      prismaMock.dispatch_route_stops.findMany.mockResolvedValue([
        {
          id: 99,
          stop_sequence: 9,
          status: 'pending',
          result: null,
          collected_amount: new Prisma.Decimal(0),
          dispatch_note: {
            dispatch_number: 'REM-ZZZ',
            grand_total: new Prisma.Decimal(10),
          },
        },
      ]);

      const scan: any = {
        stops: [
          {
            stop_sequence: 5,
            remision_number: 'NOPE',
            delivered: true,
            collected_amount: 1,
            payment_method: 'cash',
            notes: null,
          },
        ],
        confidence: 80,
      };

      await expect(
        service.matchStops(ROUTE_ID, scan),
      ).rejects.toBeInstanceOf(VendixHttpException);
    });
  });

  describe('confirmAndSettle', () => {
    it('settles confirmed stops and persists planilla_pdf_key + scan_confidence', async () => {
      prismaMock.dispatch_route_stops.findMany.mockResolvedValue([
        {
          id: 51,
          dispatch_note: { grand_total: new Prisma.Decimal(200) },
        },
        {
          id: 52,
          dispatch_note: { grand_total: new Prisma.Decimal(150) },
        },
      ]);

      const dto: any = {
        stops: [
          { stop_id: 51, delivered: true, collected_amount: 200 },
          { stop_id: 52, delivered: false, collected_amount: 0 },
        ],
        scan_result: { stops: [], confidence: 92 },
      };

      const result = await service.confirmAndSettle(ROUTE_ID, file(), dto);

      // settleStop delegated (NOT reimplemented), once per confirmed stop.
      expect(routeFlowMock.settleStop).toHaveBeenCalledTimes(2);
      expect(routeFlowMock.settleStop).toHaveBeenCalledWith(
        ROUTE_ID,
        51,
        expect.objectContaining({ result: 'delivered', collected_amount: 200 }),
      );
      expect(routeFlowMock.settleStop).toHaveBeenCalledWith(
        ROUTE_ID,
        52,
        expect.objectContaining({ result: 'rejected' }),
      );

      // S3 upload stores the KEY.
      expect(s3Mock.uploadFile).toHaveBeenCalledTimes(1);

      // Persist scan metadata, store-scoped.
      expect(prismaMock.dispatch_routes.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ROUTE_ID, store_id: STORE_ID },
          data: expect.objectContaining({
            planilla_pdf_key: 's3/key/planilla.jpg',
            scan_confidence: 92,
            planilla_scanned_at: expect.any(Date),
          }),
        }),
      );

      expect(result.planilla_pdf_key).toBe('s3/key/planilla.jpg');
      expect(result.settled).toHaveLength(2);
    });
  });
});
