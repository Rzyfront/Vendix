import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  CreateResolutionDto,
  RESOLUTION_DOCUMENT_TYPES,
  type ResolutionDocumentType,
} from './dto/create-resolution.dto';
import { UpdateResolutionDto } from './dto/update-resolution.dto';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { TechnicalKeyVaultService } from '@common/services/technical-key-vault.service';
import { parsePlausibleFiscalDate } from '@common/utils/fiscal-date.util';
import {
  isFiscalDocumentType,
  requirementsFor,
  validateResolutionDraft,
  type FiscalDocumentType,
  type FiscalRequirementViolation,
} from '../fiscal-document-requirements';
import { assertTechnicalKeyShape } from '../utils/technical-key.util';

/**
 * Qué tiene que hacer el comerciante para cerrar cada incumplimiento del
 * contrato. `validateResolutionDraft` explica POR QUÉ la combinación es ilegal
 * —esa parte es de la DIAN y vive en el contrato—; esto nombra el CLIC que la
 * corrige, que es lo que le falta a alguien parado frente al formulario.
 */
export const CORRECCION_POR_VIOLACION: Record<
  FiscalRequirementViolation['code'],
  string
> = {
  RESOLUTION_NUMBER_REQUIRED:
    'Copia en «Número de resolución» el número tal como figura en la Autorización de Numeración (MUISCA → Numeración de facturación → Consultar autorización).',
  TECHNICAL_KEY_REQUIRED:
    'Pega en «Clave técnica» la ClTec que la DIAN entregó junto con este rango; aparece en el detalle de la autorización de numeración.',
  TECHNICAL_KEY_NOT_APPLICABLE:
    'Deja vacío el campo «Clave técnica» y vuelve a guardar: la clave de este documento se arma con el Software-PIN de la habilitación, que ya está configurado aparte.',
};

/** Campos que fijan la identidad fiscal de una resolución ante la DIAN. */
type CamposInmutables = 'prefix' | 'document_type' | 'range_from' | 'resolution_number';

export const ROTULO_CAMPO_INMUTABLE: Record<CamposInmutables, string> = {
  prefix: 'prefijo',
  document_type: 'tipo de documento',
  range_from: 'número inicial del rango',
  resolution_number: 'número de resolución',
};

/**
 * Resoluciones y rangos de numeración DIAN.
 *
 * Este servicio es el CUELLO por el que pasan los tres carriles de escritura: el
 * panel del comerciante (`ResolutionsController`), la consola de super admin
 * (`TenantResolutionsController`, que entra por `TenantContextRunner` y reusa
 * este mismo servicio y estos mismos DTOs) y la API directa. Por eso las reglas
 * que cruzan campos viven aquí y no en el DTO: validarlas una vez aquí las hace
 * valer en las dos consolas a la vez, y ninguna UI futura puede saltárselas.
 */
