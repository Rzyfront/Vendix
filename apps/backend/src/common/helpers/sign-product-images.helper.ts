import type { S3Service } from '@common/services/s3.service';

type Signer = Pick<S3Service, 'signUrl'>;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Signs, in place, every `product_images.image_url` found anywhere inside a
 * Prisma result (`product_images` may be an array or, on variants, a single
 * object). `image_url` stores the S3 key, so it must be signed before it
 * reaches the client — same rule as `ProductsService.signProductImages`.
 * Only plain objects and arrays are walked (Decimal/Date are left alone).
 */
export async function signProductImageUrls<T>(
  s3: Signer | undefined,
  root: T,
): Promise<T> {
  if (!s3) return root;
  const pending: Promise<void>[] = [];

  const signImage = (img: unknown) => {
    if (!isPlainObject(img) || typeof img.image_url !== 'string') return;
    pending.push(
      s3.signUrl(img.image_url).then((signed) => {
        img.image_url = signed ?? null;
      }),
    );
  };

  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!isPlainObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'product_images') {
        if (Array.isArray(value)) value.forEach(signImage);
        else signImage(value);
      } else {
        walk(value);
      }
    }
  };

  walk(root);
  await Promise.all(pending);
  return root;
}
