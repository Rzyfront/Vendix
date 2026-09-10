import 'reflect-metadata';
import { validate } from 'class-validator';
import { PanelUiKeysWhitelist } from './panel-ui.util';

/**
 * Contrato de validación de `panel_ui` (SYS_VALIDATION_001).
 *
 * `panel_ui` es solo visibilidad, no autorización: el validador solo exige
 * forma (mapa anidado por `app_type` con hojas booleanas). Cualquier
 * `app_type` y cualquier clave de módulo se acepta — la whitelist contra
 * `PANEL_UI_FALLBACK` se eliminó porque seeds/template/DB producen claves
 * fuera del fallback (extras de ORG_ADMIN como `roles`/`reports_sales`,
 * mapas de `VENDIX_ADMIN`, `app_type` `STORE_DELIVERY`) y cada guardado
 * desde `PATCH /store/users/management/:id/panel-ui` respondía 400.
 *
 * El DTO mínimo replica el uso real (`UserConfigDto.panel_ui` y
 * `UpdateUserPanelUIDto.panel_ui`: `@IsOptional() @IsObject()` +
 * `@PanelUiKeysWhitelist()`), pero solo porta el decorador bajo prueba para
 * fijar su comportamiento aislado. La presencia la posee `@IsObject` en los
 * DTOs reales; aquí `null`/`undefined` deben pasar por el constraint mismo.
 */
class PanelUiProbeDto {
  @PanelUiKeysWhitelist()
  panel_ui?: unknown;
}

const validatePanelUi = (panel_ui: unknown) => {
  const dto = new PanelUiProbeDto();
  dto.panel_ui = panel_ui;
  return validate(dto);
};

describe('PanelUiKeysWhitelist (contrato de forma, sin whitelist)', () => {
  it('acepta claves de módulo desconocidas (fuera de PANEL_UI_FALLBACK)', async () => {
    const errors = await validatePanelUi({
      STORE_ADMIN: { modulo_inventado_xyz: true, otro_modulo: false },
    });
    expect(errors).toHaveLength(0);
  });

  it.each(['STORE_DELIVERY', 'VENDIX_ADMIN'])(
    'acepta el app_type desconocido "%s" con hojas booleanas',
    async (appType) => {
      const errors = await validatePanelUi({
        [appType]: { deliveries: true, history: false },
      });
      expect(errors).toHaveLength(0);
    },
  );

  it('rechaza la forma plana legacy { pos: true } (el contrato es anidado)', async () => {
    const errors = await validatePanelUi({ pos: true });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('panel_ui');
    expect(errors[0].constraints).toHaveProperty('panelUiWhitelist');
  });

  it('rechaza un valor superior que sea array', async () => {
    const errors = await validatePanelUi([{ STORE_ADMIN: { pos: true } }]);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('panel_ui');
  });

  it.each([
    ['string', 'no-soy-un-objeto'],
    ['boolean', true],
    ['array', [{ pos: true }]],
    ['null', null],
  ])('rechaza un mapa de app que no es objeto (%s)', async (_label, map) => {
    const errors = await validatePanelUi({ STORE_ADMIN: map });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('panel_ui');
  });

  it.each([
    ['string', 'yes'],
    ['number', 1],
    ['objeto', { nested: true }],
    ['array', [true]],
  ])('rechaza una hoja no booleana (%s)', async (_label, leaf) => {
    const errors = await validatePanelUi({ STORE_ADMIN: { pos: leaf } });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('panel_ui');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('acepta el valor superior %s (laxo: la presencia la posee @IsObject)', async (
    _label,
    panel_ui,
  ) => {
    const errors = await validatePanelUi(panel_ui);
    expect(errors).toHaveLength(0);
  });

  it('acepta un payload realista de owner semillado (extras ORG_ADMIN + claves STORE_ADMIN)', async () => {
    // `roles` y `reports_sales` no existen en el ORG_ADMIN del fallback, e
    // `inventory`/`billing` tampoco pertenecen a ese app_type: con la
    // whitelist anterior este payload respondía SYS_VALIDATION_001 (400).
    const errors = await validatePanelUi({
      ORG_ADMIN: {
        dashboard: true,
        stores: true,
        users: true,
        analytics: true,
        reports: true,
        reports_sales: true,
        inventory: true,
        billing: false,
        roles: true,
      },
      STORE_ADMIN: {
        dashboard: true,
        pos: true,
        products: true,
        products_list: true,
        orders: true,
        inventory: true,
        customers: true,
        settings: true,
      },
    });
    expect(errors).toHaveLength(0);
  });
});
