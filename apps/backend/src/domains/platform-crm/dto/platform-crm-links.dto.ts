import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Min,
  Validate,
  ValidateIf,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** `GET store/platform-crm/accounts/search?q=` (organizaciones y tiendas) */
export class SearchPlatformAccountsQueryDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q!: string;
}

/** El enlace va a la organización entera O a una tienda: nunca a las dos ni a ninguna. */
@ValidatorConstraint({ name: 'platformCrmSingleLinkTarget', async: false })
class SingleLinkTargetConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as LinkPlatformCustomerDto;
    return (dto.organization_id === undefined) !== (dto.linked_store_id === undefined);
  }

  defaultMessage(): string {
    return 'Envía organization_id o linked_store_id, solo uno de los dos';
  }
}

/** `POST store/platform-crm/customers/:customerId/link` */
export class LinkPlatformCustomerDto {
  /** La organización entera. Se valida si no llega tienda, o si llegan las dos (y falla). */
  @ValidateIf(
    (o: LinkPlatformCustomerDto) =>
      o.linked_store_id === undefined || o.organization_id !== undefined,
  )
  @Validate(SingleLinkTargetConstraint)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  organization_id?: number;

  /** Una tienda concreta; la organización del enlace será la de esa tienda. */
  @ValidateIf(
    (o: LinkPlatformCustomerDto) =>
      o.organization_id === undefined || o.linked_store_id !== undefined,
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  linked_store_id?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  note?: string;
}

/** `DELETE store/platform-crm/customers/:customerId/link` */
export class UnlinkPlatformCustomerDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  reason?: string;
}
