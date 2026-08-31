import { Injectable, Logger } from '@nestjs/common';

import { AuditService } from '@common/audit/audit.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { profileNotFound } from './profile-errors';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

import { ProfileCatalogCacheService } from './profile-catalog-cache.service';
import { ProfileAccountingValidator } from './profile-accounting.validator';
import { CloneInvoiceProfileDto } from './dto/clone-invoice-profile.dto';
import { CreateInvoiceProfileDto } from './dto/create-invoice-profile.dto';
import { normalizeName } from './dto/invoice-profile-name';
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

/**
 * Las siete acciones auditadas. `CREATE`/`UPDATE`/`DELETE` reusan los valores
 * de `AuditAction`; las otras cuatro son cadenas propias porque el enum
 * compartido no las tiene y la columna es `VarChar(100)`. Se escriben con el
 * mismo estilo del enum (MAYÚSCULAS con guion bajo) para que una consulta por
 * `action` no tenga que saber de qué dominio viene la fila.
 */
type ProfileAuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'CLONE'
  | 'SET_DEFAULT'
  | 'ACTIVATE'
  | 'DEACTIVATE';

/**
 * El valor de `resource`. Es el nombre de la tabla, que es el criterio que
 * siguen los valores de `AuditResource` (`products`, `orders`, `stock_levels`).
 */
const PROFILE_AUDIT_RESOURCE = 'invoice_profiles';

/**
 * Las columnas del perfil que la auditoría vigila. `config` no está: vive
 * versionado en `invoice_profile_versions` y no se duplica — ver `writeAudit`.
 * `updated_at` tampoco: cambia en toda escritura y su diff no informa de nada.
 */
