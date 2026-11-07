import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideMockStore } from '@ngrx/store/testing';
import { NEVER, of, throwError } from 'rxjs';
import { WorkflowTrackingComponent } from './workflow-tracking.component';
import { TrackingView, WorkflowTrackingService } from './workflow-tracking.service';

const VIEW: TrackingView = {
  store: { name: 'Tienda Uno' },
  reference: 'FLU-000007',
  flow: { name: 'Registro de proveedor' },
  status: 'active',
  current_stage: { name: 'Revisión' },
  started_at: '2026-11-01T10:00:00.000Z',
  entered_at: '2026-11-01T10:05:00.000Z',
  completed_at: null,
  timeline: [
    { type: 'started', label: 'Solicitud recibida', detail: null, at: '2026-11-01T10:00:00.000Z' },
    { type: 'stage', label: 'Pasó a «Revisión»', detail: null, at: '2026-11-01T10:05:00.000Z' },
  ],
  pending: [{ key: 'rut', label: 'RUT actualizado', accept: ['application/pdf'], max_size_mb: 5 }],
  can_reply: true,
};

describe('WorkflowTrackingComponent', () => {
  let fixture: ComponentFixture<WorkflowTrackingComponent>;
  let api: jasmine.SpyObj<WorkflowTrackingService>;
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const render = async () => {
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  };

  beforeEach(() => {
    api = jasmine.createSpyObj('WorkflowTrackingService', ['get', 'reply', 'uploader']);
    api.get.and.returnValue(of(VIEW));
    TestBed.configureTestingModule({
      imports: [WorkflowTrackingComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideMockStore({ initialState: { tenant: { domainConfig: null } } }),
        { provide: WorkflowTrackingService, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ token: 'tok-1' }) } } },
      ],
    });
    fixture = TestBed.createComponent(WorkflowTrackingComponent);
  });

  it('mientras carga lo avisa y pide el seguimiento de su enlace', async () => {
    api.get.and.returnValue(NEVER);
    await render();
    expect(text()).toContain('Cargando seguimiento...');
    expect(api.get).toHaveBeenCalledOnceWith('tok-1');
  });

  it('un enlace vencido o revocado dice "Este enlace no está disponible"', async () => {
    api.get.and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    await render();
    expect(text()).toContain('Este enlace no está disponible');
    expect(fixture.nativeElement.querySelector('[data-testid="reference"]')).toBeNull();
  });

  it('muestra referencia, estado, etapa, historial y lo que falta', async () => {
    await render();
    expect(text()).toContain('FLU-000007');
    expect(text()).toContain('En proceso');
    expect(text()).toContain('Revisión');
    expect(text()).toContain('Solicitud recibida');
    expect(text()).toContain('Falta: RUT actualizado');
    expect(text()).toContain('Subir documento');
    expect(text()).toContain('Responder a la tienda');
  });

  it('una solicitud cerrada no ofrece subir ni responder', async () => {
    api.get.and.returnValue(of({ ...VIEW, status: 'completed', pending: [], can_reply: false, completed_at: '2026-11-02T10:00:00.000Z' }));
    await render();
    expect(text()).toContain('Completada');
    expect(text()).not.toContain('Falta:');
    expect(text()).not.toContain('Responder a la tienda');
  });

  it('no envía un mensaje vacío y, con texto, lo manda y recarga', async () => {
    api.reply.and.returnValue(of({}));
    await render();
    const c = fixture.componentInstance;
    c.sendReply();
    await render();
    expect(api.reply).not.toHaveBeenCalled();
    expect(text()).toContain('Escribe tu mensaje.');
    c.onMessage('  Ya lo envié ');
    c.sendReply();
    await render();
    expect(api.reply).toHaveBeenCalledOnceWith('tok-1', 'Ya lo envié');
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(text()).toContain('Enviamos tu respuesta.');
  });

  it('rechaza un archivo más grande que el máximo del requisito sin llamar al servidor', async () => {
    await render();
    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'rut.pdf', { type: 'application/pdf' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [big] });
    fixture.componentInstance.onFile(VIEW.pending[0], { target: input } as unknown as Event);
    await render();
    expect(api.uploader).not.toHaveBeenCalled();
    expect(text()).toContain('El archivo supera el máximo de 5 MB.');
  });
});
