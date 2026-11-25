import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { persona_type_enum, tax_regime_enum } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FiscalResponsibilityInCatalogRule } from '../../../../common/validators/fiscal-responsibility.validator';

// Alias locales, igual que `create-customer.dto.ts`: el DTO habla PascalCase y
// los enums de Prisma siguen en snake_case en el borde.
type PersonaType =
  (typeof persona_type_enum)[keyof typeof persona_type_enum];
type TaxRegime = (typeof tax_regime_enum)[keyof typeof tax_regime_enum];

/**
 * Tope duro de clientes por lote de edición masiva.
 *
 * El `ValidationPipe` global lo aplica vía `@ArrayMaxSize`, y el endpoint de
 * ids-por-filtro reutiliza el mismo número para marcar `capped` en vez de
 * truncar la selección en silencio. 100 es el mismo tope que la edición masiva
 * de productos: cada fila es una transacción propia contra `users` +
 * `store_users` (+ `crm_customer_tags`), y por encima de ese número el coste
 * por lote deja de ser interactivo.
 *
 * Cuando la selección lo supera, el cliente TROCEA (ver
 * `customers-bulk-edit.service.ts` del frontend) y el backend rechaza el lote
 * entero con 400 `SYS_VALIDATION_001` si alguien manda 101 ids de golpe.
 */
export const MAX_BULK_EDIT_CUSTOMER_IDS = 100;

/** Tope de ids que devuelve el endpoint de selección por filtro. */
export const MAX_BULK_CUSTOMER_FILTER_IDS = 1000;

/** Tope de etiquetas por acción (el catálogo de una tienda no llega a tanto). */
export const MAX_BULK_CUSTOMER_TAGS = 50;

/** Estado de una fila dentro de un preview o de una aplicación de lote. */
export type BulkCustomerItemStatus = 'ok' | 'warning' | 'error';

/**
 * Modo de la acción sobre etiquetas CRM.
 *
 * Es `add` / `remove` y NO `replace`: reemplazar el conjunto de etiquetas de N
 * clientes con el mismo conjunto borraría la clasificación particular de cada
 * uno, que es justo el dato que el comercio construyó a mano. `add` y `remove`
 * son idempotentes por fila (añadir una etiqueta que ya estaba o quitar una que
 * no estaba no es un error) y nunca destruyen lo que no se pidió tocar.
 */
export enum BulkCustomerTagActionMode {
  ADD = 'add',
  REMOVE = 'remove',
}

/** Acción de etiquetas del lote. */
export class BulkCustomerTagActionDto {
  @ApiProperty({ enum: BulkCustomerTagActionMode })
  @IsEnum(BulkCustomerTagActionMode, {
    message: 'El modo de etiquetas debe ser add o remove',
  })
  mode: BulkCustomerTagActionMode;

  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayNotEmpty({ message: 'Debes seleccionar al menos una etiqueta' })
  @ArrayMaxSize(MAX_BULK_CUSTOMER_TAGS)
  @IsInt({ each: true })
  @Type(() => Number)
  ids: number[];
}

/**
 * Subconjunto ESCALAR de `UpdateCustomerDto` habilitado para edición masiva.
 *
 * Cada campo replica los decoradores que tiene en `CreateCustomerDto` (del que
 * `UpdateCustomerDto` es un `PartialType`) para que el lote no acepte valores
 * que la edición individual rechazaría. El `ValidationPipe` global corre con
 * `whitelist: true` y `forbidNonWhitelisted: true`, así que este contrato es
 * CERRADO: cualquier propiedad no declarada aquí devuelve 400.
 *
 * EXCLUIDOS DELIBERADAMENTE (no añadir sin revisar el motivo):
 * - `email`: es único por organización en la práctica (`update()` consulta
 *   `emailEquals` y rechaza duplicados con `SYS_CONFLICT_001`) y además es la
 *   credencial de acceso del cliente al portal. Poner el mismo correo a N
 *   clientes no es una edición: es un conflicto garantizado.
 * - `document_number`, `document_type`, `verification_digit`: identidad fiscal
 *   DIAN. Únicos por organización (`findByDocumentInOrganization`) y con
 *   aritmética propia (módulo 11 del NIT, coherencia persona/documento). El
 *   mismo documento para N clientes es imposible por definición — el segundo
 *   chocaría.
 * - `state`: NO está en `UpdateCustomerDto`. El único cambio de estado que la
 *   API expone hoy es `DELETE /store/customers/:id` → `archived`, que además es
 *   irreversible (no hay ruta de restauración). `users.state` gobierna el login
 *   del portal (`active` / `inactive` / `pending_verification` / `suspended`),
 *   así que escribirlo en lote podría dejar fuera a clientes con cuenta sin que
 *   nadie lo haya pedido. Se filtra por estado (lectura), no se edita.
 * - Direcciones (calle, ciudad, departamento, país): viven en `addresses`, no
 *   en `users`, y cada una es un dato propio del cliente que la facturación
 *   electrónica congela como snapshot del adquiriente (municipio DANE, DV).
 *   Sobrescribir la dirección de N clientes con la misma destruye el dato fiscal
 *   de todos. La edición individual tiene sus propios endpoints de ubicaciones
 *   (`POST /store/customers/:id/locations`, `PATCH /store/addresses/:id`).
 * - Cupo y días de crédito: NO EXISTEN en el modelo de clientes. Lo único que
 *   se llama "crédito" en el esquema es el saldo de notas crédito de
 *   facturación (`invoices.credit_limit_reserved_at`), que es contable y no un
 *   atributo del cliente.
 * - `avatar_url`, `username`, `password`, `main_store_id`: no son datos de
 *   cliente editables (credenciales / pertenencia), no aparecen en el modal.
 *
 * Los campos relacionales van aparte, como en el masivo de productos:
 * `price_tier_action` (tarifa, un solo valor por cliente) y `tag_action`
 * (etiquetas CRM, conjunto por cliente).
 */