const AUDITED_COLUMNS = [
  'name',
  'operation_type',
  'state',
  'is_default',
  'current_version',
  'cloned_from_profile_id',
  'cloned_from_version',
] as const;

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

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly catalog_cache: ProfileCatalogCacheService,
    private readonly audit: AuditService,
    private readonly accounts: ProfileAccountingValidator,
  ) {}

  // ─── Contexto ───────────────────────────────────────────────────────────

  /**
   * El perfil es store-scoped por columna propia y NO nullable (ver el esquema):
   * sin `store_id` no hay perfil que crear ni listar. Se responde 400 con código
   * —`STORE_CONTEXT_001`, el que ya usan contabilidad y retenciones— y no un
   * `Error` pelado, que el filtro global degradaría a 500 sobre una petición que
   * simplemente llegó sin tienda seleccionada.
   */
  /**
   * AUDITORÍA DE LAS SIETE ACCIONES (requerimiento 24).
   *
   * ## Qué se guarda y qué NO
   *
   * `old_values` y `new_values` llevan **sólo las columnas del perfil que
   * cambiaron**, con las mismas claves en las dos: así el par ES el diff, sin
   * que haya que compararlo al leer ni almacenar lo que quedó igual. Para
   * `CREATE`, `CLONE` y `DELETE` no hay diff sino nacimiento o muerte, y se
   * guarda el estado completo del lado que existe.
   *
   * **El `config` no se copia acá.** Ya está persistido íntegro e inmutable en
   * `invoice_profile_versions`: copiarlo a `audit_logs` crearía una segunda
   * copia de la misma verdad fiscal, con su propia posibilidad de divergir, y
   * duplicaría kilobytes por edición. El diff configuración-contra-configuración
   * —el que pide el requerimiento 13 para el historial— se calcula entre dos
   * filas de `versions`, que es donde vive. Para que el lector sepa QUÉ dos
   * filas comparar, `metadata` lleva `version_from` y `version_to`.
   *
   * ## Por qué es best-effort y no parte de la transacción
   *
   * `AuditService.log` atrapa su propio error. Es deliberado y se hereda tal
   * cual: la auditoría de un cambio de configuración no puede ser la razón por
   * la que ese cambio se pierda. Se llama DESPUÉS del commit por la misma razón
   * que la invalidación de caché — auditar algo que la transacción luego
   * revirtió sería registrar un hecho que no ocurrió.
   *
   * ## `storeId` explícito
   *
   * `AuditService.log` resuelve `organization_id` del contexto por su cuenta,
   * pero **no** `store_id`. Una fila sin `store_id` no la encuentra el índice
   * `(store_id, created_at)` con el que se consulta la auditoría de una tienda:
   * quedaría escrita y sería invisible.
   */
  private async writeAudit(
    action: ProfileAuditAction,
    profile_id: number,
    old_values: Record<string, unknown> | null,
    new_values: Record<string, unknown> | null,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const scope = RequestContextService.getContext();
    try {
      await this.audit.log({
        userId: scope?.user_id,
        storeId: scope?.store_id,
        organizationId: scope?.organization_id,
        action,
        resource: PROFILE_AUDIT_RESOURCE,
        resourceId: profile_id,
        oldValues: old_values ?? undefined,
        newValues: new_values ?? undefined,
        metadata,
      });
    } catch (error) {
      // `AuditService.log` YA atrapa su propio error, así que este catch parece
      // redundante. No lo es: esa garantía es prestada. Vive en un servicio
      // compartido de `common/`, y el día que alguien la quite —para hacer la
      // auditoría obligatoria en otro dominio, por ejemplo— este módulo
      // empezaría a devolver 500 sobre operaciones YA COMMITEADAS, que es el
      // peor error posible: el usuario reintenta algo que sí se guardó.
      //
      // La garantía tiene que ser local para ser verificable, y el spec la
      // verifica acá.
      this.logger.warn(
        `No se pudo auditar ${action} del perfil ${profile_id}: ${(error as Error)?.message}`,
      );
    }
  }

  /**
   * Reduce dos estados a las claves que difieren. Devuelve `null` si nada
   * cambió, y quien lo llama omite la fila de auditoría: registrar un PATCH que
   * no cambió nada llena la auditoría de ruido y esconde los cambios reales.
   */
  /**
   * Proyecta un perfil sobre las columnas auditadas. Proyectar en vez de pasar
   * la fila entera es lo que impide que un `select` más ancho meta el `config`
   * —o cualquier columna futura— en `audit_logs` sin que nadie lo decida.
   */
  private auditSnapshot(profile: Record<string, unknown>): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {};
    for (const key of AUDITED_COLUMNS) snapshot[key] = profile[key];
    return snapshot;
  }

  private static diffColumns(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): { old_values: Record<string, unknown>; new_values: Record<string, unknown> } | null {
    const old_values: Record<string, unknown> = {};
    const new_values: Record<string, unknown> = {};

    for (const key of AUDITED_COLUMNS) {
      if (before[key] === after[key]) continue;
      old_values[key] = before[key];
      new_values[key] = after[key];
    }

    return Object.keys(new_values).length === 0 ? null : { old_values, new_values };
  }

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
  /**
   * `runScopedTransaction` + traducción de la violación de único.
   *
   * Los tres caminos que escriben un `name` —crear, editar, clonar— pueden
   * chocar con el índice `invoice_profiles_unique_name_per_store`, y los tres
   * deben responder el MISMO 409. Envolver el `try/catch` acá evita que el
   * tercero que se agregue lo olvide y devuelva un 500 por el mismo hecho.
   */
  private async runScopedTransactionTranslating<T>(
    conflict: {
      name?: string;
      operation_type: string;
      profile_id: number | null;
      exclude_id?: number;
    },
    work: (tx: any, scope: ProfileScope) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.runScopedTransaction(work);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw await this.uniqueConflict(
          conflict.name,
          conflict.operation_type,
          conflict.profile_id,
          conflict.exclude_id,
        );
      }
      throw error;
    }
  }

  private async runScopedTransaction<T>(
    work: (tx: any, scope: ProfileScope) => Promise<T>,
  ): Promise<T> {
    const scope = this.getScope();
    const result = (await this.prisma
      .withoutScope()
      .$transaction((tx: any) => work(tx, scope))) as T;

    // INVALIDACIÓN DE LA CACHÉ DEL CATÁLOGO, en un solo sitio.
    //
    // Toda escritura de este servicio pasa por acá —crear, editar, clonar,
    // borrar, predeterminar, activar y desactivar—, así que invalidar en este
    // punto cubre las siete sin depender de que nadie lo olvide en la octava.
    // Siete llamadas dispersas serían siete oportunidades de omitirla, y la
    // omisión no se nota: el catálogo simplemente sirve un perfil retirado
    // durante lo que dure el TTL, y el wizard lo ofrece para facturar.
    //
    // Después del commit y no antes: invalidar primero deja una ventana en la
    // que un lector repuebla la caché con el estado viejo y la deja rancia
    // durante todo el TTL. Si la transacción falla, no se invalida nada, que es
    // correcto: nada cambió.
    //
    // Coste de invalidar de más, si algún día se usa esta envoltura para algo
    // que no toque perfiles: un fallo de caché. Coste de invalidar de menos:
    // emitir con una configuración retirada.
    await this.catalog_cache.invalidate(scope.store_id);
    return result;
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
  /**
   * Catálogo de perfiles activos para el selector del wizard.
   *
   * Sin paginar (ADR-9): el selector muestra siempre TODO el catálogo activo, y
   * un catálogo paginado obligaría al wizard a decidir qué media lista mostrar.
   * Lo que acota el tamaño es que son perfiles de configuración fiscal de una
   * tienda, no datos transaccionales.
   *
   * Va por caché porque se lee en cada apertura del wizard. Nunca guarda el
   * `config`: ver el docblock de `ProfileCatalogCacheService`.
   */
  async catalog() {
    const scope = this.getScope();

    const cached = await this.catalog_cache.read(scope.store_id);
    if (cached) return cached;

    const entries = await this.prisma.invoice_profiles.findMany({
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

    await this.catalog_cache.write(scope.store_id, entries);
    return entries;
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

    // COMPUERTA F.13: los códigos PUC del snapshot deben existir y aceptar
    // asientos contra el PUC que gobierna el perfil (`organizations.fiscal_scope`
    // decide cuál). Corre ANTES de la transacción y fuera de ella: es una
    // comprobación de existencia contra `chart_of_accounts`, no escribe nada, y
    // fallar temprano deja la base intacta. Ver `ProfileAccountingValidator`.
    const scope = this.getScope();
    await this.accounts.assertAccountsUsable(config, {
      organization_id: scope.organization_id,
      store_id: scope.store_id,
      operation_type: dto.operation_type,
    });

    // Comprobación previa: NO es la garantía, es el mensaje. Entre esta lectura
    // y el INSERT cabe otro `create` con el mismo nombre, y en esa carrera gana
    // el índice único. Existe para que el caso normal —el usuario escribe un
    // nombre que ya usó— reciba el 409 con el id del perfil existente sin tener
    // que provocar un error de base.
    const taken = await this.findByName(dto.name);
    if (taken) throw this.nameTaken(taken, dto.name);

    try {
      const created = await this.createInTransaction(dto, config);
      await this.writeAudit('CREATE', created.id, null, this.auditSnapshot(created), {
        version_to: created.current_version,
      });
      return created;
    } catch (error) {
      // Dos índices únicos pueden fallar acá: el de nombre por tienda y el
      // parcial de predeterminados. Cuál de los dos fue no se deduce del error
      // —ver `uniqueConflict`— sino preguntando a la base.
      if (this.isUniqueViolation(error)) {
        throw await this.uniqueConflict(dto.name, dto.operation_type, null);
      }
      throw error;
    }
  }

  private createInTransaction(
    dto: CreateInvoiceProfileDto,
    config: InvoiceProfileConfig,
  ) {
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
    // El `select` trae las columnas auditadas además de las que la lógica usa:
    // el diff de la auditoría se calcula contra ESTA lectura, y pedirlas después
    // dejaría fuera lo que la propia escritura acaba de cambiar.
    const current = await this.prisma.invoice_profiles.findFirst({
      where: { id },
      select: PROFILE_SELECT,
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

    // COMPUERTA F.13, sólo cuando ESTA escritura persiste una versión nueva:
    // los perfiles con códigos inválidos ya guardados NO se tocan (quedan
    // marcados por la consulta de DB-07 y se corrigen por edición normal), así
    // que un PATCH que sólo renombra o cambia el tipo no corre la compuerta —
    // exigírsela bloquearía para siempre la edición de las filas legadas.
    // Se valida contra la tienda del PROPIO perfil (`current`), que el cliente
    // scopeado garantiza igual a la del contexto.
    if (config) {
      await this.accounts.assertAccountsUsable(config, {
        organization_id: current.organization_id,
        store_id: current.store_id,
        operation_type,
        profile_id: id,
      });
    }

    // Renombrar hacia un nombre tomado viola el mismo índice que crear. El
    // `exclude_id` es el propio perfil: reenviar su nombre sin cambiarlo no es
    // un conflicto consigo mismo.
    if (dto.name !== undefined) {
      const taken = await this.findByName(dto.name, id);
      if (taken) throw this.nameTaken(taken, dto.name);
    }

    const result = await this.runScopedTransactionTranslating(
      { name: dto.name, operation_type, profile_id: id, exclude_id: id },
      async (tx, scope) => {
      await this.assertOwned(tx, scope, id);
      const updated = await tx.invoice_profiles.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.operation_type !== undefined && {
            operation_type: dto.operation_type,
          }),
          // `state` NO se toca acá: tiene sus propias rutas (`activate` /
          // `deactivate`). Aceptarlo también aquí crearía dos caminos para el
          // mismo hecho, y sólo uno de los dos invalidaría la caché del
          // catálogo (C.5) y escribiría la auditoría (C.7). Es el patrón de
          // «dos implementaciones paralelas» que este plan existe para evitar.
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
      },
    );

    const diff = ProfilesService.diffColumns(
      this.auditSnapshot(current),
      this.auditSnapshot(result),
    );
    if (diff) {
      await this.writeAudit('UPDATE', id, diff.old_values, diff.new_values, {
        version_from: current.current_version,
        version_to: result.current_version,
        // Una edición que sólo movió el puntero de versión cambió la
        // CONFIGURACIÓN, y el diff de columnas no lo dice: esta bandera es la
        // que le dice al lector que tiene que ir a comparar las dos versiones.
        config_changed: result.current_version !== current.current_version,
      });
    }
    return result;
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

    // COMPUERTA F.13 también al clonar: el clon persiste una versión NUEVA con
    // los códigos del origen, así que corre la MISMA compuerta y falla con el
    // MISMO código — un clon de un perfil inválido no nace roto ni se salva por
    // ser clon. La tienda es la del CONTEXTO, que es donde nace el clon (y el
    // cliente scopeado garantiza que el origen vive en ella).
    const scope = this.getScope();
    await this.accounts.assertAccountsUsable(validated, {
      organization_id: scope.organization_id,
      store_id: scope.store_id,
      operation_type: source.operation_type,
    });

    // Clonar hacia un nombre tomado viola el mismo índice. Es el caso más
    // probable de los tres: el nombre por omisión de un clon suele derivarse del
    // original, y clonar dos veces propone el mismo.
    const taken = await this.findByName(dto.name);
    if (taken) throw this.nameTaken(taken, dto.name);

    const clone = await this.runScopedTransactionTranslating(
      { name: dto.name, operation_type: source.operation_type, profile_id: null },
      async (tx, scope) => {
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
      },
    );

    // `CLONE` y no `CREATE`: el clon nace con una configuración que ya existía
    // en otro perfil, y quien audite necesita poder distinguir «alguien
    // configuró esto» de «alguien copió una configuración vigente».
    await this.writeAudit('CLONE', clone.id, null, this.auditSnapshot(clone), {
      source_profile_id: source.id,
      source_version,
      version_to: 1,
    });
    return clone;
  }

  // ─── Predeterminado y estado ────────────────────────────────────────────

  /**
   * Marca el perfil como predeterminado de su tipo de operación (ADR-9).
   *
   * ## Por qué es una ruta propia y no un campo del `PATCH`
   *
   * `PermissionsGuard` autoriza por `(path, method)` además de por nombre, así
   * que dos operaciones que deban autorizarse distinto **no pueden compartir
   * ruta y verbo**. El permiso `invoicing:profiles:set_default` está sembrado
   * con `POST /api/store/invoicing/profiles/:id/set-default` justamente para
   * que un rol pueda editar perfiles sin poder decidir cuál factura por
   * omisión — que es la decisión con consecuencia fiscal, no la edición.
   *
   * ## Por qué se exige que esté activo
   *
   * Un predeterminado inactivo es un puntero a algo que el catálogo no muestra:
   * el wizard pediría el predeterminado, lo encontraría fuera de la lista de
   * elegibles y tendría que decidir sin criterio. Se rechaza con 409 en vez de
   * activar de rebote, porque activar mete el perfil al catálogo de facturación
   * y eso no es un efecto colateral aceptable de un clic en «Predeterminar».
   *
   * ## La carrera
   *
   * Una transacción no basta, y el índice único tampoco. Dos peticiones
   * simultáneas sobre perfiles distintos del mismo tipo pueden **serializarse
   * sin colisionar**: la segunda desmarca lo que la primera acaba de marcar y
   * marca lo suyo. El invariante de base queda intacto —un solo
   * predeterminado— y las dos peticiones responden 200. Medido en vivo: 1 de 3
   * rondas concurrentes devolvió `200` a un cliente cuyo perfil no quedó
   * predeterminado.
   *
   * Lo que cierra el hueco es concurrencia optimista sobre el predeterminado
   * vigente: se lee antes de la transacción y se vuelve a leer dentro; si no
   * coinciden, otro ganó y esta petición recibe 409. La rama simétrica —el rival
   * commitea después de esa comprobación— la ataja el índice único parcial, cuyo
   * `P2002` se traduce al MISMO 409.
   *
   * Reintentar en el servidor sería peor que fallar: el usuario pidió que
   * ganara SU perfil, y un reintento decidiría por él según quién llegó último.
   */
  async setDefault(id: number) {
    const profile = await this.prisma.invoice_profiles.findFirst({
      where: { id },
      select: { id: true, operation_type: true, state: true, is_default: true },
    });
    if (!profile) throw profileNotFound(id);

    if (profile.state !== 'active') {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_PROFILE_007,
        'Un perfil inactivo no puede ser el predeterminado. Actívalo primero.',
        { profile_id: id, state: profile.state },
      );
    }

    // Ya lo es: no se abre transacción ni se reescribe `updated_at`. La
    // operación es idempotente y repetirla no es un error del cliente.
    if (profile.is_default) return this.findOne(id);

    // El predeterminado VIGENTE hace de número de versión de esta operación.
    // Se lee fuera de la transacción y se vuelve a leer dentro: si cambió
    // entremedio, alguien más ganó la carrera y esta petición se rechaza.
    const previous = await this.prisma.invoice_profiles.findFirst({
      where: { operation_type: profile.operation_type, is_default: true },
      select: { id: true },
    });
    const expected = previous?.id ?? null;

    try {
      const promoted = await this.runScopedTransaction(async (tx, scope) => {
        await this.assertOwned(tx, scope, id);

        const inside = await tx.invoice_profiles.findFirst({
          where: {
            store_id: scope.store_id,
            operation_type: profile.operation_type,
            is_default: true,
          },
          select: { id: true },
        });

        // ESTA comparación es lo que hace detectable la carrera. La versión
        // anterior desmarcaba «el predeterminado que hubiera» y marcaba el suyo;
        // con eso, dos peticiones simultáneas se aplicaban en secuencia, la
        // segunda desmarcaba a la primera, y **las dos respondían 200**. El
        // cliente que perdió recibía éxito sobre un estado que ya no existía
        // (medido: 1 de 3 rondas concurrentes). Comparar contra lo leído antes
        // convierte ese caso en el 409 que el plan exige.
        if ((inside?.id ?? null) !== expected) {
          throw this.defaultRaceLost(id, profile.operation_type);
        }

        if (inside) {
          await tx.invoice_profiles.update({
            where: { id: inside.id },
            data: { is_default: false, updated_at: new Date() },
          });
        }

        const updated = await tx.invoice_profiles.update({
          where: { id },
          data: { is_default: true, updated_at: new Date() },
          select: PROFILE_SELECT,
        });

        // Se devuelve lo que ESTA transacción escribió, no un `findOne`
        // posterior: entre el commit y una relectura cabe otro traspaso, y la
        // respuesta afirmaría un estado que el servidor ya no sostiene.
        return this.attachCurrentConfig(tx, updated);
      });

      // Una sola fila para toda la operación, con el perfil que perdió la marca
      // en `metadata`. Escribir dos —una por cada perfil— haría que un traspaso
      // se leyera como dos decisiones independientes, y la decisión fue una.
      await this.writeAudit(
        'SET_DEFAULT',
        id,
        { is_default: false },
        { is_default: true },
        { operation_type: profile.operation_type, unset_profile_id: expected },
      );
      return promoted;
    } catch (error) {
      // La otra rama de la misma carrera: si el rival commitea después de la
      // comprobación de arriba, quien choca es el índice único parcial.
      if (this.isUniqueViolation(error)) {
        throw this.defaultRaceLost(id, profile.operation_type);
      }
      throw error;
    }
  }

  /**
   * Activa el perfil. **No lo predetermina**: activar y predeterminar son dos
   * decisiones, y encadenarlas metería al wizard un perfil que nadie eligió.
   *
   * Idempotente: activar uno ya activo devuelve el perfil sin escribir.
   */
  async activate(id: number) {
    return this.setState(id, 'active');
  }

  /**
   * Desactiva el perfil y, si era el predeterminado, **le quita también la
   * marca**.
   *
   * Las dos cosas van juntas por necesidad, no por comodidad: `/catalog` sólo
   * sirve activos, así que un predeterminado inactivo sería un puntero a algo
   * que el wizard no puede ofrecer. El tipo de operación queda sin
   * predeterminado —estado legítimo, ADR-9— y el wizard lo tolera pidiendo al
   * usuario que elija.
   */
  async deactivate(id: number) {
    return this.setState(id, 'inactive');
  }

  /**
   * Cambia el estado dentro de una transacción con el ancla comprobada.
   *
   * Se lee primero por el cliente scopeado para que un id ajeno no llegue nunca
   * al cliente base, y se vuelve a comprobar dentro con `assertOwned`.
   */
  private async setState(id: number, state: 'active' | 'inactive') {
    const profile = await this.prisma.invoice_profiles.findFirst({
      where: { id },
      select: { id: true, state: true, is_default: true },
    });
    if (!profile) throw profileNotFound(id);

    // Ya está en ese estado: es idempotente y NO se audita. Registrar un clic
    // que no cambió nada llena la auditoría de ruido y esconde los cambios.
    if (profile.state === state) return this.findOne(id);

    await this.runScopedTransaction(async (tx, scope) => {
      await this.assertOwned(tx, scope, id);
      await tx.invoice_profiles.update({
        where: { id },
        data: {
          state,
          // Desactivar arrastra la marca de predeterminado; activar nunca la
          // pone. La asimetría es deliberada: quitarla evita un puntero a un
          // perfil invisible, ponerla decidiría por el usuario.
          ...(state === 'inactive' && profile.is_default && { is_default: false }),
          updated_at: new Date(),
        },
      });
    });

    // El arrastre del predeterminado forma parte del hecho auditado: sin él, el
    // perfil aparecería como no predeterminado en una consulta posterior y nada
    // diría cuándo dejó de serlo.
    const drops_default = state === 'inactive' && profile.is_default;
    await this.writeAudit(
      state === 'active' ? 'ACTIVATE' : 'DEACTIVATE',
      id,
      { state: profile.state, ...(drops_default && { is_default: true }) },
      { state, ...(drops_default && { is_default: false }) },
      drops_default ? { default_dropped: true } : undefined,
    );

    return this.findOne(id);
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
    // El `select` completo es para la auditoría: después del DELETE no hay nada
    // que leer, así que el estado del perfil se captura ANTES o se pierde.
    const profile = await this.prisma.invoice_profiles.findFirst({
      where: { id },
      select: PROFILE_SELECT,
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

        // La procedencia de los clones se anula A MANO, y como PAREJA.
        //
        // La FK `cloned_from_profile_id` es ON DELETE SET NULL, así que parecía
        // resuelto: borrar el origen anularía la referencia del clon. No lo
        // estaba. Postgres anula la columna de la FK y **sólo** esa, dejando
        // `cloned_from_version` con su valor — y el CHECK
        // `invoice_profiles_clone_pair_complete` exige que las dos sean NULL o
        // ninguna. Resultado medido: borrar un perfil del que alguien había
        // clonado devolvía 500 `SYS_INTERNAL_001` (un `DriverAdapterError` de
        // CHECK no trae código Prisma, así que no había nada que traducir) y la
        // operación era imposible de completar.
        //
        // Las dos columnas son un solo hecho —«vengo de la versión N del perfil
        // X»— y se anulan juntas. El CHECK se queda tal cual: es correcto, y es
        // lo que delató el problema.
        await tx.invoice_profiles.updateMany({
          // `store_id` explícito: dentro de la transacción no hay scope, y sin
          // él esto anularía la procedencia de clones de otros tenants.
          where: { store_id: scope.store_id, cloned_from_profile_id: id },
          data: {
            cloned_from_profile_id: null,
            cloned_from_version: null,
            updated_at: new Date(),
          },
        });

        // Lo anterior sólo alcanza a los clones de ESTA tienda, que son los
        // únicos que la API puede crear. Si quedara alguno fuera del ámbito, el
        // DELETE volvería a chocar contra el CHECK y saldría como 500: se
        // comprueba y se responde 409 en su lugar. No debería ocurrir nunca por
        // la API; ocurre si alguien insertó la referencia por SQL.
        const foreign_clones = await tx.invoice_profiles.count({
          where: { cloned_from_profile_id: id, store_id: { not: scope.store_id } },
        });
        if (foreign_clones > 0) throw this.deleteBlockedByClones(id, foreign_clones);

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

    await this.writeAudit('DELETE', id, this.auditSnapshot(profile), null, {
      versions_deleted: profile.current_version,
    });

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

  /**
   * 409 de carrera perdida. Un solo constructor porque las dos ramas —la
   * comprobación optimista y el choque del índice único— son el MISMO hecho
   * para el usuario, y responder distinto según cuál se disparó primero
   * expondría el mecanismo sin decirle nada útil.
   */
  private defaultRaceLost(profile_id: number | null, operation_type: string) {
    return new VendixHttpException(
      ErrorCodes.INVOICING_PROFILE_002,
      `Otro perfil quedó como predeterminado para operaciones ${operation_type} al mismo tiempo. Refresca y vuelve a intentarlo.`,
      { profile_id, operation_type },
    );
  }

  /**
   * 409 por clones fuera del ámbito de la tienda.
   *
   * Comparte código con el borrado bloqueado por facturas —`INVOICING_PROFILE_003`
   * es «este perfil no puede borrarse porque algo lo referencia»— pero el
   * mensaje nombra la causa real, porque la salida del usuario es distinta: ante
   * facturas timbradas se desactiva; ante esto hay que llamar a soporte.
   */
  private deleteBlockedByClones(profile_id: number, clone_count: number) {
    return new VendixHttpException(
      ErrorCodes.INVOICING_PROFILE_003,
      `Este perfil es el origen de ${clone_count} perfil(es) de otra tienda y no puede eliminarse desde acá.`,
      { profile_id, foreign_clone_count: clone_count },
    );
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

  /**
   * Busca un perfil de ESTA tienda cuyo nombre coincida sin distinguir
   * mayúsculas, que es el criterio del índice.
   *
   * ## Por qué se comparan los nombres en memoria
   *
   * Lo natural sería `name: { equals, mode: 'insensitive' }`. No se usa: Prisma
   * traduce ese modo a `ILIKE`, e `ILIKE` interpreta `%` y `_` como comodines.
   * Un perfil llamado `"AIU%"` daría por tomado cualquier nombre que empiece por
   * `AIU` y el usuario recibiría un 409 sobre un conflicto que no existe.
   *
   * Un `$queryRaw` con `lower(name) = lower($1)` sería exacto pero sale del
   * cliente scopeado y habría que reponer el `store_id` a mano —el filtro de
   * tenant es justo lo que no conviene escribir a mano dos veces—. Traer los
   * perfiles de la tienda y comparar acá es exacto, mantiene el scope, y la
   * cardinalidad lo permite: son perfiles de facturación de UNA tienda, del
   * orden de decenas.
   */
  private async findByName(name: string | undefined, exclude_id?: number) {
    if (name === undefined) return null;
    const target = normalizeName(name).toLowerCase();

    const rows = await this.prisma.invoice_profiles.findMany({
      where: exclude_id === undefined ? {} : { id: { not: exclude_id } },
      select: { id: true, name: true },
    });

    return rows.find((row) => row.name.toLowerCase() === target) ?? null;
  }

  /**
   * Decide QUÉ único se violó preguntando a la base, no leyendo el error.
   *
   * `error.meta.target` identifica la restricción en el caso simple, pero el de
   * nombre es un índice sobre una EXPRESIÓN (`lower(name)`) que no existe en el
   * esquema de Prisma: qué reporta ahí no está garantizado entre versiones del
   * cliente. Una traducción que dependa del formato del mensaje falla en
   * silencio el día que se sube de versión, y falla hacia el lado malo: el
   * usuario recibiría «otro perfil quedó como predeterminado» cuando lo que pasó
   * es que el nombre estaba tomado.
   *
   * Preguntar por el nombre es determinista: si existe, fue el índice de nombre;
   * si no, sólo queda el parcial de predeterminados.
   */
  private async uniqueConflict(
    name: string | undefined,
    operation_type: string,
    profile_id: number | null,
    exclude_id?: number,
  ): Promise<VendixHttpException> {
    const existing = await this.findByName(name, exclude_id);
    if (existing && name !== undefined) return this.nameTaken(existing, name);
    return this.defaultRaceLost(profile_id, operation_type);
  }

  /**
   * 409 de nombre tomado — la forma que toma la idempotencia de la creación.
   *
   * `existing_profile_id` va en `details` a propósito: es lo que permite al
   * frontend separar el doble clic accidental (navega al perfil que sí se creó)
   * del choque real de nombres (pide otro). Sin ese id, las dos situaciones
   * llegan indistinguibles y la única salida es mostrar un error rojo también a
   * quien no hizo nada mal.
   */
  private nameTaken(existing: { id: number; name: string }, attempted: string) {
    // El mensaje nombra el perfil EXISTENTE, no lo que el usuario escribió. La
    // primera versión mostraba lo escrito y en el caso que importa —chocar por
    // la caja— decía «Ya existe un perfil llamado "idempotencia SONDA"» cuando
    // en la lista se lee «Idempotencia Sonda»: el usuario iba a buscar una
    // cadena que no está en pantalla. `attempted` viaja en `details` para que
    // quien depure vea las dos.
    return new VendixHttpException(
      ErrorCodes.INVOICING_PROFILE_004,
      `Ya existe un perfil llamado «${existing.name}» en esta tienda.`,
      {
        name: existing.name,
        attempted_name: normalizeName(attempted),
        existing_profile_id: existing.id,
      },
    );
  }

  /**
   * `P2002` es la violación de restricción única de Prisma. En esta tabla hay
   * DOS únicos que una escritura del servicio puede violar —el parcial de
   * predeterminados y el de nombre por tienda—, así que este predicado dice
   * «chocó con un único», no cuál. Quien lo captura debe pasar por
   * `uniqueConflict` para averiguarlo.
   */
  private isUniqueViolation(error: unknown): boolean {
    return (error as { code?: string })?.code === 'P2002';
  }
}
