import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { parsePlausibleFiscalDate } from '@common/utils/fiscal-date.util';
import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import {
  isFiscalDocumentType,
  requirementsFor,
  validateResolutionDraft,
  type FiscalDocumentType,
} from '../../../store/invoicing/fiscal-document-requirements';
import {
  RESOLUTION_DOCUMENT_TYPES,
  type ResolutionDocumentType,
} from '../../../store/invoicing/resolutions/dto/create-resolution.dto';
import {
  CORRECCION_POR_VIOLACION,
  ROTULO_CAMPO_INMUTABLE,
} from '../../../store/invoicing/resolutions/resolutions.service';
import { CreateOrgInvoiceResolutionDto } from './dto/create-org-invoice-resolution.dto';
import { UpdateOrgInvoiceResolutionDto } from './dto/update-org-invoice-resolution.dto';

/** Campos que fijan la identidad fiscal de una resolución ante la DIAN. */
type CampoInmutable = keyof typeof ROTULO_CAMPO_INMUTABLE;

/**
 * Resoluciones y rangos de numeración DIAN — carril de ORGANIZACIÓN.
 *
 * ## Por qué este servicio no delega en `ResolutionsService`
 *
 * `ResolutionsService` (carril de tienda) es el cuello por el que pasan el panel
 * del comerciante, la consola de super admin (vía `TenantContextRunner`) y la API
 * directa. Este carril NO puede pasar por ahí: aquel servicio lee `store_id` del
 * `RequestContextService` y escribe con `StorePrismaService`, mientras que aquí
 * `store_id` es **opcional y legítimamente nulo** —una resolución de una
 * organización con `fiscal_scope=ORGANIZATION` no cuelga de ninguna tienda— y
 * llega en el DTO, no en el contexto. Forzar la delegación importaría la
 * suposición de tienda obligatoria y rompería el modelo multi-tienda.
 *
 * ## Cómo se evita entonces la tercera copia de las reglas
 *
 * Las reglas NO se reimplementan: se consumen.
 *
 *  - `validateResolutionDraft` / `requirementsFor` / `isFiscalDocumentType` /
 *    `RESOLUTION_DOCUMENT_TYPES` vienen del contrato
 *    `fiscal-document-requirements.ts`, que es puro justamente para que los tres
 *    carriles lean la misma tabla.
 *  - `CORRECCION_POR_VIOLACION` y `ROTULO_CAMPO_INMUTABLE` se importan del carril
 *    de tienda para que el comerciante lea EXACTAMENTE la misma corrección venga
 *    por donde venga.
 *  - Los códigos de error son los mismos (`INVOICING_RESOLUTION_005/007/008/009/010`),
 *    así que la UI mapea un solo contrato de errores.
 *
 * Lo que este servicio añade sobre el carril de tienda es sólo lo que aquel no
 * puede saber: resolución de `store_id` opcional contra el `fiscal_scope` de la
 * organización, y la entidad contable que sale de ahí.
 *
 * ## Qué se protege
 *
 * Un consecutivo autorizado. `invoice-flow.service.ts` inyecta
 * `resolution.technical_key` para TODOS los tipos de documento y
 * `dian-direct.provider.ts` la prefiere sobre `config.software_pin`: una ClTec
 * guardada en la resolución de un documento soporte hace que su CUDS se firme con
 * el 14º campo equivocado, la DIAN lo rechaza y el número que gastó no vuelve. Un
 * carril de escritura sin esta validación es por donde entra esa configuración.
 */
@Injectable()
export class OrgInvoiceResolutionsService {
  private readonly logger = new Logger(OrgInvoiceResolutionsService.name);

  constructor(
    private readonly prisma: OrganizationPrismaService,
    private readonly fiscalScope: FiscalScopeService,
  ) {}

  private requireOrganizationId(): number {
    const organization_id = RequestContextService.getOrganizationId();
    if (!organization_id) {
      throw new ForbiddenException('Organization context is required');
    }
    return organization_id;
  }

