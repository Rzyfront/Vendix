import { Body, Controller, Get, Param, ParseIntPipe, Patch, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequestContextService } from '@common/context/request-context.service';
import {
  TenantContextRunner,
  type ResolvedTenantScope,
  type RunAsTenantOptions,
} from '@common/context/tenant-context-runner.service';
import { ErrorCodes } from '@common/errors/error-codes';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ResponseService } from '@common/responses/response.service';

import { Permissions } from '../../auth/decorators/permissions.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';

import { SettingsService as OrganizationSettingsService } from '../../organization/settings/settings.service';
import {
  KNOWN_SECTIONS,
  SettingsService as StoreSettingsService,
} from '../../store/settings/settings.service';

import { TenantSettingsFiscalDataDto } from './dto/tenant-settings-fiscal-data.dto';
import { TenantSettingsUpdateDto } from './dto/tenant-settings-update.dto';
import { toTenantTarget, type TenantScopeSegment } from './dto/tenant-scope-param.dto';

/** Ver la nota de `PERMISOS_*` en `tenant-resolutions.controller.ts`. */
const PERMISOS_LECTURA = [
  'store:settings:read',
  'store:settings:fiscal_data:read',
  'organization:settings:read',
  'organization:settings:fiscal_data:read',
];
const PERMISOS_ESCRITURA = [
  'store:settings:read',
  'store:settings:update',
  'store:settings:fiscal_data:write',
  'organization:settings:read',
  'organization:settings:update',
  'organization:settings:fiscal_data:write',
];

/** Nivel del que se leen y en el que se escriben los settings del tenant. */
type NivelSettings = 'store' | 'organization';

/**
 * Secciones que la consola muestra pero NO deja editar en crudo porque tienen
 * formulario propio en otra pestaña del rail, y ese formulario es el que aplica
 * las reglas de dominio. El valor es la etiqueta de la pestaña dueña.
 *
 * POR QUÉ VIVEN AQUÍ Y NO EN `SettingsService`: no son una regla del dominio de
 * settings —el backend acepta escribir `panel_ui` y `fiscal_data` por el camino
 * normal—, son un mapa de la NAVEGACIÓN de la consola de super admin: nombran
 * pestañas que sólo existen en esta UI. Meterlas en el servicio de tienda le
 * haría conocer una pantalla y las volvería una regla para todos sus
 * consumidores, incluido el panel del comerciante, que no tiene estas pestañas.
 */
const SECCIONES_DELEGADAS: Readonly<Record<string, string>> = {
  panel_ui: 'Módulos',
  fiscal_data: 'Identidad fiscal',
};

/** Forma del catálogo de secciones que viaja en el envelope de settings. */
interface CatalogoSecciones {
  readonly known_sections: string[];
  readonly delegated_sections: Record<string, string>;
}

/**
 * Configuración de un tenant desde la consola de super admin.
 *
 * REGLA CENTRAL: el super admin escribe settings por el MISMO camino que el
 * comerciante. Cada handler delega en el `SettingsService` de tienda (o el de
 * organización, según el nivel resuelto) dentro de un contexto forjado por
 * `TenantContextRunner`, de modo que se aplican igual `sanitizeAndValidate`,
 * los guards de transición (`assertSettingsTransitionAllowed`) y
 * `ensureDefaults`.
 *
 * Esto tapa un agujero real: `PATCH /superadmin/stores/:id` acepta `settings`
 * en su DTO y los persiste crudos, saltándose el saneamiento, la validación de
 * secciones y los guards de transición —por ejemplo, el que impide apagar la
 * caja con sesiones abiertas—. Ese endpoint queda como está; este es el camino
 * que sí respeta las reglas del dominio.
 *
 * Los segmentos de alcance van en PLURAL (`stores` / `organizations`), igual
 * que en el resto del rail.
 */
