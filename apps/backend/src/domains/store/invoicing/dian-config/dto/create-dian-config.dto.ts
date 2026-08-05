import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsUUID,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import {
  TrimString,
  TrimTaxId,
} from '../../../../../common/decorators/trim-string.decorator';

export class CreateDianConfigDto {
  @TrimString()
  @IsString()
  @MaxLength(100)
  name: string;

  @TrimTaxId()
  @IsString()
  @MaxLength(20)
  @Matches(/^\d+$/, { message: 'NIT must contain only digits' })
  nit: string;

  @IsOptional()
  @IsEnum(['NIT', 'CC', 'CE', 'TI', 'PP', 'NIT_EXTRANJERIA'])
  nit_type?: 'NIT' | 'CC' | 'CE' | 'TI' | 'PP' | 'NIT_EXTRANJERIA';

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(1)
  @Matches(/^\d$/, { message: 'nit_dv must be a single digit' })
  nit_dv?: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsEnum(['invoicing', 'support_document', 'payroll', 'equivalent_document'])
  configuration_type?:
    | 'invoicing'
    | 'support_document'
    | 'payroll'
    /** Documento equivalente electrónico POS — habilitación propia (Res. 000165/2023). */
    | 'equivalent_document';

  @IsOptional()
  @IsEnum(['own_software', 'technological_provider'])
  operation_mode?: 'own_software' | 'technological_provider';
  /**
   * ARN (o key-id) de la clave asimétrica RSA de AWS KMS que custodia la mitad
   * privada del certificado. Al registrarlo, la firma XAdES del documento **y** la
   * firma WS-Security del sobre SOAP se producen dentro del HSM, y la clave privada
   * del `.p12` deja de leerse.
   *
   * Cadena vacía → `null`: es la forma de VOLVER a la custodia en proceso. Sin ese
   * mapeo, una configuración migrada por error a KMS quedaría atrapada, porque un
   * ARN inválido hace fallar toda emisión y no habría manera de retirarlo.
   *
   * No es secreto (es un identificador de recurso), así que no pasa por el sobre de
   * cifrado; se guarda en claro junto al `certificate_s3_key`.
   */
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(2048)
  @Matches(
    /^$|^(arn:aws[a-z-]*:kms:[a-z0-9-]+:\d{12}:key\/[A-Za-z0-9-]+|arn:aws[a-z-]*:kms:[a-z0-9-]+:\d{12}:alias\/[\w/_-]+|alias\/[\w/_-]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/,
    {
      message:
        'certificate_kms_key_id must be a KMS key ARN, alias ARN, alias, or key UUID',
    },
  )
  certificate_kms_key_id?: string;

  // SoftwareID and TestSetId are UUIDs issued by the DIAN portal and pasted by
  // hand. `MaxLength(100)` accepted values like "9547" and "12312", which reach
  // the DIAN as-is and get the batch discarded without a verdict. Any UUID
  // version is allowed (the portal's version is not part of our contract), but
  // the shape is enforced.
  @TrimString()
  @IsString()
  @IsUUID(undefined, {
    message: 'software_id must be the UUID issued by the DIAN portal',
  })
  software_id: string;

  // The PIN is numeric in practice but its format is not contractually fixed by
  // DIAN, so it is only trimmed and bounded — a false rejection here would block
  // a legitimate configuration.
  @TrimString()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  software_pin: string;

  @IsOptional()
  @IsEnum(['test', 'production'])
  environment?: 'test' | 'production';

  @IsOptional()
  @TrimString()
  @IsString()
  @IsUUID(undefined, {
    message: 'test_set_id must be the TestSetId UUID issued by the DIAN portal',
  })
  test_set_id?: string;
}