  async findAll(store_id?: number) {
    const organization_id = this.requireOrganizationId();
    const where: any = { organization_id };
    if (typeof store_id === 'number') where.store_id = store_id;

    return this.prisma.invoice_resolutions.findMany({
      where,
      orderBy: [{ is_active: 'desc' }, { valid_to: 'desc' }],
      include: {
        store: { select: { id: true, name: true, slug: true } },
        accounting_entity: {
          select: { id: true, name: true, fiscal_scope: true, store_id: true },
        },
        _count: { select: { invoices: true } },
      },
    });
  }

  async findOne(id: number) {
    const organization_id = this.requireOrganizationId();
    const resolution = await this.prisma.invoice_resolutions.findFirst({
      where: { id, organization_id },
      include: {
        store: { select: { id: true, name: true, slug: true } },
        accounting_entity: {
          select: { id: true, name: true, fiscal_scope: true, store_id: true },
        },
        _count: { select: { invoices: true } },
      },
    });

    if (!resolution) {
      throw new NotFoundException('Invoice resolution not found');
    }

    return resolution;
  }

  async create(dto: CreateOrgInvoiceResolutionDto) {
    // Primero lo que no toca la base: un payload que la DIAN rechazaría no tiene
    // por qué gastar queries de resolución de tienda y entidad contable antes de
    // que se lo digan. Mismo orden que el carril de tienda.
    const document_type = this.normalizeDocumentType(dto.document_type);
    this.assertFiscalRequirements({
      document_type,
      resolution_number: dto.resolution_number,
      technical_key: dto.technical_key,
    });
    this.assertRange(dto.range_from, dto.range_to);

    // Validadas, no solo convertidas: el escáner por IA y un año a medio teclear
    // producen fechas ISO válidas pero imposibles, que después viajan al período
    // de autorización del XML.
    const resolution_date = parsePlausibleFiscalDate(
      'fecha de resolución',
      dto.resolution_date,
    );
    const valid_from = parsePlausibleFiscalDate('válida desde', dto.valid_from);
    const valid_to = parsePlausibleFiscalDate('válida hasta', dto.valid_to);
    this.assertValidityWindow(valid_from, valid_to);

    const organization_id = this.requireOrganizationId();
    const store_id = await this.resolveStoreIdForWrite(
      organization_id,
      dto.store_id,
    );
    const accounting_entity =
      await this.fiscalScope.resolveAccountingEntityForFiscal({
        organization_id,
        store_id,
      });

    await this.assertPrefixFree(accounting_entity.id, dto.prefix);

    const resolution = await this.prisma.withoutScope().invoice_resolutions.create({
      data: {
        organization_id,
        store_id,
        accounting_entity_id: accounting_entity.id,
        document_type,
        // Las notas no cuelgan de una Autorización de Numeración y no tienen
        // número DIAN que poner, pero la columna es NOT NULL y su fila sigue
        // siendo obligatoria para `generateNextNumber`. Sin este respaldo el alta
        // de una nota por este carril moría con un error de base (500).
        resolution_number: this.resolveResolutionNumber(
          dto.resolution_number,
          dto.prefix,
        ),
        resolution_date,
        prefix: dto.prefix,
        range_from: dto.range_from,
        range_to: dto.range_to,
        current_number: dto.range_from - 1, // El piso autorizado, aún sin consumir
        valid_from,
        valid_to,
        is_active: dto.is_active ?? true,
        technical_key: dto.technical_key ?? null,
      },
      include: {
        store: { select: { id: true, name: true, slug: true } },
        accounting_entity: {
          select: { id: true, name: true, fiscal_scope: true, store_id: true },
        },
      },
    });

    this.logger.log(
      `Org invoice resolution ${resolution.id} created for org ${organization_id}, entity ${accounting_entity.id}`,
    );

    return resolution;
  }

