import {
  IsOptional,
  IsString,
  ValidateNested,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { CreateAddressDto } from '../../organization/addresses/dto';
import { DOCUMENT_TYPE_CODES } from '../../../common/constants/document-types';
import { IsUserDocumentType } from '../../../common/validators/user-document-type.validator';

@ApiSchema({ name: 'AuthUpdateProfileDto' })
export class AuthUpdateProfileDto {
  @ApiPropertyOptional({ example: 'Juan', description: 'Nombre del usuario' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  first_name?: string;

  @ApiPropertyOptional({
    example: 'Perez',
    description: 'Apellido del usuario',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  last_name?: string;

  @ApiPropertyOptional({ example: '5551234567', description: 'Teléfono' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    example: 'CC',
    enum: DOCUMENT_TYPE_CODES,
    nullable: true,
    description:
      'Tipo de documento (identification_type_enum). Acepta minúsculas; null o vacío lo limpia.',
  })
  @IsUserDocumentType()
  document_type?: string | null;

  @ApiPropertyOptional({
    example: '1234567890',
    nullable: true,
    description: 'Número de documento; null o vacío lo limpia',
  })
  @IsOptional()
  @IsString()
  document_number?: string | null;

  @ApiPropertyOptional({ description: 'URL o key de la imagen de perfil' })
  @IsOptional()
  @IsString()
  avatar_url?: string | null;

  @ApiPropertyOptional({ description: 'Datos de dirección' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateAddressDto)
  address?: CreateAddressDto;
}

export { AuthUpdateProfileDto as UpdateProfileDto };
