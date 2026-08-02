import { Transform } from 'class-transformer';

/**
 * Trims surrounding whitespace off a string payload field before validation.
 *
 * Opaque third-party identifiers (DIAN TestSetId / SoftwareID, API keys, tokens)
 * are pasted by hand from portals, and a trailing space survives every length
 * and format check that is written loosely enough to allow it — then travels
 * into the remote system as a real character. Normalize at the edge.
 *
 * Non-string values pass through untouched so the companion `@IsString()` /
 * `@IsUUID()` validators still produce the correct error instead of a type
 * error raised inside the transform.
 */
export function TrimString(): PropertyDecorator {
  return Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  );
}

/**
 * Trims and strips formatting separators commonly pasted with Colombian tax
 * identifiers (`902.075.738` -> `902075738`).
 *
 * Deliberately does NOT strip hyphens: `902075738-0` carries the verification
 * digit, and silently gluing it onto the NIT would produce a valid-looking but
 * wrong number. Leaving the hyphen in place lets the `@Matches(/^\d+$/)` guard
 * reject it with a message the user can act on.
 */
export function TrimTaxId(): PropertyDecorator {
  return Transform(({ value }) =>
    typeof value === 'string' ? value.trim().replace(/[.\s]/g, '') : value,
  );
}
