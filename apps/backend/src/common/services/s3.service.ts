import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ObjectCannedACL,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import sharp = require('sharp');
import {
  ImageContext,
  IMAGE_PRESETS,
  MIN_PWA_SOURCE_PX,
  PWA_ICON_SPECS,
  PWA_ICON_VARIANTS,
  PwaIconSpec,
  PwaIconVariant,
} from '../config/image-presets';
import {
  extractS3KeyFromUrl,
  isS3Key,
  isSafeS3Key,
} from '../helpers/s3-url.helper';
import { S3PathHelper } from '../helpers/s3-path.helper';

/**
 * Raised when a PWA icon cannot be derived from a tenant logo
 * (missing/corrupt source, unreadable key, sharp failure).
 *
 * Callers MUST catch this and fall back to the Vendix brand icon instead of
 * serving an empty or broken image to the installed app.
 */
export class PwaIconDerivationError extends Error {
  readonly originalError?: unknown;

  constructor(message: string, originalError?: unknown) {
    super(message);
    this.name = 'PwaIconDerivationError';
    this.originalError = originalError;
    Object.setPrototypeOf(this, PwaIconDerivationError.prototype);
  }
}

@Injectable()
export class S3Service {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly logger = new Logger(S3Service.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly s3PathHelper: S3PathHelper,
  ) {
    const region = this.configService.get<string>('AWS_REGION') || 'us-east-1';
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>(
      'AWS_SECRET_ACCESS_KEY',
    );

    this.bucketName =
      this.configService.get<string>('AWS_S3_BUCKET') ||
      'vendix-assets-storage';

    const s3Config: any = {
      region,
    };

    // If keys are provided in env, use them. Otherwise, SDK will try to find credentials (IAM Role)
    if (accessKeyId && secretAccessKey) {
      s3Config.credentials = {
        accessKeyId,
        secretAccessKey,
      };
    }

    this.s3Client = new S3Client(s3Config);
  }

  /**
   * Optimizes and uploads an image to S3. Optionally generates a thumbnail.
   */
  async uploadImage(
    file: Buffer,
    key: string,
    options: { generateThumbnail?: boolean; context?: ImageContext } = {},
  ): Promise<{ key: string; thumbKey?: string }> {
    try {
      const preset = IMAGE_PRESETS[options.context ?? ImageContext.DEFAULT];
      const mainKey = key.endsWith('.webp') ? key : `${key.split('.')[0]}.webp`;

      // Detect already-optimized images to avoid double compression
      if (preset.skipIfAlreadyOptimized) {
        const metadata = await sharp(file).metadata();
        const isAlreadyOptimal =
          metadata.format === 'webp' &&
          (metadata.width ?? 0) <= preset.maxWidth &&
          (metadata.height ?? 0) <= preset.maxHeight;

        if (isAlreadyOptimal) {
          await this.uploadToS3(file, mainKey, 'image/webp');

          let thumbKey: string | undefined;
          if (options.generateThumbnail && preset.thumbnail) {
            thumbKey = await this.generateThumbnail(
              file,
              mainKey,
              preset.thumbnail,
            );
          }

          return { key: mainKey, thumbKey };
        }
      }

      // Optimize main image using context-specific preset
      const optimizedMain = await sharp(file)
        .resize(preset.maxWidth, preset.maxHeight, {
          fit: preset.fit,
          withoutEnlargement: true,
        })
        .webp({ quality: preset.quality })
        .toBuffer();

      await this.uploadToS3(optimizedMain, mainKey, 'image/webp');

      let thumbKey: string | undefined;
      if (options.generateThumbnail && preset.thumbnail) {
        thumbKey = await this.generateThumbnail(
          file,
          mainKey,
          preset.thumbnail,
        );
      }

      return { key: mainKey, thumbKey };
    } catch (error) {
      this.logger.error(`Error processing/uploading image: ${error.message}`);
      throw error;
    }
  }