@Injectable()
export class ResolutionsService {
  private readonly logger = new Logger(ResolutionsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly fiscalScope: FiscalScopeService,
    private readonly technicalKeyVault: TechnicalKeyVaultService,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  async findAll() {
    const rows = await this.prisma.invoice_resolutions.findMany({
      orderBy: { created_at: 'desc' },
    });
    return rows.map(toPublicResolution);
  }

  /**
   * La fila COMPLETA, con las tres columnas de la ClTec. Privada a propósito:
   * la usan `update()` y `remove()`, que necesitan la clave vigente para
   * decidir si la re-sellan o la conservan. Todo lo que sale por HTTP pasa por
   * {@link findOne}, que la quita.
   */
  private async findOneInternal(id: number) {
    const resolution = await this.prisma.invoice_resolutions.findFirst({
      where: { id },
    });

    if (!resolution) {
      throw new VendixHttpException(ErrorCodes.INVOICING_FIND_002);
    }

    return resolution;
  }

  async findOne(id: number) {
    return toPublicResolution(await this.findOneInternal(id));
  }

  async create(dto: CreateResolutionDto) {
    // Primero lo que no toca la base: un payload que la DIAN rechazaría no tiene
    // por qué gastar dos queries antes de que se lo digan.
    const document_type = this.normalizeDocumentType(dto.document_type);
    this.assertFiscalRequirements({
      document_type,
      resolution_number: dto.resolution_number,
      technical_key: dto.technical_key,
    });
    // Después de los requisitos por tipo, no antes: si el documento no admite
    // ClTec, lo que hay que decirle a quien configura es «borra el campo», no
    // «tiene 38 caracteres». Se guarda lo que devuelve, no `dto.technical_key`,
    // para que lo validado y lo persistido sean el mismo valor.
    const technical_key = this.assertTechnicalKeyShape(dto.technical_key, {
      document_type,
    });
    this.assertRange(dto.range_from, dto.range_to);

    // Validadas, no solo convertidas: el escáner por IA de este mismo módulo
    // y un año a medio teclear en `<input type="date">` producen fechas ISO
    // válidas pero imposibles, que después viajan al XML del documento.
    const resolution_date = parsePlausibleFiscalDate(
      'fecha de resolución',
      dto.resolution_date,
    );
    const valid_from = parsePlausibleFiscalDate('válida desde', dto.valid_from);
    const valid_to = parsePlausibleFiscalDate('válida hasta', dto.valid_to);
    this.assertValidityWindow(valid_from, valid_to);

    const context = this.getContext();
    const accounting_entity =
      await this.fiscalScope.resolveAccountingEntityForFiscal({
        organization_id: context.organization_id!,
        store_id: context.store_id ?? null,
      });

    // La base restringe la tabla con `invoice_resolutions_entity_prefix_uidx`
    // sobre `(accounting_entity_id, prefix)` — sin `document_type` y sin
    // `is_active`. Un prefijo pertenece a UNA fila por entidad contable, que es
    // como la DIAN lo autoriza: por NIT. Sin este pre-chequeo el duplicado
    // llegaba a Postgres y volvía como P2002 crudo, o sea un 500 sin pista.
    const duplicate = await this.prisma
      .withoutScope()
      .invoice_resolutions.findFirst({
        where: {
          accounting_entity_id: accounting_entity.id,
          prefix: dto.prefix,
        },
        select: {
          id: true,
          resolution_number: true,
          document_type: true,
          is_active: true,
        },
      });
    if (duplicate) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_007,
        `Ya existe una resolución con prefijo "${dto.prefix}" (número ${
          duplicate.resolution_number
        }${
          duplicate.is_active ? '' : ', desactivada'
        }). La DIAN autoriza el prefijo por NIT, así que no puede repetirse: edita esa resolución o usa otro prefijo.`,
        {
          resolution_id: duplicate.id,
          prefix: dto.prefix,
          document_type: duplicate.document_type,
          is_active: duplicate.is_active,
        },
      );
    }

    const resolution = await this.prisma.invoice_resolutions.create({
      data: {
        organization_id: context.organization_id,
        store_id: context.store_id,
        accounting_entity_id: accounting_entity.id,
        document_type,
        resolution_number: this.resolveResolutionNumber(
          dto.resolution_number,
          dto.prefix,
        ),
        resolution_date,
        prefix: dto.prefix,
        range_from: dto.range_from,
        range_to: dto.range_to,
        current_number: dto.range_from - 1, // Start just before range_from
        valid_from,
        valid_to,
        is_active: dto.is_active ?? true,
        // Las tres columnas de la ClTec se escriben juntas — claro, cifrado y
        // huella. Escribir sólo `technical_key` es lo que dejó la columna
        // cifrada en NULL desde que se creó.
        ...this.technicalKeyVault.sealForWrite(technical_key),
      },
    });

