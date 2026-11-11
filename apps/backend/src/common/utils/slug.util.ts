/**
 * Utility functions for generating URL-friendly slugs
 */

/**
 * Generate a URL-friendly slug from a string
 * @param text - The text to convert to a slug
 * @returns A URL-friendly slug
 */
export function generateSlug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Strip accents: 'fútbol' → 'futbol', 'ñ' → 'n'
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

/**
 * Slug the same text got before accents were transliterated (they were
 * dropped: "Lácteos" → "lcteos"). Only for finding records saved back then.
 */
function legacySlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Slugs to look a record up by when it is found by its name's slug: the
 * current one and, for accented names, the one older imports saved (S23).
 * New records are always created with `generateSlug`.
 */
export function slugLookupCandidates(text: string): string[] {
  return [...new Set([generateSlug(text), legacySlug(text)])].filter(Boolean);
}

/**
 * Generate a unique slug by appending a number if the base slug already exists
 * @param baseSlug - The base slug to make unique
 * @param existingSlugChecker - Function that checks if a slug exists
 * @returns A unique slug
 */
export async function generateUniqueSlug(
  baseSlug: string,
  existingSlugChecker: (slug: string) => Promise<boolean>,
): Promise<string> {
  let slug = baseSlug;
  let counter = 1;

  while (await existingSlugChecker(slug)) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  return slug;
}

/**
 * Validate that a slug contains only allowed characters
 * @param slug - The slug to validate
 * @returns True if valid, false otherwise
 */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}
