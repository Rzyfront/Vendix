import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { DOCUMENT_TYPE_CODES } from '../../../../common/constants/document-types';
import { DocumentNumberMatchesType } from '../../../../common/validators/document-number.validator';

export class CreateCustomerDto {
  @ApiPropertyOptional({
    example: 'juan.perez@example.com',
    description: 'Correo del cliente. Opcional; si se omite, el sistema genera uno interno único.',
  })
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  )
  @IsOptional()
  @IsEmail({}, { message: 'Ingresa un correo válido' })
  email?: string | null;

  @ApiProperty({ example: 'Juan' })
  @IsString()
  @IsNotEmpty()
  first_name: string;

  @ApiProperty({ example: 'Perez' })
  @IsString()
  @IsNotEmpty()
  last_name: string;

  @ApiPropertyOptional({ example: '12345678' })
  @IsOptional()
  @IsString()
  @DocumentNumberMatchesType()
  document_number?: string | null;

  @ApiPropertyOptional({ example: 'CC', enum: DOCUMENT_TYPE_CODES })
  @IsOptional()
  @IsString()
  @IsIn(DOCUMENT_TYPE_CODES as unknown as string[], {
    message: 'document_type debe ser uno de los códigos DIAN válidos',
  })
  document_type?: string | null;

  @ApiPropertyOptional({ example: '3001234567' })
  @IsString()
  @IsOptional()
  @Matches(/^[\d+#*\s()-]*$/, {
    message:
      'El teléfono solo puede contener números y los símbolos + # * ( ) -',
  })
  phone?: string | null;

  @ApiPropertyOptional({ description: 'Tax regime (fiscal classification)' })
  @IsOptional()
  @IsString()
  tax_regime?: string | null;

  @ApiPropertyOptional({
    description: 'Person type for withholding resolution',
    enum: ['NATURAL', 'JURIDICA'],
  })
  @IsOptional()
  @IsString()
  person_type?: string | null;

  @ApiPropertyOptional({
    description: 'Whether the customer is a withholding agent (agente de retención)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  is_withholding_agent?: boolean;
}
