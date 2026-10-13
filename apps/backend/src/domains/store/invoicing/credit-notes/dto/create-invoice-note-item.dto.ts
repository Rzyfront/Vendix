import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isDianUnitCode } from '../../providers/dian-direct/constants/dian-unit-codes';

/** Uses the canonical DIAN unit catalog; the catalog itself is not copied here. */
@ValidatorConstraint({ name: 'isDianUnitCode', async: false })
export class DianUnitCodeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isDianUnitCode(value);
  }

  defaultMessage(): string {
    return 'unit_code debe ser un código de unidad DIAN válido.';
  }
}

@ValidatorConstraint({ name: 'invoiceNoteDecimalScale', async: false })
export class InvoiceNoteDecimalScaleConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown, args: ValidationArguments): boolean {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    const scale = Number(args.constraints[0]);
    const [coefficient, exponentText] = value.toString().toLowerCase().split('e');
    const exponent = exponentText ? Number(exponentText) : 0;
    const fractionalDigits = coefficient.split('.')[1]?.length ?? 0;
    return Math.max(0, fractionalDigits - exponent) <= scale;
  }
}

/**
 * Explicit editable line for a credit/debit note. Fiscal taxes and all other
 * invoice snapshots are server-owned and intentionally are not part of this DTO.
 */
export class CreateInvoiceNoteItemDto {
  @Type(() => Number)
  @IsInt({ message: 'source_invoice_item_id debe ser un entero positivo.' })
  @Min(1, { message: 'source_invoice_item_id debe ser mayor que cero.' })
  @Max(2147483647, {
    message: 'source_invoice_item_id supera el rango de un identificador entero.',
  })
  source_invoice_item_id!: number;

  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 4, allowNaN: false, allowInfinity: false },
    { message: 'quantity debe ser un número finito con máximo 4 decimales.' },
  )
  @Validate(InvoiceNoteDecimalScaleConstraint, [4], {
    message: 'quantity debe tener máximo 4 decimales.',
  })
  @Min(0.0001, { message: 'quantity debe ser como mínimo 0.0001.' })
  @Max(99999999.9999, {
    message: 'quantity excede la precisión permitida (12,4).',
  })
  quantity!: number;

  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false },
    { message: 'unit_price debe ser un número finito con máximo 2 decimales.' },
  )
  @Validate(InvoiceNoteDecimalScaleConstraint, [2], {
    message: 'unit_price debe tener máximo 2 decimales.',
  })
  @Min(0, { message: 'unit_price no puede ser negativo.' })
  @Max(9999999999.99, {
    message: 'unit_price excede la precisión permitida (12,2).',
  })
  unit_price!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false },
    {
      message:
        'discount_amount debe ser un número finito con máximo 2 decimales.',
    },
  )
  @Validate(InvoiceNoteDecimalScaleConstraint, [2], {
    message: 'discount_amount debe tener máximo 2 decimales.',
  })
  @Min(0, { message: 'discount_amount no puede ser negativo.' })
  @Max(9999999999.99, {
    message: 'discount_amount excede la precisión permitida (12,2).',
  })
  discount_amount?: number;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(5)
  @Validate(DianUnitCodeConstraint)
  unit_code?: string;
}
