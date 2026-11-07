import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideMockStore } from '@ngrx/store/testing';
import { NEVER, of, throwError } from 'rxjs';
import { CaptchaChallenge } from './workflow-captcha';
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
    api = jasmine.createSpyObj('WorkflowPublicFormService', ['get', 'submit', 'captcha', 'uploader']);
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

  it('muestra el flujo, el aviso de privacidad y los campos de archivo', async () => {
    setup();
    await render();
    expect(text()).toContain('Radicar solicitud');
    expect(text()).toContain('Usamos tus datos solo para');
    const shown = fixture.componentInstance.visibleFields().map((f) => f.key);
    expect(shown).toContain('asunto');
    expect(shown).toContain('soporte');
    expect(text()).toContain('Elegir archivo');
    expect(text()).not.toContain('Paso 1 de');
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
    api.submit.and.returnValue(of({ reference: 'FLU-000042', tracking_url: null }));
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
    api.submit.and.returnValue(of({ reference: 'FLU-000043', tracking_url: null }));
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
  describe('P3.4: pasos, captcha y enlace de seguimiento', () => {
    const STEPPED = {
      ...FORM,
      steps: [
        { title: 'Tu caso', fields: ['asunto', 'detalle'] },
        { title: 'Montos', fields: ['valor', 'soporte'] },
      ],
    } as unknown as PublicFormDefinition;

    it('muestra "Paso X de N", valida los obligatorios de la página y avanza y retrocede', async () => {
      api.get.and.returnValue(of(STEPPED));
      setup();
      await render();
      const c = fixture.componentInstance;
      expect(text()).toContain('Paso 1 de 2');
      expect(text()).toContain('Tu caso');
      expect(text()).toContain('Siguiente');
      expect(text()).not.toContain('Tus datos de contacto');
      c.next();
      await render();
      expect(text()).toContain('Paso 1 de 2');
      expect(text()).toContain('El campo "Asunto" es obligatorio.');
      c.setValue('asunto', 'Hola');
      c.next();
      await render();
      expect(text()).toContain('Paso 2 de 2');
      expect(text()).toContain('Montos');
      expect(text()).toContain('Tus datos de contacto');
      expect(text()).toContain('Atrás');
      c.back();
      await render();
      expect(text()).toContain('Paso 1 de 2');
    });

    it('al enviar con errores en una página anterior vuelve a ella', async () => {
      api.get.and.returnValue(of(STEPPED));
      setup();
      await render();
      const c = fixture.componentInstance;
      c.setValue('asunto', 'Hola');
      c.next();
      c.setValue('asunto', '');
      c.setContact('name', 'Ana');
      c.onAccept({ target: { checked: true } } as unknown as Event);
      c.submit();
      await render();
      expect(api.submit).not.toHaveBeenCalled();
      expect(c.stepIndex()).toBe(0);
    });

    it('con captcha_required resuelve la verificación antes de enviar y manda la prueba', async () => {
      const challenge: CaptchaChallenge = {
        challenge: 'c', salt: '0123456789abcdef0123456789abcdef', algorithm: 'SHA-256',
        difficulty: 4, expires_at: '2030-01-01T00:00:00.000Z', signature: 'firma',
      };
      api.get.and.returnValue(of({ ...FORM, captcha_required: true }));
      api.captcha.and.returnValue(of(challenge));
      api.submit.and.returnValue(of({ reference: 'FLU-000050', tracking_url: 'https://t.example/flujos/seguimiento/abc' }));
      setup();
      await render();
      const c = fixture.componentInstance;
      fillValid(c);
      c.submit();
      expect(c.verifying()).toBeTrue();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await render();
      const body = api.submit.calls.mostRecent().args[1];
      expect(body.captcha).toEqual(jasmine.objectContaining({ salt: challenge.salt, signature: 'firma' }));
      expect(Number.isInteger(body.captcha?.number)).toBeTrue();
      expect(c.verifying()).toBeFalse();
    });

    it('sin captcha_required no pide el reto', async () => {
      api.submit.and.returnValue(of({ reference: 'FLU-000051', tracking_url: null }));
      setup();
      await render();
      fillValid(fixture.componentInstance);
      fixture.componentInstance.submit();
      expect(api.captcha).not.toHaveBeenCalled();
      expect(api.submit.calls.mostRecent().args[1].captcha).toBeUndefined();
    });

    it('muestra el enlace de seguimiento con su botón de copiar', async () => {
      const url = 'https://t.example/flujos/seguimiento/abc';
      api.submit.and.returnValue(of({ reference: 'FLU-000052', tracking_url: url }));
      setup();
      await render();
      fillValid(fixture.componentInstance);
      fixture.componentInstance.submit();
      await render();
      expect(text()).toContain(url);
      const writeText = jasmine.createSpy('writeText').and.resolveTo();
      spyOnProperty(navigator, 'clipboard', 'get').and.returnValue({ writeText } as unknown as Clipboard);
      await fixture.componentInstance.copyLink();
      await render();
      expect(writeText).toHaveBeenCalledWith(url);
      expect(text()).toContain('Enlace copiado');
    });

    it('un campo de archivo obligatorio sin subir bloquea el envío', async () => {
      api.get.and.returnValue(
        of({ ...FORM, fields: FORM.fields.map((f) => (f.key === 'soporte' ? { ...f, required: true } : f)) }),
      );
      setup();
      await render();
      fillValid(fixture.componentInstance);
      fixture.componentInstance.submit();
      await render();
      expect(api.submit).not.toHaveBeenCalled();
      expect(text()).toContain('Sube el archivo "Soporte".');
    });
  });
});
