import { BadRequestException, Injectable } from '@nestjs/common';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import * as path from 'node:path';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import {
  AI_IMAGE_MAX_EDGE,
  ImagePrepError,
  prepareImageForAi,
} from '../images/image-prep';
import { classifyPageText, PageReadMode } from './page-content';

export interface DocumentSourceFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

export interface PreparedDocumentPage {
  page_number: number;
  data_uri: string;
  mime_type: 'image/jpeg';
  text: string;
  /** PDF sources only: page size in PDF points (scale 1). */
  width_pt?: number;
  height_pt?: number;
}

export interface PreparedDocumentPages {
  pages: PreparedDocumentPage[];
  page_count: number;
}

export interface DocumentPagesOptions {
  /** PDF page cap. Default 10 (Documentos recibidos, "Leer con IA"). */
  maxPages?: number;
}

export interface AiDocumentPagesOptions extends DocumentPagesOptions {
  /** Longest edge of image uploads. Default {@link AI_IMAGE_MAX_EDGE}. */
  imageMaxEdge?: number;
  /** Read very tall photos in overlapping strips (long photographed lists). Default true. */
  splitTallImages?: boolean;
  /**
   * Upload size cap in bytes. Default 10 MiB; never above 25 MiB. Purchase
   * invoices keep the 15 MB their endpoint always accepted.
   */
  maxBytes?: number;
  /** Real progress while pages are read (done of total pages). */
  onPage?: (done: number, total: number) => Promise<void> | void;
  /**
   * Fiscal forms (RUT, DIAN resolution, habilitación): a page with enough
   * native text is ALSO rendered and goes as text + image, so the model keeps
   * the boxes of the form (which number belongs to which casilla) while the
   * text gives it the exact digits. Default false: native text alone.
   */
  renderTextPages?: boolean;
}

/**
 * One page as the model should read it ("native text first"):
 * - `text`: the PDF has enough native text; no image is rendered or sent.
 * - `text+image`: some text but too little or too noisy; both go.
 * - `image`: scanned page or photo; only the image goes.
 * Never a raw PDF.
 */
export interface AiDocumentPage {
  page_number: number;
  mode: PageReadMode;
  /** Native PDF text (trimmed); '' for photos. */
  text: string;
  /** `data:image/jpeg;base64,…` when `mode` is not `text`. */
  image?: string;
  /** Photos read in strips: "strip 2 of 5". */
  strip?: { index: number; count: number };
  /**
   * Several files read together (one sale, one habilitación): which file this
   * page belongs to (1-based). Absent when only one file is read.
   */
  document?: { index: number; count: number };
}

export interface AiDocumentPages {
  source: 'pdf' | 'image';
  pages: AiDocumentPage[];
  /** PDF pages in the file (strips for a split photo). */
  page_count: number;
  /** PDF pages with neither usable text nor a renderable image (1-based). */
  unreadable_pages: number[];
}

/** Kept for the old import path (`received-documents/services/…`). */
export type ReceivedDocumentSourceFile = DocumentSourceFile;
export type PreparedReceivedDocumentPage = PreparedDocumentPage;
export type PreparedReceivedDocumentPages = PreparedDocumentPages;

/** Page cap exceeded; still a 400 for the legacy `prepare()` callers. */
class PdfPageLimitError extends BadRequestException {}

interface PdfPageResult {
  page_number: number;
  text: string;
  /** Absent when the page was not rendered (enough text) or its render failed. */
  data_uri?: string;
  render_failed?: boolean;
  width_pt: number;
  height_pt: number;
}

interface PdfReadConfig {
  maxPages: number;
  /** Default: render every page. */
  shouldRender?: (text: string) => boolean;
  /** A page whose render throws is kept with its text instead of failing the PDF. */
  tolerateRenderFailure?: boolean;
  onPage?: (done: number, total: number) => Promise<void> | void;
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
/** Ceiling of `AiDocumentPagesOptions.maxBytes` (render time and memory per job). */
const ABSOLUTE_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_OUTPUT_BYTES = 20 * 1024 * 1024;
export const DEFAULT_MAX_PDF_PAGES = 10;
/** Hard ceiling for any profile (render time and memory per job). */
const ABSOLUTE_MAX_PDF_PAGES = 50;
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
const HEIC_MIME = 'image/heic';

/**
 * Prepares bounded page images/text for downstream OCR without fetching remote
 * resources. Shared core of ai-ingest (plan ia-cargas F2); the old
 * `ReceivedDocumentPagesService` name re-exports this class.
 *
 * - `prepare()`: every page rendered + its native text (Documentos recibidos,
 *   "Leer con IA" of workflows, data-collection drafts). Unchanged contract.
 * - `prepareForAi()`: "native text first" for ai-ingest loads; pages with
 *   enough PDF text are not rendered, scanned pages go as images and a PDF
 *   with nothing readable fails with `AI_INGEST_NO_PAGES`.
 */
@Injectable()
export class DocumentPagesService {
  async prepare(
    file: DocumentSourceFile,
    options: DocumentPagesOptions = {},
  ): Promise<PreparedDocumentPages> {
    const mimeType = this.validateFile(file);
    if (mimeType === PDF_MIME) {
      const read = await this.readPdf(file.buffer, {
        maxPages: this.pageCap(options.maxPages),
      });
      return {
        // `readPdf` already holds the full data URI of every rendered page.
        pages: read.pages.map((p) => ({
          page_number: p.page_number,
          data_uri: p.data_uri ?? '',
          mime_type: 'image/jpeg' as const,
          text: p.text,
          width_pt: p.width_pt,
          height_pt: p.height_pt,
        })),
        page_count: read.page_count,
      };
    }
    return this.prepareImage(file.buffer);
  }

