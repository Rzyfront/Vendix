import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

import {
  FISCAL_DOCUMENT_TYPES,
  TECHNICAL_KEY_LENGTH,
  TECHNICAL_KEY_PATTERN,
  normalizeTechnicalKey,
  type FiscalDocumentType,
} from '../../fiscal-document-requirements';

/**
 * Tipos de documento que SÍ se registran como fila de `invoice_resolutions`.
 *
 * Se derivan del contrato en vez de re-escribirse: añadir un valor al enum de
 * Prisma lo hace aparecer aquí solo, y quitarle uno rompe la compilación en el
 * sitio donde hay que decidirlo.
 *
 * La nómina electrónica queda fuera a propósito. El DSPNE numera con su propio
 * consecutivo `NumNE` y `FiscalProductionReadinessService` excluye `payroll` de
 * `assertResolutionReady`; registrarle una resolución no habilita nada y sí
 * induce a creer que la nómina cuelga de un rango autorizado que no existe.
 */
export type ResolutionDocumentType = Exclude<
  FiscalDocumentType,
  'payroll' | 'payroll_adjustment'
>;

export const RESOLUTION_DOCUMENT_TYPES: readonly ResolutionDocumentType[] =
  FISCAL_DOCUMENT_TYPES.filter(
    (document_type): document_type is ResolutionDocumentType =>
      document_type !== 'payroll' && document_type !== 'payroll_adjustment',
  );

/**
 * Alta de una resolución / rango de numeración DIAN.
 *
 * Este DTO lo comparten los tres carriles de escritura —panel de la tienda
 * (`store/invoicing/resolutions`), consola de super admin
 * (`superadmin/tenant-config/.../resolutions`, que entra por
 * `TenantContextRunner`) y la API directa—, así que lo que aquí no se exige no
 * lo exige nadie.
 *
 * Reparto deliberado de responsabilidades: aquí vive la FORMA (tipos, cotas,
 * longitudes); las reglas que cruzan campos —qué exige cada tipo de documento,
 * rango coherente, vigencia coherente— viven en `ResolutionsService`, que es el
 * único punto por el que pasan los tres carriles y el que puede responder con un
 * código de error tipado en vez de un array de validación.
 */
export class CreateResolutionDto {
  /**
   * Número de la Autorización de Numeración de la DIAN.
   *
   * Opcional en la FORMA, no en la regla: `ResolutionsService` lo exige para los
   * documentos que sí cuelgan de una autorización (factura de venta, documento
   * soporte, documento equivalente POS). Para las notas —que la DIAN no autoriza
   * por rango y cuya fila existe solo como fuente de consecutivo interno— pedirlo
   * obligaba a inventar un número de resolución que nunca existió.
   *
   * El tipo declarado sigue siendo `string` y no `string | undefined` a
   * propósito: `CreateOrgInvoiceResolutionDto` hereda de esta clase y escribe el
   * campo directo en una columna NOT NULL. Quien consuma este DTO SIN pasar por
   * `ResolutionsService` debe aplicar el mismo respaldo que
   * `resolveResolutionNumber` — el carril de organización todavía no lo hace y
   * responderá con un error de base en vez de uno tipado si se le omite.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  resolution_number: string;

  /**
   * Tipo de documento fiscal que numera esta resolución.
   *
   * Sin él, el defecto es `sales_invoice` (lo aplica el servicio, no un
   * inicializador de campo: `PartialType` copia los inicializadores al DTO de
   * actualización, y un defecto aquí reescribiría el tipo de documento en cada
   * PATCH que no lo mandara).
   */
  @IsOptional()
  @IsIn(RESOLUTION_DOCUMENT_TYPES)
  document_type?: ResolutionDocumentType;

  @IsDateString()
  resolution_date: string;

  @IsString()
  @MaxLength(10)
  prefix: string;

  /**
   * Extremos del rango autorizado. `@IsInt` + `@Min(1)`, no `@IsNumber`: un
   * `1000.5` se guardaba tal cual y el consecutivo emitido dejaba de coincidir
   * con el rango que la DIAN autorizó.
   */
  @IsInt()
  @Min(1)
  @Type(() => Number)
  range_from: number;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  range_to: number;

  @IsDateString()
  valid_from: string;

  @IsDateString()
  valid_to: string;

  /**
   * Sin inicializador a propósito. `PartialType` hereda los inicializadores de
   * propiedad (`inheritPropertyInitializers`), así que un `= true` aquí hacía que
   * TODO PATCH que no mandara `is_active` llegara al servicio con `true` y
   * reactivara en silencio una resolución retirada. El defecto de alta lo pone
   * `ResolutionsService.create` con `?? true`.
   */
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  /**
   * Clave técnica (ClTec) del rango.
   *
   * Solo la factura electrónica de venta la usa: es el 14º campo de su CUFE. En
   * cualquier otro tipo el 14º campo es el Software-PIN, y guardar una ClTec aquí
   * hace que se firme con ella y la DIAN rechace el documento — quemando el
   * consecutivo autorizado. El servicio la rechaza para esos tipos.
   *
   * Admite `null` explícito (`@IsOptional` no valida `null`) porque borrar una
   * ClTec mal guardada es justamente la corrección que hay que poder hacer. El
   * `@Transform` conserva esa vía y le añade la cadena vacía: un campo que el
   * formulario manda en blanco significa «sin clave», no «clave de 0
   * caracteres», y guardarlo como `''` creaba un tercer estado que ningún lector
   * distingue de `null`.
   *
   * La FORMA sí se exige, y es la validación que faltaba. Con solo
   * `@MaxLength(255)` entró en producción una ClTec de 38 caracteres: el CUFE
   * salió calculado con ella, la DIAN lo recomputó con la suya y rechazó la
   * factura por «Valor del CUFE no está calculado correctamente», con el
   * consecutivo autorizado ya gastado. `@MaxLength` sobra desde que la forma
   * exige exactamente 40.
   *
   * El `@Transform` solo quita espacios y saltos de línea —lo que un PDF inserta
   * al copiar—; no completa ni corrige caracteres, porque una clave reparada en
   * silencio es indistinguible de una correcta hasta que la DIAN la rechaza.
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const normalized = normalizeTechnicalKey(value);
    return normalized === '' ? null : normalized;
  })
  @IsString()
  @Matches(TECHNICAL_KEY_PATTERN, {
    message:
      `La clave técnica (ClTec) debe tener exactamente ${TECHNICAL_KEY_LENGTH} ` +
      'caracteres hexadecimales (0-9, a-f), tal como la entrega la DIAN en la ' +
      'autorización de numeración. Déjala vacía si este documento no lleva clave técnica.',
  })
  technical_key?: string | null;
}