  /**
   * Uploads an already-processed image without changing its original format.
   * Useful when pixel fidelity matters, e.g. QR overlays that must remain
   * scannable after composition.
   */
  async uploadProcessedImage(
    file: Buffer,
    key: string,
    contentType: string,
    options: { generateThumbnail?: boolean; context?: ImageContext } = {},
  ): Promise<{ key: string; thumbKey?: string }> {
    try {
      await this.uploadToS3(file, key, contentType);

      let thumbKey: string | undefined;
      const preset = IMAGE_PRESETS[options.context ?? ImageContext.DEFAULT];
      if (options.generateThumbnail && preset.thumbnail) {
        thumbKey = await this.generateThumbnail(file, key, preset.thumbnail);
      }

      return { key, thumbKey };
    } catch (error) {
      this.logger.error(
        `Error uploading processed image to ${key}: ${error.message}`,
      );
      throw error;
    }
  }

  private async uploadToS3(
    file: Buffer,
    key: string,
    contentType: string,
  ): Promise<void> {
    const upload = new Upload({
      client: this.s3Client,
      params: {
        Bucket: this.bucketName,
        Key: key,
        Body: file,
        ContentType: contentType,
      },
    });
    await upload.done();
    this.logger.log(`File uploaded successfully to ${key}`);
  }

  private async generateThumbnail(
    file: Buffer,
    mainKey: string,
    thumbPreset: {
      width: number;
      height: number;
      quality: number;
      fit: 'inside' | 'cover' | 'contain';
    },
  ): Promise<string> {
    const optimizedThumb = await sharp(file)
      .resize(thumbPreset.width, thumbPreset.height, { fit: thumbPreset.fit })
      .webp({ quality: thumbPreset.quality })
      .toBuffer();

    const pathParts = mainKey.split('/');
    const fileName = pathParts.pop();
    const thumbKey = [...pathParts, `thumb_${fileName}`].join('/');

    await this.uploadToS3(optimizedThumb, thumbKey, 'image/webp');
    return thumbKey;
  }

  /**
   * Uploads a base64 encoded image to S3
   */
  async uploadBase64(
    base64: string,
    key: string,
    contentType?: string,
    options: { generateThumbnail?: boolean; context?: ImageContext } = {},
  ): Promise<{ key: string; thumbKey?: string }> {
    const matches = base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);

    if (!matches || matches.length !== 3) {
      // If it doesn't match dataURI pattern, maybe it's raw base64
      const buffer = Buffer.from(base64, 'base64');
      return this.uploadImage(buffer, key, options);
    }

    const buffer = Buffer.from(matches[2], 'base64');

