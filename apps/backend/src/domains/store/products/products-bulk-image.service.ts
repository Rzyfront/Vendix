import * as AdmZip from 'adm-zip';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { Injectable, BadRequestException } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { S3Service } from '@common/services/s3.service';
import {
  S3PathHelper,
  S3OrgContext,
  S3StoreContext,
} from '@common/helpers/s3-path.helper';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { ImageContext } from '@common/config/image-presets';
import {
  BulkImageUploadResultDto,
  BulkImageSkuResultDto,
  BulkImageAnalysisResultDto,
  BulkImageAnalysisSkuDto,
} from './dto';

const VALID_IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
  '.tiff',
  '.tif',
  '.heic',
  '.heif',
  '.avif',
  '.svg',
];
const MAX_IMAGES_PER_PRODUCT = 5;

@Injectable()
export class ProductsBulkImageService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3Service: S3Service,
    private readonly s3PathHelper: S3PathHelper,
  ) {}

  /**
   * Generates an example ZIP template with README and sample SKU folders
   */
  async generateExampleTemplate(): Promise<Buffer> {
    const zip = new AdmZip();

    const readme = [
      'INSTRUCCIONES - Carga Masiva de Imágenes de Productos',
      '=====================================================',
      '',
      '1. Crea una carpeta por cada producto, nombrada con el SKU exacto del producto.',
      '2. Dentro de cada carpeta, coloca las imágenes del producto.',
      '3. Formatos aceptados: .jpg, .jpeg, .png, .webp, .gif, .bmp, .tiff, .heic, .heif, .avif, .svg',
      '4. Máximo 5 imágenes por producto.',
      '5. Las imágenes se ordenan alfabéticamente. La primera será la imagen principal',
      '   (solo si el producto no tiene ya una imagen principal).',
      '6. Comprime todo en un archivo .zip y súbelo.',
      '',
      'Ejemplo de estructura:',
      '  SKU-EJEMPLO-001/',
      '    01-frente.jpg',
      '    02-lateral.jpg',
      '    03-detalle.jpg',
      '  SKU-EJEMPLO-002/',
      '    foto-principal.png',
      '',
      'NOTAS:',
      '- Los SKUs son insensibles a mayúsculas/minúsculas.',
      '- Si el producto ya tiene imágenes, solo se llenarán los espacios disponibles hasta 5.',
      '- Los archivos que no sean imágenes válidas serán ignorados.',
    ].join('\n');

    zip.addFile('README.txt', Buffer.from(readme, 'utf-8'));
    zip.addFile('SKU-EJEMPLO-001/', Buffer.alloc(0));
    zip.addFile('SKU-EJEMPLO-002/', Buffer.alloc(0));

    return zip.toBuffer();
  }

  /**
   * Generates a ZIP template with empty folders for each real SKU in the store
   */
  async generateStoreSkuTemplate(storeId: number): Promise<Buffer> {
    const products = await this.prisma.products.findMany({
      where: { store_id: storeId, state: 'active' },
      select: { sku: true },
      orderBy: { sku: 'asc' },
    });

    if (products.length === 0) {
      throw new BadRequestException(
        'No se encontraron productos activos en la tienda',
      );
    }

    const zip = new AdmZip();

    for (const product of products) {
      if (product.sku) {
        zip.addFile(`${product.sku}/`, Buffer.alloc(0));
      }
    }

    return zip.toBuffer();
  }

  /**
   * Processes a ZIP file containing SKU-named folders with product images
   */
  async processImageZip(
    fileBuffer: Buffer,
    storeId: number,
  ): Promise<BulkImageUploadResultDto> {
    const skuFolders = this.parseAndGroupZipEntries(fileBuffer);

    // Get store context for S3 path
    const { org, store } = await this.getStoreWithOrgContext(storeId);
    const basePath = this.s3PathHelper.buildProductPath(org, store);

    const results: BulkImageSkuResultDto[] = [];
    let successful = 0;
    let failed = 0;
    let skipped = 0;

    for (const [skuFolder, allEntries] of skuFolders) {
      // Filter to valid image extensions only
      const imageEntries = allEntries.filter((entry) => {
        const fileName = entry.entryName.split('/').pop() || '';
        const ext = '.' + fileName.split('.').pop()?.toLowerCase();
        return VALID_IMAGE_EXTENSIONS.includes(ext);
      });

      try {
        const result = await this.processSkuFolder(
          skuFolder,
          imageEntries,
          storeId,
          basePath,
        );
        results.push(result);

        if (result.status === 'success') successful++;
        else if (result.status === 'error') failed++;
        else if (result.status === 'skipped') skipped++;
      } catch (error) {
        failed++;
        results.push({
          sku: skuFolder,
          status: 'error',
          message: `Error inesperado: ${error.message}`,
          images_uploaded: 0,
        });
      }
    }

    return {
      success: failed === 0,
      total_skus_processed: skuFolders.size,
      successful,
      failed,
      skipped,
      results,
    };
  }

  /**
   * Analyzes a ZIP file without uploading images. Returns per-SKU analysis.
   * Stores the ZIP temporarily in S3 for later processing.
   */
  async analyzeImageZip(
    fileBuffer: Buffer,
    storeId: number,
  ): Promise<BulkImageAnalysisResultDto> {
    const skuFolders = this.parseAndGroupZipEntries(fileBuffer);

    // Pre-fetch all active products for the store (avoid N+1)
    const allProducts = await this.prisma.products.findMany({
      where: { store_id: storeId },
      select: {
        id: true,
        sku: true,
        name: true,
        slug: true,
        state: true,
        product_images: { select: { id: true } },
      },
    });

    const productMap = new Map<string, (typeof allProducts)[0]>();
    for (const product of allProducts) {
      if (product.sku) {
        productMap.set(product.sku.toLowerCase(), product);
      }
    }

    const skus: BulkImageAnalysisSkuDto[] = [];
    let ready = 0;
    let withWarnings = 0;
    let withErrors = 0;

    for (const [skuFolder, entries] of skuFolders) {
      const skuResult: BulkImageAnalysisSkuDto = {
        sku: skuFolder,
        sku_found: false,
        images_in_zip: entries.length,
        valid_images: 0,
        invalid_files: [],
        current_image_count: 0,
        slots_available: 0,
        images_to_upload: 0,
        status: 'ready',
        warnings: [],
        errors: [],
      };

      // Classify entries
      for (const entry of entries) {
        const fileName = entry.entryName.split('/').pop() || '';
        const ext = '.' + fileName.split('.').pop()?.toLowerCase();
        if (VALID_IMAGE_EXTENSIONS.includes(ext)) {
          skuResult.valid_images++;
        } else {
          skuResult.invalid_files.push(fileName);
        }
      }

      // Find product
      const product = productMap.get(skuFolder.toLowerCase());

      if (!product) {
        skuResult.status = 'error';
        skuResult.errors.push(
          `No se encontró un producto con SKU "${skuFolder}" en esta tienda`,
        );
        withErrors++;
        skus.push(skuResult);
        continue;
      }

      skuResult.sku_found = true;
      skuResult.product_id = product.id;
      skuResult.product_name = product.name;
      skuResult.current_image_count = product.product_images.length;
      skuResult.slots_available = Math.max(
        0,
        MAX_IMAGES_PER_PRODUCT - product.product_images.length,
      );

      if (skuResult.valid_images === 0) {
        skuResult.status = 'error';
        skuResult.errors.push(
          'La carpeta no contiene imágenes con formato válido',
        );
        withErrors++;
        skus.push(skuResult);
        continue;
      }

      if (skuResult.slots_available === 0) {
        skuResult.status = 'error';
        skuResult.errors.push(
          `El producto ya tiene ${MAX_IMAGES_PER_PRODUCT} imágenes (máximo permitido)`,
        );
        withErrors++;
        skus.push(skuResult);
        continue;
      }

      skuResult.images_to_upload = Math.min(
        skuResult.valid_images,
        skuResult.slots_available,
      );

      // Warnings
      if (skuResult.invalid_files.length > 0) {
        skuResult.warnings.push(
          `${skuResult.invalid_files.length} archivo(s) con formato no soportado serán ignorados: ${skuResult.invalid_files.join(', ')}`,
        );
        skuResult.status = 'warning';
      }

      if (skuResult.valid_images > skuResult.slots_available) {
        skuResult.warnings.push(
          `Solo se subirán ${skuResult.slots_available} de ${skuResult.valid_images} imágenes (el producto ya tiene ${skuResult.current_image_count})`,
        );
        skuResult.status = 'warning';
      }

      if (product.state !== 'active') {
        skuResult.warnings.push(
          `El producto está en estado "${product.state}"`,
        );
        skuResult.status = 'warning';
      }

      if (skuResult.status === 'warning') {
        withWarnings++;
      } else {
        ready++;
      }

      skus.push(skuResult);
    }

    // Upload ZIP to temp S3 for later processing
    const sessionId = uuidv4();
    const tempKey = `tmp/bulk-images/${storeId}/${sessionId}.zip`;
    await this.s3Service.uploadFile(fileBuffer, tempKey, 'application/zip');

    return {
      session_id: sessionId,
      total_skus: skuFolders.size,
      ready,
      with_warnings: withWarnings,
      with_errors: withErrors,
      supported_formats: [...VALID_IMAGE_EXTENSIONS],
      skus,
    };
  }

  /**
   * Processes a previously analyzed ZIP from a temp S3 session
   */
  async processImageZipFromSession(
    sessionId: string,
    storeId: number,
  ): Promise<BulkImageUploadResultDto> {
    const tempKey = `tmp/bulk-images/${storeId}/${sessionId}.zip`;

    let fileBuffer: Buffer;
    try {
      fileBuffer = await this.s3Service.downloadImage(tempKey);
    } catch {
      throw new VendixHttpException(
        ErrorCodes.BULK_IMG_SESSION_EXPIRED,
        'La sesión de análisis no fue encontrada o ha expirado. Por favor, vuelve a subir el archivo.',
      );
    }

    try {
      const result = await this.processImageZip(fileBuffer, storeId);
      return result;
    } finally {
      // Clean up temp ZIP regardless of success/failure
      try {
        await this.s3Service.deleteFile(tempKey);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Cancels an analysis session by deleting the temp ZIP
   */
  async cancelSession(sessionId: string, storeId: number): Promise<void> {
    const tempKey = `tmp/bulk-images/${storeId}/${sessionId}.zip`;
    try {
      await this.s3Service.deleteFile(tempKey);
    } catch {
      // Ignore if already deleted
    }
  }

  /**
   * Parses a ZIP buffer and groups file entries by SKU folder.
   * Does NOT filter by image extension — consumers handle that.
   */
  private parseAndGroupZipEntries(
    fileBuffer: Buffer,
  ): Map<string, AdmZip.IZipEntry[]> {
    if (!fileBuffer || fileBuffer.length < 22) {
      console.error(
        '[bulk-images] Invalid ZIP buffer',
        JSON.stringify({
          received: !!fileBuffer,
          size: fileBuffer?.length ?? 0,
          magic: fileBuffer?.slice(0, 4).toString('hex') ?? null,
        }),
      );
      throw new VendixHttpException(
        ErrorCodes.BULK_IMG_ZIP_CORRUPT,
        'El archivo ZIP está corrupto o no es válido',
      );
    }

    const magic = fileBuffer.slice(0, 4).toString('hex');
    const isZipMagic =
      magic === '504b0304' || magic === '504b0506' || magic === '504b0708';
    if (!isZipMagic) {
      console.error(
        '[bulk-images] File is not a valid ZIP (bad magic)',
        JSON.stringify({ size: fileBuffer.length, magic }),
      );
      throw new VendixHttpException(
        ErrorCodes.BULK_IMG_ZIP_CORRUPT,
        'El archivo ZIP está corrupto o no es válido',
      );
    }

    let zip: AdmZip;
    try {
      zip = new AdmZip(fileBuffer);
    } catch (error) {
      console.error(
        '[bulk-images] AdmZip failed to parse buffer',
        JSON.stringify({
          size: fileBuffer.length,
          magic,
          message: (error as Error)?.message,
        }),
      );
      throw new VendixHttpException(
        ErrorCodes.BULK_IMG_ZIP_CORRUPT,
        'El archivo ZIP está corrupto o no es válido',
      );
    }

    const entries = zip.getEntries();
    const validEntries: { entry: AdmZip.IZipEntry; parts: string[] }[] = [];

    for (const entry of entries) {
      const fullPath = entry.entryName;

      if (
        fullPath.startsWith('__MACOSX/') ||
        fullPath.includes('.DS_Store') ||
        fullPath.startsWith('.')
      ) {
        continue;
      }

      if (entry.isDirectory) continue;

      const parts = fullPath.split('/');
      if (parts.length < 2 || !parts[0]) continue;

      validEntries.push({ entry, parts });
    }

    // Detect wrapper folder
    const topLevelFolders = new Set(validEntries.map((e) => e.parts[0]));
    const hasWrapper =
      topLevelFolders.size === 1 &&
      validEntries.every((e) => e.parts.length >= 3);
    const skuIndex = hasWrapper ? 1 : 0;

    // Group entries by SKU folder
    const skuFolders = new Map<string, AdmZip.IZipEntry[]>();

    for (const { entry, parts } of validEntries) {
      const skuFolder = parts[skuIndex];
      if (!skuFolder) continue;

      if (!skuFolders.has(skuFolder)) {
        skuFolders.set(skuFolder, []);
      }
      skuFolders.get(skuFolder)!.push(entry);
    }

    if (skuFolders.size === 0) {
      throw new VendixHttpException(
        ErrorCodes.BULK_IMG_NO_SKUS,
        'El ZIP no contiene carpetas con SKUs válidos. Asegúrate de que las imágenes estén dentro de carpetas nombradas por SKU.',
      );
    }

    return skuFolders;
  }

  /**
   * Processes images for a single SKU folder
   */
  private async processSkuFolder(
    sku: string,
    imageEntries: AdmZip.IZipEntry[],
    storeId: number,
    basePath: string,
  ): Promise<BulkImageSkuResultDto> {
    // Find product by SKU (case-insensitive)
    const product = await this.prisma.products.findFirst({
      where: {
        store_id: storeId,
        sku: { equals: sku, mode: 'insensitive' },
      },
      select: {
        id: true,
        slug: true,
        product_images: {
          select: { id: true, is_main: true },
        },
      },
    });

    if (!product) {
      return {
        sku,
        status: 'error',
        message: `No se encontró un producto con SKU "${sku}" en esta tienda`,
        images_uploaded: 0,
      };
    }

    // Check available slots
    const existingCount = product.product_images.length;
    const slotsAvailable = MAX_IMAGES_PER_PRODUCT - existingCount;

    if (slotsAvailable <= 0) {
      return {
        sku,
        status: 'skipped',
        message: `El producto ya tiene ${existingCount} imágenes (máximo ${MAX_IMAGES_PER_PRODUCT})`,
        images_uploaded: 0,
        product_id: product.id,
      };
    }

    if (imageEntries.length === 0) {
      return {
        sku,
        status: 'error',
        message: `La carpeta no contiene imágenes válidas (formatos soportados: ${VALID_IMAGE_EXTENSIONS.join(', ')})`,
        images_uploaded: 0,
        product_id: product.id,
      };
    }

    // Sort alphabetically, take up to available slots
    const sortedEntries = imageEntries
      .sort((a, b) => a.entryName.localeCompare(b.entryName))
      .slice(0, slotsAvailable);

    // Check if product has a main image
    const hasMainImage = product.product_images.some((img) => img.is_main);
    const nextSortOrder = existingCount;

    let imagesUploaded = 0;

    for (let i = 0; i < sortedEntries.length; i++) {
      const entry = sortedEntries[i];
      let imageBuffer = entry.getData();
      const ext = '.' + entry.entryName.split('.').pop()?.toLowerCase();

      // SVG needs rasterization before WebP conversion
      if (ext === '.svg') {
        try {
          imageBuffer = await sharp(imageBuffer, { density: 150 })
            .png()
            .toBuffer();
        } catch {
          // Skip SVG files that fail to rasterize
          continue;
        }
      }

      const imageKey = `${basePath}/${product.slug}-bulk-${Date.now()}-${i}`;

      const uploadResult = await this.s3Service.uploadImage(
        imageBuffer,
        imageKey,
        {
          generateThumbnail: true,
          context: ImageContext.PRODUCT,
        },
      );

      await this.prisma.product_images.create({
        data: {
          product_id: product.id,
          image_url: uploadResult.key,
          is_main: !hasMainImage && i === 0,
          sort_order: nextSortOrder + i,
        },
      });

      imagesUploaded++;
    }

    const skippedCount = imageEntries.length - sortedEntries.length;
    let message = `${imagesUploaded} imagen(es) subida(s) exitosamente`;
    if (skippedCount > 0) {
      message += `. ${skippedCount} imagen(es) omitida(s) por límite de ${MAX_IMAGES_PER_PRODUCT}`;
    }

    return {
      sku,
      status: 'success',
      message,
      images_uploaded: imagesUploaded,
      product_id: product.id,
    };
  }

  /**
   * Helper to get store with organization context for S3 path building
   */
  private async getStoreWithOrgContext(
    storeId: number,
  ): Promise<{ org: S3OrgContext; store: S3StoreContext }> {
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        slug: true,
        organizations: {
          select: { id: true, slug: true },
        },
      },
    });

    if (!store || !store.organizations) {
      throw new BadRequestException('Store or organization not found');
    }

    return {
      org: store.organizations,
      store: { id: store.id, slug: store.slug },
    };
  }
}
