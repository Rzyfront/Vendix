import { IsOptional, IsString, ValidateNested, MinLength, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateAddressDto } from '../../organization/addresses/dto';

export class UpdateProfileDto {
    @ApiPropertyOptional({ example: 'Juan', description: 'Nombre del usuario' })
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    first_name?: string;

    @ApiPropertyOptional({ example: 'Perez', description: 'Apellido del usuario' })
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    last_name?: string;

    @ApiPropertyOptional({ example: '5551234567', description: 'Teléfono' })
    @IsOptional()
    @IsString()
    phone?: string;

    @ApiPropertyOptional({ example: 'CC', description: 'Tipo de documento' })
    @IsOptional()
    @IsString()
    document_type?: string;

    @ApiPropertyOptional({ example: '1234567890', description: 'Número de documento' })
    @IsOptional()
    @IsString()
    document_number?: string;

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
