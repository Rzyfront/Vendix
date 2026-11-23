import { TestBed } from '@angular/core/testing';
import { provideHttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { MyNotificationsComponent } from './my-notifications.component';
import {
  MyNotificationsService,
  NotificationPreferences,
  describeTestError,
  describeTestResult,
} from './my-notifications.service';
import { PushSubscriptionService } from '../../../../core/services/push-subscription.service';
import { environment } from '../../../../../environments/environment';

const BASE = `${environment.apiUrl}/store/notifications`;

const PREFS: NotificationPreferences = {
  groups: [
    {
      key: 'crm',
      label: 'CRM',
      types: [
        {
          type: 'crm_task_assigned',
          label: 'Tarea asignada',
          description: 'Cuando te asignan una tarea.',
          channels: { push: true, email: true },
          defaults: { push: true, email: false },
          effective: { push: true, email: false },
          customized: false,
        },
        {
          type: 'crm_task_digest',
          label: 'Resumen diario',
          description: 'Resumen de tareas del dia.',
          channels: { push: false, email: true },
          defaults: { push: false, email: false },
          effective: { push: false, email: false },
          customized: false,
        },
      ],
    },
  ],
  store_email_enabled: true,
  user_email: 'j***@correo.com',
};

describe('MyNotificationsService', () => {
  let service: MyNotificationsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MyNotificationsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('mapea GET /preferences desde la respuesta envuelta', () => {
    let result: NotificationPreferences | undefined;
    service.getPreferences().subscribe((r) => (result = r));
    http.expectOne(`${BASE}/preferences`).flush({ success: true, data: PREFS });
    expect(result?.groups[0].types.length).toBe(2);
    expect(result?.store_email_enabled).toBeTrue();
    expect(result?.user_email).toBe('j***@correo.com');
  });

  it('PATCH /subscriptions envia in_app para Dispositivo y email para Correo', () => {
    service.updatePreference('crm_task_assigned', 'push', true).subscribe();
    const push = http.expectOne(`${BASE}/subscriptions`);
    expect(push.request.method).toBe('PATCH');
    expect(push.request.body).toEqual({ type: 'crm_task_assigned', in_app: true });
    push.flush({});

    service.updatePreference('crm_task_assigned', 'email', true).subscribe();
    const email = http.expectOne(`${BASE}/subscriptions`);
    expect(email.request.body).toEqual({ type: 'crm_task_assigned', email: true });
    email.flush({});
  });

  it('la prueba arma el mensaje de exito y el de 429', () => {
    const ok = describeTestResult({
      push: { enabled: true, devices: 2 },
      email: { status: 'sent', to: 'j***@correo.com' },
    });
    expect(ok.variant).toBe('success');
    expect(ok.message).toBe('Prueba enviada: a 2 dispositivos y a j***@correo.com');

    const off = describeTestResult({
      push: { enabled: false, devices: 0 },
      email: { status: 'store_disabled', to: null },
    });
    expect(off.message).toContain('No tienes ningún aviso encendido para dispositivo');
    expect(off.message).toContain('Correo apagado para la tienda');

    const limited = new HttpErrorResponse({ status: 429 });
    expect(describeTestError(limited)).toBe(
      'Espera unos segundos antes de otra prueba',
    );
  });
});

describe('MyNotificationsComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [MyNotificationsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: PushSubscriptionService,
          useValue: {
            isSupported: false,
            permissionState: 'denied',
            requestPermissionAndSubscribe: () => Promise.resolve(false),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  it('un tipo con channels.email=false no ofrece el interruptor de correo', () => {
    const fixture = TestBed.createComponent(MyNotificationsComponent);
    fixture.detectChanges();
    http.expectOne(`${BASE}/preferences`).flush({
      success: true,
      data: {
        ...PREFS,
        groups: [
          {
            ...PREFS.groups[0],
            types: [
              {
                ...PREFS.groups[0].types[0],
                channels: { push: true, email: false },
              },
            ],
          },
        ],
      },
    });
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[aria-label="Dispositivo: Tarea asignada"]')).not.toBeNull();
    expect(root.querySelector('[aria-label="Correo: Tarea asignada"]')).toBeNull();
    expect(root.querySelector('[title="Este aviso no se envía por correo"]')).not.toBeNull();
  });
});
