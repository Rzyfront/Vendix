import { registerDecorator, ValidationOptions } from 'class-validator';
import { isSafeS3Key } from '@common/helpers/s3-url.helper';

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
          return typeof value === 'string' && isSafeS3Key(value);
        },
        defaultMessage(): string {
          return `key contains invalid path characters`;
        },
      },
    });
  };
}
