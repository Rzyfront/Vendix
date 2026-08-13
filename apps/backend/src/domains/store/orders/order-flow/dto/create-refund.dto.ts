import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export class CreateRefundItemDto {
  @IsInt()
  order_item_id: number;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsIn(['restock', 'write_off', 'no_return'])
  inventory_action: 'restock' | 'write_off' | 'no_return';

  @IsOptional()
  @IsInt()
  location_id?: number;

  @IsOptional()
  @IsString()
  reason?: string;

  // REFUND OVERHAUL — required when refund_method='bank_transfer'. The
  // destination bank account is persisted on refund_items.bank_account_id for
  // audit trail and journal entry routing. Ignored for other methods.
  @IsOptional()
  @IsInt()
  bank_account_id?: number;
}

@ValidatorConstraint({ name: 'bankTransferRequiresAccount', async: false })
class BankTransferRequiresAccountConstraint
  implements ValidatorConstraintInterface
{
  validate(_value: any, args: ValidationArguments): boolean {
    const obj = args.object as CreateRefundDto;
    if (obj.refund_method !== 'bank_transfer') return true;
    return obj.items?.some((it) => !!it.bank_account_id) ?? false;
  }
  defaultMessage(args: ValidationArguments): string {
    return 'refund_method=bank_transfer requiere bank_account_id en al menos un ítem';
  }
}

export class CreateRefundDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRefundItemDto)
  items: CreateRefundItemDto[];

  @IsBoolean()
  include_shipping: boolean;

  @IsIn(['original_payment', 'cash', 'bank_transfer', 'store_credit'])
  refund_method: string;

  @IsString()
  @MaxLength(500)
  reason: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * Hotfix post-PR-576: bank_transfer exige UNA cuenta destino. El
   * frontend la envía en `items[].bank_account_id`; el backend la
   * persiste en `refund_items.bank_account_id`. Este validador de
   * grupo exige que al menos una línea lleve `bank_account_id` cuando
   * `refund_method === 'bank_transfer'`.
   */
  @Validate(BankTransferRequiresAccountConstraint)
  bank_transfer_validated?: true;
}