export class BulkEditableCustomerChangesDto {
  // ===== Identidad de la persona =====
  /** Vacío = limpiar (`update()` escribe ''). Bloqueado si deja al cliente sin nombre. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  first_name?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  last_name?: string | null;

  /** Razón social. Obligatoria de facto cuando `person_type` queda en JURIDICA. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  legal_name?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[\d+#*\s()-]*$/, {
    message:
      'El teléfono solo puede contener números y los símbolos + # * ( ) -',
  })
  phone?: string | null;

  @ApiPropertyOptional({ enum: persona_type_enum })
  @IsOptional()
  @IsEnum(persona_type_enum, {
    message: "person_type debe ser 'NATURAL' o 'JURIDICA'",
  })
  person_type?: PersonaType | null;

  // ===== Datos fiscales =====
  @ApiPropertyOptional({ enum: tax_regime_enum })
  @IsOptional()
  @IsEnum(tax_regime_enum, {
    message: 'tax_regime debe ser uno de los regímenes tributarios válidos',
  })
  tax_regime?: TaxRegime | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_withholding_agent?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Matches(/^\d{2,4}$/, {
    message: 'ciiu_code debe ser un código numérico de 2 a 4 dígitos',
  })
  ciiu_code?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @FiscalResponsibilityInCatalogRule()
  fiscal_responsibilities?: string[];

  // ===== Tarifa (store_users.price_tier_id, una por cliente y tienda) =====
  /**
   * Tarifa preferencial del cliente en esta tienda.
   *
   * Semántica de tres estados, idéntica a la del `UpdateCustomerDto`:
   * - ausente ⇒ la tarifa de cada cliente NO se toca;
   * - `null` ⇒ se LIMPIA (queda «Sin tarifa»);
   * - un id ⇒ se ASIGNA a todos los seleccionados, sobrescribiendo la que
   *   tuvieran.
   *
   * No hay add/remove múltiple porque el modelo guarda UN solo valor por
   * cliente y tienda (`schema.prisma:357-368`). El servicio valida que la
   * tarifa exista en la tienda, sea `kind = 'customer_tier'` y esté activa
   * (`CUST_PRICE_TIER_001`); jamás resuelve una tarifa de otra tienda.
   */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt({ message: 'La tarifa debe ser un identificador numérico' })
  @Type(() => Number)
  @Min(1, { message: 'La tarifa debe ser un identificador numérico' })
  price_tier_id?: number | null;

  // ===== Etiquetas CRM (crm_customer_tags) =====
  @ApiPropertyOptional({ type: BulkCustomerTagActionDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => BulkCustomerTagActionDto)
  tag_action?: BulkCustomerTagActionDto;
}

/** Cuerpo de `POST /store/customers/bulk-edit` y de su `/preview`. */
export class BulkEditCustomersDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayNotEmpty({ message: 'Selecciona al menos un cliente' })
  @ArrayMaxSize(MAX_BULK_EDIT_CUSTOMER_IDS)
  @IsInt({ each: true })
  @Type(() => Number)
  ids: number[];

  @ApiProperty({ type: BulkEditableCustomerChangesDto })
  @IsObject()
  @ValidateNested()
  @Type(() => BulkEditableCustomerChangesDto)
  changes: BulkEditableCustomerChangesDto;
}

/**
 * Filtros combinables del panel de selección masiva.
 *
 * Todos son opcionales y se combinan con AND. `search` se resuelve contra
 * nombre, apellido, razón social, email, documento y teléfono (mismo criterio
 * que `CustomersService.findAll`).
 *
 * El scope de tienda NO viaja aquí: lo impone el contexto autenticado
 * (`store_users.store_id`) y no es negociable desde la query.
 */
