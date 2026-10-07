import { BadRequestException, Injectable } from '@nestjs/common';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import * as path from 'node:path';
const sharp: typeof import('sharp').default = require('sharp'); // eslint-disable-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment -- sharp 0.35 types are ESM-only (export default) but CJS runtime exports the function

export interface ReceivedDocumentSourceFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

export interface PreparedReceivedDocumentPage {
  page_number: number;
  data_uri: string;
  mime_type: 'image/jpeg';
  text: string;
}

export interface PreparedReceivedDocumentPages {
  pages: PreparedReceivedDocumentPage[];
  page_count: number;
}

interface PdfViewport {
  width: number;
  height: number;
}

interface PdfTextContent {
  items?: Array<{ str?: unknown }>;
}

interface PdfPage {
  getViewport(options: { scale: number }): PdfViewport;
  getTextContent(): Promise<PdfTextContent>;
  render(options: { canvasContext: unknown; viewport: PdfViewport }): { promise: Promise<void> };
  cleanup(): void;
}

interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
  destroy(): Promise<void>;
}

interface PdfJsModule {
  getDocument(options: Record<string, unknown>): PdfLoadingTask;
}

interface PdfCanvasEntry {
  canvas: Canvas | null;
  context: ReturnType<Canvas['getContext']> | null;
  pixelCount: number;
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_OUTPUT_BYTES = 20 * 1024 * 1024;
const MAX_PDF_PAGES = 10;
const MAX_CANVAS_EDGE = 2048;
const MAX_CANVAS_PIXELS = 8_000_000;
const MAX_PDF_INTERNAL_CANVAS_EDGE = 8192;
const MAX_PDF_INTERNAL_CANVAS_PIXELS = 40_000_000;
const MAX_PDF_ACTIVE_CANVAS_PIXELS = 64_000_000;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_TEXT_CHARS_PER_PAGE = 50_000;
const MAX_TEXT_ITEMS_PER_PAGE = 100_000;
const PDF_MIME = 'application/pdf';
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Prepares bounded page images/text for downstream OCR without fetching remote resources. */
@Injectable()
export class ReceivedDocumentPagesService {
  async prepare(file: ReceivedDocumentSourceFile): Promise<PreparedReceivedDocumentPages> {
    const mimeType = this.validateFile(file);
    if (mimeType === PDF_MIME) return this.preparePdf(file.buffer);
    return this.prepareImage(file.buffer);
  }

  protected async loadPdfJsModule(): Promise<PdfJsModule> {
    // Keep this literal dynamic import native under the backend CommonJS build.
    const nativeImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<PdfJsModule>;
    return nativeImport('pdfjs-dist/legacy/build/pdf.mjs');
  }

  protected createCanvas(width: number, height: number): Canvas {
    return createCanvas(width, height);
  }

  private validateFile(file: ReceivedDocumentSourceFile): string {
    if (!file?.buffer || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      throw this.badRequest('Se requiere un archivo de imagen o PDF.');
    }
    if (file.buffer.length > MAX_UPLOAD_BYTES || file.size !== file.buffer.length) {
      throw this.badRequest('El archivo debe pesar como máximo 10 MiB.');
    }

    const mimeType = file.mimetype?.trim().toLowerCase();
    if (mimeType === PDF_MIME) {
      if (!file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        throw this.badRequest('El contenido no corresponde a un PDF válido.');
      }
      return mimeType;
    }

    if (!IMAGE_MIMES.has(mimeType)) {
      throw this.badRequest('Solo se admiten archivos PDF, PNG, JPEG o WebP.');
    }
    if (!this.hasImageMagic(file.buffer, mimeType)) {
      throw this.badRequest('El contenido no coincide con el tipo de imagen declarado.');
    }
    return mimeType;
  }

  private async prepareImage(buffer: Buffer): Promise<PreparedReceivedDocumentPages> {
    try {
      const input = sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS, animated: false });
      const metadata = await input.metadata();
      if (
        (metadata.pages ?? 1) > 1 ||
        !Number.isFinite(metadata.width) ||
        !Number.isFinite(metadata.height) ||
        !metadata.width ||
        !metadata.height ||
        metadata.width * metadata.height > MAX_IMAGE_PIXELS
      ) {
        throw this.badRequest('La imagen excede los límites de páginas o dimensiones permitidos.');
      }

