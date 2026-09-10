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
 * Panel UI shape validator + deep-merge helpers.
 *
 * `DefaultPanelUIService.PANEL_UI_FALLBACK` es la fuente de defaults (el mapa
 * por `app_type` que siembra valores iniciales), NO una whitelist: `panel_ui`
 * es solo visibilidad, no autorización, así que cualquier `app_type` y
 * cualquier clave de módulo se acepta. El validador solo exige el contrato de
 * forma (mapa anidado por `app_type` con hojas booleanas).
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
 * Validador de forma del shape canónico `panel_ui` anidado por `app_type`:
 * `{ STORE_ADMIN: { pos: true }, ORG_ADMIN: { dashboard: false } }`.
 *
 * - Valor nulo/no-objeto en el nivel superior: se acepta (`@IsObject` decide
 *   presencia); arrays se rechazan.
 * - Cada valor por `app_type` debe ser un objeto no-array (la forma plana
 *   legacy `{ pos: false }` se rechaza: el contrato es anidado).
 * - Cualquier `app_type` y cualquier clave de módulo se acepta (`panel_ui`
 *   es solo visibilidad, no autorización: sin whitelist).
 * - Cada valor hoja debe ser booleano.
 *
 * Aplicado a `UserConfigDto.panel_ui` y `UpdateUserPanelUIDto.panel_ui`.
 */
@ValidatorConstraint({ name: 'panelUiWhitelist', async: false })
class PanelUiWhitelistConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value == null || typeof value !== 'object') return true;
    if (Array.isArray(value)) return false;
    const panelUi = value as Record<string, unknown>;

    for (const [, map] of Object.entries(panelUi)) {
      if (!map || typeof map !== 'object' || Array.isArray(map)) {
        // Forma plana legacy: no es el contrato anidado.
        return false;
      }
      for (const leaf of Object.values(map as Record<string, unknown>)) {
        if (typeof leaf !== 'boolean') return false;
      }
    }
    return true;
  }

  defaultMessage(_args: ValidationArguments): string {
    return (
      `panel_ui debe ser un objeto anidado por app_type ` +
      `({ STORE_ADMIN: { pos: true } }) con valores hoja booleanos.`
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
