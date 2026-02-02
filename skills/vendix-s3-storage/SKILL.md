---
name: vendix-s3-storage
description: >
  S3 storage patterns for file uploads, URL handling, and preventing signed URL persistence bug.
  Trigger: When uploading files, handling S3 URLs, or working with image_url/logo_url/favicon_url fields.
license: MIT
metadata:
  author: vendix
  version: "1.0"
  scope: [root]
  auto_invoke: "Uploading files, handling S3 URLs, or saving image URLs to database"
---

# Vendix S3 Storage Patterns

> **S3 Storage & URL Handling** - Proper patterns for file uploads and preventing signed URL persistence.

## 🎯 When to Use

Use this skill when:
- Uploading files to S3 (images, documents, etc.)
- Saving image URLs to the database (`image_url`, `logo_url`, `favicon_url`, etc.)
- Working with the `S3Service`
- Creating or modifying services that handle file uploads

---

## 🚨 Critical Pattern: Prevent Signed URL Persistence

### The Bug

**What happens:** When uploading to S3, a presigned URL is returned. If this URL is saved directly to the database, it will expire (typically 24 hours), causing images to become inaccessible (403 Forbidden).

**The Flow (BEFORE fix):**
```
Upload → Presigned URL → Frontend → Backend saves presigned URL → 24h → 403 ❌
```

**The Flow (AFTER fix):**
```
Upload → Presigned URL → Frontend → Backend extracts KEY → Save KEY → signUrl() regenerates → ✅
```

---

## 🔧 Helper: `s3-url.helper.ts`

**File:** `apps/backend/src/common/helpers/s3-url.helper.ts`

```typescript
/**
 * Extracts the S3 key from a signed URL or returns the key unchanged if already valid.
 *
 * This function is critical for preventing the storage of signed URLs in the database.
 * Signed URLs expire (typically 24 hours), and storing them causes images to become
 * inaccessible after expiration.
 *
 * @param urlOrKey - A signed S3 URL, an S3 key, or null/undefined
 * @returns The extracted S3 key, or null if input is null/undefined/empty
 */
export function extractS3KeyFromUrl(urlOrKey: string | null | undefined): string | null {
  // Handle null, undefined, or empty strings
  if (!urlOrKey || urlOrKey.trim() === '') {
    return null;
  }

  const trimmed = urlOrKey.trim();

  // If it doesn't start with http, it's already a key
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return trimmed;
  }

  // Try to parse as URL
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }

  // Check if this is an S3 URL by hostname pattern
  const S3_HOSTNAME_PATTERN = /^(?:[\w-]+\.)?s3(?:\.[\w-]+)?\.amazonaws\.com$/i;
  const isS3Url = S3_HOSTNAME_PATTERN.test(url.hostname);

  if (!isS3Url) {
    // Not an S3 URL - return as-is (external CDN, etc.)
    return trimmed;
  }

  // Extract the key from the pathname
  let key = decodeURIComponent(url.pathname);

  // Remove leading slash
  if (key.startsWith('/')) {
    key = key.substring(1);
  }

  // Handle path-style URLs: s3.region.amazonaws.com/bucket-name/key
  const isPathStyleUrl = /^s3(?:\.[\w-]+)?\.amazonaws\.com$/i.test(url.hostname);
  if (isPathStyleUrl) {
    const slashIndex = key.indexOf('/');
    if (slashIndex !== -1) {
      key = key.substring(slashIndex + 1);
    }
  }

  return key || null;
}

/**
 * Checks if a given string is a signed S3 URL.
 */
export function isSignedS3Url(urlOrKey: string | null | undefined): boolean {
  if (!urlOrKey) return false;
  if (!urlOrKey.includes('X-Amz-')) return false;

  try {
    const url = new URL(urlOrKey);
    const S3_SIGNED_URL_PARAMS = [
      'X-Amz-Algorithm', 'X-Amz-Credential', 'X-Amz-Date',
      'X-Amz-Expires', 'X-Amz-SignedHeaders', 'X-Amz-Signature',
    ];
    return S3_SIGNED_URL_PARAMS.some((param) => url.searchParams.has(param));
  } catch {
    return false;
  }
}

/**
 * Checks if a given string appears to be an S3 key (not a URL).
 */
export function isS3Key(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return !trimmed.startsWith('http://') && !trimmed.startsWith('https://');
}
```

---

## 🔧 S3Service: `sanitizeForStorage()` Method

