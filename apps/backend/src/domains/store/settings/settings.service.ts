import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { S3Service } from '@common/services/s3.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { PwaCacheService } from '@common/services/pwa-cache.service';
import { extractS3KeyFromUrl } from '@common/helpers/s3-url.helper';
import {
  AuditService,
  AuditAction,
  AuditResource,
} from '../../../common/audit/audit.service';
import { StoreSettings } from './interfaces/store-settings.interface';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { AppSettingsDto } from './dto/settings-schemas.dto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  getPersistableDefaultStoreSettings,
  mergeStoreSettingsWithDefaults,
} from './defaults/default-store-settings';
import { SettingsMigratorService } from './migrations/settings-migrator.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import {
  buildTenantFiscalColumns,
  mergeFiscalData,
} from '@common/helpers/organization-fiscal-columns.helper';
import { tryResolveTenantFiscalIdentity } from '@common/helpers/fiscal-identity.helper';
import { SessionsService } from '../cash-registers/sessions/sessions.service';
import {
  SETTINGS_TRANSITION_GUARDS,
  readSettingsPath,
  type SettingsTransitionGuardDeps,
} from './guards/settings-transition-guards';

/**
 * Top-level keys retained when sanitizing an incoming settings payload.
 * Anything else is dropped and logged. Order does not matter.
 */
