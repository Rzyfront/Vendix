import { Injectable, Logger } from '@nestjs/common';

import { ErrorCodes, VendixHttpException } from '@common/errors';
import { profileNotFound } from './profile-errors';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

import { CloneInvoiceProfileDto } from './dto/clone-invoice-profile.dto';
import { CreateInvoiceProfileDto } from './dto/create-invoice-profile.dto';
import { QueryInvoiceProfilesDto } from './dto/query-invoice-profiles.dto';
import { UpdateInvoiceProfileDto } from './dto/update-invoice-profile.dto';
import { InvoiceProfileConfig } from './invoice-profile-config.contract';
import { normalizeAndAssertProfileConfig } from './invoice-profile-config.validator';

/**
 * Ámbito del tenant, resuelto una vez por operación.
 *
 * Se pasa explícitamente a todo lo que corre DENTRO de una transacción, porque
 * el cliente que entrega `$transaction` es el BASE: no lleva la extensión de
 * scoping y no inyecta `store_id` en nada. Ver `runScopedTransaction`.
 */
interface ProfileScope {
  organization_id: number;
  store_id: number;
  user_id?: number;
}

/** Lo que el listado y el detalle devuelven del perfil. */
const PROFILE_SELECT = {
  id: true,
  organization_id: true,
  store_id: true,
  name: true,
  operation_type: true,
  state: true,
  is_default: true,
  current_version: true,
  cloned_from_profile_id: true,
  cloned_from_version: true,
  created_by: true,
  created_at: true,
  updated_at: true,
} as const;

