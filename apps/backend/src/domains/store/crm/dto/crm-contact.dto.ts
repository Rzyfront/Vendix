import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Body público de POST /ecommerce/crm/contact (formulario de la landing).
 * Sin auth: resuelto por DomainResolverMiddleware (hostname del storefront).
 * El servicio exige al menos email o teléfono (CRM_LANDING_006).
 */
export class CrmContactDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  first_name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  last_name?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Correo electrónico inválido' })
  @MaxLength(160)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(1000)
  message!: string;
}