export class BulkCustomerFilterDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  /** `active` / `inactive`. Los archivados nunca entran al panel. */
  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional()
  @IsIn(['active', 'inactive'], {
    message: 'state debe ser active o inactive',
  })
  state?: 'active' | 'inactive';

  /** Uno o varios ids de etiqueta (se combinan con OR: basta tener una). */
  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @Transform(({ value }) => parseIdList(value))
  @IsArray()
  @IsInt({ each: true })
  tag_ids?: number[];

  /** Uno o varios ids de segmento (se combinan con OR: basta cumplir uno). */
  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @Transform(({ value }) => parseIdList(value))
  @IsArray()
  @IsInt({ each: true })
  segment_ids?: number[];

  /** Tarifa actual exacta. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  price_tier_id?: number;

  /** Solo clientes SIN tarifa. El complemento de `price_tier_id`. */
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) =>
    value === true || value === 'true' || value === '1' || value === 1,
  )
  @IsBoolean()
  without_price_tier?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  state_province?: string;

  /** Alta desde (ISO 8601, inclusive). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({}, { message: 'created_from debe ser una fecha ISO 8601' })
  created_from?: string;

  /** Alta hasta (ISO 8601, inclusive). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({}, { message: 'created_to debe ser una fecha ISO 8601' })
  created_to?: string;
}

/** Query del listado paginado del panel (filtros + paginación). */
export class BulkCustomerListQueryDto extends BulkCustomerFilterDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /**
   * Ids concretos, para hidratar el stack de seleccionados cuando un
   * «seleccionar todos los del filtro» trajo ids que no están en la página
   * visible. No es un filtro del panel: es una lectura acotada por id.
   */
  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @Transform(({ value }) => parseIdList(value))
  @IsArray()
  @IsInt({ each: true })
  ids?: number[];
}

/**
 * Filtros ya resueltos: los de la query MÁS los `customer_ids` que el
 * controlador deriva de los segmentos (evaluación de reglas del CRM).
 *
 * `customer_ids` no está en el DTO a propósito: no es un parámetro público,
 * solo el resultado interno de compilar los segmentos pedidos.
 */
export type BulkCustomerFilters = BulkCustomerFilterDto & {
  customer_ids?: number[];
  ids?: number[];
};

/**
 * `1,2,3` (o `[1,2,3]`) → `[1,2,3]`. Los valores inválidos se descartan en vez
 * de romper el listado, y se corta en `MAX_BULK_CUSTOMER_TAGS` para que un
 * query absurdo no genere un `IN` gigante.
 */
function parseIdList(value: unknown): number[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const ids = new Set<number>();
  for (const entry of raw) {
    const id = Number(String(entry).trim());
    if (!Number.isInteger(id) || id < 1) continue;
    ids.add(id);
    if (ids.size >= MAX_BULK_CUSTOMER_TAGS) break;
  }
  return [...ids];
}

/** Un campo que cambiaría de valor en una fila del preview. */
export class BulkCustomerFieldDiffDto {
  field: string;
  current: unknown;
  next: unknown;
}

/**
 * Resultado read-only por cliente.
 *
 * `warning` significa que el cambio SÍ se aplicará, pero con una consecuencia
 * que el operador debe conocer (hoy: sobrescribir una tarifa distinta, o
 * vaciar nombre y apellido al marcar persona jurídica).
 */
export class BulkCustomerPreviewItemDto {
  id: number;
  name: string;
  document_number: string | null;
  status: BulkCustomerItemStatus;
  changes: BulkCustomerFieldDiffDto[];
  code?: string;
  message?: string;
}

export class BulkCustomerPreviewResultDto {
  total: number;
  ok: number;
  warnings: number;
  errors: number;
  /**
   * Cuántos clientes del lote tenían una tarifa DISTINTA y no nula que la
   * asignación va a sobrescribir. Es la cifra que el panel necesita para
   * confirmar en voz alta ("3 clientes tienen otra tarifa") antes de escribir.
   */
  tier_overwrite_count: number;
  items: BulkCustomerPreviewItemDto[];
}

/** Resultado por cliente tras la aplicación real (no hay `warning` aquí). */
export class BulkCustomerResultItemDto {
  id: number;
  name: string;
  status: Exclude<BulkCustomerItemStatus, 'warning'>;
  code?: string;
  message?: string;
}

export class BulkCustomerResultDto {
  total: number;
  successful: number;
  failed: number;
  results: BulkCustomerResultItemDto[];
}

/** Respuesta de `GET /store/customers/bulk-edit/ids`. */
export class BulkCustomerIdsDto {
  ids: number[];
  /** Total de clientes que cumplen el filtro, antes del tope. */
  total: number;
  /** `true` si el filtro devuelve más ids que el tope y la selección quedó corta. */
  capped: boolean;
}

/** Fila del listado del panel: lo justo para elegir y reconocer al cliente. */
export class BulkCustomerListRowDto {
  id: number;
  first_name: string;
  last_name: string;
  legal_name: string | null;
  document_type: string | null;
  document_number: string | null;
  email: string | null;
  phone: string | null;
  person_type: string | null;
  state: string;
  price_tier_id: number | null;
  price_tier_name: string | null;
  /** Ciudad/departamento de la dirección de facturación (o de envío si no hay). */
  city: string | null;
  state_province: string | null;
  created_at: Date | null;
}
