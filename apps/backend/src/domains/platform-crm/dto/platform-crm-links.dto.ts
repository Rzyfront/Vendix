import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** `GET store/platform-crm/organizations/search?q=` */
export class SearchPlatformOrganizationsQueryDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q!: string;
}

/** `POST store/platform-crm/customers/:customerId/link` */
export class LinkPlatformCustomerDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  organization_id!: number;

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
