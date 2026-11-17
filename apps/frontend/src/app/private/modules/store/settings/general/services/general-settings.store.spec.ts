import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';

import { GeneralSettingsStore } from './general-settings.store';
import { StoreSettingsService } from './store-settings.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { ConfigFacade } from '../../../../../../core/store/config';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { InvoicingService } from '../../../invoicing/services/invoicing.service';
import { ERROR_MESSAGES } from '../../../../../../core/utils/error-messages';
import { StoreSettings } from '../../../../../../core/models/store-settings.interface';

/**
 * QUI-563 Fase 3: Configuración general recuerda bajo qué tienda cargó sus
 * datos. Si el usuario cambia de tienda con la pantalla abierta, lo pendiente
 * es de la tienda anterior: se descarta y se recarga, nunca se guarda en la
 * tienda activa.
 */
describe('GeneralSettingsStore store switch (QUI-563)', () => {
  const settingsA = {
    general: { name: 'Tienda A' },
  } as unknown as StoreSettings;
  const settingsB = {
    general: { name: 'Tienda B' },
  } as unknown as StoreSettings;
  const mismatch = new HttpErrorResponse({
    status: 409,
    error: { error_code: 'STORE_SETTINGS_STORE_MISMATCH_001' },
  });

  let store: GeneralSettingsStore;
  let activeStoreId: number | null;
  let settingsService: jasmine.SpyObj<StoreSettingsService>;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(() => {
    activeStoreId = 10;
    settingsService = jasmine.createSpyObj<StoreSettingsService>(
      'StoreSettingsService',
      ['getActiveStoreId', 'getSettings', 'saveSettingsNow', 'uploadStoreLogo'],
    );
    settingsService.getActiveStoreId.and.callFake(() => activeStoreId);
    settingsService.getSettings.and.callFake(() =>
      of({ success: true, data: activeStoreId === 10 ? settingsA : settingsB }),
    );
    settingsService.saveSettingsNow.and.returnValue(
      of({ success: true, data: settingsA }),
    );
    toast = jasmine.createSpyObj<ToastService>('ToastService', [
      'warning',
      'error',
      'success',
    ]);

    TestBed.configureTestingModule({
      providers: [
        GeneralSettingsStore,
        { provide: StoreSettingsService, useValue: settingsService },
        { provide: ToastService, useValue: toast },
        { provide: ConfigFacade, useValue: { getCurrentConfig: () => null } },
        {
          provide: AuthFacade,
          useValue: {
            isRestaurant: signal(false),
            isHospitality: signal(false),
            isGym: signal(false),
            updateStoreLogo: jasmine.createSpy('updateStoreLogo'),
          },
        },
        { provide: InvoicingService, useValue: {} },
      ],
    });
    store = TestBed.inject(GeneralSettingsStore);
    store.loadSettings();
  });

  function editBeforeSwitch(): void {
    store.onSectionChange('general', { name: 'Editado en A' });
    store.onPendingAppLogo({ file: new File([''], 'a.png'), preview: 'x' });
  }

  it('sends the store the form was loaded under as expected_store_id', async () => {
    store.onSectionChange('general', { name: 'Editado en A' });

    await store.saveAllSettings();

    expect(settingsService.saveSettingsNow).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        general: jasmine.objectContaining({ name: 'Editado en A' }),
      }),
      { expected_store_id: 10 },
    );
  });

  it('after switching stores, saving drops the draft and loads the active store', async () => {
    editBeforeSwitch();
    activeStoreId = 20;

    await store.saveAllSettings();

    expect(settingsService.uploadStoreLogo).not.toHaveBeenCalled();
    expect(settingsService.saveSettingsNow).not.toHaveBeenCalled();
    expect(store.hasUnsavedChanges()).toBeFalse();
    expect(store.pendingAppLogo()).toBeNull();
    expect(store.isSaving()).toBeFalse();
    expect(toast.warning).toHaveBeenCalledWith(
      ERROR_MESSAGES['STORE_SETTINGS_STORE_MISMATCH_001'],
    );
    expect(settingsService.getSettings).toHaveBeenCalledWith({
      forceRefresh: true,
    });
    expect(store.settings()).toEqual(settingsB);
  });

  it('a 409 store mismatch from the backend drops the draft and reloads', async () => {
    settingsService.saveSettingsNow.and.returnValue(throwError(() => mismatch));
    store.onSectionChange('general', { name: 'Editado en A' });
    // The backend saw a token of another store; the local check could not.
    activeStoreId = null;
    settingsService.getSettings.and.returnValue(
      of({ success: true, data: settingsB }),
    );

    await store.saveAllSettings();

    expect(store.hasUnsavedChanges()).toBeFalse();
    expect(toast.warning).toHaveBeenCalledWith(
      ERROR_MESSAGES['STORE_SETTINGS_STORE_MISMATCH_001'],
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(settingsService.getSettings).toHaveBeenCalledWith({
      forceRefresh: true,
    });
    expect(store.settings()).toEqual(settingsB);
  });

  it('section autosave after switching stores does not write to the active store', () => {
    activeStoreId = 20;

    store.saveSectionNow('general', { name: 'Editado en A' } as never);

    expect(settingsService.saveSettingsNow).not.toHaveBeenCalled();
    expect(store.settings()).toEqual(settingsB);
  });

  it('section autosave sends expected_store_id for the same store', () => {
    store.saveSectionNow('general', { name: 'Editado en A' } as never);

    expect(settingsService.saveSettingsNow).toHaveBeenCalledOnceWith(
      { general: { name: 'Editado en A' } } as Partial<StoreSettings>,
      { expected_store_id: 10 },
    );
  });
});