  async update(id: number, dto: UpdateOrgInvoiceResolutionDto) {
    const current = await this.findOne(id);

    // `current_number` arranca en `range_from - 1`. Alcanzar `range_from`
    // significa que la DIAN ya vio un consecutivo salido de este rango —incluido
    // el set de pruebas de habilitación, que quema números sin escribir filas en
    // `invoices`—, y a partir de ahí la identidad fiscal de la fila está
    // comprometida con documentos ya reportados.
    const consumed = current.current_number >= current.range_from;

    if (consumed) {
      const inmutables: CampoInmutable[] = [];
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
    // validación puede venir incumpliendo el contrato.
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

    const update_data: any = {};

    if (dto.resolution_number !== undefined) {
      update_data.resolution_number = dto.resolution_number;
    }
    if (dto.resolution_date !== undefined) {
      update_data.resolution_date = parsePlausibleFiscalDate(
        'fecha de resolución',
        dto.resolution_date,
      );
    }
    if (dto.prefix !== undefined) update_data.prefix = dto.prefix;
    if (dto.document_type !== undefined) {
      update_data.document_type = next_document_type;
    }
    if (dto.range_from !== undefined) update_data.range_from = dto.range_from;
    if (dto.range_to !== undefined) update_data.range_to = dto.range_to;
    if (dto.valid_from !== undefined) update_data.valid_from = next_valid_from;
    if (dto.valid_to !== undefined) update_data.valid_to = next_valid_to;
    // `!== undefined` y nada más: un defecto materializado en el DTO reactivaría
    // en silencio una resolución retirada. Por eso `CreateOrgInvoiceResolutionDto`
    // y su `PartialType` no llevan inicializadores de propiedad.
    if (dto.is_active !== undefined) update_data.is_active = dto.is_active;
    if (dto.technical_key !== undefined) {
      update_data.technical_key = dto.technical_key;
    }

    let next_accounting_entity_id = current.accounting_entity_id;
    if (dto.store_id !== undefined) {
      const store_id = await this.resolveStoreIdForWrite(
        current.organization_id,
        dto.store_id,
      );
      const accounting_entity =
        await this.fiscalScope.resolveAccountingEntityForFiscal({
          organization_id: current.organization_id,
          store_id,
        });
      update_data.store_id = store_id;
      update_data.accounting_entity_id = accounting_entity.id;
      next_accounting_entity_id = accounting_entity.id;
    }

    // Mover la resolución de entidad fiscal o cambiarle el prefijo la lleva al
    // mismo eje del índice único que vigila el alta. Sin este chequeo el choque
    // volvía como P2002 crudo, o sea un 500 sin pista. Sólo se paga la query
    // cuando el PATCH mueve realmente uno de los dos campos.
    const next_prefix = dto.prefix ?? current.prefix;
    if (
      next_accounting_entity_id !== current.accounting_entity_id ||
      next_prefix !== current.prefix
    ) {
      await this.assertPrefixFree(next_accounting_entity_id, next_prefix, id);
    }

    const updated = await this.prisma.withoutScope().invoice_resolutions.update({
      where: { id },
      data: update_data,
      include: {
        store: { select: { id: true, name: true, slug: true } },
        accounting_entity: {
          select: { id: true, name: true, fiscal_scope: true, store_id: true },
        },
      },
    });

    this.logger.log(`Org invoice resolution #${id} updated`);
    return updated;
  }

  async remove(id: number) {
    const resolution = await this.findOne(id);

    if (resolution._count.invoices > 0) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_003,
        `La resolución tiene ${resolution._count.invoices} documento(s) emitido(s). Desactívala en vez de borrarla.`,
        { resolution_id: id, issued_invoices: resolution._count.invoices },
      );
    }

