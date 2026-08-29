import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { DefaultPanelUIService } from '../services/default-panel-ui.service';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';

/**
 * Panel UI whitelist + deep-merge helpers.
 *
 * Decisión B.3-(b): el catálogo del frontend (`APP_MODULES`,
 * `store-module-catalog.constant`) vive en `apps/frontend` y el backend no
 * puede importarlo cruzando el boundary de apps, y `libs/shared-types` no lo
 * expone. La única fuente de verdad backend es `DefaultPanelUIService.PANEL_UI_FALLBACK`
 * (el mapa por `app_type` que siembra defaults). La whitelist de claves se
 * deriva de ese mapa, y el desajuste con el catálogo del frontend queda
 * registrado como deuda de mantenimiento dual (backend `PANEL_UI_FALLBACK` ↔
 * frontend `APP_MODULES`).
 *
 * `PANEL_UI_FALLBACK` es una propiedad privada de instancia (campo con literal
 * sin tocar la base de datos), así que se accede a ella por reflexión para no
 * modificar el servicio (solo lectura por alcance). `new DefaultPanelUIService(undefined)`
 * solo ejecuta el inicializador del campo; ningún método de Prisma se invoca.
 */
const FALLBACK_INSTANCE = new DefaultPanelUIService(
  undefined as unknown as GlobalPrismaService,
);

function readFallback(): Record<string, Record<string, boolean>> {
  return (FALLBACK_INSTANCE as unknown as {
    PANEL_UI_FALLBACK: Record<string, Record<string, boolean>>;
  }).PANEL_UI_FALLBACK;
}

/** `app_type` → lista de claves `panel_ui` permitidas (catálogo backend). */
export const PANEL_UI_ALLOWED_KEYS: Record<string, string[]> = Object.fromEntries(
  Object.entries(readFallback()).map(([appType, map]) => [
    appType,
    Object.keys(map),
  ]),
);

export function getAllowedPanelUiKeys(appType: string): string[] {
  return PANEL_UI_ALLOWED_KEYS[appType] ?? [];
}

export function isKnownPanelUiKey(appType: string, key: string): boolean {
  return getAllowedPanelUiKeys(appType).includes(key);
}

/**
 * Deep-merge de `panel_ui` por `app_type`.
 *
 * Tanto `users.service.updateConfiguration` como
 * `store-user-management.service.updatePanelUI` sobrescribían `panel_ui`
 * entero, pisándose entre sí sobre la misma columna `user_settings.config.panel_ui`
 * (un admin de organización guardando borraba en silencio la configuración por
 * app que guardó un store-admin, y viceversa — pérdida de datos, no un gap de
 * tipos). Esto fusiona por `app_type`: cada app_type recibe `{...existente,
 * ...entrante}`, los app_types no tocados se conservan y una lista legacy
 * plana (valores booleanos en el primer nivel) se descarta, alineado con el
 * contrato canónico anidado.
 */
export function mergePanelUiByAppType(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, Record<string, boolean>> | undefined,
): Record<string, Record<string, boolean>> {
  const result: Record<string, Record<string, boolean>> = {};

  // Clona los mapas por app_type ya persistidos (los valores de primer nivel
  // que son objetos). Los mapas legacy planos (valores booleanos en el primer
  // nivel) no son un `app_type` y se descartan por contrato.
  for (const [appType, map] of Object.entries(existing || {})) {
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      result[appType] = { ...(map as Record<string, boolean>) };
    }
  }

  // Fusiona el payload entrante, app_type por app_type, sin borrar lo demás.
  for (const [appType, map] of Object.entries(incoming || {})) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    result[appType] = { ...(result[appType] || {}), ...map };
  }

  return result;
}

/**
 * Validador de whitelist del shape canónico `panel_ui` anidado por `app_type`:
 * `{ STORE_ADMIN: { pos: true }, ORG_ADMIN: { dashboard: false } }`.
 *
 * - El primer nivel debe ser un `app_type` válido y su valor un objeto (la
 *   forma plana legacy `{ pos: false }` se rechaza: el contrato es anidado).
 * - Cada clave del mapa debe existir en la whitelist derivada de
 *   `PANEL_UI_FALLBACK` para ese `app_type`.
 *
 * Aplicado a `UserConfigDto.panel_ui` y `UpdateUserPanelUIDto.panel_ui`.
 */
@ValidatorConstraint({ name: 'panelUiWhitelist', async: false })
class PanelUiWhitelistConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value == null || typeof value !== 'object') return true;
    if (Array.isArray(value)) return false;
    const panelUi = value as Record<string, unknown>;

    for (const [appType, map] of Object.entries(panelUi)) {
      if (!map || typeof map !== 'object' || Array.isArray(map)) {
        // Forma plana legacy: no es el contrato anidado.
        return false;
      }
      const allowed = getAllowedPanelUiKeys(appType);
      for (const key of Object.keys(map as Record<string, unknown>)) {
        if (!allowed.includes(key)) return false;
      }
    }
    return true;
  }

  defaultMessage(_args: ValidationArguments): string {
    return (
      `panel_ui contiene claves que no pertenecen al catálogo del panel ` +
      `para el tipo de aplicación (claves permitidas por app_type en ` +
      `PANEL_UI_FALLBACK).`
    );
  }
}

export function PanelUiKeysWhitelist(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: PanelUiWhitelistConstraint,
    });
  };
}
