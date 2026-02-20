import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCustomerDto {
    @ApiProperty({ example: 'juan.perez@example.com' })
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @ApiProperty({ example: 'Juan' })
    @IsString()
    @IsNotEmpty()
    first_name: string;

    @ApiProperty({ example: 'Perez' })
    @IsString()
    @IsNotEmpty()
    last_name: string;

    @ApiProperty({ example: '12345678' })
    @IsString()
    @IsNotEmpty()
    document_number: string;

    @ApiPropertyOptional({ example: 'CC' })
    @IsString()
    @IsOptional()
    document_type?: string;

    @ApiPropertyOptional({ example: '3001234567' })
    @IsString()
    @IsOptional()
    @Matches(/^[\d+#*\s()-]*$/, { message: 'El teléfono solo puede contener números y los símbolos + # * ( ) -' })
    phone?: string;
}
