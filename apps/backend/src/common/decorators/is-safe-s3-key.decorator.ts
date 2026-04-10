import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Validates that an S3 key does not contain path traversal sequences.
 *
 * Blocks: ../, ..\\, encoded variants (%2e%2e, %252e), null bytes.
 * After URI-decoding the key, checks that no '..' segment exists
 * in the path that could allow escaping the intended directory.
 */
export function IsSafeS3Key(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isSafeS3Key',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any): boolean {
          if (typeof value !== 'string') return false;

          let decoded: string;
          try {
            decoded = decodeURIComponent(value);
          } catch {
            return false;
          }

          // Null bytes
          if (decoded.includes('\0') || value.includes('%00')) return false;

          // Backslash traversal
          if (decoded.includes('..\\')) return false;

          // Slash traversal (raw and decoded)
          if (decoded.includes('../') || value.includes('../')) return false;

          // Standalone '..' segments
          if (decoded.split('/').some((s) => s === '..')) return false;

          return true;
        },
        defaultMessage(): string {
          return `key contains invalid path characters`;
        },
      },
    });
  };
}