    this.logger.log(
      `Resolution ${resolution.resolution_number} created (prefix: ${resolution.prefix}, range: ${resolution.range_from}-${resolution.range_to})`,
    );
    return toPublicResolution(resolution);
  }

  async update(id: number, dto: UpdateResolutionDto) {
    const current = await this.findOneInternal(id);

    // `current_number` arranca en `range_from - 1`. Alcanzar `range_from`
    // significa que la DIAN ya vio un consecutivo salido de este rango —incluido
    // el set de pruebas de habilitación, que quema números sin escribir filas en
    // `invoices`—, y a partir de ahí la identidad fiscal de la fila está
    // comprometida con documentos ya reportados.
    const consumed = current.current_number >= current.range_from;

    if (consumed) {
      const inmutables: CamposInmutables[] = [];
      if (dto.prefix !== undefined && dto.prefix !== current.prefix) {
        inmutables.push('prefix');
      }
      if (
        dto.document_type !== undefined &&
        dto.document_type !== current.document_type
      ) {
        inmutables.push('document_type');
      }
      if (dto.range_from !== undefined && dto.range_from !== current.range_from) {
        inmutables.push('range_from');
      }
      if (
        dto.resolution_number !== undefined &&
        dto.resolution_number !== current.resolution_number
      ) {
        inmutables.push('resolution_number');
      }
      if (inmutables.length > 0) {
        throw new VendixHttpException(
          ErrorCodes.INVOICING_RESOLUTION_005,
          `La resolución ya consumió numeración ante la DIAN (va en ${current.current_number}): ${inmutables
            .map((campo) => ROTULO_CAMPO_INMUTABLE[campo])
            .join(
              ', ',
            )} no se puede cambiar sin re-etiquetar documentos ya reportados. Crea una resolución nueva con esos datos y desactiva esta.`,
          {
            resolution_id: id,
            immutable_fields: inmutables,
            current_number: current.current_number,
          },
        );
      }
    }

    const next_document_type =
      dto.document_type !== undefined
        ? this.normalizeDocumentType(dto.document_type)
        : (current.document_type as FiscalDocumentType);
    const next_resolution_number =
      dto.resolution_number !== undefined
        ? dto.resolution_number
        : current.resolution_number;
    const next_technical_key =
      dto.technical_key !== undefined
        ? dto.technical_key
        : current.technical_key;

    // Los requisitos por tipo se re-juzgan SOLO si el PATCH toca alguno de los
    // campos que los deciden. Alternar `is_active` tiene que funcionar siempre:
    // es la única vía para retirar la resolución SETP de habilitación —que no se
    // puede borrar porque ya consumió numeración— y una fila anterior a esta
    // validación puede venir incumpliendo el contrato. Bloquear su desactivación
    // dejaría al comerciante encerrado con la resolución defectuosa activa.
    if (
      dto.document_type !== undefined ||
      dto.resolution_number !== undefined ||
      dto.technical_key !== undefined
    ) {
      this.assertFiscalRequirements(
        {
          document_type: next_document_type,
          resolution_number: next_resolution_number,
          technical_key: next_technical_key,
        },
        { resolution_id: id },
      );
    }

    // La FORMA de la ClTec se juzga SOLO cuando el PATCH la escribe, por la misma
    // razón que el bloque de arriba: una fila anterior a esta validación puede
    // venir con la clave mal copiada, y bloquear todo PATCH que la arrastre
    // dejaría al comerciante sin poder corregir el resto de la resolución ni
    // retirarla. Lo que no se puede es GUARDAR una clave con forma inválida — y
    // si una vieja sobrevive, `InvoiceNumberGenerator` la corta antes de gastar
    // el consecutivo, que es donde el daño sería irreversible.
    const patched_technical_key =
      dto.technical_key !== undefined
        ? this.assertTechnicalKeyShape(dto.technical_key, {
            resolution_id: id,
            document_type: next_document_type,
          })
        : undefined;

    const next_range_from = dto.range_from ?? current.range_from;
    const next_range_to = dto.range_to ?? current.range_to;
    if (dto.range_from !== undefined || dto.range_to !== undefined) {
      this.assertRange(next_range_from, next_range_to, { resolution_id: id });
      // Bajar el techo por debajo de lo ya consumido haría que la siguiente
      // asignación reutilizara un número que ya viaja en un documento reportado.
      if (consumed && next_range_to < current.current_number) {
        throw new VendixHttpException(
          ErrorCodes.INVOICING_RESOLUTION_009,
          `El rango ya va en ${current.current_number}: el número final no puede quedar por debajo. Sube el número final o crea una resolución nueva para el rango siguiente.`,
          {
            resolution_id: id,
            range_to: next_range_to,
            current_number: current.current_number,
          },
        );
      }
    }

    const next_valid_from = dto.valid_from
      ? parsePlausibleFiscalDate('válida desde', dto.valid_from)
      : current.valid_from;
    const next_valid_to = dto.valid_to
      ? parsePlausibleFiscalDate('válida hasta', dto.valid_to)
      : current.valid_to;
    if (dto.valid_from !== undefined || dto.valid_to !== undefined) {
      this.assertValidityWindow(next_valid_from, next_valid_to, {
        resolution_id: id,
      });
    }

    const update_data: any = {
      ...(dto.resolution_number && {
        resolution_number: dto.resolution_number,
      }),
      ...(dto.resolution_date && {
        resolution_date: parsePlausibleFiscalDate(
          'fecha de resolución',
          dto.resolution_date,
        ),
      }),
      ...(dto.prefix && { prefix: dto.prefix }),
      ...(dto.document_type !== undefined && {
        document_type: next_document_type,
      }),
      ...(dto.range_from !== undefined && { range_from: dto.range_from }),
      ...(dto.range_to !== undefined && { range_to: dto.range_to }),
      ...(dto.valid_from && { valid_from: next_valid_from }),
      ...(dto.valid_to && { valid_to: next_valid_to }),
      ...(dto.is_active !== undefined && { is_active: dto.is_active }),
      // Las tres columnas van juntas o no va ninguna. Actualizar sólo
      // `technical_key` dejaría la copia cifrada y la huella apuntando a la clave
      // ANTERIOR, y como `reveal()` prefiere la cifrada, la resolución seguiría
      // hasheando el CUFE con la clave que el usuario acaba de corregir.
      ...(dto.technical_key !== undefined &&
        this.technicalKeyVault.sealForWrite(patched_technical_key)),
    };

    const updated = await this.prisma.invoice_resolutions.update({
      where: { id },
      data: update_data,
    });

    this.logger.log(`Resolution #${id} updated`);
    return toPublicResolution(updated);
  }

  async remove(id: number) {
    const resolution = await this.findOneInternal(id);

    // Check if resolution has been used
    const usage_count = await this.prisma.invoices.count({
      where: { resolution_id: id },
    });

    if (usage_count > 0) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_003,
        `La resolución tiene ${usage_count} documento(s) emitido(s). Desactívala en vez de borrarla.`,
        { resolution_id: id, issued_invoices: usage_count },
      );
    }

    // `current_number` starts at range_from - 1. Reaching range_from means the
    // DIAN already saw a consecutive from this range — for instance a habilitación
    // test set, which burns numbers without writing rows in `invoices`. Deleting
    // the row would erase the only record of which numbers were consumed.
    if (resolution.current_number >= resolution.range_from) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_003,
        `La resolución ya consumió numeración ante la DIAN (va en ${resolution.current_number}). Desactívala en vez de borrarla.`,
        { resolution_id: id, current_number: resolution.current_number },
      );
    }

    await this.prisma.invoice_resolutions.delete({
      where: { id },
    });

    this.logger.log(`Resolution #${id} deleted`);
  }

  // ---------------------------------------------------------------------------
  // Validación cruzada. Privada a propósito: la regla la declara
  // `fiscal-document-requirements.ts`; aquí solo se aplica y se traduce a HTTP.
  // ---------------------------------------------------------------------------

  /**
   * Resuelve y valida el tipo de documento. Sin él, `sales_invoice` — el defecto
   * histórico de la columna y del generador de consecutivos.
   */
  private normalizeDocumentType(
    value: string | undefined | null,
  ): ResolutionDocumentType {
    const document_type = value ?? 'sales_invoice';

    if (!isFiscalDocumentType(document_type)) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_008,
        `«${document_type}» no es un tipo de documento fiscal reconocido. Elige uno de: ${RESOLUTION_DOCUMENT_TYPES.map(
          (tipo) => requirementsFor(tipo).label,
        ).join(', ')}.`,
        { document_type },
      );
    }

    if (
      !(RESOLUTION_DOCUMENT_TYPES as readonly FiscalDocumentType[]).includes(
        document_type,
      )
    ) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_008,
        `${requirementsFor(document_type).label} no numera contra una resolución: lleva su propio consecutivo NumNE. Configúralo en la habilitación de nómina electrónica, no en resoluciones de numeración.`,
        { document_type },
      );
    }

    // El `includes` de arriba ya descartó los tipos excluidos, pero no estrecha
    // la unión: `RESOLUTION_DOCUMENT_TYPES` se deriva en runtime del contrato.
    return document_type as ResolutionDocumentType;
  }

  /**
   * `invoice_resolutions.resolution_number` es NOT NULL, pero las notas no
   * cuelgan de una Autorización de Numeración y no tienen número DIAN que poner.
   * Su fila existe igual porque `generateNextNumber` la busca por `document_type`
   * y sin ella lanza `FISCAL_RESOLUTION_MISSING`, así que se rotula como interna
   * en vez de obligar al comerciante a inventarse una resolución que no existe.
   *
   * Solo se llega aquí con el número vacío para tipos que NO lo exigen:
   * `assertFiscalRequirements` ya cortó a los que sí.
   */
  private resolveResolutionNumber(
    resolution_number: string | undefined | null,
    prefix: string,
  ): string {
    const declarado = resolution_number?.trim();
    return declarado ? declarado : `INTERNA-${prefix}`;
  }

  /**
   * Aplica el contrato de requisitos por tipo de documento.
   *
   * El caso que justifica el 422 y no un simple aviso: `invoice-flow.service.ts`
   * inyecta `resolution.technical_key` para TODOS los tipos y
   * `dian-direct.provider.ts` la prefiere sobre `config.software_pin`. Una ClTec
   * guardada en la resolución de un documento soporte hace que su CUDS se firme
   * con la clave equivocada, la DIAN lo rechaza y el consecutivo autorizado que
   * gastó no se recupera. Esta validación es lo único que lo impide aguas arriba.
   */
  private assertFiscalRequirements(
    draft: {
      document_type: FiscalDocumentType;
      resolution_number?: string | null;
      technical_key?: string | null;
    },
    details: Record<string, unknown> = {},
  ): void {
    const violations = validateResolutionDraft(draft);
    if (violations.length === 0) return;

    const requirements = requirementsFor(draft.document_type);
    throw new VendixHttpException(
      ErrorCodes.INVOICING_RESOLUTION_008,
      violations
        .map(
          (violation) =>
            `${violation.message} ${CORRECCION_POR_VIOLACION[violation.code]}`,
        )
        .join(' '),
      {
        ...details,
        document_type: draft.document_type,
        document_label: requirements.label,
        key_algorithm: requirements.key_algorithm,
        violations: violations.map(({ field, code }) => ({ field, code })),
      },
    );
  }

  /**
   * Exige que la ClTec tenga la FORMA que emite la DIAN y devuelve el valor
   * normalizado que hay que persistir (`null` si no hay clave).
   *
   * POR QUÉ NO BASTA EL DTO: los tres carriles de escritura pasan por aquí, pero
   * no todos por el mismo `ValidationPipe` —la consola de super admin entra por
   * `TenantContextRunner` y un llamador interno puede construir el DTO a mano—,
   * así que lo que este servicio no exige no lo exige nadie.
   *
   * POR QUÉ IMPORTA LA FORMA Y NO SOLO LA PRESENCIA: la ClTec es el 14º campo
   * del CUFE y la única entrada del hash que el XML NO transporta. La DIAN
   * recomputa el CUFE con la clave que ella emitió, así que es el PRIMER sistema
   * capaz de notar que la nuestra está mal — y lo notifica rechazando el
   * documento con el consecutivo autorizado ya consumido. Pasó en producción con
   * una clave de 38 caracteres que el `@MaxLength(255)` de entonces aceptó sin
   * mirar: «Valor del CUFE no está calculado correctamente», número quemado.
   *
   * La AUSENCIA de clave no se juzga aquí: eso depende del tipo de documento y
   * ya lo decidió `assertFiscalRequirements` (`INVOICING_RESOLUTION_008`).
   */
  private assertTechnicalKeyShape(
    raw: string | null | undefined,
    details: Record<string, unknown> = {},
  ): string | null {
    // La regla vive en `utils/technical-key.util.ts` porque hay TRES carriles de
    // escritura de resoluciones —tienda, organización y consola de super admin—
    // en tres dominios distintos, y durante un tiempo sólo éste la aplicaba. Un
    // método privado no se puede compartir; una copia por carril se desincroniza.
    return assertTechnicalKeyShape(raw, details);
  }

  /** El rango tiene que ser un intervalo real de enteros positivos. */
  private assertRange(
    range_from: number,
    range_to: number,
    details: Record<string, unknown> = {},
  ): void {
    if (
      !Number.isInteger(range_from) ||
      !Number.isInteger(range_to) ||
      range_from < 1 ||
      range_to < 1
    ) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_009,
        `El rango autorizado (${range_from} a ${range_to}) tiene que ir de un número entero a otro, ambos desde 1 en adelante. Cópialos tal cual de la autorización de numeración.`,
        { ...details, range_from, range_to },
      );
    }

    if (range_from > range_to) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_009,
        `El rango autorizado empieza en ${range_from} y termina en ${range_to}: el número final no puede ser menor que el inicial. Revisa cuál de los dos va en cada campo.`,
        { ...details, range_from, range_to },
      );
    }
  }

  /** La vigencia tiene que abrir una ventana, no cerrarla. */
  private assertValidityWindow(
    valid_from: Date,
    valid_to: Date,
    details: Record<string, unknown> = {},
  ): void {
    if (valid_from.getTime() >= valid_to.getTime()) {
      const desde = valid_from.toISOString().slice(0, 10);
      const hasta = valid_to.toISOString().slice(0, 10);
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_010,
        `La vigencia va del ${desde} al ${hasta}: la fecha final tiene que ser posterior a la inicial, o la resolución nace sin un solo día hábil y el generador de consecutivos nunca la encuentra. Corrige las fechas de vigencia de la autorización.`,
        { ...details, valid_from: desde, valid_to: hasta },
      );
    }
  }
}

