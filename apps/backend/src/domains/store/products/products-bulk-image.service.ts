import * as AdmZip from 'adm-zip';
import { Injectable, BadRequestException } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { S3Service } from '@common/services/s3.service';
import { S3PathHelper, S3OrgContext, S3StoreContext } from '@common/helpers/s3-path.helper';
import {
  BulkImageUploadResultDto,
  BulkImageSkuResultDto,
} from './dto';

const VALID_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
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
      '3. Formatos aceptados: .jpg, .jpeg, .png, .webp',
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
    let zip: AdmZip;
    try {
      zip = new AdmZip(fileBuffer);
    } catch {
      throw new BadRequestException(
        'El archivo ZIP está corrupto o no es válido',
      );
    }

    const entries = zip.getEntries();

    // First pass: collect valid image entries with their path parts
    const validEntries: { entry: AdmZip.IZipEntry; parts: string[] }[] = [];

    for (const entry of entries) {
      const fullPath = entry.entryName;

      // Skip macOS metadata and hidden files
      if (
        fullPath.startsWith('__MACOSX/') ||
        fullPath.includes('.DS_Store') ||
        fullPath.startsWith('.')
      ) {
        continue;
      }

      // Skip directories themselves and files in root (no folder)
      if (entry.isDirectory) continue;

      const parts = fullPath.split('/');
      if (parts.length < 2 || !parts[0]) continue; // File must be inside a folder

      const fileName = parts[parts.length - 1];

      // Only include valid image files
      const ext = '.' + fileName.split('.').pop()?.toLowerCase();
      if (!VALID_IMAGE_EXTENSIONS.includes(ext)) continue;

      validEntries.push({ entry, parts });
    }

    // Detect wrapper folder: if ALL entries share the same top-level folder
    // and have depth >= 3 (wrapper/SKU/image.jpg), it's a wrapper
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
      throw new BadRequestException(
        'El ZIP no contiene carpetas con SKUs válidos. Asegúrate de que las imágenes estén dentro de carpetas nombradas por SKU.',
      );
    }

    // Get store context for S3 path
    const { org, store } = await this.getStoreWithOrgContext(storeId);
    const basePath = this.s3PathHelper.buildProductPath(org, store);

    const results: BulkImageSkuResultDto[] = [];
    let successful = 0;
    let failed = 0;
    let skipped = 0;

    for (const [skuFolder, imageEntries] of skuFolders) {
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
        message: 'La carpeta no contiene imágenes válidas (.jpg, .jpeg, .png, .webp)',
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
      const buffer = entry.getData();

      const imageKey = `${basePath}/${product.slug}-bulk-${Date.now()}-${i}`;

      const uploadResult = await this.s3Service.uploadImage(buffer, imageKey, {
        generateThumbnail: true,
      });

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