      const jpeg = await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS, animated: false })
        .rotate()
        .resize({
          width: MAX_CANVAS_EDGE,
          height: MAX_CANVAS_EDGE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85 })
        .toBuffer();
      const page = this.toPage(1, jpeg, '');
      this.assertOutputSize([page]);
      return { pages: [page], page_count: 1 };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw this.badRequest('No se pudo preparar la imagen del documento.');
    }
  }

  private async preparePdf(buffer: Buffer): Promise<PreparedReceivedDocumentPages> {
    let loadingTask: PdfLoadingTask | undefined;
    let pdfDocument: PdfDocument | undefined;
    const activeCanvases = new Set<PdfCanvasEntry>();
    let activeCanvasPixels = 0;
    const owner = this;

    class BoundedCanvasFactory {
      constructor(_options?: unknown) {}

      create(width: number, height: number): PdfCanvasEntry {
        const dimensions = owner.validateInternalCanvasDimensions(width, height, activeCanvasPixels);
        const canvas = owner.createCanvas(dimensions.width, dimensions.height);
        const entry: PdfCanvasEntry = { canvas, context: canvas.getContext('2d'), pixelCount: dimensions.pixels };
        activeCanvases.add(entry);
        activeCanvasPixels += dimensions.pixels;
        return entry;
      }

      reset(entry: PdfCanvasEntry, width: number, height: number): void {
        if (!entry.canvas || !entry.context) throw new Error('Canvas factory received a destroyed surface.');
        if (!activeCanvases.has(entry)) throw new Error('Canvas factory received an untracked surface.');
        const budgetWithoutEntry = activeCanvasPixels - entry.pixelCount;
        const dimensions = owner.validateInternalCanvasDimensions(width, height, budgetWithoutEntry);
        // Release the old bitmap first. Setting width and then height directly
        // can transiently allocate old-height × new-width (or vice versa), even
        // when both endpoint surfaces satisfy the cap.
        entry.canvas.width = 0;
        entry.canvas.height = 0;
        entry.canvas.width = dimensions.width;
        entry.canvas.height = dimensions.height;
        entry.context = entry.canvas.getContext('2d');
        activeCanvasPixels = budgetWithoutEntry + dimensions.pixels;
        entry.pixelCount = dimensions.pixels;
      }

      destroy(entry: PdfCanvasEntry): void {
        if (activeCanvases.delete(entry)) activeCanvasPixels = Math.max(0, activeCanvasPixels - entry.pixelCount);
        if (entry.canvas) {
          entry.canvas.width = 0;
          entry.canvas.height = 0;
        }
        entry.canvas = null;
        entry.context = null;
      }
    }

    try {
      const pdfjs = await this.loadPdfJsModule();
      const pdfjsPackageRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
      loadingTask = pdfjs.getDocument({
        data: new Uint8Array(buffer),
        isEvalSupported: false,
        enableXfa: false,
        useSystemFonts: false,
        disableRange: true,
        disableStream: true,
        disableAutoFetch: true,
        useWorkerFetch: false,
        useWasm: false,
        cMapUrl: `${path.join(pdfjsPackageRoot, 'cmaps')}${path.sep}`,
        cMapPacked: true,
        standardFontDataUrl: `${path.join(pdfjsPackageRoot, 'standard_fonts')}${path.sep}`,
        maxImageSize: MAX_IMAGE_PIXELS,
        CanvasFactory: BoundedCanvasFactory,
      });
      pdfDocument = await loadingTask.promise;
      if (!Number.isInteger(pdfDocument.numPages) || pdfDocument.numPages < 1) {
        throw this.badRequest('El PDF no contiene páginas válidas.');
      }
      if (pdfDocument.numPages > MAX_PDF_PAGES) {
        throw this.badRequest('El PDF excede el máximo de 10 páginas.');
      }

      const pages: PreparedReceivedDocumentPage[] = [];
      let totalOutputBytes = 0;
      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        const page = await pdfDocument.getPage(pageNumber);
        let canvasEntry: PdfCanvasEntry | undefined;
        try {
          const baseViewport = page.getViewport({ scale: 1 });
          this.assertFiniteViewport(baseViewport);
          const scale = Math.min(1.5, MAX_CANVAS_EDGE / Math.max(baseViewport.width, baseViewport.height));
          const viewport = page.getViewport({ scale });
          this.assertViewportSize(viewport);

          let text = '';
          try {
            const content = await page.getTextContent();
            const items = content.items ?? [];
            const textParts: string[] = [];
            let textLength = 0;
            for (let index = 0; index < items.length && index < MAX_TEXT_ITEMS_PER_PAGE && textLength < MAX_TEXT_CHARS_PER_PAGE; index += 1) {
              const itemText = typeof items[index].str === 'string' ? items[index].str : '';
              if (!itemText) continue;
              const piece = `${textParts.length ? ' ' : ''}${itemText}`.slice(0, MAX_TEXT_CHARS_PER_PAGE - textLength);
              textParts.push(piece);
              textLength += piece.length;
            }
            text = textParts.join('');
          } catch {
            // OCR remains possible from the rendered image when PDF text extraction fails.
          }

          const dimensions = this.validateCanvasDimensions(viewport.width, viewport.height);
          canvasEntry = new BoundedCanvasFactory().create(dimensions.width, dimensions.height);
          if (!canvasEntry.context || !canvasEntry.canvas) {
            throw this.badRequest('No se pudo preparar la página del PDF.');
          }
          await page.render({ canvasContext: canvasEntry.context, viewport }).promise;
          const jpeg = canvasEntry.canvas.toBuffer('image/jpeg', 85);
          const prepared = this.toPage(pageNumber, jpeg, text);
          totalOutputBytes += Buffer.byteLength(prepared.data_uri, 'utf8');
          if (totalOutputBytes > MAX_TOTAL_OUTPUT_BYTES) {
            throw this.badRequest('Las páginas preparadas exceden el límite de 20 MiB.');
          }
          pages.push(prepared);
        } finally {
          if (canvasEntry) new BoundedCanvasFactory().destroy(canvasEntry);
          page.cleanup();
        }
      }
      return { pages, page_count: pdfDocument.numPages };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw this.badRequest('No se pudo leer el PDF del documento.');
    } finally {
      for (const entry of activeCanvases) {
        if (entry.canvas) {
          entry.canvas.width = 0;
          entry.canvas.height = 0;
        }
        entry.canvas = null;
        entry.context = null;
        entry.pixelCount = 0;
      }
      activeCanvases.clear();
      activeCanvasPixels = 0;
      if (pdfDocument) {
        try { await pdfDocument.destroy(); } catch { /* best-effort resource cleanup */ }
      }
      if (loadingTask) {
        try { await loadingTask.destroy(); } catch { /* best-effort resource cleanup */ }
      }
    }
  }

  private toPage(pageNumber: number, jpeg: Buffer, text: string): PreparedReceivedDocumentPage {
    return {
      page_number: pageNumber,
      data_uri: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
      mime_type: 'image/jpeg',
      text: text.slice(0, MAX_TEXT_CHARS_PER_PAGE),
    };
  }

  private assertOutputSize(pages: PreparedReceivedDocumentPage[]): void {
    const bytes = pages.reduce((sum, page) => sum + Buffer.byteLength(page.data_uri, 'utf8'), 0);
    if (bytes > MAX_TOTAL_OUTPUT_BYTES) throw this.badRequest('Las páginas preparadas exceden el límite de 20 MiB.');
  }

  private assertFiniteViewport(viewport: PdfViewport): void {
    if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
      throw this.badRequest('El PDF contiene una página con dimensiones inválidas.');
    }
  }

  private assertViewportSize(viewport: PdfViewport): void {
    this.assertFiniteViewport(viewport);
    if (Math.max(Math.ceil(viewport.width), Math.ceil(viewport.height)) > MAX_CANVAS_EDGE || Math.ceil(viewport.width) * Math.ceil(viewport.height) > MAX_CANVAS_PIXELS) {
      throw this.badRequest('El PDF contiene una página que excede los límites de renderizado.');
    }
  }

  private validateCanvasDimensions(width: number, height: number): { width: number; height: number } {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw this.badRequest('El PDF solicitó dimensiones de imagen inválidas.');
    }
    const safeWidth = Math.ceil(width);
    const safeHeight = Math.ceil(height);
    if (safeWidth * safeHeight > MAX_CANVAS_PIXELS || Math.max(safeWidth, safeHeight) > MAX_CANVAS_EDGE) {
      throw this.badRequest('El PDF solicitó una superficie de imagen demasiado grande.');
    }
    return { width: safeWidth, height: safeHeight };
  }

  private validateInternalCanvasDimensions(width: number, height: number, activePixels: number): { width: number; height: number; pixels: number } {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw this.badRequest('El PDF solicitó dimensiones de imagen inválidas.');
    }
    const safeWidth = Math.ceil(width);
    const safeHeight = Math.ceil(height);
    const pixels = safeWidth * safeHeight;
    if (safeWidth > MAX_PDF_INTERNAL_CANVAS_EDGE || safeHeight > MAX_PDF_INTERNAL_CANVAS_EDGE || pixels > MAX_PDF_INTERNAL_CANVAS_PIXELS) {
      throw this.badRequest('El PDF solicitó una superficie de imagen demasiado grande.');
    }
    if (!Number.isSafeInteger(pixels) || activePixels + pixels > MAX_PDF_ACTIVE_CANVAS_PIXELS) {
      throw this.badRequest('El PDF excede el límite de memoria de superficies de imagen activas.');
    }
    return { width: safeWidth, height: safeHeight, pixels };
  }

  private hasImageMagic(buffer: Buffer, mimeType: string): boolean {
    if (mimeType === 'image/png') {
      return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (mimeType === 'image/jpeg') {
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    }
    return mimeType === 'image/webp' && buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  }

  private badRequest(message: string): BadRequestException {
    return new BadRequestException(message);
  }
}
