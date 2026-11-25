import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';

import {
  VexDesignChatService,
  VexDesignStreamChunk,
} from './vex-design-chat.service';

class FakeEventSource {
  private readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  closeCalls = 0;

  constructor(public readonly url: string) {}

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  emit(type: string, data: unknown): void {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: payload } as MessageEvent);
    }
  }

  triggerError(): void {
    this.onerror?.(new Event('error'));
  }

  close(): void {
    this.closed = true;
    this.closeCalls += 1;
  }
}

describe('VexDesignChatService · ciclo de vida de EventSource (F4)', () => {
  let service: VexDesignChatService;
  const authKey = 'vendix_auth_state';
  let originalAuth: string | null;

  beforeEach(() => {
    originalAuth = localStorage.getItem(authKey);
    localStorage.setItem(
      authKey,
      JSON.stringify({ tokens: { access_token: 'jwt-test-token' } }),
    );

    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideHttpClient()],
    });
    service = TestBed.inject(VexDesignChatService);
  });

  afterEach(() => {
    if (originalAuth === null) {
      localStorage.removeItem(authKey);
    } else {
      localStorage.setItem(authKey, originalAuth);
    }
  });

  it('emite frames y cierra EventSource y completa el stream al recibir done', () => {
    let fakeSource!: FakeEventSource;
    const chunks: VexDesignStreamChunk[] = [];
    let completed = false;

    service
      .streamDesign('product_page', 42, 'stream-done', (url) => {
        fakeSource = new FakeEventSource(url);
        return fakeSource as unknown as EventSource;
      })
      .subscribe({
        next: (c) => chunks.push(c),
        complete: () => (completed = true),
      });

    expect(fakeSource.url).toContain('/store/apps/design-chat/product_page/stream');
    expect(fakeSource.url).toContain('conversation_id=42');
    expect(fakeSource.url).toContain('stream_id=stream-done');

    fakeSource.emit('ai-chunk', { type: 'text', content: 'Listo' });
    fakeSource.emit('ai-chunk', { type: 'done' });
    // Un evento posterior tras el cierre no debe re-emitirse.
    fakeSource.emit('ai-chunk', { type: 'text', content: 'tardío' });

    expect(chunks.map((c) => c.type)).toEqual(['text', 'done']);
    expect(completed).toBe(true);
    expect(fakeSource.closed).toBe(true);
    expect(fakeSource.closeCalls).toBe(1);
  });

  it('emite el frame error, cierra EventSource y completa el observable', () => {
    let fakeSource!: FakeEventSource;
    const chunks: VexDesignStreamChunk[] = [];
    let completed = false;

    service
      .streamDesign('booking', 9, 'stream-err-frame', (url) => {
        fakeSource = new FakeEventSource(url);
        return fakeSource as unknown as EventSource;
      })
      .subscribe({
        next: (c) => chunks.push(c),
        complete: () => (completed = true),
      });

    fakeSource.emit('ai-chunk', {
      type: 'error',
      error: 'El stream no corresponde a esta app.',
    });

    expect(chunks).toEqual([
      { type: 'error', error: 'El stream no corresponde a esta app.' },
    ]);
    expect(completed).toBe(true);
    expect(fakeSource.closed).toBe(true);
    expect(fakeSource.closeCalls).toBe(1);
  });

  it('cierra EventSource y propaga error cuando dispara source.onerror', () => {
    let fakeSource!: FakeEventSource;
    const errors: Error[] = [];

    service
      .streamDesign('service_page', 12, 'stream-net-err', (url) => {
        fakeSource = new FakeEventSource(url);
        return fakeSource as unknown as EventSource;
      })
      .subscribe({
        error: (err: Error) => (receivedError = err),
      });

    fakeSource.triggerError();
    // Un segundo onerror tras cerrar no debe volver a cerrar ni fallar.
    fakeSource.triggerError();

    expect(receivedError).toBeTruthy();
    expect(receivedError!.message).toContain('interrumpió la conexión');
    expect(fakeSource.closed).toBe(true);
    expect(fakeSource.closeCalls).toBe(1);
  });

  it('cierra EventSource al desuscribirse (botón Detener / destrucción)', () => {
    let fakeSource!: FakeEventSource;
    const chunks: VexDesignStreamChunk[] = [];

    const sub = service
      .streamDesign('product_page', 55, 'stream-unsub', (url) => {
        fakeSource = new FakeEventSource(url);
        return fakeSource as unknown as EventSource;
      })
      .subscribe({
        next: (c) => chunks.push(c),
      });

    fakeSource.emit('ai-chunk', { type: 'text', content: 'Parcial' });
    sub.unsubscribe();
    fakeSource.emit('ai-chunk', { type: 'text', content: 'Después de detener' });

    expect(chunks).toEqual([{ type: 'text', content: 'Parcial' }]);
    expect(fakeSource.closed).toBe(true);
    expect(fakeSource.closeCalls).toBe(1);
  });

  it('cierra EventSource y falla si el servidor envía JSON malformado', () => {
    let fakeSource!: FakeEventSource;
    const errors: Error[] = [];

    service
      .streamDesign('product_page', 55, 'stream-bad-json', (url) => {
        fakeSource = new FakeEventSource(url);
        return fakeSource as unknown as EventSource;
      })
      .subscribe({
        error: (err: Error) => errors.push(err),
      });

    fakeSource.emit('ai-chunk', '{no-es-json');

    expect(errors[0]?.message).toContain('no válida');
    expect(fakeSource.closed).toBe(true);
  });

  it('falla sin abrir EventSource cuando falta el token de sesión', () => {
    localStorage.removeItem(authKey);
    const createSpy = jasmine.createSpy('createSource');
    const errors: Error[] = [];

    service
      .streamDesign('product_page', 55, 'stream-no-auth', createSpy)
      .subscribe({
        error: (err: Error) => errors.push(err),
      });

    expect(createSpy).not.toHaveBeenCalled();
    expect(errors[0]?.message).toContain('Sesión no válida');
  });
});