    // `current_number` arranca en `range_from - 1`. Alcanzarlo significa que la
    // DIAN ya vio un consecutivo de este rango —por ejemplo el set de pruebas de
    // habilitación, que quema números sin escribir filas en `invoices`—, y borrar
    // la fila borraría el único registro de qué números se consumieron.
    if (resolution.current_number >= resolution.range_from) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_003,
        `La resolución ya consumió numeración ante la DIAN (va en ${resolution.current_number}). Desactívala en vez de borrarla.`,
        { resolution_id: id, current_number: resolution.current_number },
      );
    }

    await this.prisma.withoutScope().invoice_resolutions.delete({
      where: { id },
    });

    this.logger.log(`Org invoice resolution #${id} deleted`);
  }

  private async resolveStoreIdForWrite(
    organization_id: number,
    requested_store_id?: number | null,
  ): Promise<number | null> {
    const fiscal_scope = await this.fiscalScope.requireFiscalScope(organization_id);

    if (fiscal_scope === 'ORGANIZATION') {
      return null;
    }

    if (typeof requested_store_id !== 'number') {
      throw new BadRequestException(
        'store_id is required when fiscal_scope=STORE',
      );
    }

    const store = await this.prisma.stores.findFirst({
      where: {
        id: requested_store_id,
        organization_id,
        is_active: true,
      },
      select: { id: true },
    });

    if (!store) {
      throw new ForbiddenException(
        'Store does not belong to the current organization',
      );
    }

    return store.id;
  }

  // ---------------------------------------------------------------------------
  // Validación cruzada. Las reglas las declara `fiscal-document-requirements.ts`
  // y las redacta el carril de tienda; aquí sólo se aplican y se traducen a HTTP
  // con los MISMOS códigos, para que la UI no tenga que distinguir el carril.
  // ---------------------------------------------------------------------------

  /**
   * El prefijo pertenece a UNA fila por entidad contable, que es como la DIAN lo
   * autoriza: por NIT.
   *
   * Mira `(accounting_entity_id, prefix)` —el mismo eje del índice único
   * `invoice_resolutions_entity_prefix_uidx`, sin `document_type` y sin
   * `is_active`— y con el mismo cliente que hace la escritura: `withoutScope()`.
   * Mirar por otro eje o con el cliente scopeado podía no ver la fila con la que
   * iba a colisionar, y el duplicado salía como P2002 crudo.
   */
  private async assertPrefixFree(
    accounting_entity_id: number,
    prefix: string,
    ignore_resolution_id?: number,
  ): Promise<void> {
    const existing = await this.prisma
      .withoutScope()
      .invoice_resolutions.findFirst({
        where: {
          accounting_entity_id,
          prefix,
          ...(ignore_resolution_id !== undefined && {
            id: { not: ignore_resolution_id },
          }),
        },
        select: {
          id: true,
          resolution_number: true,
          document_type: true,
          is_active: true,
        },
      });

    if (!existing) return;

    const rotulo = isFiscalDocumentType(existing.document_type)
      ? requirementsFor(existing.document_type).label
      : existing.document_type;

    throw new VendixHttpException(
      ErrorCodes.INVOICING_RESOLUTION_007,
      `Ya existe una resolución con prefijo "${prefix}" para ${rotulo} (número ${
        existing.resolution_number
      }${
        existing.is_active ? '' : ', desactivada'
      }) en esta entidad fiscal. La DIAN autoriza el prefijo por NIT, así que no puede repetirse.`,
      {
        resolution_id: existing.id,
        prefix,
        document_type: existing.document_type,
        is_active: existing.is_active,
      },
    );
  }

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

    return document_type as ResolutionDocumentType;
  }

  /**
   * `invoice_resolutions.resolution_number` es NOT NULL, pero las notas no
   * cuelgan de una Autorización de Numeración y no tienen número DIAN que poner.
   * Su fila existe igual porque `generateNextNumber` la busca por `document_type`
   * y sin ella lanza `FISCAL_RESOLUTION_MISSING`, así que se rotula como interna.
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
   * Idéntico al del carril de tienda hasta el mensaje: las violaciones las emite
   * `validateResolutionDraft` y la corrección concreta sale de
   * `CORRECCION_POR_VIOLACION`, ambas compartidas. Si la redacción cambia allá,
   * cambia aquí.
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
