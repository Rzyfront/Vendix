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
