import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import {
  DOCUMENT_TYPE_RULES,
  DocumentTypeCode,
  isValidDocumentType,
} from '../constants/document-types';

type FailureReason =
  | 'missing_type'
  | 'invalid_type'
  | 'too_long'
  | 'pattern_mismatch'
  | 'not_a_string';

interface ResolvedValidation {
  ok: boolean;
  reason?: FailureReason;
  type?: DocumentTypeCode;
}

function resolve(value: unknown, object: unknown): ResolvedValidation {
  if (value === undefined || value === null || value === '') {
    return { ok: true };
  }

  if (typeof value !== 'string') {
    return { ok: false, reason: 'not_a_string' };
  }

  const rawType = (object as Record<string, unknown> | null | undefined)?.[
    'document_type'
  ];

  if (rawType === undefined || rawType === null || rawType === '') {
    return { ok: false, reason: 'missing_type' };
  }

  if (typeof rawType !== 'string' || !isValidDocumentType(rawType)) {
    return { ok: false, reason: 'invalid_type' };
  }

  const type = rawType as DocumentTypeCode;
  const rule = DOCUMENT_TYPE_RULES[type];
  const normalized = value.trim().toUpperCase();

  if (normalized.length > rule.maxLength) {
    return { ok: false, reason: 'too_long', type };
  }

  if (!rule.regex.test(normalized)) {
    return { ok: false, reason: 'pattern_mismatch', type };
  }

  return { ok: true, type };
}

/**
 * Cross-field validator: ensures `document_number` matches the regex/maxLength
 * of the sibling `document_type` field. Requires `document_type` to be present
 * when `document_number` is provided.
 *
 * Use via `@DocumentNumberMatchesType()` on the `document_number` property.
 */
@ValidatorConstraint({ name: 'DocumentNumberMatchesType', async: false })
export class DocumentNumberMatchesTypeConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown, args: ValidationArguments): boolean {
    return resolve(value, args.object).ok;
  }

  defaultMessage(args: ValidationArguments): string {
    const result = resolve(args.value, args.object);

    if (result.ok) {
      return 'document_number inválido';
    }

    switch (result.reason) {
      case 'missing_type':
        return 'document_type es requerido cuando se proporciona document_number';
      case 'invalid_type':
        return 'document_type inválido';
      case 'not_a_string':
        return 'document_number debe ser un string';
      case 'too_long':
      case 'pattern_mismatch': {
        if (result.type) {
          const rule = DOCUMENT_TYPE_RULES[result.type];
          return `document_number no cumple el formato de ${rule.label}`;
        }
        return 'document_number inválido';
      }
      default:
        return 'document_number inválido';
    }
  }
}

export function DocumentNumberMatchesType(
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'DocumentNumberMatchesType',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: DocumentNumberMatchesTypeConstraint,
    });
  };
}
