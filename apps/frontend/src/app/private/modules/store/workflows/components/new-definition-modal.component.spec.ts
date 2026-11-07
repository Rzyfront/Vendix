import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { of, throwError } from 'rxjs';
import { ToastService } from '../../../../../shared/components/index';
import { WorkflowsApiService } from '../services/workflows-api.service';
import { NewDefinitionModalComponent } from './new-definition-modal.component';

describe('NewDefinitionModalComponent', () => {
  let api: jasmine.SpyObj<WorkflowsApiService>;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(() => {
    api = jasmine.createSpyObj('WorkflowsApiService', ['createDefinition']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    TestBed.configureTestingModule({
      imports: [NewDefinitionModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideMockStore({ initialState: { tenant: { domainConfig: null } } }),
        { provide: WorkflowsApiService, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
    });
  });

  it('crea el borrador solo con el nombre, avisa, emite y se cierra', () => {
    const c = TestBed.createComponent(NewDefinitionModalComponent).componentInstance;
    const emitted: unknown[] = [];
    c.created.subscribe((r) => emitted.push(r));
    api.createDefinition.and.returnValue(of({ id: 9, name: 'Compras' }) as never);
    c.isOpen.set(true);
    c.onNameChange('  Compras  ');
    c.create();
    expect(api.createDefinition).toHaveBeenCalledWith({ name: 'Compras' });
    expect(toast.success).toHaveBeenCalled();
    expect(emitted).toEqual([{ id: 9, name: 'Compras' }]);
    expect(c.isOpen()).toBeFalse();
  });

  it('sin nombre no llama al servidor', () => {
    const c = TestBed.createComponent(NewDefinitionModalComponent).componentInstance;
    c.onNameChange('   ');
    c.create();
    expect(api.createDefinition).not.toHaveBeenCalled();
  });

  it('un error del servidor se muestra y el modal sigue abierto', () => {
    const c = TestBed.createComponent(NewDefinitionModalComponent).componentInstance;
    api.createDefinition.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'Sin permiso' } })) as never,
    );
    c.isOpen.set(true);
    c.onNameChange('Compras');
    c.create();
    expect(c.error()).toBeTruthy();
    expect(c.isOpen()).toBeTrue();
    expect(c.creating()).toBeFalse();
  });
});