/**
 * ─── LA ClTec NO SALE POR HTTP ───────────────────────────────────────────────
 *
 * `GET /store/invoicing/resolutions` devolvía la fila entera de
 * `invoice_resolutions`, y ahí viven TRES columnas que no pueden llegar al
 * navegador:
 *
 *   - `technical_key` — la ClTec en claro. Es la 14.ª entrada del hash del CUFE
 *     (Anexo 1.9 §11.2). Con ella y con los datos públicos del documento
 *     —número, fecha, hora, totales, NIT de las dos partes— cualquiera recompone
 *     el CUFE de todo lo emitido bajo esa resolución, que es exactamente lo que
 *     la DIAN usa para probar autenticidad.
 *   - `technical_key_encrypted` — el ciphertext. Publicarlo es peor que inútil:
 *     regala material para atacar la llave fuera de línea, sin límite de
 *     intentos y sin que quede rastro.
 *   - `technical_key_fingerprint` — SHA-256 sin llave. Correlaciona resoluciones
 *     de tenants distintos que comparten clave; es un índice ciego de uso
 *     interno (`fiscal-production-readiness.service.ts`), no un dato de la
 *     pantalla.
 *
 * Se sustituyen por lo único que la UI necesita: si la clave ESTÁ y cuántos
 * caracteres tiene. Con eso el formulario pinta «clave guardada» sin volver a
 * pedirla y el diagnóstico del caso de producción —una ClTec de 38 en vez de
 * 40— se lee de un vistazo, sin exponer un solo carácter.
 *
 * Es la misma convención que ya aplica el carril superadmin
 * (`tenant-resolutions.controller.ts`, `tenant-directory.service.ts`): allí se
 * publica `technical_key_set`. Aquí se añade además la longitud porque este es
 * el carril donde el comerciante corrige la clave.
 *
 * ⚠️ Se aplica en el SERVICIO y no en el controlador porque `findOne()` lo
 * consumen también otros métodos de esta clase; los que sí necesitan la clave
 * vigente llaman a `findOneInternal()`, que es privada. Un controlador nuevo no
 * puede saltarse la limpieza sin escribir su propia consulta.
 */
function toPublicResolution<
  T extends {
    technical_key?: string | null;
    technical_key_encrypted?: string | null;
    technical_key_fingerprint?: string | null;
  },
>(row: T) {
  const {
    technical_key,
    technical_key_encrypted: _encrypted,
    technical_key_fingerprint: _fingerprint,
    ...rest
  } = row;

  const stored = (technical_key ?? '').trim();

  return {
    ...rest,
    technical_key_set: stored.length > 0,
    /**
     * Cuántos caracteres tiene la guardada. `0` cuando no hay.
     *
     * No es un dato decorativo: la DIAN emite exactamente 40 hexadecimales, y
     * el rechazo real del 14/08/2026 fue una clave de 38 que nadie miró. Que la
     * pantalla pueda decir «tiene 38, deben ser 40» sin revelar ni un carácter
     * es la diferencia entre diagnosticar en un segundo y quemar otro
     * consecutivo autorizado.
     */
    technical_key_length: stored.length,
  };
}