@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  // ─── Contexto ───────────────────────────────────────────────────────────

  /**
   * El perfil es store-scoped por columna propia y NO nullable (ver el esquema):
   * sin `store_id` no hay perfil que crear ni listar. Se responde 400 con código
   * —`STORE_CONTEXT_001`, el que ya usan contabilidad y retenciones— y no un
   * `Error` pelado, que el filtro global degradaría a 500 sobre una petición que
   * simplemente llegó sin tienda seleccionada.
   */
  private getScope(): ProfileScope {
    const context = RequestContextService.getContext();
    if (!context?.organization_id || !context?.store_id) {
      throw new VendixHttpException(
        ErrorCodes.STORE_CONTEXT_001,
        'Selecciona una tienda antes de trabajar con perfiles de facturación.',
      );
    }
    return {
      organization_id: context.organization_id,
      store_id: context.store_id,
      user_id: context.user_id,
    };
  }

  /**
   * Corre una transacción con el ancla de tenant EXPLÍCITA.
   *
   * `BasePrismaService.$transaction` delega en `this.baseClient.$transaction`,
   * o sea entrega el cliente crudo: dentro del callback no hay extensión de
   * scoping y `store_id` no se inyecta en ninguna parte. Todo `where` de dentro
   * lo lleva a mano, y por eso el ámbito viaja como argumento en vez de leerse
   * del contexto ahí dentro — así se ve en la firma de cada operación.
   *
   * Mismo patrón que `invoice-number-generator.ts`, que envuelve la reserva de
   * consecutivos con `withoutScope().$transaction` y escribe
   * `accounting_entity_id` en cada consulta.
   *
   * Leer una versión de OTRO tenant no sería un dato de más: sería calcular el
   * IVA de un documento con las tarifas de otra empresa, bajo nuestro NIT y
   * nuestro consecutivo.
   */
  private runScopedTransaction<T>(
    work: (tx: any, scope: ProfileScope) => Promise<T>,
  ): Promise<T> {
    const scope = this.getScope();
    return this.prisma
      .withoutScope()
      .$transaction((tx: any) => work(tx, scope)) as Promise<T>;
  }

  // ─── Lectura ────────────────────────────────────────────────────────────

  async findAll(query: QueryInvoiceProfilesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Record<string, unknown> = {};
    if (query.operation_type) where.operation_type = query.operation_type;
    if (query.state) where.state = query.state;
    if (query.search?.trim()) {
      where.name = { contains: query.search.trim(), mode: 'insensitive' };
    }

    // Cliente SCOPEADO: `store_id` lo inyecta la extensión. No se escribe a mano
    // acá a propósito — `mergeScopedWhere` deja el valor del llamador arriba y
    // empuja el del scope al `AND`, así que un `store_id` propio produciría un
    // predicado imposible y el listado devolvería cero filas sin explicación.
    const [data, total] = await Promise.all([
      this.prisma.invoice_profiles.findMany({
        where,
        select: PROFILE_SELECT,
        orderBy: [{ is_default: 'desc' }, { updated_at: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.invoice_profiles.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * `findFirst` y no `findUnique`: la extensión de scoping añade `store_id` al
   * `where`, y `findUnique` sólo admite campos del único — un `where` con
   * `store_id` lo hace fallar. Es el motivo por el que todo el repo usa
   * `findFirst` sobre modelos scopeados.
   */
  async findOne(id: number) {
    const profile = await this.prisma.invoice_profiles.findFirst({
      where: { id },
      select: PROFILE_SELECT,
    });
    if (!profile) throw profileNotFound(id);

    const version = await this.prisma.invoice_profile_versions.findFirst({
      where: { profile_id: id, version: profile.current_version },
      select: { id: true, version: true, config: true, created_at: true, created_by: true },
    });

    // `current_version = 0` significa «sin versión comprometida»: el default de
    // la columna es 0 y no 1 justo para que una transacción interrumpida sea
    // DETECTABLE en vez de parecer una versión que nadie escribió.
    if (!version && profile.current_version > 0) {
      this.logger.error(
        `invoice_profiles.id=${id} apunta a la versión ${profile.current_version}, que no existe`,
      );
    }

    return { ...profile, current_config: version?.config ?? null, version };
  }

  /**
   * Catálogo para el wizard de factura: sólo los perfiles ACTIVOS.
   *
   * Devuelve el catálogo completo y no sólo el predeterminado (ADR-9): el
   * selector muestra todo lo activo y preselecciona el predeterminado. Enviar
   * sólo uno escondería los demás y obligaría a ir al módulo para cambiarlo.
   *
   * No lleva paginación a propósito. Un selector paginado no es un selector, y
   * el número de perfiles de una tienda es del orden de las decenas — si algún
   * día dejara de serlo, el problema sería el diseño del selector, no el tamaño
   * de la respuesta.
   *
   * La caché Redis se monta encima de ESTE método (paso C.5), no dentro de los
   * llamadores: así hay un solo sitio donde invalidar.
   */
  async catalog() {
    return this.prisma.invoice_profiles.findMany({
      where: { state: 'active' },
      select: {
        id: true,
        name: true,
        operation_type: true,
        is_default: true,
        current_version: true,
      },
      orderBy: [{ is_default: 'desc' }, { name: 'asc' }],
    });
  }

  // ─── Escritura ──────────────────────────────────────────────────────────

  /**
   * Crea el perfil y su versión 1 en la MISMA transacción.
   *
   * Si no fueran atómicas, un fallo entre las dos escrituras dejaría un perfil
   * con `current_version = 1` apuntando a una versión que no existe, y toda
   * lectura del perfil devolvería configuración nula: el wizard elegiría un
   * perfil que no puede calcular nada.
   */
  async create(dto: CreateInvoiceProfileDto) {
    const config = normalizeAndAssertProfileConfig(dto.config, {
      operation_type: dto.operation_type,
    });

    return this.runScopedTransaction(async (tx, scope) => {
      if (dto.is_default) {
        await this.clearDefault(tx, scope, dto.operation_type);
      }

      const profile = await tx.invoice_profiles.create({
        data: {
          organization_id: scope.organization_id,
          store_id: scope.store_id,
          name: dto.name,
          operation_type: dto.operation_type,
          state: dto.state ?? 'active',
          is_default: dto.is_default ?? false,
          current_version: 0,
          created_by: scope.user_id ?? null,
        },
        select: PROFILE_SELECT,
      });

      return this.commitVersion(tx, scope, profile.id, config, 1);
    });
  }

  /**
   * Editar NO reescribe la versión vigente: escribe una nueva y mueve el
   * puntero, las dos en la misma transacción (ADR-1).
   *
   * Reescribirla cambiaría, retroactivamente, la configuración con la que se
   * emitieron las facturas que la referencian — y con ella el IVA que declararon.
   */
  async update(id: number, dto: UpdateInvoiceProfileDto) {
    // La lectura previa va por el cliente SCOPEADO: es lo que garantiza que un
    // id de otro tenant no llegue nunca a la transacción, donde ya no hay scope.
    const current = await this.prisma.invoice_profiles.findFirst({
      where: { id },
      select: { id: true, operation_type: true, current_version: true },
    });
    if (!current) throw profileNotFound(id);

    // El tipo de operación EFECTIVO manda sobre la validación: un perfil que
    // deja de ser '09' no puede conservar su sección AIU, y uno que empieza a
    // serlo tiene que traerla. Validar contra el tipo viejo dejaría pasar las dos.
    const operation_type = dto.operation_type ?? current.operation_type;
    const config =
      dto.config === undefined
        ? null
        : normalizeAndAssertProfileConfig(dto.config, {
            operation_type,
            profile_id: id,
          });

    // Cambiar el tipo de operación sin reenviar la configuración dejaría el
    // snapshot vigente validado contra un tipo que ya no es el del perfil.
    if (dto.operation_type && dto.operation_type !== current.operation_type && !config) {
      const existing = await this.readVersionConfig(id, current.current_version);
      normalizeAndAssertProfileConfig(existing, { operation_type, profile_id: id });
    }

    return this.runScopedTransaction(async (tx, scope) => {
      await this.assertOwned(tx, scope, id);
      const updated = await tx.invoice_profiles.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.operation_type !== undefined && {
            operation_type: dto.operation_type,
          }),
          ...(dto.state !== undefined && { state: dto.state }),
          updated_at: new Date(),
        },
        select: PROFILE_SELECT,
      });

      if (!config) return this.attachCurrentConfig(tx, updated);
      return this.commitVersion(
        tx,
        scope,
        updated.id,
        config,
        updated.current_version + 1,
      );
    });
  }

  /**
   * Clonar produce un perfil INDEPENDIENTE con su propia versión 1 (ADR-1).
   *
   * Nunca hereda `is_default`: dos predeterminados del mismo tipo de operación
   * los rechazaría el índice único parcial, y decidir cuál gana por orden de
   * inserción sería arbitrario. El clon nace no predeterminado y se marca aparte.
   *
   * Y nace **inactivo**, sin heredar el estado del origen. Se clona para
   * cambiar algo: el clon es, por definición, una configuración a medio hacer.
   * Si naciera activo entraría al catálogo del wizard en el mismo instante en
   * que se crea, y quien facturara entremedio emitiría con la copia sin revisar
   * —con el nombre nuevo y las tarifas viejas—. Activarlo es un paso aparte y
   * deliberado.
   */
  async clone(id: number, dto: CloneInvoiceProfileDto) {
    const source = await this.prisma.invoice_profiles.findFirst({
      where: { id },
      select: { id: true, operation_type: true, current_version: true, state: true },
    });
    if (!source) throw profileNotFound(id);

    const source_version = dto.source_version ?? source.current_version;
    const config = await this.readVersionConfig(id, source_version);

    // Se revalida lo clonado en vez de copiarlo a ciegas: si la versión de
    // origen se guardó con una versión anterior de las reglas fiscales, el clon
    // no puede nacer con una configuración que hoy sería inválida.
    const validated = normalizeAndAssertProfileConfig(config, {
      operation_type: source.operation_type,
    });

    return this.runScopedTransaction(async (tx, scope) => {
      const profile = await tx.invoice_profiles.create({
        data: {
          organization_id: scope.organization_id,
          store_id: scope.store_id,
          name: dto.name,
          operation_type: source.operation_type,
          state: 'inactive',
          is_default: false,
          current_version: 0,
          cloned_from_profile_id: source.id,
          cloned_from_version: source_version,
          created_by: scope.user_id ?? null,
        },
        select: PROFILE_SELECT,
      });

      return this.commitVersion(tx, scope, profile.id, validated, 1);
    });
  }

  /**
   * Borra el perfil y su historial — sólo si NINGUNA factura lo referencia.
   *
   * ## La decisión que el plan pedía documentar
   *
   * Se borra de verdad, no se marca. El historial de versiones existe para hacer
   * REPRODUCIBLE una factura emitida: si ninguna factura apunta a este perfil,
   * no hay nada que reproducir, y conservarlo dejaría creciendo para siempre una
   * lista de perfiles que el usuario pidió explícitamente quitar. En cuanto una
   * factura lo referencia, el borrado deja de ser posible —acá y en la base— y
   * la alternativa es desactivarlo.
   *
   * La comprobación previa no es la garantía, es el mensaje: la garantía es la
   * FK `ON DELETE RESTRICT`. Entre el conteo y el borrado cabe una factura
   * nueva, y en esa carrera gana la base. Por eso el error de FK se traduce al
   * MISMO 409 en vez de escapar como 500.
   */
  async remove(id: number) {
    const profile = await this.prisma.invoice_profiles.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!profile) throw profileNotFound(id);

    const stamped = await this.prisma.invoices.count({
      where: { profile_id: id },
    });
    if (stamped > 0) throw this.deleteBlocked(id, stamped);

    try {
      await this.runScopedTransaction(async (tx, scope) => {
        // El ancla se comprueba ANTES de borrar y dentro de la transacción: sin
        // esto, `deleteMany({ profile_id })` borraría el historial de un perfil
        // de otro tenant con sólo acertar un id.
        await this.assertOwned(tx, scope, id);
        await tx.invoice_profile_versions.deleteMany({
          where: { profile_id: id },
        });
        await tx.invoice_profiles.delete({ where: { id } });
      });
    } catch (error) {
      if (this.isForeignKeyViolation(error)) {
        const now = await this.prisma.invoices.count({ where: { profile_id: id } });
        throw this.deleteBlocked(id, now);
      }
      throw error;
    }

    return { deleted: true, id };
  }

  // ─── Auxiliares ─────────────────────────────────────────────────────────

  /**
   * Escribe la versión y mueve el puntero. **Siempre dentro de una transacción.**
   *
   * El orden es versión primero, puntero después: si algo falla entremedio y la
   * transacción no existiera, quedaría una versión huérfana —inofensiva, nadie
   * la referencia— en vez de un puntero a la nada. Con transacción no queda
   * ninguna de las dos, y el orden sólo importa por si alguien la quita.
   */
  /**
   * Vuelve a comprobar el ancla de tenant DENTRO de la transacción y devuelve el
   * perfil. Es el único punto donde `store_id` entra al `where` a mano.
   *
   * Existe como paso con nombre —en vez de colar `store_id` en cada `update`—
   * por dos razones. La primera es que se puede probar: un spec afirma que la
   * consulta que sale lleva el filtro. La segunda es que no depende del
   * «extended where unique» de Prisma, que admite campos no únicos junto al
   * único pero cuyo comportamiento no es el mismo entre `update` y `deleteMany`.
   */
  private async assertOwned(tx: any, scope: ProfileScope, id: number) {
    const profile = await tx.invoice_profiles.findFirst({
      where: { id, store_id: scope.store_id },
      select: PROFILE_SELECT,
    });
    if (!profile) throw profileNotFound(id);
    return profile;
  }

  private async commitVersion(
    tx: any,
    scope: ProfileScope,
    profile_id: number,
    config: InvoiceProfileConfig,
    version: number,
  ) {
    const created = await tx.invoice_profile_versions.create({
      data: {
        profile_id,
        version,
        config: config as unknown as object,
        created_by: scope.user_id ?? null,
      },
      select: { id: true, version: true, config: true, created_at: true, created_by: true },
    });

    const profile = await tx.invoice_profiles.update({
      where: { id: profile_id },
      data: { current_version: version, updated_at: new Date() },
      select: PROFILE_SELECT,
    });

    return { ...profile, current_config: created.config, version: created };
  }

  /** Desmarca el predeterminado vigente del mismo tipo de operación. */
  private async clearDefault(
    tx: any,
    scope: ProfileScope,
    operation_type: string,
    except_id?: number,
  ): Promise<void> {
    await tx.invoice_profiles.updateMany({
      // `store_id` explícito: dentro de la transacción no hay scope, y sin él
      // este `updateMany` desmarcaría el predeterminado de TODOS los tenants
      // que compartan tipo de operación.
      where: {
        store_id: scope.store_id,
        operation_type,
        is_default: true,
        ...(except_id !== undefined && { id: { not: except_id } }),
      },
      data: { is_default: false, updated_at: new Date() },
    });
  }

  private async attachCurrentConfig(tx: any, profile: { id: number; current_version: number }) {
    const version = await tx.invoice_profile_versions.findFirst({
      where: { profile_id: profile.id, version: profile.current_version },
      select: { id: true, version: true, config: true, created_at: true, created_by: true },
    });
    return { ...profile, current_config: version?.config ?? null, version };
  }

  /** Lee el `config` de una versión por el cliente scopeado. 404 si no existe. */
  private async readVersionConfig(profile_id: number, version: number) {
    const row = await this.prisma.invoice_profile_versions.findFirst({
      where: { profile_id, version },
      select: { config: true },
    });
    if (!row) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_PROFILE_VERSION_001,
        `La versión ${version} de este perfil no existe.`,
        { profile_id, version },
      );
    }
    return row.config;
  }

  private deleteBlocked(profile_id: number, invoice_count: number) {
    return new VendixHttpException(
      ErrorCodes.INVOICING_PROFILE_003,
      invoice_count === 1
        ? 'Este perfil tiene 1 factura timbrada y no puede eliminarse. Puedes desactivarlo.'
        : `Este perfil tiene ${invoice_count} facturas timbradas y no puede eliminarse. Puedes desactivarlo.`,
      { profile_id, invoice_count },
    );
  }

  /**
   * `P2003` es la violación de FK de Prisma; `P2014` la de una relación
   * requerida. Se miran por código y no por mensaje porque el mensaje cambia
   * entre versiones del cliente.
   */
  private isForeignKeyViolation(error: unknown): boolean {
    const code = (error as { code?: string })?.code;
    return code === 'P2003' || code === 'P2014';
  }
}
