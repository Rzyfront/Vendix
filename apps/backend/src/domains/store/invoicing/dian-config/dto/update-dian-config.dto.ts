import {
  IsString,
  IsOptional,
  IsBoolean,
  IsUUID,
  MaxLength,
  MinLength,
  Matches,
  IsIn,
  ValidateIf,
} from 'class-validator';
import {
  TrimString,
  TrimTaxId,
} from '../../../../../common/decorators/trim-string.decorator';

export class UpdateDianConfigDto {
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @TrimTaxId()
  @IsString()
  @MaxLength(20)
  @Matches(/^\d+$/, { message: 'NIT must contain only digits' })
  nit?: string;

  @IsOptional()
  @IsIn(['NIT', 'CC', 'CE', 'TI', 'PP', 'NIT_EXTRANJERIA'])
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
  @IsIn(['invoicing', 'support_document', 'payroll', 'equivalent_document'])
  configuration_type?:
    | 'invoicing'
    | 'support_document'
    | 'payroll'
    /** Documento equivalente electrónico POS — habilitación propia (Res. 000165/2023). */
    | 'equivalent_document';

  @IsOptional()
  @IsIn(['own_software', 'technological_provider'])
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

  // Same contract as CreateDianConfigDto: these are DIAN-issued UUIDs pasted by
  // hand, so they are trimmed and shape-checked. Values such as "9547" reached
  // production before this guard existed.
  //
  // QUI-657 — la cadena vacía es un valor legítimo del formulario, no un intento
  // de escribir basura. El wizard manda el campo SIEMPRE (devuelve el objeto
  // completo), y el tenant de la rama `without_cert` todavía no tiene el dato,
  // así que `@IsOptional()` no alcanzaba: `''` está definido y chocaba contra
  // `@IsUUID`. Devolver 400 por un campo que el usuario aún no puede llenar
  // convertía "no me deja avanzar" en "no me deja guardar".
  //
  // Vacío significa "sigo sin tenerlo", NUNCA "bórralo": el servicio ignora el
  // valor al construir el update, de modo que un PATCH del formulario no puede
  // desconfigurar un Software ID ya registrado. Con contenido, se valida como
  // UUID exactamente igual que antes.
  @IsOptional()
  @ValidateIf((o: UpdateDianConfigDto) => o.software_id !== '')
  @TrimString()
  @IsString()
  @IsUUID(undefined, {
    message: 'software_id must be the UUID issued by the DIAN portal',
  })
  software_id?: string;

  // Mismo criterio que `software_id`. Ojo con los dos valores que NO son un PIN:
  // `'****'` es el enmascarado que el front reenvía para decir "no lo cambies",
  // y `''` es "todavía no lo tengo". Ambos los descarta el servicio antes de
  // cifrar; acá solo se deja pasar el vacío para que no explote el `@MinLength(1)`.
  @IsOptional()
  @ValidateIf((o: UpdateDianConfigDto) => o.software_pin !== '')
  @TrimString()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  software_pin?: string;

  @IsOptional()
  @IsIn(['test', 'production'])
  environment?: 'test' | 'production';

  @IsOptional()
  @TrimString()
  @IsString()
  @IsUUID(undefined, {
    message: 'test_set_id must be the TestSetId UUID issued by the DIAN portal',
  })
  test_set_id?: string;
}