@ApiTags('Super Admin - Consola de tenants')
@Controller('superadmin/tenants/:scope/:tenantId/settings')
@UseGuards(PermissionsGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class TenantSettingsController {
  constructor(
    private readonly runner: TenantContextRunner,
    private readonly storeSettings: StoreSettingsService,
    private readonly organizationSettings: OrganizationSettingsService,
    private readonly response: ResponseService,
  ) {}

  @Get()
  @Permissions('superadmin:tenants:settings:read')
  @ApiOperation({
    summary: 'Configuración del tenant',
    description:
      'Devuelve el nivel del que se leyó (store u organization) junto a los settings, porque en una organización de NIT único la configuración no vive en la tienda que nombra la URL.',
  })
  async get(
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
  ) {
    const resultado = await this.runner.runAsTenant(
      toTenantTarget(scope, tenantId),
      this.opciones(PERMISOS_LECTURA),
      async (resuelto) => {
        if (this.nivel(resuelto) === 'organization') {
          const settings = await this.leerSettingsOrganizacion();
          return {
            ...this.cabecera(resuelto, 'organization'),
            ...this.catalogo('organization', settings),
            settings,
          };
        }

        const settings = await this.storeSettings.getSettings();
        return {
          ...this.cabecera(resuelto, 'store'),
          ...this.catalogo('store', settings),
          settings,
        };
      },
    );

    return this.response.success(resultado, 'Configuración del tenant obtenida');
  }

  @Patch()
  @Permissions('superadmin:tenants:settings:write')
  @ApiOperation({
    summary: 'Actualizar la configuración del tenant',
    description:
      'Delega en el servicio de settings del tenant, así que pasa por el mismo saneamiento, la misma validación por sección y los mismos guards de transición que un cambio hecho desde el panel del comerciante.',
  })
  async update(
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Body() dto: TenantSettingsUpdateDto,
  ) {
    const resultado = await this.runner.runAsTenant(
      toTenantTarget(scope, tenantId),
      this.opciones(PERMISOS_ESCRITURA),
      async (resuelto) => {
        if (this.nivel(resuelto) === 'organization') {
          const settings = await this.actualizarSettingsOrganizacion(
            dto.settings,
          );
          return {
            ...this.cabecera(resuelto, 'organization'),
            ...this.catalogo('organization', settings),
            settings,
          };
        }

        await this.storeSettings.updateSettings(dto.settings);
        // Se relee como hace el controlador de tienda: `updateSettings`
        // devuelve el JSON persistido, no la proyección (branding → `app`,
        // URLs de S3 firmadas) que el consumidor espera.
        const settings = await this.storeSettings.getSettings();
        return {
          ...this.cabecera(resuelto, 'store'),
          // El catálogo también viaja en el PATCH: la consola repinta su estado
          // con lo que devuelve el guardado, y sin esto perdería la lista justo
          // después de escribir.
          ...this.catalogo('store', settings),
          settings,
        };
      },
    );

    return this.response.updated(resultado, 'Configuración del tenant actualizada');
  }

  @Get('fiscal-data')
  @Permissions('superadmin:tenants:settings:read')
  @ApiOperation({
    summary: 'Identidad legal/tributaria (fiscal_data) del tenant',
  })
  async getFiscalData(
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
  ) {
    const resultado = await this.runner.runAsTenant(
      toTenantTarget(scope, tenantId),
      this.opciones(PERMISOS_LECTURA),
      async (resuelto) => {
        const nivel = this.nivel(resuelto);
        const fiscal_data =
          nivel === 'organization'
            ? await this.organizationSettings.getFiscalData()
            : await this.storeSettings.getFiscalData();

        return { ...this.cabecera(resuelto, nivel), fiscal_data };
      },
    );

    return this.response.success(resultado, 'Identidad fiscal del tenant obtenida');
  }

  @Patch('fiscal-data')
  @Permissions('superadmin:tenants:settings:write')
  @ApiOperation({
    summary: 'Actualizar la identidad legal/tributaria del tenant',
    description:
      'Fusión parcial sobre `settings.fiscal_data`; el resto de secciones no se toca. En una organización de NIT único escribe en organization_settings, que es donde su propio panel lo lee.',
  })
  async updateFiscalData(
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Body() dto: TenantSettingsFiscalDataDto,
  ) {
    const payload = dto as unknown as Record<string, unknown>;

    const resultado = await this.runner.runAsTenant(
      toTenantTarget(scope, tenantId),
      this.opciones(PERMISOS_ESCRITURA),
      async (resuelto) => {
        const nivel = this.nivel(resuelto);
        const fiscal_data =
          nivel === 'organization'
            ? await this.organizationSettings.updateFiscalData(payload)
            : await this.storeSettings.updateFiscalData(payload);

        return { ...this.cabecera(resuelto, nivel), fiscal_data };
      },
    );

    return this.response.updated(resultado, 'Identidad fiscal del tenant actualizada');
  }

  // --------------------------------------------------------------------
  // Auxiliares
  // --------------------------------------------------------------------

  /**
   * Nivel del que cuelga la configuración del tenant.
   *
   * Misma decisión que `TenantDirectoryService.readSettings`: cuando la
   * organización factura con NIT único, los settings relevantes viven en
   * `organization_settings` aunque la URL nombre una tienda. `resolve()` ya
   * devuelve `store_id: null` en ese caso, así que el contexto forjado no
   * tiene tienda y el servicio de tienda ni siquiera podría resolverse.
   */
  private nivel(scope: ResolvedTenantScope): NivelSettings {
    return scope.fiscal_scope === 'ORGANIZATION' || scope.store_id == null
      ? 'organization'
      : 'store';
  }

  /**
   * Se devuelve en cada respuesta para que la consola nunca tenga que adivinar
   * qué fila acaba de leer o escribir: una organización consolidada responde
   * `level: 'organization'` aunque se haya entrado por `stores/:id`.
   */
  private cabecera(scope: ResolvedTenantScope, level: NivelSettings) {
    return {
      level,
      organization_id: scope.organization_id,
      store_id: scope.store_id,
      fiscal_scope: scope.fiscal_scope,
    };
  }

  /**
   * Catálogo de secciones que acompaña a los settings.
   *
   * EXISTE PORQUE LA CONSOLA MENTÍA: mantenía su propia copia de
   * `KNOWN_SECTIONS` y se quedó tres entradas corta (`accounting_flows`, `vexi`,
   * `app`). Resultado: marcaba esas secciones como descartadas por el saneador
   * y deshabilitaba «Guardar» sobre escrituras que el backend sí persiste. La
   * lista tiene un solo dueño —el saneador— y por eso viaja desde aquí en vez
   * de duplicarse en el cliente.
   *
   * A NIVEL ORGANIZACIÓN NO HAY LISTA BLANCA: `organization_settings` se
   * reemplaza entero (sólo se sanean las URLs de assets), así que cualquier
   * clave presente se conserva. Devolver ahí la lista de tienda a secas
   * repetiría el mismo defecto al revés, marcando como descartable algo que sí
   * se guarda; por eso se une con las claves realmente almacenadas, que son
   * exactamente las que la consola puede llegar a mostrar.
   */
  private catalogo(nivel: NivelSettings, settings: unknown): CatalogoSecciones {
    const base = [...KNOWN_SECTIONS] as string[];
    const presentes =
      nivel === 'organization' && settings && typeof settings === 'object'
        ? Object.keys(settings as Record<string, unknown>)
        : [];

    return {
      known_sections: [...new Set([...base, ...presentes])],
      delegated_sections: { ...SECCIONES_DELEGADAS },
    };
  }

  private opciones(permissions: string[]): RunAsTenantOptions {
    const ambient = RequestContextService.getContext();
    return {
      actor: { user_id: ambient?.user_id, email: ambient?.email },
      permissions,
    };
  }

  /**
   * Un tenant sin fila en `organization_settings` es un estado válido —nunca
   * guardó configuración—, no un 404. `findOne()` responde ORG_FIND_001 en ese
   * caso; cualquier otro error se re-lanza tal cual.
   */
  private async leerSettingsOrganizacion(): Promise<Record<string, unknown>> {
    try {
      const fila = await this.organizationSettings.findOne();
      return ((fila?.settings as Record<string, unknown>) ?? {});
    } catch (error) {
      if (
        error instanceof VendixHttpException &&
        error.errorCode === ErrorCodes.ORG_FIND_001.code
      ) {
        return {};
      }
      throw error;
    }
  }

  /**
   * `SettingsService.update()` de organización REEMPLAZA el JSON completo, así
   * que la fusión por sección de primer nivel se hace aquí; sin ella un PATCH
   * de una sección borraría branding, fonts, inventory y el resto.
   *
   * Las URLs firmadas que devuelve `findOne()` no se filtran a la base: el
   * propio `update()` las pasa por `sanitizeSettingsAssets`, que reextrae la
   * clave S3 de `branding.logo_url` y `branding.favicon_url`.
   */
  private async actualizarSettingsOrganizacion(
    parcial: Record<string, unknown>,
  ): Promise<unknown> {
    const actuales = await this.leerSettingsOrganizacion();
    const fusionados = { ...actuales, ...parcial };
    const resultado = await this.organizationSettings.update({
      settings: fusionados,
    });
    return resultado?.settings ?? fusionados;
  }
}
