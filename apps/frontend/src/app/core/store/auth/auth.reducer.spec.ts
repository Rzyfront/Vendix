import * as AuthActions from './auth.actions';
import { authReducer, initialAuthState } from './auth.reducer';

describe('authReducer updateUserSettingsSuccess (QUI-998)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  const switched = {
    ...initialAuthState,
    user: { id: 1 } as any,
    tokens: { access_token: 'a', refresh_token: 'r' } as any,
    user_settings: { app_type: 'STORE_ADMIN', config: { panel_ui: {} } },
  };

  it('keeps the switched STORE_ADMIN environment when the server answers ORG_ADMIN', () => {
    const next = authReducer(
      switched,
      AuthActions.updateUserSettingsSuccess({
        user_settings: { app_type: 'ORG_ADMIN', config: { panel_ui: { STORE_ADMIN: { x: true } } } },
      }),
    );
    expect(next.user_settings.app_type).toBe('STORE_ADMIN');
    expect(next.user_settings.config.panel_ui.STORE_ADMIN.x).toBe(true);
    expect(localStorage.getItem('vendix_user_environment')).toBe('STORE_ADMIN');
  });

  it('uses the server settings when the store has no active app_type', () => {
    const next = authReducer(
      { ...switched, user_settings: null },
      AuthActions.updateUserSettingsSuccess({ user_settings: { app_type: 'ORG_ADMIN' } }),
    );
    expect(next.user_settings.app_type).toBe('ORG_ADMIN');
  });
});

/**
 * QUI-563 Fase 0: `restoreAuthState` lo despacha el cambio de tienda con el
 * contexto de la tienda destino. Nada de la tienda anterior puede sobrevivir:
 * ni sus `store_settings` ni su `default_panel_ui`, que antes se heredaba con
 * `default_panel_ui || state.default_panel_ui`.
 */
describe('authReducer restoreAuthState (QUI-563)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  const storeA = {
    ...initialAuthState,
    user: { id: 1, store: { id: 10 } } as any,
    tokens: { access_token: 'token-a', refresh_token: 'r' } as any,
    user_settings: { app_type: 'STORE_ADMIN', config: { panel_ui: {} } },
    store_settings: { general: { currency: 'COP' } },
    default_panel_ui: { STORE_ADMIN: { dispatch: true } },
  };

  const switchToB = {
    user: { id: 1, store: { id: 20 } },
    tokens: { access_token: 'token-b', refresh_token: 'r' },
    user_settings: { app_type: 'STORE_ADMIN', config: { panel_ui: {} } },
    store_settings: { general: { currency: 'USD' } },
    default_panel_ui: { STORE_ADMIN: { dispatch: false } },
    permissions: [],
    roles: [],
  };

  it('replaces the previous store context with the target store one', () => {
    const next = authReducer(storeA, AuthActions.restoreAuthState(switchToB));

    expect(next.store_settings).toEqual({ general: { currency: 'USD' } });
    expect(next.default_panel_ui).toEqual({ STORE_ADMIN: { dispatch: false } });
    const persisted = JSON.parse(localStorage.getItem('vendix_auth_state')!);
    expect(persisted.store_settings).toEqual({ general: { currency: 'USD' } });
    expect(persisted.default_panel_ui).toEqual({ STORE_ADMIN: { dispatch: false } });
  });

  it('never inherits default_panel_ui or store_settings from the previous store', () => {
    const { default_panel_ui, store_settings, ...withoutContext } = switchToB;

    const next = authReducer(
      storeA,
      AuthActions.restoreAuthState(withoutContext),
    );

    expect(next.default_panel_ui).toBeNull();
    expect(next.store_settings).toBeNull();
    const persisted = JSON.parse(localStorage.getItem('vendix_auth_state')!);
    expect(persisted.default_panel_ui).toBeNull();
    expect(persisted.store_settings).toBeNull();
  });

  it('keeps the persisted context when rehydrating the same session', () => {
    const next = authReducer(
      initialAuthState,
      AuthActions.restoreAuthState({
        user: storeA.user,
        tokens: storeA.tokens,
        user_settings: storeA.user_settings,
        store_settings: storeA.store_settings,
        default_panel_ui: storeA.default_panel_ui,
      }),
    );

    expect(next.store_settings).toEqual(storeA.store_settings);
    expect(next.default_panel_ui).toEqual(storeA.default_panel_ui);
    expect(next.is_authenticated).toBeTrue();
  });
});
