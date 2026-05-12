---
name: vendix-s3-storage
description: >
  S3 storage patterns for Vendix uploads: store S3 keys, never signed URLs, validate safe
  keys, centralize upload paths, use image presets, and sign URLs only for reads. Trigger:
  When uploading files, handling S3 URLs, or saving image/logo/favicon URLs to database.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke: "Uploading files, handling S3 URLs, or saving image URLs to database"
---

# Vendix S3 Storage

## Source of Truth

- `apps/backend/src/common/services/s3.service.ts`
- `apps/backend/src/common/helpers/s3-url.helper.ts`
- `apps/backend/src/common/helpers/s3-path.helper.ts`
- `apps/backend/src/common/config/image-presets.ts`
- `apps/backend/src/common/decorators/is-safe-s3-key.decorator.ts`

## Core Rule

Persist S3 keys, not presigned URLs. Signed URLs expire and will break stored images.

Correct flow:

```text
upload -> key stored in DB -> read response signs key -> frontend receives fresh URL
```

Use `S3Service.sanitizeForStorage(urlOrKey)` before saving image/logo/favicon fields. It delegates to `extractS3KeyFromUrl()`.

## Safety Rules

- Validate read/delete keys with `isSafeS3Key()` / `validateS3Key()`.
- Use `@IsSafeS3Key` for DTO fields that should contain S3 keys.
- Centralize upload paths with `S3PathHelper`; do not hand-build ad-hoc key prefixes in services.
- Use image contexts/presets from `image-presets.ts` for resizing/optimization behavior.
- Allow external absolute URLs only when the owning flow explicitly supports external assets.

## Save Pattern

```typescript
const image_url = this.s3Service.sanitizeForStorage(dto.image_url);
await this.prisma.products.update({ data: { image_url } });
```

## Read Pattern

```typescript
return {
  ...record,
  image_url: await this.s3Service.signUrl(record.image_url),
};
```

## Common Fields

- Product/category image fields.
- Brand/store/organization logos.
- Settings `logo_url` / `favicon_url`.
- Ecommerce slider/gallery image keys.

## Related Skills

- `vendix-validation`
- `vendix-backend`
- `vendix-settings-system`
