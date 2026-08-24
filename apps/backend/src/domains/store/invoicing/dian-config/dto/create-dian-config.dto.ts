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

  // SoftwareID and TestSetId are UUIDs issued by the DIAN portal and pasted by
  // hand. `MaxLength(100)` accepted values like "9547" and "12312", which reach
  // the DIAN as-is and get the batch discarded without a verdict. Any UUID
  // version is allowed (the portal's version is not part of our contract), but
  // the shape is enforced.
  //
  // QUI-657 — exigirlo SIEMPRE era un bloqueo circular. La DIAN emite el
  // Software ID al inscribir el software, y el tenant de la rama `without_cert`
  // llega acá justamente porque todavía no ha podido inscribirlo: no tiene
  // certificado de firma. Pedirle el dato que viene DESPUÉS para dejarlo
  // empezar cerraba el wizard sobre sí mismo. El mismo razonamiento ya está
  // escrito en `subscription-fiscal.service.ts` para `platform_settings`.
  //
  // Se exige, entonces, en función de la rama — no de la existencia del campo:
  //   - `with_cert` (y cualquier cliente viejo que no mande `certificate_branch`)
  //     se comporta EXACTAMENTE igual que antes: obligatorio y con forma de UUID.
  //   - `without_cert` lo acepta ausente o vacío, porque es un estado de espera.
  //
  // Lo que NO se relaja es la forma: si el usuario escribió algo, se valida como
  // UUID igual que siempre. Un "9547" mal copiado no falla acá, falla en la DIAN
  // descartando el lote sin veredicto — que es la razón por la que este
  // `@IsUUID` existe. Ausencia y error no son lo mismo.
  //
  // La columna es NOT NULL, así que la ausencia se guarda como cadena vacía: es
  // lo que los tres lectores del dato (`readiness`, checklist de plataforma,
  // directorio de tenants) ya interpretan como "sin configurar".
  @ValidateIf(
    (o: CreateDianConfigDto) =>
      o.certificate_branch !== 'without_cert' || !!o.software_id,
  )
  @TrimString()
  @IsString()
  @IsUUID(undefined, {
    message: 'software_id must be the UUID issued by the DIAN portal',
  })
  software_id?: string;

  // The PIN is numeric in practice but its format is not contractually fixed by
  // DIAN, so it is only trimmed and bounded — a false rejection here would block
  // a legitimate configuration.
  //
  // Mismo trato que `software_id`: el PIN lo define el tenant AL inscribir el
  // software en la DIAN, así que en `without_cert` todavía no existe. Si lo
  // manda, se valida entero; si no, la fila nace sin PIN y el checklist de
  // habilitación lo sigue reportando como pendiente.
  @ValidateIf(
    (o: CreateDianConfigDto) =>
      o.certificate_branch !== 'without_cert' || !!o.software_pin,
  )
  @TrimString()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  software_pin?: string;

  @IsOptional()
  @IsIn(['test', 'production'])
  environment?: 'test' | 'production';

  /**
   * QUI-657 — bifurcación del wizard fiscal.
   *
   * `with_cert` (default, y lo que hacía todo el mundo hasta ahora): el tenant
   * trae su propio `.p12` y lo sube por `POST upload-certificate`. La fila nace
   * con `certificate_provisioning_status = 'not_required'` — no hay trámite que
   * hacer de nuestro lado.
   *
   * `without_cert`: el tenant NO tiene certificado de firma y pide que la
   * plataforma se lo tramite. La fila nace en `documents_pending` y el wizard
   * le pide los documentos de identidad. **No desbloquea nada**: la emisión
   * sigue cerrada por `certificate_s3_key` vacío hasta que el superadmin cargue
   * el cert expedido. Es un estado de espera, no un permiso.
   *
   * El default es `with_cert` y no un campo obligatorio a propósito: cualquier
   * cliente viejo que no mande el campo sigue comportándose exactamente igual.
   */
  @IsOptional()
  @IsIn(['with_cert', 'without_cert'])
  certificate_branch?: 'with_cert' | 'without_cert';

  @IsOptional()
  @TrimString()
  @IsString()
  @IsUUID(undefined, {
    message: 'test_set_id must be the TestSetId UUID issued by the DIAN portal',
  })
  test_set_id?: string;
}
