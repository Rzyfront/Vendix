import { Injectable, Logger } from '@nestjs/common';

import { ErrorCodes, VendixHttpException } from '@common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';

import { CloneQuotationProfileDto } from './dto/clone-quotation-profile.dto';
import { CreateQuotationProfileDto } from './dto/create-quotation-profile.dto';
import { normalizeQuotationName } from './dto/quotation-profile-name';
import { QueryQuotationProfilesDto } from './dto/query-quotation-profiles.dto';
import { UpdateQuotationProfileDto } from './dto/update-quotation-profile.dto';
import {
  QuotationProfileConfig,
  normalizeAndAssertQuotationProfileConfig,
} from './quotation-profile-config';
import {
  quotationProfileInvalidForStore,
  quotationProfileNotFound,
} from './quotation-profile-errors';

/**
 * Ámbito del tenant, resuelto una vez por operación.
 *
 * Se pasa explícitamente a todo lo que corre DENTRO de una transacción,
 * porque el cliente que entrega `$transaction` es el BASE: no lleva la
 * extensión de scoping y no inyecta `store_id` en nada.
 */
interface QuotationProfileScope {
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
  state: true,
  is_default: true,
  current_version: true,
  cloned_from_profile_id: true,
  cloned_from_version: true,
  created_by: true,
  created_at: true,
  updated_at: true,
} as const;

/**
 * B.1 — Perfiles de cotización opcionales por store (DB-02, DB-03, FB-03,
 * FB-04, ERR-04; ADR-03).
 *
 * Espejo simplificado de `ProfilesService` (facturación): misma disciplina
 * de tenant (scope una vez, ancla explícita dentro de la transacción),
 * versiones append-only (`update` inserta y mueve el puntero, jamás
 * reescribe), nombre único por store con 409 y un solo `is_default` por
 * store. Sin rail de organización, sin tipos DIAN, sin compuerta contable:
 * el `config` acá congela con qué números se citó (A/I/U, vigencia,
 * términos), que C.1 copia al contrato y D.1 a la factura AIU.
 */