**File:** `apps/backend/src/common/services/s3.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { extractS3KeyFromUrl } from '../helpers/s3-url.helper';

@Injectable()
export class S3Service {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly logger = new Logger(S3Service.name);

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('AWS_REGION') || 'us-east-1';
    this.bucketName = this.configService.get<string>('AWS_S3_BUCKET') || 'vendix-assets-storage';
    this.s3Client = new S3Client({ region });
  }

  /**
   * Uploads an image to S3 with optimization.
   */
  async uploadImage(
    file: Buffer,
    key: string,
    options: { generateThumbnail?: boolean } = {},
  ): Promise<{ key: string; thumbKey?: string }> {
    // Optimization with sharp, then upload
    // ...
  }

  /**
   * Generates a presigned URL for viewing/downloading the file.
   */
  async getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    return await getSignedUrl(this.s3Client, command, { expiresIn });
  }

  /**
   * Deletes a file from S3.
   */
  async deleteFile(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    await this.s3Client.send(command);
  }

  /**
   * Signs a URL for a given S3 key.
   * If the URL is already an absolute HTTP(S) URL, returns it as is.
   */
  async signUrl(keyOrUrl: string | null | undefined, useThumbnail = false): Promise<string | undefined> {
    if (!keyOrUrl || keyOrUrl.startsWith('http')) {
      return keyOrUrl || undefined;
    }

    const EXPIRATION_TIME = 24 * 60 * 60; // 24 hours

    let targetKey = keyOrUrl;
    if (useThumbnail) {
      const pathParts = keyOrUrl.split('/');
      const fileName = pathParts.pop();
      targetKey = [...pathParts, `thumb_${fileName}`].join('/');

      try {
        return await this.getPresignedUrl(targetKey, EXPIRATION_TIME);
      } catch {
        return this.getPresignedUrl(keyOrUrl, EXPIRATION_TIME);
      }
    }

    return this.getPresignedUrl(targetKey, EXPIRATION_TIME);
  }

  /**
   * Sanitizes a URL or key for database storage.
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
}
```

---

## 📋 Pattern: Saving Image URLs to Database

### ✅ CORRECT Pattern

```typescript
// apps/backend/src/domains/store/products/products.service.ts
import { S3Service } from '@/common/services/s3.service';

@Injectable()
export class ProductsService {
  constructor(private readonly s3Service: S3Service) {}

  async create(dto: CreateProductDto) {
    // ✅ Sanitize BEFORE saving to database
    const image_url = this.s3Service.sanitizeForStorage(dto.image_url);

    return this.prisma.products.create({
      data: {
        ...dto,
        image_url, // Store the KEY, not the signed URL
      },
    });
  }

  async update(id: number, dto: UpdateProductDto) {
    // ✅ Sanitize on update too
    const image_url = this.s3Service.sanitizeForStorage(dto.image_url);

    return this.prisma.products.update({
      where: { id },
      data: {
        ...dto,
        image_url,
      },
    });
  }

  async findAll() {
    const products = await this.prisma.products.findMany();

    // ✅ Sign URLs when returning to frontend
    return Promise.all(
      products.map(async (product) => ({
        ...product,
        image_url: await this.s3Service.signUrl(product.image_url),
      }))
    );
  }
}
```

### ❌ WRONG Pattern

```typescript
// ❌ WRONG: Saves signed URL directly to database
async create(dto: CreateProductDto) {
  return this.prisma.products.create({
    data: {
      ...dto,
      image_url: dto.image_url, // ❌ This might be a signed URL!
    },
  });
}
```

---

## 📋 Affected Services Summary

| Service | Fields Sanitized |
|---------|------------------|
| `ecommerce.service.ts` | `inicio.logo_url`, `slider.photos[].url/key` |
| `products.service.ts` | `image_url` (in handleImageUploads and image_urls legacy) |
| `settings.service.ts` | `app.logo_url`, `app.favicon_url`, `general.logo_url` |
| `categories.service.ts` | `image_url` (in create and update) |
| `brands.service.ts` | `logo_url` (in create and update) |

---

## 🎯 Decision Tree

```
Handling image URLs from frontend?
├── Receive DTO with image_url (could be signed URL or key)
├── Before saving to DB:
│   └── Use: this.s3Service.sanitizeForStorage(dto.image_url)
├── Save the returned KEY to database
├── When returning to frontend:
│   └── Use: await this.s3Service.signUrl(stored_key)
└── Frontend receives fresh presigned URL (valid for 24h)
```

---

## 📦 Key Files Reference

| File | Purpose |
|------|---------|
| `apps/backend/src/common/helpers/s3-url.helper.ts` | Helper for URL/Key extraction |
| `apps/backend/src/common/services/s3.service.ts` | S3 operations + `sanitizeForStorage()` |
| `apps/backend/src/domains/store/products/products.service.ts` | Example usage for products |
| `apps/backend/src/domains/store/brands/brands.service.ts` | Example usage for brands |
| `apps/backend/src/domains/store/categories/categories.service.ts` | Example usage for categories |
| `apps/backend/src/domains/store/settings/settings.service.ts` | Example usage for settings |
| `apps/backend/src/domains/store/ecommerce/ecommerce.service.ts` | Example usage for ecommerce |

---

## 📚 Related Skills

- `vendix-backend` - NestJS patterns
- `vendix-backend-prisma` - Prisma services
- `vendix-backend-api` - API endpoint patterns
- `vendix-validation` - Validation patterns
- `vendix-store-settings` - Settings with favicon generation
