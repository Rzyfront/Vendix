import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideMockStore } from '@ngrx/store/testing';
import { NEVER, of, throwError } from 'rxjs';
import { WorkflowPublicFormComponent } from './workflow-public-form.component';
import {
  PublicFormDefinition,
  WorkflowPublicFormService,
} from './workflow-public-form.service';

const FORM: PublicFormDefinition = {
  available: true,
  store: { name: 'Tienda Uno' },
  flow: { name: 'Radicar solicitud', description: 'Cuéntanos qué necesitas.' },
  privacy_notice: 'Usamos tus datos solo para atender esta solicitud.',
  fields: [
    { key: 'asunto', type: 'text', label: 'Asunto', required: true },
    {
      key: 'detalle',
      type: 'textarea',
      label: 'Detalle',
      visible_when: { all: [{ field: 'asunto', op: 'is_not_empty' }] },
    },
    { key: 'valor', type: 'number', label: 'Valor' },
    { key: 'soporte', type: 'file', label: 'Soporte' },
  ],
} as unknown as PublicFormDefinition;

describe('WorkflowPublicFormComponent', () => {
  let fixture: ComponentFixture<WorkflowPublicFormComponent>;
  let api: jasmine.SpyObj<WorkflowPublicFormService>;

  const http = (status: number) => new HttpErrorResponse({ status, error: { message: 'x' } });
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const render = async () => {
    // Not whenStable: the shared currency service keeps an HTTP request open.
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  };

  function setup() {
    fixture = TestBed.createComponent(WorkflowPublicFormComponent);
  }

  function fillValid(component: WorkflowPublicFormComponent) {
    component.setValue('asunto', 'Cambio de datos');
    component.setContact('name', 'Ana Pérez');
    component.onAccept({ target: { checked: true } } as unknown as Event);
  }

  beforeEach(() => {
    api = jasmine.createSpyObj('WorkflowPublicFormService', ['get', 'submit']);
    api.get.and.returnValue(of(FORM));
    TestBed.configureTestingModule({
      imports: [WorkflowPublicFormComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideMockStore({ initialState: { tenant: { domainConfig: null } } }),
        { provide: WorkflowPublicFormService, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ token: 'tok-1' }) } },
        },
      ],
    });
  });

  it('mientras carga muestra el aviso y pide el formulario de su enlace', async () => {
    api.get.and.returnValue(NEVER);
    setup();
    await render();
    expect(text()).toContain('Cargando formulario...');
    expect(api.get).toHaveBeenCalledOnceWith('tok-1');
  });

  it('un enlace inexistente o desactivado lo dice sin mostrar el formulario', async () => {
    api.get.and.returnValue(throwError(() => http(404)));
    setup();
    await render();
    expect(text()).toContain('Este enlace no existe o fue desactivado');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('un error de red muestra el motivo y no un formulario vacío', async () => {
    api.get.and.returnValue(throwError(() => http(0)));
    setup();
    await render();
    expect(text()).toContain('No pudimos cargar el formulario');
    expect(text()).toContain('Sin conexión');
  });

  it('un flujo apagado se muestra como no disponible, con el nombre de la tienda', async () => {
    api.get.and.returnValue(of({ ...FORM, available: false }));
    setup();
    await render();
    expect(text()).toContain('Este formulario no está disponible por ahora');
    expect(text()).toContain('Tienda Uno');
  });

  it('muestra el flujo, el aviso de privacidad y omite los campos de archivo', async () => {
    setup();
    await render();
    expect(text()).toContain('Radicar solicitud');
    expect(text()).toContain('Usamos tus datos solo para');
    const shown = fixture.componentInstance.visibleFields().map((f) => f.key);
    expect(shown).toContain('asunto');
    expect(shown).not.toContain('soporte');
  });

  it('un campo condicional aparece al cumplirse su condición', async () => {
    setup();
    await render();
    const c = fixture.componentInstance;
    expect(c.visibleFields().map((f) => f.key)).not.toContain('detalle');
    c.setValue('asunto', 'Hola');
    expect(c.visibleFields().map((f) => f.key)).toContain('detalle');
  });

  it('sin obligatorios ni aceptación no envía y explica cada error en pantalla', async () => {
    setup();
    await render();
    const c = fixture.componentInstance;
    c.submit();
    await render();
    expect(api.submit).not.toHaveBeenCalled();
    expect(text()).toContain('El campo "Asunto" es obligatorio.');
    expect(text()).toContain('Escribe tu nombre.');
    expect(text()).toContain('Debes aceptar el aviso de privacidad.');
  });

  it('un valor numérico inválido y un correo inválido bloquean el envío', async () => {
    setup();
    await render();
    const c = fixture.componentInstance;
    fillValid(c);
    c.setValue('valor', 'abc');
    c.setContact('email', 'no-es-correo');
    c.submit();
    await render();
    expect(api.submit).not.toHaveBeenCalled();
    expect(text()).toContain('debe ser un número válido');
    expect(text()).toContain('Escribe un correo válido.');
  });

  it('al enviar muestra la referencia y manda solo lo visible, sin contacto vacío', async () => {
    api.submit.and.returnValue(of({ reference: 'FLU-000042' }));
    setup();
    await render();
    const c = fixture.componentInstance;
    fillValid(c);
    c.setValue('valor', '12,5');
    c.submit();
    await render();
    const [token, body] = api.submit.calls.mostRecent().args;
    expect(token).toBe('tok-1');
    expect(body.values).toEqual({ asunto: 'Cambio de datos', valor: 12.5 });
    expect(body.contact).toEqual({ name: 'Ana Pérez' });
    expect(body.accept_privacy).toBeTrue();
    expect(text()).toContain('Recibimos tu solicitud');
    expect(text()).toContain('FLU-000042');
  });

  it('un doble clic no envía dos veces', async () => {
    api.submit.and.returnValue(NEVER);
    setup();
    await render();
    const c = fixture.componentInstance;
    fillValid(c);
    c.submit();
    c.submit();
    expect(api.submit).toHaveBeenCalledTimes(1);
    await render();
    expect(text()).toContain('Enviando...');
  });

  it('tras un 429 avisa, deja reintentar y reutiliza el mismo submission_id', async () => {
    api.submit.and.returnValue(throwError(() => http(429)));
    setup();
    await render();
    const c = fixture.componentInstance;
    fillValid(c);
    c.submit();
    await render();
    expect(text()).toContain('Demasiados envíos; intenta en un minuto.');
    const first = api.submit.calls.mostRecent().args[1].submission_id;
    api.submit.and.returnValue(of({ reference: 'FLU-000043' }));
    c.submit();
    await render();
    expect(api.submit.calls.mostRecent().args[1].submission_id).toBe(first);
    expect(text()).toContain('FLU-000043');
  });

  it('si el enlace se desactiva durante el envío pasa a "no existe"', async () => {
    api.submit.and.returnValue(throwError(() => http(404)));
    setup();
    await render();
    const c = fixture.componentInstance;
    fillValid(c);
    c.submit();
    await render();
    expect(text()).toContain('Este enlace no existe o fue desactivado');
  });
});
