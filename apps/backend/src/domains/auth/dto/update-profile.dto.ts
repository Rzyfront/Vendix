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

    @ApiPropertyOptional({ description: 'Datos de dirección' })
    @IsOptional()
    @ValidateNested()
    @Type(() => CreateAddressDto)
    address?: CreateAddressDto;
}