export const KNOWN_SECTIONS = [
  'general',
  'inventory',
  'checkout',
  'notifications',
  'pos',
  'receipts',
  'branding',
  'fonts',
  'publication',
  'operations',
  'panel_ui',
  'ecommerce',
  'module_flows',
  'fiscal_status',
  'fiscal_data',
  // Parámetros de emisión fiscal que la ley deja al contribuyente (régimen AIU).
  // Tiene que estar acá Y como propiedad de `UpdateSettingsDto`: el sanitizador
  // descarta lo que no esté en esta lista y responde 200 igual, y el
  // `ValidationPipe` con `whitelist: true` borra lo que el DTO no declare. Con
  // sólo una de las dos, el PATCH se pierde en silencio.
  'invoicing',
  'dispatch',
  'restaurant',
  'membership',
  'services', // appointment redesign phase 1: offer_home_service + local_address
  // Appointment redesign phase 2: reschedule policy (directo vs aprobación)
  // and per-product home service eligibility live here.
  'reservations',
  // Slot generation fallback (`AvailabilitySettings.working_days`). Declared in
  // `StoreSettings` and validated by `UpdateSettingsDto`, but it was missing
  // here, so a PATCH over it was dropped by the sanitizer and answered 200 with
  // the previous value: the caller had no way to know the write never landed.
  'availability',
  // @deprecated — el camino nuevo es `module_flows.accounting`; esta clave sólo
  // se conserva como alias legacy (`updateSettings` la sincroniza hacia
  // `module_flows`). Se lista igualmente porque dejar de mentir con un 200 no
  // puede depender de si la clave está deprecada: sin esto el alias se descarta
  // en silencio en vez de aplicarse o rechazarse.
  'accounting_flows',
  // Vexi's store-wide master switch. Must be listed here or the sanitizer
  // drops `{ vexi: { enabled: false } }` before validation and the endpoint
  // answers 200 with the old value — a switch that silently refuses to move.
  'vexi',
  // Promotions - Evaluation strategy (winner_takes_all vs stacking_groups) & UI
  'promotions',
  // `app` is intentionally accepted here because the service maps it to
  // branding via updateStoreBranding(); the migrator strips persisted `app`
  // afterwards. The legacy alias should not break update calls.
  'app',
] as const;

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private prisma: StorePrismaService,
    private organizationPrisma: OrganizationPrismaService,
    private globalPrisma: GlobalPrismaService,
    private s3Service: S3Service,
    private s3PathHelper: S3PathHelper,
    private auditService: AuditService,
    private migrator: SettingsMigratorService,
    private fiscalScope: FiscalScopeService,
    private sessionsService: SessionsService,
    private pwaCache: PwaCacheService,
  ) {}

  /**
   * Whether the fields the Web App Manifest and the installable icon are built
   * from actually changed.
   *
   * Compared field by field instead of invalidating on every settings write:
   * this endpoint also carries inventory, fiscal, payroll and panel_ui
   * sections, and each needless invalidation costs a re-derivation of four PNGs
   * for the tenant's next visitor.
   *
   * `ecommerce.inicio` is read too because a STORE_ECOMMERCE domain takes its
   * `theme_color` from there, not from `branding` (see `resolveDomain`).
   */
  private brandingAffectsPwa(before: any, after: any): boolean {
    const read = (settings: any) => {
      const branding = settings?.branding ?? {};
      const inicio = settings?.ecommerce?.inicio ?? {};
      return [
        branding.logo_url,
        branding.favicon_url,
        branding.primary_color,
        inicio.logo_url,
        inicio.colores?.primary_color,
      ].join('|');
    };

    return read(before) !== read(after);
  }

  /**
   * Dependencias que los guards de transición pueden consultar (QUI-560).
   * Se arman por llamada para que cada guard vea el `RequestContext` vigente.
   */
  private transitionGuardDeps(): SettingsTransitionGuardDeps {
    return {
      countOpenCashSessions: () => this.sessionsService.countOpenSessions(),
    };
  }

  /**
   * Puerta única de transición de settings (QUI-560).
   *
   * Se invoca desde los TRES caminos que persisten `store_settings`
   * (`updateSettings`, `resetToDefault`, `applyTemplate`) con el estado actual y
   * el estado que está a punto de escribirse. Validar solo el primero dejaría
   * los otros dos como puertas traseras capaces de producir exactamente el mismo
   * estado corrupto.
   *
   * Los guards se evalúan en serie y el primero que bloquea aborta la escritura:
   * cada uno hace una consulta a DB, y encadenarlas todas cuando ya sabemos que
   * la operación se rechaza no aporta nada.
   */
  private async assertSettingsTransitionAllowed(
    current: unknown,
    next: unknown,
  ): Promise<void> {
    for (const guard of SETTINGS_TRANSITION_GUARDS) {
      const before = readSettingsPath(current, guard.path);
      const after = readSettingsPath(next, guard.path);

      if (before !== guard.from || after !== guard.to) continue;

      const result = await guard.check(this.transitionGuardDeps());
      if (!result.blocked) continue;

      this.logger.warn(
        `[Settings] transición bloqueada path=${guard.path} ` +
          `${String(guard.from)}->${String(guard.to)} code=${guard.errorCode.code}`,
      );

      throw new VendixHttpException(
        guard.errorCode,
        result.detail,
        result.metadata,
      );
    }
  }

  /**
   * Idempotently ensures a `store_settings` row exists for the given store
   * with current default settings. Never overwrites an existing row.
   * Safe to call from store-creation flows or as auto-heal on first read.
   */
  async ensureDefaults(storeId: number): Promise<void> {
    if (!storeId) return;
    await this.prisma.store_settings.upsert({
      where: { store_id: storeId },
      create: {
        store_id: storeId,
        settings: getPersistableDefaultStoreSettings() as any,
      },
      update: {},
    });
  }

  /**
   * Filter unknown top-level keys, validate retained sections against
   * `UpdateSettingsDto` (with whitelist + skipMissingProperties), and return
   * the sanitized DTO. Known-section validation errors are surfaced via
   * SYS_VALIDATION_001; deprecated keys are dropped and logged.
   */
  private sanitizeAndValidate(
    raw: Record<string, unknown>,
    storeId: number,
  ): UpdateSettingsDto {
    const filtered: Record<string, unknown> = {};
    const droppedKeys: string[] = [];

    const knownSet = new Set<string>(KNOWN_SECTIONS as readonly string[]);
    for (const [key, value] of Object.entries(raw ?? {})) {
      if (knownSet.has(key)) {
        filtered[key] = value;
      } else {
        droppedKeys.push(key);
      }
    }

    if (droppedKeys.length > 0) {
      this.logger.warn(
        `[Settings] dropped deprecated keys storeId=${storeId} keys=${droppedKeys.join(
          ',',
        )}`,
      );
    }

    const dto = plainToInstance(UpdateSettingsDto, filtered, {
      enableImplicitConversion: true,
    });

    const errors = validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: false,
      skipMissingProperties: true,
      stopAtFirstError: false,
    });

    if (errors.length > 0) {
      throw new VendixHttpException(ErrorCodes.SYS_VALIDATION_001, undefined, {
        validation: errors.map((e) => ({
          property: e.property,
          constraints: e.constraints ?? {},
          children: e.children?.length ? e.children.map((c) => c.property) : [],
        })),
      });
    }

    return dto;
  }

  /**
   * Normaliza un campo de imagen que admite tri-estado dentro de un PATCH
   * parcial de settings:
   *
   * - `undefined` → la clave no vino en el payload: no se toca el valor vigente.
   * - `null` (o cadena vacía) → el usuario borró la imagen: hay que persistir
   *   el borrado.
   * - `string` → clave S3 o URL firmada a sanear vía `extractS3KeyFromUrl`.
   *
   * QUI-289: el patrón anterior era `extractS3KeyFromUrl(x) ?? undefined`, que
   * aplastaba el `null` explícito a `undefined`. Como las tres compuertas de
   * escritura del logo (`stores.logo_url`, `updateStoreBranding` y la sync de
   * la tabla `stores` desde `general`) filtran por `!== undefined`, borrar el
   * logo respondía `success: true` sin borrar nada. Preservar el tri-estado es
   * lo que hace que una respuesta afirmativa signifique lo que dice.
   */
  private normalizeImageKey(
    value: string | null | undefined,
  ): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    // `extractS3KeyFromUrl` ya devuelve null para cadenas vacías o en blanco,
    // así que un "" del cliente también se interpreta como borrado.
    return extractS3KeyFromUrl(value);
  }

  async getSettings(): Promise<StoreSettings> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    // Auto-heal: legacy stores without a settings row get one with current
    // defaults before we read. Idempotent — never overwrites existing data.
    await this.ensureDefaults(store_id);

    // Obtener datos de la tienda desde la tabla stores
    const store = await this.prisma.stores.findUnique({
      where: { id: store_id },
      select: {
        id: true,
        name: true,
        logo_url: true,
        store_type: true,
        timezone: true,
        organization_id: true,
      },
    });

    const storeSettings = await this.prisma.store_settings.findUnique({
      where: { store_id },
    });

    // Run lazy schema migrations against the persisted JSON. If any migration
    // applied, persist the migrated value so subsequent reads are idempotent.
    const defaultSettings = getPersistableDefaultStoreSettings();
    const rawSettings = (storeSettings?.settings || {}) as any;
    let settings = mergeStoreSettingsWithDefaults(rawSettings);
    if (storeSettings?.settings) {
      const result = this.migrator.migrate(rawSettings);
      const migratedSettings = mergeStoreSettingsWithDefaults(result.migrated);
      if (result.changed) {
        try {
          await this.prisma.store_settings.update({
            where: { store_id },
            data: { settings: migratedSettings, updated_at: new Date() },
          });
          this.logger.log(
            `[Settings] migrated store ${store_id}: v${result.fromVersion}->v${result.toVersion}`,
          );
        } catch (err: any) {
          this.logger.warn(
            `[Settings] failed to persist migration for store ${store_id}: ${err?.message ?? err}`,
          );
        }
      }
      settings = migratedSettings;
    }

    // Read branding from store_settings.settings.branding (source of truth)
    const branding = settings.branding || defaultSettings.branding;

    // Map branding to legacy app structure for compatibility
    const primaryColor = branding.primary_color || '#7ED7A5';
    const secondaryColor = branding.secondary_color || '#2F6F4E';
    const accentColor = branding.accent_color || '#FFFFFF';

    // Sign URLs on-demand before returning to frontend
    // Keys are stored in DB, but frontend needs signed URLs to access S3 objects
    const signedStoreLogoUrl = await this.s3Service.signUrl(store?.logo_url);
    const signedBrandingLogoUrl = await this.s3Service.signUrl(
      branding.logo_url,
    );
    const signedFaviconUrl = await this.s3Service.signUrl(branding.favicon_url);

    if (!storeSettings || !storeSettings.settings) {
      return {
        ...defaultSettings,
        general: {
          ...defaultSettings.general,
          name: store?.name,
          logo_url: signedStoreLogoUrl,
          store_type: store?.store_type,
          timezone: store?.timezone || defaultSettings.general.timezone,
        },
        app: {
          name: branding.name || store?.name || 'Vendix',
          primary_color: primaryColor,
          secondary_color: secondaryColor,
          accent_color: accentColor,
          theme: 'default',
          logo_url: signedBrandingLogoUrl || signedStoreLogoUrl,
          favicon_url: signedFaviconUrl,
        },
      };
    }

    // Merge existing settings with store data
    // Use branding as the single source of truth for colors (same as onboarding)
    return {
      ...settings,
      general: {
        ...settings.general,
        name: store?.name,
        logo_url: signedStoreLogoUrl,
        store_type: store?.store_type,
        timezone: store?.timezone || settings.general?.timezone,
      },
      app: {
        // Use branding as the single source of truth for colors
        name: branding.name || store?.name || 'Vendix',
        primary_color: primaryColor,
        secondary_color: secondaryColor,
        accent_color: accentColor,
        theme: settings.app?.theme || 'default',
        logo_url: signedBrandingLogoUrl || signedStoreLogoUrl,
        favicon_url: signedFaviconUrl,
      },
    };
  }

  async updateSettings(
    raw: Record<string, unknown> | UpdateSettingsDto,
  ): Promise<StoreSettings> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    const user_id = context?.user_id;

    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    // Sanitize unknown top-level keys and validate retained sections.
    // This replaces the previous, ineffective controller-side ValidationPipe.
    const dto: UpdateSettingsDto = this.sanitizeAndValidate(
      raw as Record<string, unknown>,
      store_id,
    );

    // La configuración de Vexi es exclusiva de propietario y administrador, y eso
    // tiene que decidirse acá. `store:settings:update` — el permiso que protege
    // este endpoint — también lo tienen `manager` y `Preventista`, así que el
    // guard de permisos no alcanza: sin esta comprobación, un manager apaga la
    // asistente de toda la tienda con un curl aunque el panel le oculte la
    // opción. Ocultar una UI no es restringir una capacidad.
    //
    // La compuerta cubre la sección ENTERA, no sólo `enabled`. `voice_engine`
    // también entra por acá, y con razón: el pipeline es el único motor que puede
    // ejecutar escrituras con confirmación, así que elegirlo amplía lo que la
    // asistente puede hacer sobre los datos de la tienda. Es la misma decisión
    // que encenderla.
    if (dto.vexi !== undefined) {
      const roles = RequestContextService.getRoles();
      const puedeConfigurarVexi = roles.some((role) =>
        ['owner', 'admin', 'STORE_OWNER', 'ORG_OWNER', 'super_admin'].includes(
          role,
        ),
      );
      if (!puedeConfigurarVexi) {
        throw new VendixHttpException(
          ErrorCodes.SYS_FORBIDDEN_001,
          'Solo el propietario o un administrador de la tienda pueden configurar a Vexi.',
        );
      }
    }

    // Validar que el sonido de notificación referenciado exista en el
    // catálogo global y esté activo. Permitimos null (sin sonido).
    const incomingSoundId = dto.notifications?.sound_id;
    if (incomingSoundId !== undefined && incomingSoundId !== null) {
      const sound = await this.globalPrisma.notification_sounds.findUnique({
        where: { id: incomingSoundId },
        select: { id: true, is_active: true },
      });
      if (!sound || !sound.is_active) {
        throw new VendixHttpException(
          ErrorCodes.NOTIFICATION_SOUND_INVALID,
          'El sonido seleccionado no existe o está desactivado.',
        );
      }
    }

    // Read raw DB settings (without signed URLs) to avoid leaking temporary URLs into stored JSON
    const storeSettings = await this.prisma.store_settings.findUnique({
      where: { store_id },
    });
    let currentSettings = mergeStoreSettingsWithDefaults(
      storeSettings?.settings,
    );

    // Guardar valores antiguos para auditoría
    const oldValues = { ...currentSettings };

    /**
     * Logo que trajo la sección `app`, ya normalizado. `undefined` = `app` no lo
     * mandó.
     *
     * QUI-289 — `app` es la sección autoritativa del branding (por eso más abajo
     * se borra de los settings persistidos: se reconstruye desde `branding`). El
     * panel manda `app` y `general` juntas, y al borrar el logo sólo anulaba
     * `app`: el bloque de `general`, que corre después, reescribía
     * `stores.logo_url` con la URL firmada anterior y revivía el logo recién
     * borrado en la MISMA petición. Con esto, un `logo_url` explícito en `app`
     * gana sobre lo que venga en `general`.
     */
    let appLogoUrl: string | null | undefined;

    /**
     * Si esta petición tocó algún insumo del manifest / ícono instalable.
     *
     * Se captura AQUÍ y no comparando settings al final porque la sección `app`
     * —la vía por la que el panel cambia el logo— se aplica aparte
     * (`updateStoreBranding`), luego se BORRA del dto y `currentSettings` se
     * re-lee ya con el branding nuevo. Para cuando el flujo llega al upsert,
     * el "antes" y el "después" son idénticos y una comparación no ve nada.
     */
    let pwaSourceTouched = false;

    // Handle app section - update branding in store_settings.settings.branding
    if (dto.app) {
      pwaSourceTouched = [
        dto.app.logo_url,
        dto.app.favicon_url,
        dto.app.name,
        dto.app.primary_color,
      ].some((value) => value !== undefined);

      // CRITICAL: Sanitize logo_url to extract S3 key before storing
      // This prevents storing signed URLs that expire after 24 hours.
      // `normalizeImageKey` conserva el `null` de un borrado explícito.
      if (dto.app.logo_url !== undefined) {
        dto.app.logo_url = this.normalizeImageKey(dto.app.logo_url);
        appLogoUrl = dto.app.logo_url;
      }
      if (dto.app.favicon_url !== undefined) {
        dto.app.favicon_url = this.normalizeImageKey(dto.app.favicon_url);
      }

      // Sincronizar logo_url simultáneamente en stores table
      if (dto.app.logo_url !== undefined) {
        await this.prisma.stores.update({
          where: { id: store_id },
          data: { logo_url: dto.app.logo_url },
        });
      }

      // Sincronizar nombre simultáneamente en stores y organizations
      if (dto.app.name !== undefined) {
        await this.prisma.stores.update({
          where: { id: store_id },
          data: { name: dto.app.name },
        });

        // Sincronizar con organizations table
        const store = await this.prisma.stores.findUnique({
          where: { id: store_id },
          select: { organization_id: true },
        });

        if (store?.organization_id) {
          await this.organizationPrisma.organizations.update({
            where: { id: store.organization_id },
            data: { name: dto.app.name },
          });
        }
      }

      // Update branding in store_settings.settings.branding (source of truth)
      await this.updateStoreBranding(store_id, dto.app);

      // Delete app and branding from dto - branding is managed by updateStoreBranding()
      // App will be built from branding in getSettings()
      // Branding must also be removed because the frontend sends the ENTIRE settings object,
      // which includes stale branding values from the previous GET response
      delete (dto as any).app;
      delete (dto as any).branding;

      // Re-read settings after branding update to avoid overwriting with stale data
      const freshStoreSettings = await this.prisma.store_settings.findUnique({
        where: { store_id },
      });
      currentSettings = mergeStoreSettingsWithDefaults(
        freshStoreSettings?.settings,
      );
    }

    // Merge solo las secciones enviadas
    const updatedSettings = { ...currentSettings };
    for (const key of Object.keys(dto)) {
      if (dto[key as keyof UpdateSettingsDto] !== undefined) {
        (updatedSettings as any)[key] = dto[key as keyof UpdateSettingsDto];
      }
    }

    // `vexi` se mezcla por clave, no por sección.
    //
    // El bucle de arriba REEMPLAZA la sección completa, que es lo correcto para
    // secciones que se editan enteras desde una sola pantalla. `vexi` no es una
    // de esas: el interruptor maestro manda `{ vexi: { enabled } }` y el selector
    // de motor manda `{ vexi: { voice_engine } }`, cada uno desde su propio
    // control. Con reemplazo de sección, tocar el interruptor borraba el
    // `voice_engine` que el dueño había elegido y la tienda volvía al default sin
    // avisar — la clase de fallo que ya se pagó en `ai_feature_flags`, donde un
    // normalizador que reconstruía el objeto entero borraba la clave que no
    // conocía. Un PATCH parcial no debe destruir lo que no menciona.
    if (dto.vexi !== undefined) {
      (updatedSettings as any).vexi = {
        ...((currentSettings as any).vexi ?? {}),
        ...dto.vexi,
      };
    }

    // `invoicing` también se mezcla por clave, y una clave MÁS ADENTRO que
    // `vexi`, porque su contenido está anidado dos niveles: la sección sólo
    // contiene `aiu`, y `aiu` contiene cuatro parámetros que la pantalla fiscal
    // edita por separado (régimen, objeto del contrato, piso legal, porcentaje).
    //
    // Con el reemplazo del bucle genérico, un PATCH de `{ invoicing: { aiu: {
    // contract_object } } }` borraría el `regime` ya elegido y el documento
    // volvería al default `et_462_1` sin avisar. Eso no es una preferencia de
    // UI que se pierde: cambia la BASE GRAVABLE del IVA de las facturas AIU que
    // se emitan después, y el error no produce ningún síntoma —la DIAN acepta
    // el documento igual— hasta que llega la revisión.
    if (dto.invoicing !== undefined) {
      const current_invoicing = (currentSettings as any).invoicing ?? {};
      const merged_invoicing: Record<string, any> = {
        ...current_invoicing,
        ...dto.invoicing,
      };

      // Las subsecciones se FUSIONAN clave a clave; el spread de arriba las
      // sustituiría enteras. Un PATCH que sólo trae `invoicing.pos.auto_emit`
      // reemplazaría todo `pos` por ese único campo y borraría el resto en
      // silencio — la misma pérdida callada que produce olvidar una sección en
      // `KNOWN_SECTIONS`, sólo que un nivel más abajo y sin ningún síntoma
      // (la respuesta sigue siendo 200).
      //
      // La lista se recorre en vez de escribirse a mano por subsección: `aiu`
      // era la única cuando esto se escribió, `pos` llegó después, y lo que
      // falla no es añadir la subsección — es olvidarse de añadirla AQUÍ.
      for (const key of ['aiu', 'pos'] as const) {
        const patch = (dto.invoicing as Record<string, any>)[key];
        if (patch === undefined) continue;
        merged_invoicing[key] = { ...(current_invoicing[key] ?? {}), ...patch };
      }

      (updatedSettings as any).invoicing = merged_invoicing;
    }

    // @deprecated: Sync bidireccional eliminada. module_flows es source of truth.
    // accounting_flows se mantiene en lectura como fallback legacy (Fase 2: eliminar).

    // Legacy accounting_flows writes → sync a module_flows.accounting
    if (dto.accounting_flows) {
      if (!updatedSettings.module_flows) {
        updatedSettings.module_flows = {
          accounting: { enabled: true, ...dto.accounting_flows } as any,
          payroll: { enabled: true },
          invoicing: { enabled: true },
        };
      } else {
        updatedSettings.module_flows = {
          ...updatedSettings.module_flows,
          accounting: {
            ...updatedSettings.module_flows.accounting,
            ...dto.accounting_flows,
          } as any,
        };
      }
    }

    // NUEVO: Actualizar campos de la tabla stores si vienen en general
    if (dto.general) {
      let { name, logo_url, store_type, timezone, industries } = dto.general;

      // CRITICAL: Sanitize logo_url to extract S3 key before storing
      // This prevents storing signed URLs that expire after 24 hours.
      // Un `null` explícito sobrevive para que el borrado llegue a la tabla.
      if (appLogoUrl !== undefined) {
        // `app` ya decidió el logo en esta misma petición: no lo contradigas.
        logo_url = appLogoUrl;
        dto.general.logo_url = logo_url;
      } else if (logo_url !== undefined) {
        logo_url = this.normalizeImageKey(logo_url);
        dto.general.logo_url = logo_url; // Update DTO for consistency
      }

      // Preparar objeto de actualización solo con campos definidos
      const storeUpdateData: any = {};

      if (name !== undefined) {
        storeUpdateData.name = name;
      }
      if (logo_url !== undefined) {
        storeUpdateData.logo_url = logo_url;
      }
      if (store_type !== undefined) {
        storeUpdateData.store_type = store_type;
      }
      if (timezone !== undefined) {
        // Sincronizar timezone con la tabla stores
        storeUpdateData.timezone = timezone;
      }
      if (industries !== undefined) {
        // Sincronizar industries con la tabla stores (Prisma serializa
        // el array a Postgres `industry_enum[]`).
        storeUpdateData.industries = industries;
      }

      // Actualizar tabla stores si hay campos para actualizar
      if (Object.keys(storeUpdateData).length > 0) {
        try {
          // Obtener la tienda para saber si es la principal y su organización
          const store = await this.prisma.stores.findUnique({
            where: { id: store_id },
            select: { organization_id: true, main_store_users: { take: 1 } },
          });

          await this.prisma.stores.update({
            where: { id: store_id },
            data: storeUpdateData,
          });

          // Si el nombre cambió, actualizar en store_settings.settings.branding
          if (name && store?.organization_id) {
            await this.updateStoreBranding(store_id, { name } as any);
          }

          // Trigger favicon generation asynchronously if logo_url was updated
          if (logo_url !== undefined && logo_url !== null) {
            this.generateFaviconForStore(store_id, logo_url).catch((error) =>
              this.logger.warn(`Favicon generation failed: ${error.message}`),
            );
          }
        } catch (error) {
          console.error('Error updating stores table:', error);
        }
      }
    }

    // Safety net: sanitize any signed URLs that may have leaked into the settings
    // object. Se evalúa contra `undefined` y no por truthiness para que un
    // borrado (`null`) no se salte la red y quede sin normalizar.
    if (updatedSettings.general?.logo_url !== undefined) {
      updatedSettings.general.logo_url = this.normalizeImageKey(
        updatedSettings.general.logo_url,
      );
    }

    // Remove app from settings - branding is the single source of truth
    // App will be built from branding in getSettings()
    delete (updatedSettings as any).app;

    // QUI-560 — última puerta antes de persistir: el payload ya está saneado y
    // mergeado, así que aquí se compara el estado real de salida contra el de
    // entrada, no el fragmento que mandó el cliente.
    await this.assertSettingsTransitionAllowed(currentSettings, updatedSettings);

    const result = await this.prisma.store_settings.upsert({
      where: { store_id },
      update: {
        settings: updatedSettings,
        updated_at: new Date(),
      },
      create: {
        store_id,
        settings: updatedSettings,
      },
    });

    // El manifest y el ícono instalable se derivan de dos tablas: el nombre y
    // el logo viven en `stores`, los colores y el favicon en este branding.
    // Ambos se cachean en S3 + Redis y no se re-derivan solos, así que sin este
    // drop la PWA de la tienda conserva el logo anterior (ver PwaCacheService).
    //
    // Tres señales, porque el branding llega por tres caminos distintos:
    // `app` (ya capturada arriba, antes de que se borre del dto), `general`
    // (escribe `stores.name` / `stores.logo_url`) y el resto de secciones, que
    // sí sobreviven hasta aquí y se detectan comparando.
    const generalFeedsPwa =
      dto.general?.name !== undefined || dto.general?.logo_url !== undefined;

    if (
      pwaSourceTouched ||
      generalFeedsPwa ||
      this.brandingAffectsPwa(currentSettings, updatedSettings)
    ) {
      await this.pwaCache.invalidateStore(store_id);
    }

    // Registrar auditoría de actualización de settings
    try {
      // Solo guardar las secciones que cambiaron (no todo el objeto de settings)
      const changedSections: Record<string, any> = {};
      for (const key of Object.keys(dto)) {
        if (dto[key as keyof UpdateSettingsDto] !== undefined) {
          changedSections[key] = {
            old: (oldValues as any)[key],
            new: (updatedSettings as any)[key],
          };
        }
      }

      await this.auditService.logUpdate(
        user_id!,
        AuditResource.SETTINGS,
        store_id, // Validado arriba, siempre existe aquí
        null, // No guardamos el objeto completo de oldValues
        changedSections, // Solo las secciones que cambiaron
        {
          sections_updated: Object.keys(dto),
          store_id,
        },
      );
      this.logger.log(
        `Audit log created for settings update by user ${user_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create audit log for settings update: ${error.message}`,
      );
    }

    return mergeStoreSettingsWithDefaults(result.settings);
  }

  async resetToDefault(): Promise<StoreSettings> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const defaults = getPersistableDefaultStoreSettings();

    // QUI-560 — restablecer a defaults apaga `pos.cash_register.enabled`, así
    // que es una transición tan destructiva como el PATCH y pasa por la misma
    // puerta.
    const existing = await this.prisma.store_settings.findUnique({
      where: { store_id },
    });
    await this.assertSettingsTransitionAllowed(
      mergeStoreSettingsWithDefaults(existing?.settings),
      defaults,
    );

    await this.prisma.store_settings.upsert({
      where: { store_id },
      update: {
        settings: defaults,
        updated_at: new Date(),
      },
      create: {
        store_id,
        settings: defaults,
      },
    });

    return this.getSettings();
  }

  async getSystemTemplates(): Promise<any[]> {
    const templates = await this.prisma.default_templates.findMany({
      where: {
        configuration_type: 'store_settings',
        is_active: true,
        is_system: true,
      },
      select: {
        template_name: true,
        template_data: true,
        description: true,
      },
      orderBy: {
        updated_at: 'desc',
      },
    });

    return templates;
  }

  async applyTemplate(template_name: string): Promise<StoreSettings> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const template = await this.prisma.default_templates.findFirst({
      where: {
        template_name,
        configuration_type: 'store_settings',
        is_active: true,
      },
    });

    if (!template) {
      throw new VendixHttpException(ErrorCodes.STORE_FIND_001);
    }

    const settings = mergeStoreSettingsWithDefaults(template.template_data);

    // QUI-560 — una plantilla puede traer la caja apagada; misma puerta.
    const existing = await this.prisma.store_settings.findUnique({
      where: { store_id },
    });
    await this.assertSettingsTransitionAllowed(
      mergeStoreSettingsWithDefaults(existing?.settings),
      settings,
    );

    await this.prisma.store_settings.upsert({
      where: { store_id },
      update: {
        settings,
        updated_at: new Date(),
      },
      create: {
        store_id,
        settings,
      },
    });

    return settings;
  }

  /**
   * Generates a favicon from the store logo and updates the domain configuration.
   * This method runs asynchronously (fire-and-forget) to avoid blocking the logo upload response.
   *
   * @param storeId - Store ID
   * @param logoUrl - Logo URL (S3 key or HTTP URL)
   */
  private async generateFaviconForStore(
    storeId: number,
    logoUrl: string,
  ): Promise<void> {
    try {
      // 1. Get store with organization and slugs for path S3
      const store = await this.prisma.stores.findUnique({
        where: { id: storeId },
        select: {
          id: true,
          slug: true,
          organization_id: true,
          logo_url: true,
          organizations: {
            select: { id: true, slug: true },
          },
        },
      });

      if (!store?.organization_id || !store.organizations) {
        this.logger.warn(`Store ${storeId} missing organization data`);
        return;
      }

      if (!store.logo_url) {
        this.logger.warn(`Store ${storeId} has no logo_url`);
        return;
      }

      // 2. Download logo from S3 (if it's a key, not an external URL)
      let logoBuffer: Buffer;
      if (store.logo_url.startsWith('http')) {
        this.logger.warn(
          `Store ${storeId} has external logo URL, skipping favicon generation`,
        );
        return;
      }

      try {
        logoBuffer = await this.s3Service.downloadImage(store.logo_url);
      } catch (error) {
        this.logger.error(
          `Failed to download logo for store ${storeId}: ${error.message}`,
        );
        return;
      }

      // 3. Generate and upload favicons using path with slug-id
      const faviconPath = this.s3PathHelper.buildFaviconPath(
        store.organizations,
        store,
      );

      const result = await this.s3Service.generateAndUploadFaviconFromLogo(
        logoBuffer,
        faviconPath,
      );

      if (!result) {
        this.logger.warn(`Favicon generation failed for store ${storeId}`);
        return;
      }

      this.logger.log(
        `Favicons generated for store ${storeId}: ${result.sizes.join(', ')}px`,
      );

      // 4. Update store_settings.settings.branding.favicon_url (source of truth)
      const storeSettings = await this.prisma.store_settings.findUnique({
        where: { store_id: storeId },
      });

      const currentSettings = mergeStoreSettingsWithDefaults(
        storeSettings?.settings,
      );
      const updatedSettings = {
        ...currentSettings,
        branding: {
          ...currentSettings.branding,
          favicon_url: result.faviconKey, // Store S3 key (not signed URL)
        },
      };

      await this.prisma.store_settings.upsert({
        where: { store_id: storeId },
        update: {
          settings: updatedSettings,
          updated_at: new Date(),
        },
        create: {
          store_id: storeId,
          settings: updatedSettings,
        },
      });

      this.logger.log(`Favicon updated in store_settings for store ${storeId}`);

      // Corre fuera de la petición que subió el logo (se dispara con
      // `.catch()`), así que la invalidación de `updateSettings` ya pasó y no
      // vio este `favicon_url`. Sin este segundo drop, una tienda SIN logo que
      // acaba de estrenar favicon seguiría instalando con la marca Vendix.
      await this.pwaCache.invalidateStore(storeId);
    } catch (error) {
      this.logger.error(
        `Error in generateFaviconForStore for store ${storeId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Updates the branding configuration in store_settings.settings.branding (source of truth).
   *
   * @param storeId - Store ID
   * @param appSettings - App settings containing branding configuration
   */
  private async updateStoreBranding(
    storeId: number,
    appSettings: AppSettingsDto,
  ): Promise<void> {
    // Get current store_settings
    const storeSettings = await this.prisma.store_settings.findUnique({
      where: { store_id: storeId },
    });

    const currentSettings = mergeStoreSettingsWithDefaults(
      storeSettings?.settings,
    );
    const existingBranding =
      currentSettings.branding || getPersistableDefaultStoreSettings().branding;

    // Build updated branding - only update fields that are provided
    const updatedBranding = {
      ...existingBranding,
      ...(appSettings.name !== undefined && { name: appSettings.name }),
      ...(appSettings.primary_color !== undefined && {
        primary_color: appSettings.primary_color,
      }),
      ...(appSettings.secondary_color !== undefined && {
        secondary_color: appSettings.secondary_color,
      }),
      ...(appSettings.accent_color !== undefined && {
        accent_color: appSettings.accent_color,
      }),
      ...(appSettings.logo_url !== undefined && {
        logo_url: appSettings.logo_url,
      }),
      ...(appSettings.favicon_url !== undefined && {
        favicon_url: appSettings.favicon_url,
      }),
    };

    const updatedSettings = {
      ...currentSettings,
      branding: updatedBranding,
    };

    // Upsert store_settings with updated branding
    await this.prisma.store_settings.upsert({
      where: { store_id: storeId },
      update: {
        settings: updatedSettings,
        updated_at: new Date(),
      },
      create: {
        store_id: storeId,
        settings: updatedSettings,
      },
    });

    this.logger.log(`Branding updated in store_settings for store ${storeId}`);

    // Sync organization name if it changed
    if (appSettings.name) {
      try {
        const store = await this.prisma.stores.findUnique({
          where: { id: storeId },
          select: { organization_id: true },
        });

        if (store?.organization_id) {
          await this.organizationPrisma.organizations.update({
            where: { id: store.organization_id },
            data: { name: appSettings.name },
          });
          this.logger.log(
            `Organization ${store.organization_id} name updated to ${appSettings.name}`,
          );
        }
      } catch (error) {
        this.logger.warn(`Failed to sync organization name: ${error.message}`);
      }
    }
  }

  async create(data: any) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    return this.prisma.store_settings.create({
      data: {
        ...data,
        store_id: store_id,
      },
    });
  }

  async findAll() {
    return this.prisma.store_settings.findMany();
  }

  async findOne(id: number) {
    const setting = await this.prisma.store_settings.findFirst({
      where: { id },
    });
    if (!setting) throw new VendixHttpException(ErrorCodes.STORE_FIND_001);
    return setting;
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.store_settings.update({
      where: { id },
      data,
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.store_settings.delete({
      where: { id },
    });
  }

  /**
   * Patch-style update for `settings.fiscal_data`. Deep-merges over the
   * existing section so partial payloads are safe. Other settings sections
   * (branding, panel_ui, etc.) are never touched.
   *
   * Canonical endpoint: `PATCH /store/settings/fiscal-data`.
   */
  async getFiscalData(): Promise<StoreSettings['fiscal_data']> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    let organization_id = context?.organization_id;

    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    if (!organization_id) {
      const store = await this.prisma.withoutScope().stores.findUnique({
        where: { id: store_id },
        select: { organization_id: true },
      });
      organization_id = store?.organization_id;
    }

    if (!organization_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    const fiscalScope =
      await this.fiscalScope.requireFiscalScope(organization_id);

    if (fiscalScope === 'ORGANIZATION') {
      const orgSettings = await this.organizationPrisma
        .withoutScope()
        .organization_settings.findFirst({
          where: { organization_id },
          select: { settings: true },
        });
      const orgFiscalData = ((orgSettings?.settings as any)?.fiscal_data ??
        {}) as Record<string, unknown>;
      // CP-PURCHASE-TRANSPARENCY B.2 — bajo alcance fiscal ORGANIZATION la
      // tienda NO tiene identidad propia: todo el bloque es de la organización,
      // así que el origen es 'organization' sin ambigüedad.
      return {
        ...orgFiscalData,
        tax_responsibilities_source: 'organization',
        tax_regime_source: 'organization',
      } as StoreSettings['fiscal_data'];
    }

    await this.ensureDefaults(store_id);
    const [existing, store] = await Promise.all([
      this.prisma.store_settings.findUnique({
        where: { store_id },
        select: { settings: true },
      }),
      this.prisma.withoutScope().stores.findUnique({
        where: { id: store_id },
        select: {
          legal_name: true,
          tax_id: true,
          tax_id_dv: true,
          nit_type: true,
          municipality_code: true,
          ciiu_code: true,
        },
      }),
    ]);
    const fiscalData = (mergeStoreSettingsWithDefaults(existing?.settings)
      .fiscal_data ?? {}) as Record<string, unknown>;
    const storeLevel: Record<string, unknown> = {
      ...fiscalData,
      legal_name: store?.legal_name ?? fiscalData.legal_name,
      nit: store?.tax_id ?? fiscalData.nit,
      nit_dv: store?.tax_id_dv ?? fiscalData.nit_dv,
      tax_id: store?.tax_id ?? fiscalData.tax_id,
      tax_id_dv: store?.tax_id_dv ?? fiscalData.tax_id_dv,
      nit_type: store?.nit_type ?? fiscalData.nit_type,
      municipality_code: store?.municipality_code ?? fiscalData.municipality_code,
      ciiu_code: store?.ciiu_code ?? fiscalData.ciiu_code,
    };

    // Pre-fill defaults for a freshly created per-store-scope store: it has no
    // legal identity of its own yet, so instead of an empty form we surface the
    // organization's fiscal identity (captured at registration/onboarding) as
    // EDITABLE defaults. Strictly read-only — never persisted here and never
    // overrides a value the store already set. A multi-store org whose stores
    // are distinct legal entities simply edits the default before saving.
    const blank = (value: unknown): boolean =>
      value === null || value === undefined || String(value).trim() === '';

    // ── CP-PURCHASE-TRANSPARENCY B.2 ─────────────────────────────────────────
    // Herencia de `tax_responsibilities` y `tax_regime` desde la organización.
    //
    // Decisión de negocio: una tienda que no declaró responsabilidades propias
    // es la misma entidad ante la DIAN que su organización. La herencia que ya
    // existía cubría la IDENTIDAD (NIT, razón social) pero no estos dos campos,
    // así que una tienda dentro de una organización que declaró O-48 resolvía
    // «no responsable» y capitalizaba el IVA al costo sin que nadie lo hubiera
    // decidido. En el entorno de referencia, 12 de 15 organizaciones no tienen
    // datos fiscales y caen justo en esa rama.
    //
    // La herencia es POR CAMPO y sólo hacia el vacío: un valor propio de la
    // tienda NUNCA se pisa. Aplicarla al revés convertiría a una tienda que
    // declaró O-49 en O-48 y le haría descontar un IVA que no puede descontar.
    //
    // Se aplica sobre `storeLevel` (antes de las dos ramas de retorno) para que
    // la tienda con identidad propia y la que la hereda cuenten la misma
    // historia sobre su responsabilidad fiscal.
    const ownResponsibilities = Array.isArray(storeLevel.tax_responsibilities)
      ? (storeLevel.tax_responsibilities as unknown[])
      : [];
    const needsResponsibilities = ownResponsibilities.length === 0;
    const needsRegime = blank(storeLevel.tax_regime);

    storeLevel.tax_responsibilities_source = 'store';
    storeLevel.tax_regime_source = 'store';

    if (needsResponsibilities || needsRegime) {
      const inheritedSettings = await this.organizationPrisma
        .withoutScope()
        .organization_settings.findFirst({
          where: { organization_id },
          select: { settings: true },
        });
      const orgFiscal = ((inheritedSettings?.settings as any)?.fiscal_data ??
        {}) as Record<string, unknown>;

      const orgResponsibilities = Array.isArray(orgFiscal.tax_responsibilities)
        ? (orgFiscal.tax_responsibilities as unknown[]).filter(
            (code): code is string => typeof code === 'string',
          )
        : [];
      if (needsResponsibilities && orgResponsibilities.length > 0) {
        storeLevel.tax_responsibilities = orgResponsibilities;
        storeLevel.tax_responsibilities_source = 'organization';
      }

      if (needsRegime && !blank(orgFiscal.tax_regime)) {
        storeLevel.tax_regime = orgFiscal.tax_regime;
        storeLevel.tax_regime_source = 'organization';
      }
    }

    const hasOwnIdentity =
      !blank(storeLevel.tax_id) ||
      !blank(storeLevel.nit) ||
      !blank(storeLevel.legal_name);

    if (!hasOwnIdentity) {
      const [orgSettings, organization] = await Promise.all([
        this.organizationPrisma
          .withoutScope()
          .organization_settings.findFirst({
            where: { organization_id },
            select: { settings: true },
          }),
        this.prisma.withoutScope().organizations.findUnique({
          where: { id: organization_id },
          select: { legal_name: true, tax_id: true, name: true },
        }),
      ]);
      const orgFiscal = ((orgSettings?.settings as any)?.fiscal_data ??
        {}) as Record<string, unknown>;
      const orgLegalName = orgFiscal.legal_name ?? organization?.legal_name;
      const orgTaxId = orgFiscal.tax_id ?? orgFiscal.nit ?? organization?.tax_id;
      const orgTaxIdDv = orgFiscal.tax_id_dv ?? orgFiscal.nit_dv;
      const orgNitType = orgFiscal.nit_type;

      // Antes del paso 5 del plan, este return vivía con su propia cascada de
      // respaldos store→org. Esa cascada podía divergir de la del resolvedor
      // único (ej: `nit_dv` se concatenaba al NIT sin re-derivar). El
      // resolvedor decide precedencias — `fiscal_data` gana a la columna — y
      // expone un contrato ancho con campos crudos; lo proyectamos a la forma
      // que el formulario de tienda espera.
      // Esta es una superficie de LECTURA: el GET que llena el formulario fiscal
      // del wizard. Se usa el resolvedor PERMISIVO, no el estricto envuelto en
      // try/catch: el tenant abre este formulario justamente porque le faltan
      // datos, así que un campo ausente es el estado NORMAL aquí, no una
      // excepción. Con el estricto había que atrapar el throw para no romper el
      // GET — control de flujo por excepción para un caso esperado.
      // Ver la nota de asimetría lectura/emisión en `fiscal-identity.helper.ts`.
      const { identity } = tryResolveTenantFiscalIdentity({
        nit: (orgTaxId as string) ?? '',
        fiscal_data: orgFiscal,
        organization: organization
          ? { legal_name: organization.legal_name, name: organization.name }
          : null,
      });
      // Los campos que el resolvedor no pudo resolver llegan vacíos, así que la
      // cascada previa sigue actuando como respaldo con un `||` explícito.
      const resolvedLegalName: unknown =
        identity.legal_name || storeLevel.legal_name;
      const resolvedNit: unknown =
        identity.nit || storeLevel.tax_id || storeLevel.nit;
      const resolvedNitDv: unknown =
        identity.nit_dv || storeLevel.tax_id_dv || storeLevel.nit_dv;
      const resolvedNitType: unknown =
        identity.nit_type || storeLevel.nit_type;

      return {
        ...storeLevel,
        legal_name: blank(storeLevel.legal_name)
          ? resolvedLegalName
          : storeLevel.legal_name,
        nit: blank(storeLevel.nit) ? resolvedNit : storeLevel.nit,
        nit_dv: blank(storeLevel.nit_dv) ? resolvedNitDv : storeLevel.nit_dv,
        tax_id: blank(storeLevel.tax_id) ? resolvedNit : storeLevel.tax_id,
        tax_id_dv: blank(storeLevel.tax_id_dv)
          ? resolvedNitDv
          : storeLevel.tax_id_dv,
        nit_type: blank(storeLevel.nit_type)
          ? resolvedNitType
          : storeLevel.nit_type,
      } as StoreSettings['fiscal_data'];
    }

    return storeLevel as StoreSettings['fiscal_data'];
  }

  async updateFiscalData(
    dto: Record<string, unknown>,
  ): Promise<StoreSettings['fiscal_data']> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    const user_id = context?.user_id;
    let organization_id = context?.organization_id;

    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    if (!organization_id) {
      const store = await this.prisma.withoutScope().stores.findUnique({
        where: { id: store_id },
        select: { organization_id: true },
      });
      organization_id = store?.organization_id;
    }

    if (!organization_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    const fiscalScope =
      await this.fiscalScope.requireFiscalScope(organization_id);
    if (fiscalScope === 'ORGANIZATION') {
      throw new BadRequestException(
        'Fiscal data is managed at organization level for this organization.',
      );
    }

    await this.ensureDefaults(store_id);

    const existing = await this.prisma.store_settings.findUnique({
      where: { store_id },
    });
    const currentSettings = mergeStoreSettingsWithDefaults(existing?.settings);
    const previousFiscalData = currentSettings.fiscal_data ?? {};

    // Fusión superficial centralizada en `mergeFiscalData` (ver §"Approach
    // Chosen" del plan de identidad fiscal SSOT). Antes este spread se hacía
    // inline — mismo resultado, pero el nombre no declaraba la intención.
    // B.2 — `getFiscalData` devuelve dos marcadores DERIVADOS del origen del
    // dato (`*_source`). Un formulario que lea y devuelva el objeto entero los
    // reenviaría, y `mergeFiscalData` los persistiría: la tienda acabaría con
    // un campo que dice de dónde vino un valor que ahora es suyo, y la próxima
    // lectura lo contradiría. Se descartan aquí, en el único punto de escritura.
    const writableDto = { ...dto };
    delete writableDto.tax_responsibilities_source;
    delete writableDto.tax_regime_source;

    const nextFiscalData = mergeFiscalData(
      previousFiscalData as Record<string, unknown>,
      writableDto,
    );

    // Proyección única de columnas del alcance tienda vía
    // `buildTenantFiscalColumns`. Antes este bloque inlineaba la lectura de cada
    // campo del DTO y la escritura de cada columna, así que el mismo payload
    // podía producir columnas distintas si el orden o el saneado cambiaban.
    const storeColumns = buildTenantFiscalColumns(
      'store',
      writableDto,
      nextFiscalData,
    );

    const updatedSettings: StoreSettings = {
      ...currentSettings,
      fiscal_data: nextFiscalData as StoreSettings['fiscal_data'],
    };

    await this.prisma.$transaction(async (tx: any) => {
      await tx.store_settings.upsert({
        where: { store_id },
        update: {
          settings: updatedSettings as any,
          updated_at: new Date(),
        },
        create: {
          store_id,
          settings: updatedSettings as any,
        },
      });

      if (Object.keys(storeColumns).length > 0) {
        await tx.stores.update({
          where: { id: store_id },
          data: { ...storeColumns, updated_at: new Date() },
        });
      }
    });

    try {
      await this.auditService.logUpdate(
        user_id!,
        AuditResource.SETTINGS,
        store_id,
        { fiscal_data: previousFiscalData },
        { fiscal_data: nextFiscalData },
        { action: 'update_fiscal_data', store_id },
      );
    } catch (err) {
      this.logger.warn(
        `Audit log for fiscal_data update failed: ${(err as Error).message}`,
      );
    }

    return nextFiscalData as StoreSettings['fiscal_data'];
  }

  /**
   * Returns the currency code configured for the current store.
   * Reads from store_settings.settings.general.currency with fallback to 'USD'.
   */
  async getStoreCurrency(): Promise<string> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      return 'USD';
    }

    try {
      const storeSettings = await this.prisma.store_settings.findUnique({
        where: { store_id },
        select: { settings: true },
      });

      const settings = mergeStoreSettingsWithDefaults(storeSettings?.settings);
      return settings?.general?.currency || 'USD';
    } catch {
      return 'USD';
    }
  }

  /**
   * Returns the store's currency together with its `decimal_places`, read from
   * the global `currencies` catalog.
   *
   * OCR scanners need the decimal count, not just the code: in a zero-decimal
   * currency (COP, CLP, PYG, JPY…) a fractional amount is structurally
   * impossible, which turns "how many decimals" into a deterministic validator
   * for AI-extracted money — see `ocr-money.util.ts`.
   *
   * Never throws: falls back to 2 decimals, the same conservative default as
   * the `currencies.decimal_places` column, so an unknown code can only ever
   * disable the repair, never trigger it wrongly.
   */
  async getStoreCurrencyInfo(): Promise<{
    code: string;
    decimal_places: number;
  }> {
    const code = await this.getStoreCurrency();

    try {
      const currency = await this.globalPrisma.currencies.findUnique({
        where: { code },
        select: { decimal_places: true },
      });
      return { code, decimal_places: currency?.decimal_places ?? 2 };
    } catch (err) {
      this.logger.warn(
        `getStoreCurrencyInfo: could not resolve decimals for ${code} (${(err as Error).message}); defaulting to 2.`,
      );
      return { code, decimal_places: 2 };
    }
  }
}
