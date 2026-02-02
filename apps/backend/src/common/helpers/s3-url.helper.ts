/**
 * S3 URL Helper
 *
 * Utilities for handling S3 keys and signed URLs.
 * The primary purpose is to prevent storing signed URLs in the database,
 * which would cause images to become inaccessible after URL expiration.
 */

/**
 * Pattern to match S3 signed URL query parameters.
 * These parameters indicate the URL is a presigned/temporary URL.
 */
const S3_SIGNED_URL_PARAMS = [
  'X-Amz-Algorithm',
  'X-Amz-Credential',
  'X-Amz-Date',
  'X-Amz-Expires',
  'X-Amz-SignedHeaders',
  'X-Amz-Signature',
];

/**
 * Pattern to match S3 bucket hostnames.
 * Supports various S3 URL formats:
 * - https://bucket-name.s3.region.amazonaws.com/key
 * - https://s3.region.amazonaws.com/bucket-name/key
 * - https://bucket-name.s3.amazonaws.com/key
 */
const S3_HOSTNAME_PATTERN = /^(?:[\w-]+\.)?s3(?:\.[\w-]+)?\.amazonaws\.com$/i;

/**
 * Extracts the S3 key from a signed URL or returns the key unchanged if already valid.
 *
 * This function is critical for preventing the storage of signed URLs in the database.
 * Signed URLs expire (typically 24 hours), and storing them causes images to become
 * inaccessible after expiration.
 *
 * @param urlOrKey - A signed S3 URL, an S3 key, or null/undefined
 * @returns The extracted S3 key, or null if input is null/undefined/empty
 *
 * @example
 * // Signed URL → Key
 * extractS3KeyFromUrl("https://bucket.s3.us-east-1.amazonaws.com/org/store/image.webp?X-Amz-Algorithm=...")
 * // Returns: "org/store/image.webp"
 *
 * @example
 * // Already a key → No change
 * extractS3KeyFromUrl("org/store/image.webp")
 * // Returns: "org/store/image.webp"
 *
 * @example
 * // External URL → Preserved (not an S3 URL)
 * extractS3KeyFromUrl("https://external-cdn.com/image.jpg")
 * // Returns: "https://external-cdn.com/image.jpg"
 *
 * @example
 * // Null/undefined → null
 * extractS3KeyFromUrl(null)
 * // Returns: null
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
    // If URL parsing fails, return as-is (might be a malformed URL or key with special chars)
    return trimmed;
  }

  // Check if this is an S3 URL by hostname pattern
  const isS3Url = S3_HOSTNAME_PATTERN.test(url.hostname);

  if (!isS3Url) {
    // Not an S3 URL - return as-is (external CDN, etc.)
    return trimmed;
  }

  // Check if this is a signed URL by looking for signature parameters
  const hasSignedParams = S3_SIGNED_URL_PARAMS.some((param) =>
    url.searchParams.has(param),
  );

  if (!hasSignedParams) {
    // S3 URL but not signed - still extract the key to normalize
    // This handles cases where someone stored a non-signed S3 URL
  }

  // Extract the key from the pathname
  // The pathname starts with '/' so we remove it
  let key = decodeURIComponent(url.pathname);

  // Remove leading slash
  if (key.startsWith('/')) {
    key = key.substring(1);
  }

  // Handle path-style URLs: s3.region.amazonaws.com/bucket-name/key
  // In this case, the first segment is the bucket name, not part of the key
  // We detect this by checking if the hostname is exactly s3.*.amazonaws.com (no bucket prefix)
  const isPathStyleUrl = /^s3(?:\.[\w-]+)?\.amazonaws\.com$/i.test(url.hostname);
  if (isPathStyleUrl) {
    // Remove the bucket name (first segment)
    const slashIndex = key.indexOf('/');
    if (slashIndex !== -1) {
      key = key.substring(slashIndex + 1);
    }
  }

  return key || null;
}

/**
 * Checks if a given string is a signed S3 URL.
 *
 * @param urlOrKey - A potential URL or key
 * @returns true if the string is a signed S3 URL, false otherwise
 */
export function isSignedS3Url(urlOrKey: string | null | undefined): boolean {
  if (!urlOrKey) {
    return false;
  }

  // Quick check for signed URL indicators
  if (!urlOrKey.includes('X-Amz-')) {
    return false;
  }

  try {
    const url = new URL(urlOrKey);
    return S3_SIGNED_URL_PARAMS.some((param) => url.searchParams.has(param));
  } catch {
    return false;
  }
}

/**
 * Checks if a given string appears to be an S3 key (not a URL).
 *
 * @param value - A potential key or URL
 * @returns true if the value looks like an S3 key, false if it's a URL
 */
export function isS3Key(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  const trimmed = value.trim();

  // Keys don't start with http
  return !trimmed.startsWith('http://') && !trimmed.startsWith('https://');
}