  /**
   * ai-ingest reading of a PDF or photo (see {@link AiDocumentPage}). The file
   * type must already be the REAL one (ai-ingest detector). Errors are
   * `VendixHttpException`s with an `AI_INGEST_*` code and a Spanish message.
   */
  async prepareForAi(
    file: DocumentSourceFile,
    options: AiDocumentPagesOptions = {},
  ): Promise<AiDocumentPages> {
    let mimeType: string;
    try {
      mimeType = this.validateFile(file, {
        allowHeic: true,
        maxBytes: options.maxBytes,
      });
    } catch (error) {
      throw this.toIngestError(error);
    }

    if (mimeType !== PDF_MIME) {
      try {
        const images = await prepareImageForAi(file.buffer, {
          maxEdge: options.imageMaxEdge ?? AI_IMAGE_MAX_EDGE,
          splitTall: options.splitTallImages ?? true,
        });
        const pages: AiDocumentPage[] = images.map((img) => ({
          page_number: img.strip,
          mode: 'image',
          text: '',
          image: `data:image/jpeg;base64,${img.buffer.toString('base64')}`,
          ...(img.strips > 1 ? { strip: { index: img.strip, count: img.strips } } : {}),
        }));
        this.assertAiOutputSize(pages);
        await options.onPage?.(pages.length, pages.length);
        return { source: 'image', pages, page_count: pages.length, unreadable_pages: [] };
      } catch (error) {
        throw this.toIngestError(error);
      }
    }

    let read: { pages: PdfPageResult[]; page_count: number };
    try {
      read = await this.readPdf(file.buffer, {
        maxPages: this.pageCap(options.maxPages),
        shouldRender: (text) =>
          !!options.renderTextPages || classifyPageText(text) !== 'text',
        tolerateRenderFailure: true,
        onPage: options.onPage,
      });
    } catch (error) {
      throw this.toIngestError(error);
    }

    const pages: AiDocumentPage[] = [];
    const unreadable: number[] = [];
    for (const p of read.pages) {
      const textMode = classifyPageText(p.text);
      const text = p.text.trim();
      if (textMode === 'text' && options.renderTextPages && p.data_uri) {
        pages.push({ page_number: p.page_number, mode: 'text+image', text, image: p.data_uri });
      } else if (textMode === 'text') {
        pages.push({ page_number: p.page_number, mode: 'text', text });
      } else if (p.data_uri) {
        pages.push({
          page_number: p.page_number,
          mode: textMode === 'text+image' ? 'text+image' : 'image',
          text: textMode === 'text+image' ? text : '',
          image: p.data_uri,
        });
      } else if (textMode === 'text+image') {
        // The image could not be drawn; the little text there is still helps.
        pages.push({ page_number: p.page_number, mode: 'text', text });
      } else {
        unreadable.push(p.page_number);
      }
    }
    if (!pages.length) {
      throw new VendixHttpException(
        ErrorCodes.AI_INGEST_NO_PAGES,
        'El PDF no tiene texto ni páginas que se puedan leer. Si es un escaneo, vuelve a escanearlo o sube fotos de las páginas.',
      );
    }
    return { source: 'pdf', pages, page_count: read.page_count, unreadable_pages: unreadable };
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

  private pageCap(maxPages?: number): number {
    if (maxPages == null || !Number.isFinite(maxPages)) return DEFAULT_MAX_PDF_PAGES;
    return Math.min(ABSOLUTE_MAX_PDF_PAGES, Math.max(1, Math.floor(maxPages)));
  }

  /** 4xx of this service → `AI_INGEST_*` with the same Spanish message. */
  private toIngestError(error: unknown): VendixHttpException {
    if (error instanceof VendixHttpException) return error;
    if (error instanceof PdfPageLimitError) {
      return new VendixHttpException(ErrorCodes.AI_INGEST_TOO_MANY_PAGES, error.message);
    }
    if (error instanceof ImagePrepError) {
      return new VendixHttpException(
        error.reason === 'unsupported'
          ? ErrorCodes.AI_INGEST_UNSUPPORTED_TYPE
          : ErrorCodes.AI_INGEST_INVALID_FILE,
        error.message,
      );
    }
    if (error instanceof BadRequestException) {
      return new VendixHttpException(ErrorCodes.AI_INGEST_INVALID_FILE, error.message);
    }
    return new VendixHttpException(
      ErrorCodes.AI_INGEST_INVALID_FILE,
      'No se pudo leer el documento.',
    );
  }

  private assertAiOutputSize(pages: AiDocumentPage[]): void {
    const bytes = pages.reduce((sum, page) => sum + Buffer.byteLength(page.image ?? '', 'utf8'), 0);
    if (bytes > MAX_TOTAL_OUTPUT_BYTES) throw this.badRequest('Las páginas preparadas exceden el límite de 20 MiB.');
  }

  private validateFile(
    file: DocumentSourceFile,
    options: { allowHeic?: boolean; maxBytes?: number } = {},
  ): string {
    if (!file?.buffer || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      throw this.badRequest('Se requiere un archivo de imagen o PDF.');
    }
    const maxBytes =
      options.maxBytes != null && Number.isFinite(options.maxBytes) && options.maxBytes > 0
        ? Math.min(ABSOLUTE_MAX_UPLOAD_BYTES, Math.floor(options.maxBytes))
        : MAX_UPLOAD_BYTES;
    if (file.buffer.length > maxBytes || file.size !== file.buffer.length) {
      throw this.badRequest(
        `El archivo debe pesar como máximo ${Math.round(maxBytes / (1024 * 1024))} MiB.`,
      );
    }

    const mimeType = file.mimetype?.trim().toLowerCase();
    if (mimeType === PDF_MIME) {
      if (!file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        throw this.badRequest('El contenido no corresponde a un PDF válido.');
      }
      return mimeType;
    }

    if (options.allowHeic && mimeType === HEIC_MIME) {
      // Decoding (or its clear "not supported" message) is image-prep's job.
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

  /** Same sharp pipeline as ai-ingest (image-prep), at the 2048 px this flow always used. */
  private async prepareImage(buffer: Buffer): Promise<PreparedDocumentPages> {
    try {
      const [image] = await prepareImageForAi(buffer, { maxEdge: MAX_CANVAS_EDGE });
      const page = this.toPage(1, image.buffer, '');
      this.assertOutputSize([page]);
      return { pages: [page], page_count: 1 };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error instanceof ImagePrepError && (error.reason === 'too_large' || error.reason === 'multipage')) {
        throw this.badRequest('La imagen excede los límites de páginas o dimensiones permitidos.');
      }
      throw this.badRequest('No se pudo preparar la imagen del documento.');
    }
  }

  private async readPdf(
    buffer: Buffer,
    config: PdfReadConfig,
  ): Promise<{ pages: PdfPageResult[]; page_count: number }> {
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
      if (pdfDocument.numPages > config.maxPages) {
        throw new PdfPageLimitError(
          `El PDF excede el máximo de ${config.maxPages} páginas.${config.maxPages < ABSOLUTE_MAX_PDF_PAGES ? ' Divide el archivo y súbelo por partes.' : ''}`,
        );
      }

      const pages: PdfPageResult[] = [];
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

          const prepared: PdfPageResult = {
            page_number: pageNumber,
            text: text.slice(0, MAX_TEXT_CHARS_PER_PAGE),
            width_pt: baseViewport.width,
            height_pt: baseViewport.height,
          };
          if (!config.shouldRender || config.shouldRender(text)) {
            try {
              const dimensions = this.validateCanvasDimensions(viewport.width, viewport.height);
              canvasEntry = new BoundedCanvasFactory().create(dimensions.width, dimensions.height);
              if (!canvasEntry.context || !canvasEntry.canvas) {
                throw this.badRequest('No se pudo preparar la página del PDF.');
              }
              await page.render({ canvasContext: canvasEntry.context, viewport }).promise;
              const jpeg = canvasEntry.canvas.toBuffer('image/jpeg', 85);
              prepared.data_uri = this.toPage(pageNumber, jpeg, '').data_uri;
            } catch (error) {
              // Limits stay hard errors; only a broken page drawing is tolerated.
              if (!config.tolerateRenderFailure || error instanceof BadRequestException) throw error;
              prepared.render_failed = true;
            }
          }
          totalOutputBytes += Buffer.byteLength(prepared.data_uri ?? '', 'utf8');
          if (totalOutputBytes > MAX_TOTAL_OUTPUT_BYTES) {
            throw this.badRequest('Las páginas preparadas exceden el límite de 20 MiB.');
          }
          pages.push(prepared);
        } finally {
          if (canvasEntry) new BoundedCanvasFactory().destroy(canvasEntry);
          page.cleanup();
        }
        try {
          await config.onPage?.(pageNumber, pdfDocument.numPages);
        } catch {
          // Progress is best effort.
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

  private toPage(pageNumber: number, jpeg: Buffer, text: string): PreparedDocumentPage {
    return {
      page_number: pageNumber,
      data_uri: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
      mime_type: 'image/jpeg',
      text: text.slice(0, MAX_TEXT_CHARS_PER_PAGE),
    };
  }

  private assertOutputSize(pages: PreparedDocumentPage[]): void {
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
