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

/**
 * apps-sistema-voz: las apps que el backend resuelve por clave (`is_system`)
 * se pueden editar o apagar, pero no borrar. La acción «Eliminar» queda
 * deshabilitada con la etiqueta «Del sistema» y un tooltip que lo explica.
 */
describe('AIEngineComponent — apps del sistema no se borran desde el panel', () => {
  let component: AIEngineComponent;
  let dialog: { confirm: jasmine.Spy };
  let toast: jasmine.SpyObj<ToastService>;

  const systemApp = {
    id: 5,
    key: 'vexi_voice_tts',
    name: 'Agentes — Voz: dictado (TTS)',
    is_system: true,
  } as AIEngineApp;
  const customApp = {
    id: 99,
    key: 'mi_app',
    name: 'Mi app',
    is_system: false,
  } as AIEngineApp;

  beforeEach(async () => {
    dialog = { confirm: jasmine.createSpy('confirm').and.resolveTo(false) };
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
        { provide: AIEngineService, useValue: {} },
        { provide: ToastService, useValue: toast },
        { provide: DialogService, useValue: dialog },
      ],
    })
      .overrideComponent(AIEngineComponent, {
        set: { template: '', imports: [] },
      })
      .compileComponents();

    component = TestBed.createComponent(AIEngineComponent).componentInstance;
  });

  function deleteAction() {
    const action = component.appTableActions.find((a) =>
      ['trash-2', 'lock'].includes(
        typeof a.icon === 'function' ? a.icon(customApp) : (a.icon ?? ''),
      ),
    );
    expect(action).withContext('acción de borrar').toBeDefined();
    return action!;
  }

  it('app del sistema: «Del sistema», deshabilitada y con tooltip', () => {
    const action = deleteAction();
    const label = action.label as (item: AIEngineApp) => string;
    const tooltip = action.tooltip as (item: AIEngineApp) => string;

    expect(label(systemApp)).toBe('Del sistema');
    expect(action.disabled!(systemApp)).toBeTrue();
    expect(tooltip(systemApp)).toBe(
      'La usa el sistema: puedes editarla o apagarla, pero no borrarla',
    );
  });

  it('app personalizada: sigue mostrando «Eliminar» habilitado', () => {
    const action = deleteAction();
    const label = action.label as (item: AIEngineApp) => string;

    expect(label(customApp)).toBe('Eliminar');
    expect(action.disabled!(customApp)).toBeFalse();
  });

  it('confirmDeleteApp de una app del sistema no abre el diálogo de borrado', () => {
    component.confirmDeleteApp(systemApp);

    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalled();
  });

  it('la columna Origen etiqueta la app como «Del sistema»', () => {
    const column = component.appTableColumns.find((c) => c.key === 'is_system');
    expect(column?.transform?.(true)).toBe('Del sistema');
    expect(column?.transform?.(false)).toBe('Personalizada');
  });
});
