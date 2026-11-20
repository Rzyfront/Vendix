import * as XLSX from 'xlsx';
import { MemberBulkScannerService } from './member-bulk-scanner.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import { SheetParserService } from '@common/ai-ingest/sheets/sheet-parser.service';
import { AiExtractionService } from '@common/ai-ingest/extraction/ai-extraction.service';
import { RosterScanResult } from './dto/scan-roster.dto';

describe('MemberBulkScannerService (scan)', () => {
  let service: MemberBulkScannerService;
  let aiMock: { run: jest.Mock };
  let registryMock: { register: jest.Mock };
  let pagesMock: { prepareForAi: jest.Mock };
  let prismaMock: any;
  let plansServiceMock: { create: jest.Mock };
  let membershipsMock: { createFromImport: jest.Mock };
  let customersMock: { create: jest.Mock; linkCustomerToStore: jest.Mock };

  const AI_FIXTURE = JSON.stringify({
    document_type: 'roster',
    detected_plans: [{ name: 'Mensual', price: 80000, duration_days: 30 }],
    members: [{ first_name: 'Ana', last_name: 'Lopez', plan_name: 'Mensual' }],
    confidence: 91,
  });

  // A real JPEG signature: the type is decided by the bytes, not the mimetype.
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
  const PDF = Buffer.from('%PDF-1.4\n%fake');

  const multerFile = () =>
    ({
      buffer: JPEG,
      mimetype: 'image/jpeg',
      originalname: 'padron.jpg',
      size: JPEG.length,
    }) as Express.Multer.File;

  const scanFile = (buffer: Buffer = JPEG, mimeType = 'image/jpeg', originalName = 'padron.jpg') => ({
    buffer,
    mimeType,
    originalName,
    size: buffer.length,
  });

  const xlsx = (rows: unknown[][]): Buffer => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Socios');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  };

  const imagePage = (n: number) => ({
    page_number: n,
    mode: 'image',
    text: '',
    image: 'data:image/jpeg;base64,AAAA',
  });

  beforeEach(() => {
    aiMock = {
      run: jest.fn().mockResolvedValue({ success: true, content: AI_FIXTURE, model: 'm' }),
    };
    registryMock = { register: jest.fn() };
    pagesMock = {
      prepareForAi: jest.fn().mockResolvedValue({
        source: 'image',
        pages: [imagePage(1)],
        page_count: 1,
        unreadable_pages: [],
      }),
    };
    const membershipPlans = {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(async ({ where }: any) => ({ id: where.id })),
    };
    prismaMock = {
      withoutScope: () => ({ membership_plans: membershipPlans }),
      store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    plansServiceMock = { create: jest.fn().mockResolvedValue({ id: 77 }) };
    membershipsMock = { createFromImport: jest.fn().mockResolvedValue({ id: 500 }) };
    customersMock = {
      create: jest.fn().mockResolvedValue({ id: 900 }),
      linkCustomerToStore: jest.fn(),
    };
    service = new MemberBulkScannerService(
      prismaMock,
      plansServiceMock as any,
      membershipsMock as any,
      { upsert: jest.fn() } as any,
      customersMock as any,
      {} as any,
      registryMock as any,
      new SheetParserService(),
      new AiExtractionService(aiMock as any),
      pagesMock as any,
    );
  });

  it('scanRosterFromFiles da el mismo resultado que scanRoster', async () => {
    const sync = await service.scanRoster(multerFile());
    const viaFiles = await service.scanRosterFromFiles([scanFile()]);
    expect(viaFiles).toEqual(sync);
    expect(sync.members).toHaveLength(1);
    expect(aiMock.run).toHaveBeenCalledWith(
      'member_roster_ocr',
      {},
      expect.any(Array),
      expect.objectContaining({
        responseSchema: expect.objectContaining({ name: 'member_roster' }),
        quotaKey: expect.stringMatching(/^ai-ingest:/),
      }),
    );
  });

  it('rechaza archivo ausente y tipo invalido (por firma, no por mimetype)', async () => {
    await expect(service.scanRosterFromFiles([])).rejects.toBeInstanceOf(VendixHttpException);
    await expect(
      service.scanRosterFromFiles([scanFile(Buffer.from([0, 1, 2, 0]), 'image/jpeg', 'x.jpg')]),
    ).rejects.toMatchObject({ errorCode: 'MEMBER_SCAN_INVALID_FILE' });
  });

  it('onModuleInit registra member_roster y delega con el progreso', async () => {
    service.onModuleInit();
    expect(registryMock.register).toHaveBeenCalledWith('member_roster', expect.any(Function));
    const handler = registryMock.register.mock.calls[0][1];
    const spy = jest.spyOn(service, 'scanRosterFromFiles');
    const files = [scanFile()];
    const reportProgress = jest.fn();
    await handler({ files, params: {}, context: {}, reportProgress });
    expect(spy).toHaveBeenCalledWith(files, reportProgress);
  });

  describe('hojas de cálculo (ia-cargas F2)', () => {
    it('lee una hoja con encabezados reconocibles SIN llamar a la IA: fila de origen, planes, omitidas y avisos', async () => {
      const buffer = xlsx([
        ['Padrón de socios Gimnasio Fuerte'],
        [],
        ['Nombre completo', 'Cédula', 'Correo', 'Plan', 'Valor', 'Fecha inicio', 'Vence'],
        ['Juan Carlos Pérez Gómez', 'C.C. 1.020.304.050', 'juan@x.co', 'Mensual', '$ 80.000', '01/07/2026', '31/07/2026'],
        ['Ana López', '52123456', 'no-es-correo', 'trimestral', '200000', '4 de julio', ''],
        ['', '', '', '', '', '', ''],
        ['Juan Carlos Pérez Gómez', '1020304050', 'juan@x.co', 'Mensual', '80000', '01/07/2026', '31/07/2026'],
        ['', '', 'solo@correo.co', 'Mensual', '', '', ''],
      ]);
      const progress = jest.fn().mockResolvedValue(undefined);
      // The ai-scan worker rebuilds the mimetype from the S3 key: image/jpeg.
      const scan = await service.scanRosterFromFiles(
        [scanFile(buffer, 'image/jpeg', '1-socios.xlsx')],
        progress,
      );

      expect(aiMock.run).not.toHaveBeenCalled();
      expect(pagesMock.prepareForAi).not.toHaveBeenCalled();
      expect(scan.members).toHaveLength(2);
      expect(scan.members[0]).toMatchObject({
        first_name: 'Juan Carlos',
        last_name: 'Pérez Gómez',
        document_type: 'CC',
        document_number: '1020304050',
        plan_name: 'Mensual',
        membership_start_date: '2026-07-01',
        membership_end_date: '2026-07-31',
        source_row: 4,
      });
      // No year → 0000: analyze puts the store's year and warns.
      expect(scan.members[1]).toMatchObject({
        first_name: 'Ana',
        last_name: 'López',
        email: null,
        membership_start_date: '0000-07-04',
        source_row: 5,
      });
      expect(scan.detected_plans).toEqual([
        expect.objectContaining({ name: 'Mensual', price: 80000 }),
        expect.objectContaining({ name: 'trimestral', price: 200000 }),
      ]);
      expect(scan.skipped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ row: 7, reason: 'duplicate' }),
          expect.objectContaining({ row: 8, reason: 'unreadable', message: 'Fila sin nombre ni documento.' }),
        ]),
      );
      expect(scan.row_issues).toEqual([
        expect.objectContaining({ row: 5, field: 'email' }),
      ]);
      expect(scan.stats).toMatchObject({ source: 'sheet', imported_rows: 2, mapping: 'synonyms' });
      expect(scan.confidence).toBe(100);
      expect(progress).toHaveBeenLastCalledWith(
        expect.objectContaining({ unit: 'filas', done: scan.stats!.total_rows, total: scan.stats!.total_rows }),
      );
    });

    it('encabezados raros: UNA llamada de mapeo con encabezados + muestra y luego código', async () => {
      aiMock.run.mockResolvedValue({
        success: true,
        content: JSON.stringify({
          columns: [
            { column: 'Afil.', field: 'full_name' },
            { column: 'N° Ident', field: 'document_number' },
            { column: 'Pqte', field: 'plan_name' },
          ],
        }),
      });
      const rows: unknown[][] = [['Afil.', 'N° Ident', 'Pqte']];
      for (let i = 0; i < 120; i += 1) rows.push([`Socio ${i} Ruiz`, `${10_000_000 + i}`, 'Mensual']);
      const scan = await service.scanRosterFromFiles([
        scanFile(xlsx(rows), 'application/octet-stream', 'raro.xlsx'),
      ]);
      expect(aiMock.run).toHaveBeenCalledTimes(1);
      const [, , messages, options] = aiMock.run.mock.calls[0];
      expect(options.responseSchema.name).toBe('column_mapping');
      expect(String(messages[0].content)).toContain('Sample rows');
      expect(scan.members).toHaveLength(120);
      expect(scan.members[119]).toMatchObject({ document_number: '10000119', plan_name: 'Mensual' });
      expect(scan.stats?.mapping).toBe('ai');
    });

    it('acepta CSV y respeta el tope de 5.000 filas avisando el rango omitido', async () => {
      const lines = ['nombre;documento;plan'];
      for (let i = 0; i < 5003; i += 1) lines.push(`Socio ${i};${20_000_000 + i};Mensual`);
      const csv = Buffer.from(lines.join('\n'));
      const scan = await service.scanRosterFromFiles([scanFile(csv, 'text/csv', 'socios.csv')]);
      expect(scan.members).toHaveLength(5000);
      expect(scan.skipped).toEqual([
        expect.objectContaining({ reason: 'limit', row: 5002, row_end: 5004 }),
      ]);
    });
  });

  describe('PDF y fotos (ia-cargas F2)', () => {
    it('PDF de 3 páginas: lotes de 2 páginas, planes y socios repetidos fusionados, progreso por páginas', async () => {
      pagesMock.prepareForAi.mockResolvedValue({
        source: 'pdf',
        pages: [
          { page_number: 1, mode: 'text', text: 'Ana Lopez 123 Mensual '.repeat(20) },
          imagePage(2),
          imagePage(3),
        ],
        page_count: 3,
        unreadable_pages: [],
      });
      const answer = (members: object[]) => ({
        success: true,
        content: JSON.stringify({
          document_type: 'roster',
          detected_plans: [{ name: 'Mensual', price: 80000 }],
          members,
          confidence: 80,
        }),
      });
      aiMock.run
        .mockResolvedValueOnce(answer([
          { first_name: 'Ana', last_name: 'Lopez', document_number: '123', plan_name: 'Mensual' },
        ]))
        .mockResolvedValueOnce(answer([
          { first_name: 'Ana', last_name: 'Lopez', document_number: '123', plan_name: 'Mensual' },
          { first_name: 'Luis', last_name: 'Diaz', document_number: '456', plan_name: 'mensual' },
        ]));
      const progress = jest.fn().mockResolvedValue(undefined);

      const scan = await service.scanRosterFromFiles(
        [scanFile(PDF, 'image/jpeg', 'padron.pdf')],
        progress,
      );

      expect(pagesMock.prepareForAi).toHaveBeenCalledWith(
        expect.objectContaining({ mimetype: 'application/pdf' }),
        expect.objectContaining({ maxPages: 10 }),
      );
      expect(aiMock.run).toHaveBeenCalledTimes(2);
      // Page 1 travels as text, page 2 as an image; never the raw PDF.
      const firstParts = aiMock.run.mock.calls[0][2][0].content as Array<{ type: string }>;
      expect(firstParts.filter((p) => p.type === 'image_url')).toHaveLength(1);
      expect(JSON.stringify(aiMock.run.mock.calls)).not.toContain('application/pdf');
      expect(scan.members.map((m) => m.document_number)).toEqual(['123', '456']);
      expect(scan.detected_plans).toHaveLength(1);
      expect(scan.warnings.join(' ')).toContain('repetidos');
      expect(scan.stats).toMatchObject({ source: 'document', pages: 3, text_pages: 1 });
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ unit: 'páginas', done: 3, total: 3 }),
      );
    });

    it('un PDF escaneado sin páginas legibles da un error claro AI_INGEST_*', async () => {
      pagesMock.prepareForAi.mockRejectedValue(new VendixHttpException(ErrorCodes.AI_INGEST_NO_PAGES));
      await expect(
        service.scanRosterFromFiles([scanFile(PDF, 'application/pdf', 'p.pdf')]),
      ).rejects.toMatchObject({ errorCode: 'AI_INGEST_NO_PAGES' });
    });

    it('una respuesta cortada en una sola página da AI_INGEST_INCOMPLETE (no reintentable)', async () => {
      aiMock.run.mockResolvedValue({ success: true, content: '{"members":[', finish_reason: 'length' });
      await expect(service.scanRosterFromFiles([scanFile()])).rejects.toMatchObject({
        errorCode: 'AI_INGEST_INCOMPLETE',
      });
    });
  });

  describe('analyze y commit en tramos (ia-cargas F2)', () => {
    const runInStore = <T>(fn: () => Promise<T>) =>
      RequestContextService.run({ store_id: 5, organization_id: 9 } as any, fn);

    it('analyze numera las filas con el desplazamiento del tramo', async () => {
      const scan: RosterScanResult = {
        document_type: 'spreadsheet',
        detected_plans: [],
        members: [
          { first_name: 'Ana', last_name: 'Lopez' } as any,
          { first_name: 'Luis', last_name: 'Diaz' } as any,
        ],
        warnings: [],
        confidence: 100,
      };
      const analysis = await runInStore(() => service.analyzeRoster(scan, 200));
      expect(analysis.members.map((m) => m.row_number)).toEqual([201, 202]);
    });

    it('commit devuelve el plan de cada ref_index para que el siguiente tramo no lo cree otra vez', async () => {
      const result = await runInStore(() =>
        service.commitRoster({
          plans: [
            { ref_index: 0, status: 'new', code: 'MENSUAL', name: 'Mensual', price: 80000, duration_days: 30 },
            { ref_index: 1, status: 'existing', plan_id: 12 },
          ],
          members: [
            { row_number: 1, plan_ref_index: 0, first_name: 'Ana', last_name: 'Lopez', status: 'active' },
          ],
        } as any),
      );
      expect(plansServiceMock.create).toHaveBeenCalledTimes(1);
      expect(result.succeeded).toBe(1);
      expect(result.plans_resolved).toEqual([
        { ref_index: 0, plan_id: 77 },
        { ref_index: 1, plan_id: 12 },
      ]);
    });
  });
});
