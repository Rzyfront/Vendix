import { Prisma } from '@prisma/client';
import { RouteSheetScannerService } from './route-sheet-scanner.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { AiExtractionService } from '@common/ai-ingest/extraction/ai-extraction.service';
import { ROUTE_SHEET_IMAGE_INSTRUCTION } from './route-sheet-ingest.profile';

// ia-cargas F5a: the type is detected by signature, so the bytes are real.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PDF = Buffer.from('%PDF-1.7 planilla');
const IMG = 'data:image/jpeg;base64,/9j/AAAA';

/**
 * Unit tests for the route-sheet AI scanner.
 *
 * Dev has 0 ai_engine_configs, so the real AI returns AI_PROVIDER_002. We mock
 * AIEngineService with a fixture JSON, mock S3, and mock RouteFlowService.settleStopsAtomically
 * (settlement is delegated, not reimplemented; the mock runs the caller's
 * extra writes against a fake `tx`, like the real single transaction).
 */
describe('RouteSheetScannerService', () => {
  const STORE_ID = 100;
  const ROUTE_ID = 7;

  let service: RouteSheetScannerService;
  let aiMock: any;
  let prismaMock: any;
  let routeFlowMock: any;
  let dispatchRoutesMock: any;
  let s3Mock: any;
  let registryMock: any;
  let pagesMock: any;
  let txMock: any;

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
      buffer: JPEG,
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

    // tx fake: the scan metadata is written through the transaction client.
    txMock = {
      dispatch_routes: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    routeFlowMock = {
      settleStopsAtomically: jest.fn(
        async (_id: number, items: any[], extra?: (tx: any) => Promise<void>) => {
          if (extra) await extra(txMock);
          return items.map((i) => ({
            stop_id: i.stop_id,
            result: i.kind === 'release' ? 'released' : i.dto.result,
          }));
        },
      ),
    };
    // confirmAndSettle re-reads the route via DispatchRoutesService.findOne to
    // return the updated route in its response.
    dispatchRoutesMock = {
      findOne: jest.fn().mockResolvedValue({ id: ROUTE_ID, status: 'in_transit' }),
    };
    s3Mock = {
      uploadFile: jest.fn().mockResolvedValue('s3/key/planilla.jpg'),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };

    registryMock = { register: jest.fn() };
    pagesMock = {
      prepareForAi: jest.fn().mockResolvedValue({
        source: 'image',
        pages: [{ page_number: 1, mode: 'image', text: '', image: IMG }],
        page_count: 1,
        unreadable_pages: [],
      }),
    };

    service = new RouteSheetScannerService(
      new AiExtractionService(aiMock as any),
      prismaMock as any,
      routeFlowMock as any,
      dispatchRoutesMock as any,
      s3Mock as any,
      registryMock as any,
      pagesMock as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('scanRouteSheetFromFiles / registro async', () => {
    const scanFile = (mimeType = 'image/jpeg') => ({
      buffer: JPEG,
      mimeType,
      originalName: 'planilla.jpg',
      size: 4,
    });

    it('da el mismo resultado que el escaneo sincrono', async () => {
      const sync = await service.scanRouteSheet(ROUTE_ID, file());
      const viaFiles = await service.scanRouteSheetFromFiles([scanFile()], {
        route_id: ROUTE_ID,
      });
      expect(viaFiles).toEqual(sync);
    });

    it('rechaza mime invalido y archivo ausente', async () => {
      await expect(
        service.scanRouteSheetFromFiles([{ ...scanFile('text/plain'), buffer: Buffer.from('hola') }], {
          route_id: ROUTE_ID,
        }),
      ).rejects.toBeInstanceOf(VendixHttpException);
      await expect(
        service.scanRouteSheetFromFiles([], { route_id: ROUTE_ID }),
      ).rejects.toBeInstanceOf(VendixHttpException);
    });

    it('onModuleInit registra route_sheet y delega al nucleo', async () => {
      service.onModuleInit();
      expect(registryMock.register).toHaveBeenCalledWith(
        'route_sheet',
        expect.any(Function),
      );
      const handler = registryMock.register.mock.calls[0][1];
      const spy = jest.spyOn(service, 'scanRouteSheetFromFiles');
      const files = [scanFile()];
      await handler({ files, params: { route_id: ROUTE_ID }, context: {} });
      expect(spy).toHaveBeenCalledWith(files, { route_id: ROUTE_ID }, undefined);
    });
  });

  describe('scanRouteSheet', () => {
    it('normalizes the AI fixture into a RouteSheetScanResult', async () => {
      const result = await service.scanRouteSheet(ROUTE_ID, file());

      expect(aiMock.run).toHaveBeenCalledWith(
        'route_sheet_ocr',
        {},
        expect.any(Array),
        expect.objectContaining({ responseSchema: expect.any(Object) }),
      );
      // A photo gets the exact request of always, as a prepared JPEG.
      const content = aiMock.run.mock.calls[0][2][0].content;
      expect(content[0]).toEqual({ type: 'text', text: ROUTE_SHEET_IMAGE_INSTRUCTION });
      expect(content[2]).toEqual({ type: 'image_url', image_url: { url: IMG, detail: 'high' } });
      expect(result.scan_source).toEqual({ pages: 1, text_pages: 0, batches: 1 });
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

    it('throws RTSCAN_AI_FAIL (code kept) when the AI call fails', async () => {
      aiMock.run.mockResolvedValueOnce({ success: false, error: 'boom' });
      await expect(service.scanRouteSheet(ROUTE_ID, file())).rejects.toMatchObject({
        errorCode: 'RTSCAN_AI_FAIL',
      });
    });

    it('repairs an invalid JSON once; a second invalid answer is RTSCAN_PARSE_FAIL', async () => {
      aiMock.run.mockResolvedValueOnce({ success: true, content: 'not json' });
      const repaired = await service.scanRouteSheet(ROUTE_ID, file());
      expect(aiMock.run).toHaveBeenCalledTimes(2);
      expect(repaired.stops).toHaveLength(2);

      aiMock.run.mockReset();
      aiMock.run.mockResolvedValue({ success: true, content: 'not json' });
      await expect(service.scanRouteSheet(ROUTE_ID, file())).rejects.toMatchObject({
        errorCode: 'RTSCAN_PARSE_FAIL',
      });
      // An answer without the stops list is also repaired, then a parse failure.
      aiMock.run.mockReset();
      aiMock.run.mockResolvedValue({ success: true, content: '{"confidence": 80}' });
      await expect(service.scanRouteSheet(ROUTE_ID, file())).rejects.toMatchObject({
        errorCode: 'RTSCAN_PARSE_FAIL',
      });
    });

    it('a PDF is read by pages (native text first, never the raw PDF); 7 pages → 2 calls merged', async () => {
      pagesMock.prepareForAi.mockResolvedValue({
        source: 'pdf',
        pages: Array.from({ length: 7 }, (_, i) => ({
          page_number: i + 1,
          mode: 'text',
          text: `PLANILLA pagina ${i + 1} ` + 'x'.repeat(220),
        })),
        page_count: 7,
        unreadable_pages: [],
      });
      aiMock.run.mockImplementation(async (_app: string, _v: unknown, messages: any[]) => {
        const text = JSON.stringify(messages[0].content);
        const first = text.includes('pages 1-5');
        return {
          success: true,
          content: JSON.stringify({
            stops: [{ stop_sequence: first ? 1 : 2, remision_number: first ? 'REM-1' : 'REM-2', delivered: true, collected_amount: 100 }],
            confidence: first ? 90 : 70,
          }),
        };
      });

      const result = await service.scanRouteSheet(ROUTE_ID, {
        buffer: PDF,
        mimetype: 'application/pdf',
        originalname: 'planilla.pdf',
        size: PDF.length,
      } as any);

      expect(pagesMock.prepareForAi).toHaveBeenCalledWith(
        expect.objectContaining({ mimetype: 'application/pdf' }),
        expect.objectContaining({ maxPages: 10, splitTallImages: false }),
      );
      expect(aiMock.run).toHaveBeenCalledTimes(2);
      const sent = JSON.stringify(aiMock.run.mock.calls.map((c: any[]) => c[2]));
      expect(sent).not.toContain('application/pdf');
      expect(sent).not.toContain('image_url');
      expect(result.stops.map((s) => s.remision_number)).toEqual(['REM-1', 'REM-2']);
      expect(result.confidence).toBe(70);
      expect(result.scan_source).toEqual({ pages: 7, text_pages: 7, batches: 2 });
    });

    it('document problems arrive as AI_INGEST_* (too many pages)', async () => {
      const { ErrorCodes } = jest.requireActual('@common/errors');
      pagesMock.prepareForAi.mockRejectedValue(
        new VendixHttpException(ErrorCodes.AI_INGEST_TOO_MANY_PAGES, 'El PDF excede el máximo de 10 páginas.'),
      );
      await expect(
        service.scanRouteSheet(ROUTE_ID, { buffer: PDF, mimetype: 'application/pdf', originalname: 'p.pdf', size: PDF.length } as any),
      ).rejects.toMatchObject({ errorCode: 'AI_INGEST_TOO_MANY_PAGES' });
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

    it('suggests null (never partial) when the sheet says delivered but the cash is short', async () => {
      // La hoja dice ENTREGADA cobrando 120 de un neto de 200. `partial` no es un
      // resultado válido en ruta, y ninguna derivación automática es segura, así
      // que la sugerencia es `null` → decisión del operador.
      aiMock.run.mockResolvedValue({
        success: true,
        model: 'MiniMax-VL-01',
        content: JSON.stringify({
          stops: [
            {
              stop_sequence: 1,
              remision_number: 'REM-1',
              delivered: true,
              collected_amount: 120,
              payment_method: 'efectivo',
              notes: 'abonó solo una parte',
            },
          ],
          confidence: 90,
        }),
      });
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
      ]);

      const scan = await service.scanRouteSheet(ROUTE_ID, file());
      const match = await service.matchStops(ROUTE_ID, scan);

      expect(match.stops[0]).toMatchObject({
        stop_id: 51,
        suggested_result: null,
      });
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
    const pendingStop = (id: number, total: number, extra: any = {}) => ({
      id,
      status: 'pending',
      dispatch_note: { grand_total: new Prisma.Decimal(total), ...extra },
    });
    // Prepaid DERIVED from the live order: nothing left to pay.
    const prepaidStop = (id: number, total: number) =>
      pendingStop(id, total, {
        order: { remaining_balance: new Prisma.Decimal(0) },
      });

    it('settles in ONE atomic batch and stores the confidence as a 0-1 fraction', async () => {
      prismaMock.dispatch_route_stops.findMany.mockResolvedValue([
        pendingStop(51, 200),
        pendingStop(52, 150),
      ]);

      const dto: any = {
        stops: [
          { stop_id: 51, result: 'delivered', collected_amount: 200 },
          {
            stop_id: 52,
            result: 'rejected',
            reason: 'Cliente cerrado',
            collected_amount: 0,
          },
        ],
        scan_result: { stops: [], confidence: 92 },
      };

      const result = await service.confirmAndSettle(ROUTE_ID, file(), dto);

      // ONE batch call (one transaction) with every stop.
      expect(routeFlowMock.settleStopsAtomically).toHaveBeenCalledTimes(1);
      const [, items] = routeFlowMock.settleStopsAtomically.mock.calls[0];
      expect(items).toEqual([
        expect.objectContaining({
          kind: 'settle',
          stop_id: 51,
          dto: expect.objectContaining({ result: 'delivered', collected_amount: 200 }),
        }),
        expect.objectContaining({
          kind: 'settle',
          stop_id: 52,
          dto: expect.objectContaining({ result: 'rejected', reason: 'Cliente cerrado' }),
        }),
      ]);

      expect(s3Mock.uploadFile).toHaveBeenCalledTimes(1);

      // Scan metadata written INSIDE the same transaction, store-scoped, and
      // the 92 % confidence fits Decimal(5,4) as 0.92 (it was the P2020).
      expect(prismaMock.dispatch_routes.updateMany).not.toHaveBeenCalled();
      expect(txMock.dispatch_routes.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ROUTE_ID, store_id: STORE_ID },
          data: expect.objectContaining({
            planilla_pdf_key: 's3/key/planilla.jpg',
            scan_confidence: 0.92,
            planilla_scanned_at: expect.any(Date),
          }),
        }),
      );

      expect(result.planilla_pdf_key).toBe('s3/key/planilla.jpg');
      expect(result.settled).toHaveLength(2);
      expect(result.skipped).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(dispatchRoutesMock.findOne).toHaveBeenCalledWith(ROUTE_ID);
      expect(result.route).toMatchObject({ id: ROUTE_ID });
    });

    it.each([[150], [-1], ['abc']])(
      'confidence out of range (%p) → 400 RTSCAN_CONFIRM_INVALID without writing',
      async (confidence) => {
        prismaMock.dispatch_route_stops.findMany.mockResolvedValue([
          pendingStop(51, 200),
        ]);
        const dto: any = {
          stops: [{ stop_id: 51, result: 'delivered', collected_amount: 200 }],
          scan_result: { stops: [], confidence },
        };

        await expect(
          service.confirmAndSettle(ROUTE_ID, file(), dto),
        ).rejects.toMatchObject({ errorCode: 'RTSCAN_CONFIRM_INVALID' });
        expect(s3Mock.uploadFile).not.toHaveBeenCalled();
        expect(routeFlowMock.settleStopsAtomically).not.toHaveBeenCalled();
      },
    );

    it('atomic: if the batch fails in the middle nothing is applied and the upload is dropped', async () => {
      prismaMock.dispatch_route_stops.findMany.mockResolvedValue([
        pendingStop(51, 200),
        pendingStop(52, 150),
      ]);
      const boom = new VendixHttpException(
        { code: 'DISPATCH_ROUTE_BATCH_INVALID', httpStatus: 400, devMessage: 'x' } as any,
      );
      routeFlowMock.settleStopsAtomically.mockRejectedValueOnce(boom);

      const dto: any = {
        stops: [
          { stop_id: 51, result: 'delivered', collected_amount: 200 },
          { stop_id: 52, result: 'delivered', collected_amount: 150 },
        ],
        scan_result: { stops: [], confidence: 90 },
      };

      await expect(service.confirmAndSettle(ROUTE_ID, file(), dto)).rejects.toBe(boom);
      // The metadata write lives inside the failed transaction → never ran.
      expect(txMock.dispatch_routes.updateMany).not.toHaveBeenCalled();
      expect(s3Mock.deleteFile).toHaveBeenCalledWith('s3/key/planilla.jpg');
      expect(dispatchRoutesMock.findOne).not.toHaveBeenCalled();
    });

    it('reconciles idempotently: skips already-terminal and not-in-route stops', async () => {
      prismaMock.dispatch_route_stops.findMany.mockResolvedValue([
        { ...pendingStop(51, 200), status: 'delivered' },
        pendingStop(52, 150),
      ]);

      const dto: any = {
        stops: [
          { stop_id: 51, delivered: true, collected_amount: 200 },
          { stop_id: 52, delivered: true, collected_amount: 150 },
          { stop_id: 99, delivered: true, collected_amount: 10 },
        ],
        scan_result: { stops: [], confidence: 88 },
      };

      const result = await service.confirmAndSettle(ROUTE_ID, file(), dto);

      const [, items] = routeFlowMock.settleStopsAtomically.mock.calls[0];
      expect(items.map((i: any) => i.stop_id)).toEqual([52]);
      expect(result.settled).toEqual([{ stop_id: 52, result: 'delivered' }]);
      expect(result.skipped).toEqual(
        expect.arrayContaining([
          { stop_id: 51, reason: 'already_settled' },
          { stop_id: 99, reason: 'not_in_route' },
        ]),
      );
    });

    it('legacy delivered:false is NOT a silent rejection: the stop stays untouched', async () => {
      prismaMock.dispatch_route_stops.findMany.mockResolvedValue([
        pendingStop(51, 200),
        pendingStop(52, 150),
      ]);
      const dto: any = {
        stops: [
          { stop_id: 51, delivered: false, collected_amount: 0 },
          { stop_id: 52, delivered: true, collected_amount: 150 },
        ],
      };

      const result = await service.confirmAndSettle(ROUTE_ID, file(), dto);

      const [, items] = routeFlowMock.settleStopsAtomically.mock.calls[0];
      expect(items.map((i: any) => i.stop_id)).toEqual([52]);
      expect(result.skipped).toEqual([{ stop_id: 51, reason: 'outcome_required' }]);
    });

    it('delivery without collection is not assumed paid: a short legacy delivery waits for a decision', async () => {
      prismaMock.dispatch_route_stops.findMany.mockResolvedValue([
        pendingStop(51, 200),
        pendingStop(52, 150),
      ]);

      const dto: any = {
        stops: [
          { stop_id: 51, delivered: true }, // no amount → 0, never "cobro total"
          { stop_id: 52, delivered: true, collected_amount: 150 },
        ],
        scan_result: { stops: [], confidence: 91 },
      };

      const result = await service.confirmAndSettle(ROUTE_ID, file(), dto);

      const [, items] = routeFlowMock.settleStopsAtomically.mock.calls[0];
      expect(items.map((i: any) => i.stop_id)).toEqual([52]);
      expect(result.skipped).toEqual([
        {
          stop_id: 51,
          reason: 'short_payment_requires_decision',
          collected_amount: 0,
          net: 200,
        },
      ]);
    });

    it.each([['rejected'], ['released']])(
      '%s without a reason → 400 and nothing is written',
      async (outcome) => {
        prismaMock.dispatch_route_stops.findMany.mockResolvedValue([
          pendingStop(51, 200),
          pendingStop(52, 150),
        ]);
        const dto: any = {
          stops: [
            { stop_id: 51, result: 'delivered', collected_amount: 200 },
            { stop_id: 52, result: outcome, reason: '   ' },
          ],
        };

        await expect(
          service.confirmAndSettle(ROUTE_ID, file(), dto),
        ).rejects.toMatchObject({ errorCode: 'RTSCAN_CONFIRM_INVALID' });
        expect(s3Mock.uploadFile).not.toHaveBeenCalled();
        expect(routeFlowMock.settleStopsAtomically).not.toHaveBeenCalled();
      },
    );

    it('released with reason → release item (same history/reason as the manual flow)', async () => {
      prismaMock.dispatch_route_stops.findMany.mockResolvedValue([
        pendingStop(52, 150),
      ]);
      const dto: any = {
        stops: [{ stop_id: 52, result: 'released', reason: 'Reprogramada' }],
      };

      const result = await service.confirmAndSettle(ROUTE_ID, file(), dto);

      const [, items] = routeFlowMock.settleStopsAtomically.mock.calls[0];
      expect(items).toEqual([
        { kind: 'release', stop_id: 52, reason: 'Reprogramada' },
      ]);
      expect(result.settled).toEqual([{ stop_id: 52, result: 'released' }]);
    });

    it('a rejected stop cannot carry a collection', async () => {
      prismaMock.dispatch_route_stops.findMany.mockResolvedValue([
        pendingStop(52, 150),
      ]);
      const dto: any = {
        stops: [
          { stop_id: 52, result: 'rejected', reason: 'No pidió', collected_amount: 50 },
        ],
      };
      await expect(
        service.confirmAndSettle(ROUTE_ID, file(), dto),
      ).rejects.toMatchObject({ errorCode: 'RTSCAN_CONFIRM_INVALID' });
      expect(routeFlowMock.settleStopsAtomically).not.toHaveBeenCalled();
    });

    it('prepaid: delivered with 0 is settled as prepaid; any collection → 400 without writing', async () => {
      prismaMock.dispatch_route_stops.findMany.mockResolvedValue([
        prepaidStop(53, 300),
      ]);

      const ok = await service.confirmAndSettle(ROUTE_ID, file(), {
        stops: [{ stop_id: 53, result: 'delivered', collected_amount: 0 }],
      } as any);
      const [, items] = routeFlowMock.settleStopsAtomically.mock.calls[0];
      expect(items[0].dto).toMatchObject({
        result: 'delivered',
        collected_amount: 0,
        payment_method: 'prepaid',
      });
      expect(ok.settled).toEqual([{ stop_id: 53, result: 'delivered' }]);

      routeFlowMock.settleStopsAtomically.mockClear();
      s3Mock.uploadFile.mockClear();
      await expect(
        service.confirmAndSettle(ROUTE_ID, file(), {
          stops: [{ stop_id: 53, result: 'delivered', collected_amount: 300 }],
        } as any),
      ).rejects.toMatchObject({ errorCode: 'RTSCAN_CONFIRM_INVALID' });
      expect(s3Mock.uploadFile).not.toHaveBeenCalled();
      expect(routeFlowMock.settleStopsAtomically).not.toHaveBeenCalled();
    });
    it('stop_id repetido → 400 sin subir ni liquidar (evita el doble cobro)', async () => {
      prismaMock.dispatch_route_stops.findMany.mockResolvedValue([pendingStop(51, 200)]);
      const dto: any = {
        stops: [
          { stop_id: 51, result: 'delivered', collected_amount: 200 },
          { stop_id: 51, result: 'delivered', collected_amount: 200 },
        ],
      };
      await expect(
        service.confirmAndSettle(ROUTE_ID, file(), dto),
      ).rejects.toMatchObject({ errorCode: 'RTSCAN_CONFIRM_INVALID' });
      expect(s3Mock.uploadFile).not.toHaveBeenCalled();
      expect(routeFlowMock.settleStopsAtomically).not.toHaveBeenCalled();
    });
  });
});