@Injectable()
export class QuotationProfilesService {
  private readonly logger = new Logger(QuotationProfilesService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  // ─── Contexto ───────────────────────────────────────────────────────────

  /**
   * El perfil es store-scoped por columna propia y NO nullable: sin
   * `store_id` no hay perfil que crear ni listar. Se responde 400 con
   * `STORE_CONTEXT_001` —el que ya usan contabilidad, retenciones y los
   * perfiles de factura— y no un `Error` pelado, que el filtro global
   * degradaría a 500 sobre una petición que simplemente llegó sin tienda.
   */
  private getScope(): QuotationProfileScope {
    const context = RequestContextService.getContext();
    if (!context?.organization_id || !context?.store_id) {
      throw new VendixHttpException(
        ErrorCodes.STORE_CONTEXT_001,
        'Selecciona una tienda antes de trabajar con perfiles de cotización.',
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
   * scoping y `store_id` no se inyecta en ninguna parte. Todo `where` de
   * dentro lo lleva a mano, y por eso el ámbito viaja como argumento.
   */
  private async runScopedTransaction<T>(
    work: (tx: any, scope: QuotationProfileScope) => Promise<T>,
  ): Promise<T> {
    const scope = this.getScope();
    return (await this.prisma
      .withoutScope()
      .$transaction((tx: any) => work(tx, scope))) as T;
  }

  /**
   * `runScopedTransaction` + traducción de la violación de único.
   *
   * Los tres caminos que escriben un `name` —crear, editar, clonar— pueden
   * chocar con el índice `quotation_profiles_unique_name_per_store`, y los
   * tres deben responder el MISMO 409. Envolver el `try/catch` acá evita que
   * el tercero que se agregue lo olvide y devuelva un 500 por el mismo hecho.
   */
  private async runScopedTransactionTranslating<T>(
    conflict: {
      name?: string;
      profile_id: number | null;
      exclude_id?: number;
    },
    work: (tx: any, scope: QuotationProfileScope) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.runScopedTransaction(work);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw await this.uniqueConflict(
          conflict.name,
          conflict.profile_id,
          conflict.exclude_id,
        );
      }
      throw error;
    }
  }

  // ─── Lectura ────────────────────────────────────────────────────────────

  async findAll(query: QueryQuotationProfilesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Record<string, unknown> = {};
    if (query.state) where.state = query.state;
    if (query.search?.trim()) {
      where.name = { contains: query.search.trim(), mode: 'insensitive' };
    }

    // Cliente SCOPEADO: `store_id` lo inyecta la extensión. No se escribe a
    // mano acá a propósito — `mergeScopedWhere` deja el valor del llamador
    // arriba y empuja el del scope al `AND`, así que un `store_id` propio
    // produciría un predicado imposible y el listado devolvería cero filas
    // sin explicación.
    const [data, total] = await Promise.all([
      this.prisma.quotation_profiles.findMany({
        where,
        select: PROFILE_SELECT,
        orderBy: [{ is_default: 'desc' }, { updated_at: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.quotation_profiles.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * `findFirst` y no `findUnique`: la extensión de scoping añade `store_id`
   * al `where`, y `findUnique` sólo admite campos del único — un `where` con
   * `store_id` lo hace fallar.
   */
  async findOne(id: number) {
    const profile = await this.prisma.quotation_profiles.findFirst({
      where: { id },
      select: PROFILE_SELECT,
    });
    if (!profile) throw quotationProfileNotFound(id);

    const version = await this.prisma.quotation_profile_versions.findFirst({
      where: { profile_id: id, version: profile.current_version },
      select: {
        id: true,
        version: true,
        config: true,
        created_at: true,
        created_by: true,
      },
    });

    // `current_version = 0` significa «sin versión comprometida»: el default
    // de la columna es 0 y no 1 justo para que una transacción interrumpida
    // sea DETECTABLE en vez de parecer una versión que nadie escribió.
    if (!version && profile.current_version > 0) {
      this.logger.error(
        `quotation_profiles.id=${id} apunta a la versión ${profile.current_version}, que no existe`,
      );
    }

    return { ...profile, current_config: version?.config ?? null, version };
  }

  /** Historial completo de versiones de un perfil (append-only por diseño). */
  async findVersions(id: number, page = 1, limit = 20) {
    const profile = await this.prisma.quotation_profiles.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!profile) throw quotationProfileNotFound(id);

    const [data, total] = await Promise.all([
      this.prisma.quotation_profile_versions.findMany({
        where: { profile_id: id },
        select: {
          id: true,
          version: true,
          config: true,
          created_at: true,
          created_by: true,
        },
        orderBy: { version: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.quotation_profile_versions.count({
        where: { profile_id: id },
      }),
    ]);

    return { data, total, page, limit };
  }

  async findVersion(id: number, version: number) {
    const profile = await this.prisma.quotation_profiles.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!profile) throw quotationProfileNotFound(id);

    const row = await this.prisma.quotation_profile_versions.findFirst({
      where: { profile_id: id, version },
      select: {
        id: true,
        version: true,
        config: true,
        created_at: true,
        created_by: true,
      },
    });
    if (!row) {
      throw new VendixHttpException(
        ErrorCodes.QPROFILE_VERSION_001,
        `La versión ${version} de este perfil no existe.`,
        { profile_id: id, version },
      );
    }
    return row;
  }

  /**
   * Catálogo para el selector de perfil (FB-03): solo los perfiles ACTIVOS.
   *
   * Devuelve el catálogo completo y no solo el predeterminado: el selector
   * muestra todo lo activo y preselecciona el predeterminado. Sin paginación
   * a propósito — un selector paginado no es un selector, y los perfiles de
   * una tienda son del orden de las decenas.
   */
  async catalog() {
    this.getScope();
    return this.prisma.quotation_profiles.findMany({
      where: { state: 'active' },
      select: {
        id: true,
        name: true,
        is_default: true,
        current_version: true,
      },
      orderBy: [{ is_default: 'desc' }, { name: 'asc' }],
    });
  }

  /**
   * Resuelve un perfil para usarlo como REFERENCIA desde otra entidad de la
   * misma tienda (`quotations.profile_id` en C.1).
   *
   * ERR-04: si el perfil es de otra tienda se responde 400 con
   * `QPROFILE_STORE_001` («Perfil no válido para tu tienda») y NO 404: el
   * llamador ya sabe que la fila existe —lo que está mal es el tenant— y un
   * 404 lo mandaría a reintentar algo que nunca va a aparecer.
   */
  async resolveForQuotation(profile_id: number) {
    const scoped = await this.prisma.quotation_profiles.findFirst({
      where: { id: profile_id },
      select: PROFILE_SELECT,
    });
    if (scoped) return this.attachCurrentConfigScoped(scoped);

    // Distinguir «no existe» de «es de otra tienda» exige mirar sin scope.
    // Se hace con una sola lectura cruda y sin exponer nada de la fila
    // ajena: la respuesta es idéntica para cualquier perfil ajeno.
    const scope = this.getScope();
    const exists = await this.prisma
      .withoutScope()
      .quotation_profiles.findFirst({
        where: { id: profile_id },
        select: { id: true },
      });
    if (exists) throw quotationProfileInvalidForStore(profile_id);

    // Misma respuesta que `findOne`: el id inexistente no revela tenant.
    this.logger.warn(
      `resolveForQuotation: perfil ${profile_id} inexistente para store ${scope.store_id}`,
    );
    throw quotationProfileNotFound(profile_id);
  }

  // ─── Escritura ──────────────────────────────────────────────────────────

  /**
   * Crea el perfil y su versión 1 en la MISMA transacción.
   *
   * Si no fueran atómicas, un fallo entre las dos escrituras dejaría un
   * perfil con `current_version = 1` apuntando a una versión que no existe,
   * y toda lectura devolvería configuración nula.
   */
  async create(dto: CreateQuotationProfileDto) {
    const config = normalizeAndAssertQuotationProfileConfig(dto.config);
    this.getScope();

    // Comprobación previa: NO es la garantía, es el mensaje. Entre esta
    // lectura y el INSERT cabe otro `create` con el mismo nombre, y en esa
    // carrera gana el índice único.
    const taken = await this.findByName(dto.name);
    if (taken) throw this.nameTaken(taken, dto.name);

    try {
      return await this.runScopedTransaction(async (tx, scope) => {
        if (dto.is_default) {
          await this.clearDefault(tx, scope);
        }

        const profile = await tx.quotation_profiles.create({
          data: {
            organization_id: scope.organization_id,
            store_id: scope.store_id,
            name: dto.name,
            state: dto.state ?? 'active',
            is_default: dto.is_default ?? false,
            current_version: 0,
            created_by: scope.user_id ?? null,
          },
          select: PROFILE_SELECT,
        });

        return this.commitVersion(tx, scope, profile.id, config, 1);
      });
    } catch (error) {
      // Dos únicos pueden fallar acá: el de nombre por tienda y el parcial
      // de predeterminados. Cuál fue no se deduce del error sino preguntando
      // a la base (el de nombre es sobre una expresión y `meta.target` no es
      // fiable entre versiones del cliente).
      if (this.isUniqueViolation(error)) {
        throw await this.uniqueConflict(dto.name, null);
      }
      throw error;
    }
  }

  /**
   * Editar NO reescribe la versión vigente: escribe una nueva y mueve el
   * puntero, las dos en la misma transacción (ADR-03).
   *
   * Reescribirla cambiaría, retroactivamente, con qué números se citaron las
   * cotizaciones que la referencian — y con ellos lo que el contrato debe
   * congelar.
   */
  async update(id: number, dto: UpdateQuotationProfileDto) {
    // La lectura previa va por el cliente SCOPEADO: es lo que garantiza que
    // un id de otro tenant no llegue nunca a la transacción, donde ya no hay
    // scope.
    const current = await this.prisma.quotation_profiles.findFirst({
      where: { id },
      select: PROFILE_SELECT,
    });
    if (!current) throw quotationProfileNotFound(id);

    const config =
      dto.config === undefined
        ? null
        : normalizeAndAssertQuotationProfileConfig(dto.config, id);

    // Renombrar hacia un nombre tomado viola el mismo índice que crear. El
    // `exclude_id` es el propio perfil: reenviar su nombre sin cambiarlo no
    // es un conflicto consigo mismo.
    if (dto.name !== undefined) {
      const taken = await this.findByName(dto.name, id);
      if (taken) throw this.nameTaken(taken, dto.name);
    }

    return this.runScopedTransactionTranslating(
      { name: dto.name, profile_id: id, exclude_id: id },
      async (tx, scope) => {
        await this.assertOwned(tx, scope, id);
        const updated = await tx.quotation_profiles.update({
          where: { id },
          data: {
            ...(dto.name !== undefined && { name: dto.name }),
            // `state` e `is_default` NO se tocan acá: tienen sus propias
            // rutas. Aceptarlos también aquí crearía dos caminos para el
            // mismo hecho que divergen en cuanto uno crece.
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
  }

  /**
   * Clonar produce un perfil INDEPENDIENTE con su propia versión 1.
   *
   * Nunca hereda `is_default` (dos predeterminados los rechazaría el parcial,
   * y decidir cuál gana por orden de inserción sería arbitrario) y nace
   * **inactivo**: se clona para cambiar algo, y un clon activo entraría al
   * catálogo del selector sin que nadie lo revisara. Activarlo es un paso
   * aparte y deliberado.
   */
  async clone(id: number, dto: CloneQuotationProfileDto) {
    const source = await this.prisma.quotation_profiles.findFirst({
      where: { id },
      select: { id: true, current_version: true },
    });
    if (!source) throw quotationProfileNotFound(id);

    const source_version = dto.source_version ?? source.current_version;
    const raw = await this.readVersionConfig(id, source_version);

    // Se revalida lo clonado en vez de copiarlo a ciegas: si la versión de
    // origen se guardó con reglas anteriores, el clon no puede nacer con una
    // configuración que hoy sería inválida.
    const validated = normalizeAndAssertQuotationProfileConfig(raw);

    const taken = await this.findByName(dto.name);
    if (taken) throw this.nameTaken(taken, dto.name);

    return this.runScopedTransactionTranslating(
      { name: dto.name, profile_id: null },
      async (tx, scope) => {
        const profile = await tx.quotation_profiles.create({
          data: {
            organization_id: scope.organization_id,
            store_id: scope.store_id,
            name: dto.name,
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
  }

  /**
   * Marca el perfil como predeterminado de la tienda.
   *
   * Ruta propia y no campo del `PATCH` (misma razón que invoice): el
   * `PermissionsGuard` autoriza por `(path, method)` además de por nombre.
   * Se exige que esté activo: un predeterminado inactivo es un puntero a
   * algo que el catálogo no muestra, y activarlo de rebote metería al
   * selector un perfil que nadie revisó.
   */
  async setDefault(id: number) {
    const profile = await this.prisma.quotation_profiles.findFirst({
      where: { id },
      select: { id: true, state: true, is_default: true },
    });
    if (!profile) throw quotationProfileNotFound(id);

    if (profile.state !== 'active') {
      throw new VendixHttpException(
        ErrorCodes.QPROFILE_DEFAULT_001,
        'Un perfil inactivo no puede ser el predeterminado. Actívalo primero.',
        { profile_id: id, state: profile.state },
      );
    }

    // Ya lo es: idempotente, sin transacción ni reescritura de `updated_at`.
    if (profile.is_default) return this.findOne(id);

    // El predeterminado VIGENTE hace de número de versión de esta operación:
    // se lee fuera y se vuelve a leer dentro; si cambió entremedio, otro
    // ganó la carrera y esta petición se rechaza con 409. La rama simétrica
    // (el rival commitea después) la ataja el parcial, cuyo `P2002` se
    // traduce al MISMO 409.
    const previous = await this.prisma.quotation_profiles.findFirst({
      where: { is_default: true },
      select: { id: true },
    });
    const expected = previous?.id ?? null;

    try {
      return await this.runScopedTransaction(async (tx, scope) => {
        await this.assertOwned(tx, scope, id);

        const inside = await tx.quotation_profiles.findFirst({
          where: { store_id: scope.store_id, is_default: true },
          select: { id: true },
        });
        if ((inside?.id ?? null) !== expected) {
          throw this.defaultRaceLost(id);
        }

        if (inside) {
          await tx.quotation_profiles.update({
            where: { id: inside.id },
            data: { is_default: false, updated_at: new Date() },
          });
        }

        const updated = await tx.quotation_profiles.update({
          where: { id },
          data: { is_default: true, updated_at: new Date() },
          select: PROFILE_SELECT,
        });

        // Se devuelve lo que ESTA transacción escribió, no un `findOne`
        // posterior: entremedio cabe otro traspaso y la respuesta afirmaría
        // un estado que el servidor ya no sostiene.
        return this.attachCurrentConfig(tx, updated);
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw this.defaultRaceLost(id);
      }
      throw error;
    }
  }

  /**
   * Activa el perfil. **No lo predetermina**: activar y predeterminar son dos
   * decisiones, y encadenarlas metería al selector un perfil que nadie
   * eligió. Idempotente.
   */
  async activate(id: number) {
    return this.setState(id, 'active');
  }

  /**
   * Desactiva el perfil y, si era el predeterminado, **le quita también la
   * marca**: `/catalog` solo sirve activos, así que un predeterminado
   * inactivo sería un puntero a algo que el selector no puede ofrecer. La
   * tienda queda sin predeterminado —estado legítimo— y el selector pide
   * elegir.
   */
  async deactivate(id: number) {
    return this.setState(id, 'inactive');
  }

  /**
   * Cambia el estado dentro de una transacción con el ancla comprobada. Se
   * lee primero por el cliente scopeado para que un id ajeno no llegue nunca
   * al cliente base, y se vuelve a comprobar dentro con `assertOwned`.
   */
  private async setState(id: number, state: 'active' | 'inactive') {
    const profile = await this.prisma.quotation_profiles.findFirst({
      where: { id },
      select: { id: true, state: true, is_default: true },
    });
    if (!profile) throw quotationProfileNotFound(id);

    // Ya está en ese estado: idempotente, sin escribir.
    if (profile.state === state) return this.findOne(id);

    await this.runScopedTransaction(async (tx, scope) => {
      await this.assertOwned(tx, scope, id);
      await tx.quotation_profiles.update({
        where: { id },
        data: {
          state,
          // Desactivar arrastra la marca de predeterminado; activar nunca la
          // pone. La asimetría es deliberada: quitarla evita un puntero a un
          // perfil invisible, ponerla decidiría por el usuario.
          ...(state === 'inactive' &&
            profile.is_default && { is_default: false }),
          updated_at: new Date(),
        },
      });
    });

    return this.findOne(id);
  }

  /**
   * Borra el perfil y su historial — solo si NINGUNA cotización lo
   * referencia.
   *
   * Se borra de verdad, no se marca: el historial existe para hacer
   * REPRODUCIBLE con qué números se citó; si ninguna cotización apunta a
   * este perfil, no hay nada que reproducir. En cuanto una lo referencia, el
   * borrado deja de ser posible —acá y en la base— y la alternativa es
   * desactivarlo.
   *
   * La comprobación previa no es la garantía, es el mensaje: la garantía es
   * la FK `ON DELETE RESTRICT`. Entre el conteo y el borrado cabe una
   * cotización nueva, y en esa carrera gana la base — por eso el error de FK
   * se traduce al MISMO 409 en vez de escapar como 500.
   */
  async remove(id: number) {
    const profile = await this.prisma.quotation_profiles.findFirst({
      where: { id },
      select: PROFILE_SELECT,
    });
    if (!profile) throw quotationProfileNotFound(id);

    const referenced = await this.prisma.quotations.count({
      where: { profile_id: id },
    });
    if (referenced > 0) throw this.deleteBlocked(id, referenced);

    try {
      await this.runScopedTransaction(async (tx, scope) => {
        // El ancla se comprueba ANTES de borrar y dentro de la transacción:
        // sin esto, `deleteMany({ profile_id })` borraría el historial de un
        // perfil de otro tenant con solo acertar un id.
        await this.assertOwned(tx, scope, id);

        // La procedencia de los clones se anula A MANO y como PAREJA: la FK
        // anula solo su propia columna y el par (id, versión) quedaría roto.
        await tx.quotation_profiles.updateMany({
          // `store_id` explícito: dentro de la transacción no hay scope, y
          // sin él esto anularía la procedencia de clones de otros tenants.
          where: { store_id: scope.store_id, cloned_from_profile_id: id },
          data: {
            cloned_from_profile_id: null,
            cloned_from_version: null,
            updated_at: new Date(),
          },
        });

        // Lo anterior solo alcanza a los clones de ESTA tienda, que son los
        // únicos que la API puede crear. Si quedara alguno fuera del ámbito
        // (inserción manual por SQL), se responde 409 en vez de dejar que la
        // base falle sin código traducible.
        const foreign_clones = await tx.quotation_profiles.count({
          where: {
            cloned_from_profile_id: id,
            store_id: { not: scope.store_id },
          },
        });
        if (foreign_clones > 0) {
          throw this.deleteBlockedByClones(id, foreign_clones);
        }

        await tx.quotation_profile_versions.deleteMany({
          where: { profile_id: id },
        });
        await tx.quotation_profiles.delete({ where: { id } });
      });
    } catch (error) {
      if (this.isForeignKeyViolation(error)) {
        const now = await this.prisma.quotations.count({
          where: { profile_id: id },
        });
        throw this.deleteBlocked(id, now);
      }
      throw error;
    }

    return { deleted: true, id };
  }

  // ─── Auxiliares ─────────────────────────────────────────────────────────

  /**
   * Vuelve a comprobar el ancla de tenant DENTRO de la transacción. Es el
   * único punto donde `store_id` entra al `where` a mano, y existe como paso
   * con nombre para que se pueda probar: un spec afirma que la consulta que
   * sale lleva el filtro.
   */
  private async assertOwned(
    tx: any,
    scope: QuotationProfileScope,
    id: number,
  ) {
    const profile = await tx.quotation_profiles.findFirst({
      where: { id, store_id: scope.store_id },
      select: PROFILE_SELECT,
    });
    if (!profile) throw quotationProfileNotFound(id);
    return profile;
  }

  /**
   * Escribe la versión y mueve el puntero. **Siempre dentro de una
   * transacción.** El orden es versión primero, puntero después: si algo
   * falla entremedio, quedaría una versión huérfana —inofensiva, nadie la
   * referencia— en vez de un puntero a la nada.
   */
  private async commitVersion(
    tx: any,
    scope: QuotationProfileScope,
    profile_id: number,
    config: QuotationProfileConfig,
    version: number,
  ) {
    const created = await tx.quotation_profile_versions.create({
      data: {
        profile_id,
        version,
        config: config as unknown as object,
        created_by: scope.user_id ?? null,
      },
      select: {
        id: true,
        version: true,
        config: true,
        created_at: true,
        created_by: true,
      },
    });

    const profile = await tx.quotation_profiles.update({
      where: { id: profile_id },
      data: { current_version: version, updated_at: new Date() },
      select: PROFILE_SELECT,
    });

    return { ...profile, current_config: created.config, version: created };
  }

  private async attachCurrentConfig(
    tx: any,
    profile: { id: number; current_version: number },
  ) {
    const version = await tx.quotation_profile_versions.findFirst({
      where: { profile_id: profile.id, version: profile.current_version },
      select: {
        id: true,
        version: true,
        config: true,
        created_at: true,
        created_by: true,
      },
    });
    return { ...profile, current_config: version?.config ?? null, version };
  }

  /** Variante scopeada (fuera de transacción) para `resolveForQuotation`. */
  private async attachCurrentConfigScoped(profile: {
    id: number;
    current_version: number;
  }) {
    const version = await this.prisma.quotation_profile_versions.findFirst({
      where: { profile_id: profile.id, version: profile.current_version },
      select: {
        id: true,
        version: true,
        config: true,
        created_at: true,
        created_by: true,
      },
    });
    return { ...profile, current_config: version?.config ?? null, version };
  }

  /** Desmarca el predeterminado vigente de la tienda. */
  private async clearDefault(tx: any, scope: QuotationProfileScope) {
    await tx.quotation_profiles.updateMany({
      // `store_id` explícito: dentro de la transacción no hay scope, y sin
      // él este `updateMany` desmarcaría el predeterminado de TODOS los
      // tenants.
      where: { store_id: scope.store_id, is_default: true },
      data: { is_default: false, updated_at: new Date() },
    });
  }

  /** Lee el `config` de una versión por el cliente scopeado. 404 si no existe. */
  private async readVersionConfig(profile_id: number, version: number) {
    const row = await this.prisma.quotation_profile_versions.findFirst({
      where: { profile_id, version },
      select: { config: true },
    });
    if (!row) {
      throw new VendixHttpException(
        ErrorCodes.QPROFILE_VERSION_001,
        `La versión ${version} de este perfil no existe.`,
        { profile_id, version },
      );
    }
    return row.config;
  }

  /**
   * Busca un perfil de ESTA tienda cuyo nombre coincida sin distinguir
   * mayúsculas, que es el criterio del índice.
   *
   * Se compara en memoria y no con `equals + mode: 'insensitive'`: Prisma lo
   * traduce a `ILIKE`, e `ILIKE` interpreta `%` y `_` como comodines — un
   * perfil llamado `"Obra%"` daría por tomado cualquier nombre que empiece
   * por `Obra`. Traer los de la tienda y comparar acá es exacto, mantiene el
   * scope, y la cardinalidad lo permite (decenas por tienda).
   */
  private async findByName(name: string | undefined, exclude_id?: number) {
    if (name === undefined) return null;
    const target = normalizeQuotationName(name).toLowerCase();

    const rows = await this.prisma.quotation_profiles.findMany({
      where: exclude_id === undefined ? {} : { id: { not: exclude_id } },
      select: { id: true, name: true },
    });

    return rows.find((row) => row.name.toLowerCase() === target) ?? null;
  }

  /**
   * Decide QUÉ único se violó preguntando a la base, no leyendo el error:
   * el de nombre es un índice sobre una EXPRESIÓN (`lower(name)`) y lo que
   * `error.meta.target` reporte ahí no está garantizado entre versiones del
   * cliente. Si el nombre existe, fue ese índice; si no, solo queda el
   * parcial de predeterminados.
   */
  private async uniqueConflict(
    name: string | undefined,
    profile_id: number | null,
    exclude_id?: number,
  ): Promise<VendixHttpException> {
    const existing = await this.findByName(name, exclude_id);
    if (existing && name !== undefined) return this.nameTaken(existing, name);
    return this.defaultRaceLost(profile_id);
  }

  /**
   * 409 de nombre tomado. `existing_profile_id` va en `details`: es lo que
   * permite al frontend separar el doble clic accidental (navega al perfil
   * que sí se creó) del choque real de nombres (pide otro).
   */
  private nameTaken(existing: { id: number; name: string }, attempted: string) {
    return new VendixHttpException(
      ErrorCodes.QPROFILE_NAME_001,
      `Ya existe un perfil llamado «${existing.name}» en esta tienda.`,
      {
        name: existing.name,
        attempted_name: normalizeQuotationName(attempted),
        existing_profile_id: existing.id,
      },
    );
  }

  /**
   * 409 de carrera perdida al marcar predeterminado. Un solo constructor
   * porque las dos ramas —la comprobación optimista y el choque del índice—
   * son el MISMO hecho para el usuario.
   */
  private defaultRaceLost(profile_id: number | null) {
    return new VendixHttpException(
      ErrorCodes.QPROFILE_DEFAULT_001,
      'Otro perfil quedó como predeterminado al mismo tiempo. Refresca y vuelve a intentarlo.',
      { profile_id },
    );
  }

  private deleteBlocked(profile_id: number, quotation_count: number) {
    return new VendixHttpException(
      ErrorCodes.QPROFILE_DELETE_001,
      quotation_count === 1
        ? 'Este perfil lo usa 1 cotización y no puede eliminarse. Puedes desactivarlo.'
        : `Este perfil lo usan ${quotation_count} cotizaciones y no puede eliminarse. Puedes desactivarlo.`,
      { profile_id, quotation_count },
    );
  }

  private deleteBlockedByClones(profile_id: number, clone_count: number) {
    return new VendixHttpException(
      ErrorCodes.QPROFILE_DELETE_001,
      `Este perfil es el origen de ${clone_count} perfil(es) de otra tienda y no puede eliminarse desde acá.`,
      { profile_id, foreign_clone_count: clone_count },
    );
  }

  /**
   * `P2003`/`P2014` son violaciones de FK; `P2002` de restricción única. Se
   * miran por código y no por mensaje porque el mensaje cambia entre
   * versiones del cliente.
   */
  private isForeignKeyViolation(error: unknown): boolean {
    const code = (error as { code?: string })?.code;
    return code === 'P2003' || code === 'P2014';
  }

  private isUniqueViolation(error: unknown): boolean {
    return (error as { code?: string })?.code === 'P2002';
  }
}
