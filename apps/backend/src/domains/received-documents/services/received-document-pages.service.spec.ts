import { createCanvas } from '@napi-rs/canvas';
import { BadRequestException } from '@nestjs/common';
import {
  ReceivedDocumentPagesService,
  type ReceivedDocumentSourceFile,
} from './received-document-pages.service';

type MockPage = {
  getViewport: jest.Mock;
  getTextContent: jest.Mock;
  render: jest.Mock;
  cleanup: jest.Mock;
};

class TestReceivedDocumentPagesService extends ReceivedDocumentPagesService {
  pdfJsModule: unknown;

  protected override async loadPdfJsModule() {
    return this.pdfJsModule as never;
  }
}

describe('ReceivedDocumentPagesService', () => {
  let service: TestReceivedDocumentPagesService;

  beforeEach(() => {
    service = new TestReceivedDocumentPagesService();
  });

  const pdfFile = (sizeBytes = 16): ReceivedDocumentSourceFile => ({
    buffer: Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(Math.max(0, sizeBytes - 9))]),
    mimetype: 'application/pdf',
    size: sizeBytes,
    originalname: 'supplier.pdf',
  });

  const createPage = (
    pageNumber: number,
    events: string[],
    viewport: (scale: number) => { width: number; height: number } = () => ({ width: 20, height: 30 }),
    renderFailure?: Error,
  ): MockPage => ({
    getViewport: jest.fn(({ scale }: { scale: number }) => viewport(scale)),
    getTextContent: jest.fn(async () => ({ items: [{ str: `texto-${pageNumber}` }] })),
    render: jest.fn(({ canvasContext }: { canvasContext: { canvas: { width: number; height: number } } }) => {
      events.push(`render-${pageNumber}`);
      if (renderFailure) return { promise: Promise.reject(renderFailure) };
      canvasContext.canvas.width = canvasContext.canvas.width;
      return { promise: Promise.resolve() };
    }),
    cleanup: jest.fn(() => events.push(`cleanup-${pageNumber}`)),
  });

  const installPdfMock = (
    pages: MockPage[],
    options?: { numPages?: number; documentFailure?: Error },
    events: string[] = [],
  ) => {
    const document = {
      numPages: options?.numPages ?? pages.length,
      getPage: jest.fn(async (pageNumber: number) => {
        events.push(`get-${pageNumber}`);
        return pages[pageNumber - 1];
      }),
      destroy: jest.fn(async () => events.push('document-destroy')),
    };
    const loadingTask = {
      promise: options?.documentFailure ? Promise.reject(options.documentFailure) : Promise.resolve(document),
      destroy: jest.fn(async () => events.push('task-destroy')),
    };
    const getDocument = jest.fn((params: Record<string, unknown>) => {
      expect(params['isEvalSupported']).toBe(false);
      expect(params['enableXfa']).toBe(false);
      expect(params['useSystemFonts']).toBe(false);
      expect(params['disableRange']).toBe(true);
      expect(params['disableStream']).toBe(true);
      expect(params['disableAutoFetch']).toBe(true);
      expect(String(params['cMapUrl'])).toContain(`${require('node:path').sep}cmaps${require('node:path').sep}`);
      expect(String(params['standardFontDataUrl'])).toContain(`${require('node:path').sep}standard_fonts${require('node:path').sep}`);
      expect(params['data']).toBeInstanceOf(Uint8Array);
      return loadingTask;
    });
    service.pdfJsModule = { getDocument };
    return { events, document, loadingTask, getDocument };
  };

  it('rejects unsupported formats and MIME/magic mismatches before decoding', async () => {
    await expect(service.prepare({ ...pdfFile(), mimetype: 'text/xml' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.prepare({ ...pdfFile(), buffer: Buffer.from('not a pdf') })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.prepare({ ...pdfFile(), mimetype: 'image/png' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enforces the 10 MiB source limit and exact buffer size', async () => {
    const oversized = { ...pdfFile(), buffer: Buffer.alloc(10 * 1024 * 1024 + 1), size: 10 * 1024 * 1024 + 1 };
    await expect(service.prepare(oversized)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.prepare({ ...pdfFile(), size: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects more than ten PDF pages before opening or rendering any page', async () => {
    const page = createPage(1, []);
    const mock = installPdfMock([page], { numPages: 11 });
    await expect(service.prepare(pdfFile())).rejects.toBeInstanceOf(BadRequestException);
    expect(mock.document.getPage).not.toHaveBeenCalled();
    expect(page.render).not.toHaveBeenCalled();
    expect(mock.document.destroy).toHaveBeenCalledTimes(1);
    expect(mock.loadingTask.destroy).toHaveBeenCalledTimes(1);
  });

  it('renders pages sequentially and caps extracted text per page', async () => {
    const events: string[] = [];
    const first = createPage(1, events);
    const second = createPage(2, events);
    first.getTextContent.mockResolvedValue({ items: [{ str: 'a'.repeat(50_100) }] });
    const mock = installPdfMock([first, second], undefined, events);
    const result = await service.prepare(pdfFile());

    expect(result.page_count).toBe(2);
    expect(result.pages.map((page) => page.page_number)).toEqual([1, 2]);
    expect(result.pages[0].text).toHaveLength(50_000);
    expect(result.pages[0].mime_type).toBe('image/jpeg');
    expect(events.indexOf('render-1')).toBeLessThan(events.indexOf('get-2'));
    expect(events.indexOf('cleanup-1')).toBeLessThan(events.indexOf('get-2'));
    expect(first.cleanup).toHaveBeenCalledTimes(1);
    expect(second.cleanup).toHaveBeenCalledTimes(1);
    expect(mock.document.destroy).toHaveBeenCalledTimes(1);
    expect(mock.loadingTask.destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects a render viewport beyond bounds before allocating its canvas', async () => {
    const page = createPage(1, [], (scale) => scale === 1 ? { width: 100, height: 100 } : { width: 2500, height: 10 });
    installPdfMock([page]);
    const createCanvasSpy = jest.spyOn(service as unknown as { createCanvas: (width: number, height: number) => unknown }, 'createCanvas');
    await expect(service.prepare(pdfFile())).rejects.toBeInstanceOf(BadRequestException);
    expect(createCanvasSpy).not.toHaveBeenCalled();
    expect(page.render).not.toHaveBeenCalled();
    expect(page.cleanup).toHaveBeenCalledTimes(1);
  });

  it('rejects internal canvases beyond the maximum source edge before allocation', async () => {
    const createCanvasSpy = jest.spyOn(service as unknown as { createCanvas: (width: number, height: number) => unknown }, 'createCanvas');
    service.pdfJsModule = {
      getDocument: (options: Record<string, unknown>) => {
        const Factory = options['CanvasFactory'] as new (options?: unknown) => { create(width: number, height: number): unknown };
        new Factory().create(8193, 1);
        throw new Error('unreachable');
      },
    };
    await expect(service.prepare(pdfFile())).rejects.toBeInstanceOf(BadRequestException);
    expect(createCanvasSpy).not.toHaveBeenCalled();
  });

  it('allows a scanned A4 source bitmap for PDF internals while keeping the output viewport bounded', async () => {
    const events: string[] = [];
    const page = createPage(1, events, () => ({ width: 2048, height: 1200 }));
    const mock = installPdfMock([page]);
    const fakeCanvas = (width: number, height: number) => {
      const surface: { width: number; height: number; toBuffer: jest.Mock; getContext: jest.Mock } = {
        width, height, toBuffer: jest.fn(() => Buffer.from('jpeg')),
        getContext: jest.fn(() => ({ canvas: surface })),
      };
      return surface as never;
    };
    jest.spyOn(service as unknown as { createCanvas: (width: number, height: number) => unknown }, 'createCanvas').mockImplementation(fakeCanvas);
    service.pdfJsModule = {
      getDocument: (options: Record<string, unknown>) => {
        const Factory = options['CanvasFactory'] as new (options?: unknown) => { create(width: number, height: number): { canvas: unknown }; destroy(entry: { canvas: unknown }): void };
        const factory = new Factory();
        const embeddedSource = factory.create(2480, 3508);
        factory.destroy(embeddedSource);
        return mock.loadingTask;
      },
    };

    const result = await service.prepare(pdfFile());
    expect(result.page_count).toBe(1);
    expect(page.render).toHaveBeenCalledTimes(1);
    expect(result.pages[0].page_number).toBe(1);
  });

  it.each([
    ['edge', [[8193, 1]]],
    ['per-surface pixels', [[6400, 6400]]],
    ['aggregate active pixels', [[8000, 5000], [6000, 4001]]],
  ])('rejects oversized internal PDF canvas %s before allocating it', async (_name, surfaces) => {
    const createCanvasSpy = jest.spyOn(service as unknown as { createCanvas: (width: number, height: number) => unknown }, 'createCanvas')
      .mockImplementation(((width: number, height: number) => ({ width, height, getContext: () => ({ canvas: { width, height } }) })) as never);
    service.pdfJsModule = {
      getDocument: (options: Record<string, unknown>) => {
        const Factory = options['CanvasFactory'] as new (options?: unknown) => { create(width: number, height: number): unknown };
        const factory = new Factory();
        for (const [width, height] of surfaces as number[][]) factory.create(width, height);
        throw new Error('unreachable');
      },
    };

    await expect(service.prepare(pdfFile())).rejects.toMatchObject({ response: expect.objectContaining({ message: _name === 'aggregate active pixels' ? 'El PDF excede el límite de memoria de superficies de imagen activas.' : 'El PDF solicitó una superficie de imagen demasiado grande.' }) });
    const rejectedIndex = surfaces[0][0] > 8192 || surfaces[0][0] * surfaces[0][1] > 40_000_000 ? 0 : 1;
    expect(createCanvasSpy).toHaveBeenCalledTimes(rejectedIndex);
  });

  it('releases aggregate pixel budget on reset and destroy', async () => {
    const createCanvasSpy = jest.spyOn(service as unknown as { createCanvas: (width: number, height: number) => unknown }, 'createCanvas')
      .mockImplementation(((width: number, height: number) => ({ width, height, getContext: () => ({ canvas: { width, height } }) })) as never);
    let remaining!: () => void;
    const loadingTask = { promise: new Promise<never>((_resolve, reject) => { remaining = () => reject(new Error('stop after budget checks')); }), destroy: jest.fn(async () => undefined) };
    service.pdfJsModule = {
      getDocument: (options: Record<string, unknown>) => {
        const Factory = options['CanvasFactory'] as new (options?: unknown) => { create(width: number, height: number): { canvas: { width: number; height: number }; context: unknown }; reset(entry: { canvas: { width: number; height: number }; context: unknown }, width: number, height: number): void; destroy(entry: { canvas: { width: number; height: number }; context: unknown }): void };
        const factory = new Factory();
        const first = factory.create(5000, 4000);
        const second = factory.create(5000, 4000);
        factory.reset(first, 8000, 5000); // replaces 20 MP with 40 MP: active total is 60 MP, not 80 MP.
        factory.destroy(second);
        factory.create(4000, 4000); // 56 MP after destroy remains below 64 MP.
        remaining();
        return loadingTask;
      },
    };

    await expect(service.prepare(pdfFile())).rejects.toMatchObject({
      response: expect.objectContaining({ message: 'No se pudo leer el PDF del documento.' }),
    });
    expect(createCanvasSpy).toHaveBeenCalledTimes(3);
  });

  it('zeros an old PDF canvas before reset dimensions to prevent oversized intermediate allocation', async () => {
    let peakPixels = 0;
    let resetShape: { width: number; height: number } | undefined;
    jest.spyOn(service as unknown as { createCanvas: (width: number, height: number) => unknown }, 'createCanvas')
      .mockImplementation(((width: number, height: number) => {
        let currentWidth = width;
        let currentHeight = height;
        const updatePeak = () => { peakPixels = Math.max(peakPixels, currentWidth * currentHeight); };
        const surface = {
          get width() { return currentWidth; },
          set width(value: number) { currentWidth = value; updatePeak(); },
          get height() { return currentHeight; },
          set height(value: number) { currentHeight = value; updatePeak(); },
          getContext: () => ({ canvas: surface }),
        };
        updatePeak();
        return surface;
      }) as never);
    service.pdfJsModule = {
      getDocument: (options: Record<string, unknown>) => {
        const Factory = options['CanvasFactory'] as new (options?: unknown) => { create(width: number, height: number): { canvas: { width: number; height: number }; context: unknown }; reset(entry: { canvas: { width: number; height: number }; context: unknown }, width: number, height: number): void };
        const factory = new Factory();
        const surface = factory.create(1, 8192);
        factory.reset(surface, 8192, 1);
        resetShape = { width: surface.canvas.width, height: surface.canvas.height };
        throw new Error('stop after reset dimensions are verified');
      },
    };

    await expect(service.prepare(pdfFile())).rejects.toMatchObject({
      response: expect.objectContaining({ message: 'No se pudo leer el PDF del documento.' }),
    });
    expect(resetShape).toEqual({ width: 8192, height: 1 });
    expect(peakPixels).toBeLessThanOrEqual(40_000_000);
  });

  it('destroys page, document, and loading resources when rendering fails', async () => {
    const events: string[] = [];
    const page = createPage(1, events, undefined, new Error('private pdf parser detail'));
    const mock = installPdfMock([page]);
    await expect(service.prepare(pdfFile())).rejects.toMatchObject({
      response: expect.objectContaining({ message: 'No se pudo leer el PDF del documento.' }),
    });
    expect(page.cleanup).toHaveBeenCalledTimes(1);
    expect(mock.document.destroy).toHaveBeenCalledTimes(1);
    expect(mock.loadingTask.destroy).toHaveBeenCalledTimes(1);
  });

  it('preprocesses a valid PNG into a single bounded JPEG page', async () => {
    const buffer = createCanvas(4, 3).toBuffer('image/png');
    const result = await service.prepare({
      buffer,
      mimetype: 'image/png',
      size: buffer.length,
      originalname: 'supplier.png',
    });
    expect(result.page_count).toBe(1);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]).toMatchObject({ page_number: 1, mime_type: 'image/jpeg', text: '' });
    expect(result.pages[0].data_uri).toMatch(/^data:image\/jpeg;base64,/);
  });
});
