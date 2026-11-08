import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { WorkflowLiveEvent } from '../interfaces/workflow-board.interfaces';
import { LIVE_DEBOUNCE_MS, WorkflowLiveService } from './workflow-live.service';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(m: MessageEvent) => void>>();
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (m: MessageEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), cb]);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data: unknown): void {
    (this.listeners.get(type) ?? []).forEach((cb) => cb({ data } as MessageEvent));
  }
}

describe('WorkflowLiveService', () => {
  let service: WorkflowLiveService;
  const realEventSource = window.EventSource;

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate();
    FakeEventSource.instances = [];
    (window as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    localStorage.setItem('vendix_auth_state', JSON.stringify({ tokens: { access_token: 'tok en' } }));
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    service = TestBed.inject(WorkflowLiveService);
  });

  afterEach(() => {
    jasmine.clock().uninstall();
    (window as unknown as { EventSource: unknown }).EventSource = realEventSource;
    localStorage.removeItem('vendix_auth_state');
  });

  it('abre un solo EventSource con el token y lo cierra cuando no quedan suscriptores', () => {
    const a = service.events$.subscribe();
    const b = service.events$.subscribe();
    expect(FakeEventSource.instances.length).toBe(1);
    expect(FakeEventSource.instances[0].url).toContain('/store/workflows/live/stream?token=tok%20en');
    a.unsubscribe();
    expect(FakeEventSource.instances[0].closed).toBeFalse();
    b.unsubscribe();
    expect(FakeEventSource.instances[0].closed).toBeTrue();
  });

  it('emite los eventos con ids y descarta los mal formados', () => {
    const seen: WorkflowLiveEvent[] = [];
    const sub = service.events$.subscribe((e) => seen.push(e));
    const es = FakeEventSource.instances[0];
    es.emit('workflow', JSON.stringify({ instance_id: 5, task_id: 8, kind: 'task' }));
    es.emit('workflow', 'no json');
    es.emit('workflow', JSON.stringify({ instance_id: '5', kind: 'event' }));
    es.emit('workflow', JSON.stringify({ instance_id: 5, kind: 'otro' }));
    expect(seen).toEqual([{ kind: 'task', instance_id: 5, task_id: 8 }]);
    sub.unsubscribe();
  });

  it('reconecta con espera y avisa resync al reabrir', () => {
    const seen: WorkflowLiveEvent[] = [];
    const sub = service.events$.subscribe((e) => seen.push(e));
    FakeEventSource.instances[0].onerror?.();
    expect(FakeEventSource.instances[0].closed).toBeTrue();
    expect(FakeEventSource.instances.length).toBe(1);
    jasmine.clock().tick(1000);
    expect(FakeEventSource.instances.length).toBe(2);
    FakeEventSource.instances[1].onopen?.();
    expect(seen).toEqual([{ kind: 'resync', instance_id: null }]);
    sub.unsubscribe();
  });

  it('changes() filtra por la solicitud y junta ráfagas en una sola lectura', () => {
    const seen: WorkflowLiveEvent[] = [];
    const sub = service.changes((e) => e.instance_id === 5).subscribe((e) => seen.push(e));
    const es = FakeEventSource.instances[0];
    es.emit('workflow', JSON.stringify({ instance_id: 9, kind: 'event' }));
    es.emit('workflow', JSON.stringify({ instance_id: 5, kind: 'event' }));
    es.emit('workflow', JSON.stringify({ instance_id: 5, kind: 'task', task_id: 1 }));
    jasmine.clock().tick(LIVE_DEBOUNCE_MS);
    expect(seen.length).toBe(1);
    expect(seen[0].instance_id).toBe(5);
    sub.unsubscribe();
  });
});
