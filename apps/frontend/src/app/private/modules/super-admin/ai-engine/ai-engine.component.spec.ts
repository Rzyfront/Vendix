import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of, throwError } from 'rxjs';
import { AIEngineComponent } from './ai-engine.component';
import { AIEngineService } from './services/ai-engine.service';
import {
  DialogService,
  ToastService,
} from '../../../../shared/components/index';
import { NETWORK_ERROR_MESSAGE } from '../../../../core/utils/api-error-handler';
import { initializeAppFailure } from '../../../../core/store/config/config.actions';
import { AIEngineApp } from './interfaces';

/**
 * Incidente 2026-11-23: una prueba con 400 y un guardado que no salió del
 * navegador terminaron en la pantalla global del gato. Contrato: los errores
 * de probar/guardar una aplicación se quedan en esta pantalla (toast) y nunca
 * disparan el fallo global de arranque (`initializeAppFailure` → gato).
 */
describe('AIEngineComponent — errores de probar/guardar se quedan en la pantalla', () => {
  let component: AIEngineComponent;
  let service: jasmine.SpyObj<AIEngineService>;
  let toast: jasmine.SpyObj<ToastService>;
  let store: MockStore;

  const app37 = { id: 37, key: 'vex_analysis' } as AIEngineApp;

  beforeEach(async () => {
    service = jasmine.createSpyObj<AIEngineService>('AIEngineService', [
      'testApp',
      'updateApp',
      'createApp',
    ]);
    toast = jasmine.createSpyObj<ToastService>('ToastService', [
      'success',
      'error',
      'warning',
      'info',
    ]);

    await TestBed.configureTestingModule({
      imports: [AIEngineComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideMockStore(),
        { provide: AIEngineService, useValue: service },
        { provide: ToastService, useValue: toast },
        { provide: DialogService, useValue: {} },
      ],
    })
      .overrideComponent(AIEngineComponent, {
        set: { template: '', imports: [] },
      })
      .compileComponents();

    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');
    component = TestBed.createComponent(AIEngineComponent).componentInstance;
  });

  function expectNoGlobalCat(): void {
    expect(store.dispatch).not.toHaveBeenCalledWith(
      jasmine.objectContaining({ type: initializeAppFailure.type }),
    );
  }

  it('400 de la prueba → toast con el motivo, sin gato', () => {
    service.testApp.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              success: false,
              message: 'La aplicación está desactivada.',
            },
          }),
      ),
    );

    component.testAppExecution(app37);

    expect(toast.error).toHaveBeenCalledWith('La aplicación está desactivada.');
    expect(component.isTestingApp()).toBeNull();
    expectNoGlobalCat();
  });

  it('prueba con success:false (contrato nuevo del backend) → toast, sin gato', () => {
    service.testApp.and.returnValue(
      of({
        success: false,
        error: 'El proveedor de IA no respondió en 90 s.',
      }),
    );

    component.testAppExecution(app37);

    expect(toast.error).toHaveBeenCalledWith(
      'Test fallo: El proveedor de IA no respondió en 90 s.',
    );
    expectNoGlobalCat();
  });

  it('status 0 aislado al guardar → toast de conexión legible, sin gato', () => {
    component.selectedApp.set(app37);
    service.updateApp.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 0,
            error: new TypeError('Failed to fetch'),
          }),
      ),
    );

    component.saveApp({ name: 'Vex' });

    expect(toast.error).toHaveBeenCalledWith(NETWORK_ERROR_MESSAGE);
    expect(component.isSubmittingApp()).toBeFalse();
    expectNoGlobalCat();
  });
});