    // Use uploadImage to optimize it
    return this.uploadImage(buffer, key, options);
  }

  /**
   * Uploads a file to S3
   * @param file Buffer of the file
   * @param key Path/Name of the file in S3
   * @param contentType MIME type
   */
  async uploadFile(
    file: Buffer,
    key: string,
    contentType: string,
  ): Promise<string> {
    try {
      await this.uploadToS3(file, key, contentType);
      return key;
    } catch (error) {
      this.logger.error(`Error uploading file to S3: ${error.message}`);
      throw error;
    }
  }

  /**
   * Reads an object back as a Buffer.
   *
   * Needed by anything that has to hand the bytes to something else in-process
   * — Vexi's vision tools re-read the document the user attached, and the API
   * bridge rebuilds a `multipart/form-data` request out of it. Signing a URL
   * and fetching it would work but pays a network round trip through the public
   * edge for a file this process can read directly.
   *
   * `validateS3Key` runs first for the same reason it does in `getPresignedUrl`:
   * the key can originate from a database row, and a traversal-shaped key must
   * never reach the client.
   */
  async downloadFile(key: string): Promise<Buffer> {
    this.validateS3Key(key);

    try {
      const response = await this.s3Client.send(
        new GetObjectCommand({ Bucket: this.bucketName, Key: key }),
      );

      const body = response.Body as
        | { transformToByteArray?: () => Promise<Uint8Array> }
        | undefined;

      if (!body?.transformToByteArray) {
        throw new Error('S3 response body is not readable');
      }

      return Buffer.from(await body.transformToByteArray());
    } catch (error: any) {
      this.logger.error(`Error downloading ${key} from S3: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generates a presigned URL for viewing/downloading the file
   * @param key Path of the file in S3
   * @param expiresIn Expiration time in seconds (default 1 hour)
   */
  async getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
    try {
      this.validateS3Key(key);
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      return await getSignedUrl(this.s3Client, command, { expiresIn });
    } catch (error) {
      this.logger.error(
        `Error generating presigned URL for ${key}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Deletes a file from S3
   * @param key Path of the file in S3
   */
  async deleteFile(key: string): Promise<void> {
    try {
      this.validateS3Key(key);
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
      this.logger.log(`File deleted successfully: ${key}`);
    } catch (error) {
      this.logger.error(`Error deleting file from S3: ${error.message}`);
      throw error;
    }
  }

  /**
   * Whether an object exists in the bucket. Never throws: an unreadable or
   * missing key is simply `false`, so callers can use it to pick between
   * candidates without wrapping every call in a try/catch.
   */
  async objectExists(key: string | null | undefined): Promise<boolean> {
    if (!key || !isSafeS3Key(key)) return false;

    try {
      await this.s3Client.send(
        new HeadObjectCommand({ Bucket: this.bucketName, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns the `Content-Type` and `Content-Length` of an object via a HEAD
   * request, or `null` if the object does not exist / is unreachable.
   *
   * Use when the caller needs metadata without downloading the bytes — e.g.
   * `getPaymentReceiptUrl` decides whether the FE should preview an image or
   * render a PDF based on the MIME stored at upload time. Never throws on
   * missing objects: returns `null` so callers can branch on it cleanly.
   */
  async headObject(
    key: string | null | undefined,
  ): Promise<{ contentType: string | null; contentLength: number | null } | null> {
    if (!key || !isSafeS3Key(key)) return null;

    try {
      const response = await this.s3Client.send(
        new HeadObjectCommand({ Bucket: this.bucketName, Key: key }),
      );
      return {
        contentType: response.ContentType ?? null,
        contentLength:
          response.ContentLength !== undefined
            ? Number(response.ContentLength)
            : null,
      };
    } catch {
      return null;
    }
  }

  /**
   * Drops every derived PWA icon cached under a tenant's base path.
   *
   * `getOrCreatePwaIcon` treats an existing derived object as authoritative and
   * never re-renders it, so WITHOUT this the icon a tenant installed with is
   * frozen forever: changing the logo or the brand color has no visible effect.
   *
   * Deletes run CONCURRENTLY and without a preceding HeadObject: this sits in
   * the request path of a settings save, and four sequential head+delete pairs
   * would add eight S3 round-trips to a user-facing PUT. `DeleteObject` is
   * idempotent — deleting an object that was never derived is a no-op, so the
   * existence check bought nothing but latency.
   *
   * Best-effort: one failed delete must not abort the rest, nor fail the write
   * that triggered it.
   *
   * @returns how many deletes completed without error (an object that never
   *          existed counts as one — S3 does not distinguish)
   */
  async deleteDerivedPwaIcons(basePath: string): Promise<number> {
    const prefix = this.s3PathHelper.buildPwaIconPath(basePath);

    const results = await Promise.allSettled(
      PWA_ICON_VARIANTS.map((variant) =>
        this.deleteFile(`${prefix}/${variant}.png`),
      ),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.warn(
          `Could not drop a derived PWA icon under ${prefix}: ` +
            `${this.describeError(result.reason)}`,
        );
      }
    }

    return results.filter((result) => result.status === 'fulfilled').length;
  }

  /**
   * Signs a URL for a given S3 key, optionally targeting a thumbnail.
   * If the URL is already an absolute HTTP(S) URL, returns it as is.
   */
  async signUrl(
    keyOrUrl: string | null | undefined,
    useThumbnail = false,
  ): Promise<string | undefined> {
    if (!keyOrUrl) {
      return undefined;
    }

    const EXPIRATION_TIME = 24 * 60 * 60; // 24 hours

    // If it's an HTTP URL, check if it's an S3 URL that needs re-signing
    let targetKey = keyOrUrl;
    if (keyOrUrl.startsWith('http')) {
      const extractedKey = extractS3KeyFromUrl(keyOrUrl);
      if (!extractedKey || extractedKey === keyOrUrl) {
        // External URL (not S3) — return as-is
        return keyOrUrl;
      }
      // It was an S3 URL (signed or unsigned) — use the extracted key
      targetKey = extractedKey;
    }

    if (useThumbnail) {
      const pathParts = targetKey.split('/');
      const fileName = pathParts.pop();
      const thumbKey = [...pathParts, `thumb_${fileName}`].join('/');

      try {
        return await this.getPresignedUrl(thumbKey, EXPIRATION_TIME);
      } catch {
        // Return original key signature as fallback
        return this.getPresignedUrl(targetKey, EXPIRATION_TIME);
      }
    }

    return this.getPresignedUrl(targetKey, EXPIRATION_TIME);
  }

  /**
   * Generates and uploads favicon files in multiple sizes from a logo buffer.
   * Creates 16x16, 32x32, and 192x192 PNG favicons optimized for browsers and PWA.
   *
   * @param logoBuffer - Buffer of the logo image
   * @param basePath - S3 base path for favicons (caller should use S3PathHelper)
   * @returns Object with favicon key and generated sizes, or null if failed
   */
  async generateAndUploadFaviconFromLogo(
    logoBuffer: Buffer,
    basePath: string,
  ): Promise<{ faviconKey: string; sizes: number[] } | null> {
    try {
      const sizes = [16, 32, 192];
      let mainFaviconKey: string | undefined;

      for (const size of sizes) {
        // Resize image to square using cover fit mode
        const resized = await sharp(logoBuffer)
          .resize(size, size, { fit: 'cover' })
          .png() // Use PNG format for better browser support
          .toBuffer();

        const fileName = `favicon-${size}.png`;
        const key = `${basePath}/${fileName}`;

        // Upload to S3
        await this.uploadToS3(resized, key, 'image/png');

        // Track the main favicon (16x16) for storage in domain config
        if (size === 16) {
          mainFaviconKey = key;
        }

        this.logger.log(`Favicon generated: ${key} (${size}x${size})`);
      }

      if (!mainFaviconKey) {
        throw new Error('Failed to generate main favicon');
      }

      return { faviconKey: mainFaviconKey, sizes };
    } catch (error) {
      this.logger.error(`Error generating favicon: ${error.message}`);
      return null;
    }
  }

  /**
   * Returns the PNG buffer of a PWA icon derived from the tenant logo.
   *
   * Reads `{buildPwaIconPath(basePath)}/{variant}.png` from S3 when it already
   * exists; otherwise derives it from `logoKey` with sharp, persists it under
   * that key and returns it.
   *
   * The binary is ALWAYS served by the backend: this never signs a URL and
   * never makes the derived object public.
   *
   * @param logoKey - S3 key (or legacy S3 URL) of the tenant logo
   * @param basePath - S3 base path of the tenant (see `S3PathHelper`)
   * @param variant - PWA icon variant to produce
   * @param backgroundColor - opaque hex background, e.g. '#2F6F4E'
   * @throws PwaIconDerivationError when the icon cannot be produced
   */
  async getOrCreatePwaIcon(
    logoKey: string,
    basePath: string,
    variant: PwaIconVariant,
    backgroundColor: string,
  ): Promise<Buffer> {
    const spec: PwaIconSpec | undefined = PWA_ICON_SPECS[variant];
    if (!spec) {
      throw new PwaIconDerivationError(
        `Unsupported PWA icon variant: ${String(variant)}`,
      );
    }

    const background = this.normalizePwaBackground(backgroundColor);
    const derivedKey = `${this.s3PathHelper.buildPwaIconPath(basePath)}/${variant}.png`;
    this.validateS3Key(derivedKey);

    const cached = await this.readCachedPwaIcon(derivedKey);
    if (cached) {
      return cached;
    }

    // Tolerate legacy rows that stored a full S3 URL instead of the key
    const sourceKey = extractS3KeyFromUrl(logoKey);
    if (!sourceKey || !isSafeS3Key(sourceKey)) {
      throw new PwaIconDerivationError(
        `Invalid source logo key for PWA icon ${variant}`,
      );
    }

    let logoBuffer: Buffer;
    try {
      logoBuffer = await this.downloadImage(sourceKey);
    } catch (error) {
      throw new PwaIconDerivationError(
        `Source logo "${sourceKey}" could not be read from S3`,
        error,
      );
    }

    if (!logoBuffer || logoBuffer.length === 0) {
      throw new PwaIconDerivationError(
        `Source logo "${sourceKey}" is empty; cannot derive PWA icon ${variant}`,
      );
    }

    await this.assertUsablePwaSource(logoBuffer, sourceKey, variant);

    let icon: Buffer;
    try {
      icon = await this.renderPwaIcon(logoBuffer, spec, background);
    } catch (error) {
      throw new PwaIconDerivationError(
        `Failed to derive PWA icon ${variant} from "${sourceKey}"`,
        error,
      );
    }

    if (icon.length === 0) {
      throw new PwaIconDerivationError(
        `Derived PWA icon ${variant} from "${sourceKey}" is empty`,
      );
    }

    // Caching is best-effort: a failed upload must not fail the request
    try {
      await this.uploadToS3(icon, derivedKey, 'image/png');
      this.logger.log(
        `PWA icon derived and cached: ${derivedKey} (${spec.size}x${spec.size})`,
      );
    } catch (error) {
      this.logger.warn(
        `PWA icon ${derivedKey} derived but could not be cached: ${this.describeError(error)}`,
      );
    }

    return icon;
  }

  /**
   * Rejects a source image too small to become a legible app icon.
   *
   * Throws `PwaIconDerivationError`, which `resolveIconBuffer` already degrades
   * to the Vendix brand icon, so the failure mode is a correct foreign mark
   * rather than an unreadable own one. Unreadable metadata is treated as a
   * rejection too: sharp could not measure it, so neither can we vouch for it.
   */
  private async assertUsablePwaSource(
    logoBuffer: Buffer,
    sourceKey: string,
    variant: PwaIconVariant,
  ): Promise<void> {
    let width: number | undefined;
    let height: number | undefined;

    try {
      ({ width, height } = await sharp(logoBuffer).metadata());
    } catch (error) {
      throw new PwaIconDerivationError(
        `Source "${sourceKey}" could not be measured for PWA icon ${variant}`,
        error,
      );
    }

    const shortestSide = Math.min(width ?? 0, height ?? 0);

    if (shortestSide < MIN_PWA_SOURCE_PX) {
      throw new PwaIconDerivationError(
        `Source "${sourceKey}" is ${width ?? '?'}x${height ?? '?'}, below the ` +
          `${MIN_PWA_SOURCE_PX}px floor for PWA icon ${variant}`,
      );
    }
  }

  /**
   * Reads an already-derived PWA icon. Returns null when it is not cached yet
   * (or is unreadable), so the caller falls back to derivation.
   */
  private async readCachedPwaIcon(key: string): Promise<Buffer | null> {
    try {
      await this.s3Client.send(
        new HeadObjectCommand({ Bucket: this.bucketName, Key: key }),
      );
    } catch {
      // Not generated yet — expected on first request per tenant/variant
      return null;
    }

    try {
      const cached = await this.downloadImage(key);
      return cached && cached.length > 0 ? cached : null;
    } catch (error) {
      this.logger.warn(
        `Cached PWA icon ${key} is unreadable, regenerating: ${this.describeError(error)}`,
      );
      return null;
    }
  }

  /**
   * Renders the square, OPAQUE PNG for a PWA icon spec.
   *
   * `inscribeRatio < 1` inscribes the logo inside the canvas so it survives
   * the Android adaptive-icon (maskable) safe-zone crop.
   */
  private async renderPwaIcon(
    logoBuffer: Buffer,
    spec: PwaIconSpec,
    background: string,
  ): Promise<Buffer> {
    const { size, inscribeRatio } = spec;

    if (inscribeRatio >= 1) {
      return sharp(logoBuffer)
        .resize(size, size, { fit: 'contain', background })
        .flatten({ background })
        .png()
        .toBuffer();
    }

    const inscribedSize = Math.max(1, Math.round(size * inscribeRatio));
    const inscribed = await sharp(logoBuffer)
      .resize(inscribedSize, inscribedSize, { fit: 'contain', background })
      .flatten({ background })
      .png()
      .toBuffer();

    const composed = await sharp({
      create: {
        width: size,
        height: size,
        channels: 3,
        background,
      },
    })
      .composite([{ input: inscribed, gravity: 'centre' }])
      .png()
      .toBuffer();

    // sharp applies `flatten` BEFORE `composite` within a single pipeline, so
    // the alpha channel introduced by the overlay must be dropped in a second
    // pass — otherwise Safari renders the remaining transparency as black.
    return sharp(composed).flatten({ background }).png().toBuffer();
  }

  /**
   * Ensures the PWA icon background is an opaque hex color usable by sharp.
   * Falls back to white instead of failing the whole icon.
   */
  private normalizePwaBackground(backgroundColor: string): string {
    const candidate = (backgroundColor ?? '').trim();

    if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(candidate)) {
      return candidate;
    }

    this.logger.warn(
      `Invalid PWA icon background "${backgroundColor}", falling back to #FFFFFF`,
    );
    return '#FFFFFF';
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * Sanitizes markdown content for storage by replacing signed S3 URLs with S3 keys.
   * Finds all markdown image patterns ![alt](url) and extracts the S3 key from each URL.
   *
   * @param content - Markdown content potentially containing signed S3 URLs
   * @returns Content with signed URLs replaced by S3 keys
   */
  sanitizeMarkdownContent(content: string): string {
    if (!content) {
      return content;
    }

    const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;

    return content.replace(markdownImageRegex, (match, alt, url) => {
      const key = extractS3KeyFromUrl(url);
      return `![${alt}](${key || url})`;
    });
  }

  /**
   * Signs markdown content by replacing S3 keys with fresh presigned URLs.
   * Finds all markdown image patterns ![alt](url) and signs each S3 key.
   *
   * @param content - Markdown content potentially containing S3 keys
   * @returns Content with S3 keys replaced by fresh signed URLs
   */
  async signMarkdownContent(content: string): Promise<string> {
    if (!content) {
      return content;
    }

    // First, sanitize: replace any signed/expired S3 URLs with their S3 keys
    const sanitized = this.sanitizeMarkdownContent(content);

    const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const matches = [...sanitized.matchAll(markdownImageRegex)];

    if (matches.length === 0) {
      return sanitized;
    }

    let result = sanitized;

    for (const match of matches) {
      const [fullMatch, alt, url] = match;

      if (isS3Key(url)) {
        const signedUrl = await this.signUrl(url);
        if (signedUrl) {
          result = result.replace(fullMatch, `![${alt}](${signedUrl})`);
        }
      }
    }

    return result;
  }

  /**
   * Sanitizes a URL or key for database storage.
   * Extracts the S3 key from signed URLs to prevent storing expiring URLs.
   *
   * IMPORTANT: Always use this method before saving image URLs to the database.
   * Signed URLs expire (typically 24 hours), causing images to become inaccessible.
   *
   * @param urlOrKey - A signed S3 URL, an S3 key, or null/undefined
   * @returns The S3 key suitable for storage, or null if input is null/undefined
   *
   * @example
   * // Before saving to database:
   * const keyToStore = this.s3Service.sanitizeForStorage(dto.image_url);
   * await prisma.products.update({ data: { image_url: keyToStore } });
   */
  sanitizeForStorage(urlOrKey: string | null | undefined): string | null {
    return extractS3KeyFromUrl(urlOrKey);
  }

  /**
   * Downloads an image from S3 and returns it as a Buffer.
   * Useful for processing images that are already stored.
   *
   * @param key - S3 key of the image to download
   * @returns Buffer of the image data
   */
  async downloadImage(key: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.s3Client.send(command);

      // Convert stream to buffer
      const chunks: Uint8Array[] = [];
      const stream = response.Body as any;

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      return Buffer.concat(chunks);
    } catch (error) {
      this.logger.error(`Error downloading image from S3: ${error.message}`);
      throw error;
    }
  }

  /**
   * Validates that an S3 key does not contain path traversal sequences.
   * Defense-in-depth: called before any S3 read/delete operation.
   * @throws BadRequestException if the key contains path traversal patterns
   */
  private validateS3Key(key: string): void {
    if (!isSafeS3Key(key)) {
      throw new BadRequestException('Invalid S3 key: path traversal detected');
    }
  }
}
