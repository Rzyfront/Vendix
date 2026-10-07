import { ElementRef, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { PullToRefreshDirective } from './pull-to-refresh.directive';

/** PR #897 — eventos reales, DI/effect/output zoneless y reloj Jasmine. */
describe('PullToRefreshDirective — scroll ownership y cancelación', () => {
  let host: HTMLElement;
  let directive: PullToRefreshDirective;
  let disabled: WritableSignal<boolean>;
  let threshold: WritableSignal<number>;
  let refreshed: jasmine.Spy;

  function dimensions(element: HTMLElement, top = 0, height = 200, content = 1000): void {
    // La geometría es un seam explícito; no depende de layout/headless ni de
    // que el setter scrollTop del navegador acepte scroll en un nodo vacío.
    Object.defineProperties(element, {
      scrollTop: { configurable: true, writable: true, value: top },
      clientHeight: { configurable: true, value: height },
      scrollHeight: { configurable: true, value: content },
    });
  }

  function child(overflowY: string, top = 0, parent = host): HTMLElement {
    const element = document.createElement('div');
    element.style.overflowY = overflowY;
    parent.appendChild(element);
    dimensions(element, top);
    return element;
  }

  function touch(
    type: string,
    target: Node = host,
    y = 100,
    count = type === 'touchend' || type === 'touchcancel' ? 0 : 1,
    path?: EventTarget[],
    reportedTarget?: EventTarget | null,
  ): Event {
    const event = new Event(type, { bubbles: true, cancelable: true, composed: true });
    Object.defineProperty(event, 'touches', {
      value: Array.from({ length: count }, (_, index) => ({ identifier: index, clientY: y })),
    });
    if (path !== undefined) Object.defineProperty(event, 'composedPath', { value: () => path });
    if (reportedTarget !== undefined) Object.defineProperty(event, 'target', { value: reportedTarget });
    target.dispatchEvent(event);
    return event;
  }

  function pull(target: Node = host, distance = 200): Event {
    touch('touchstart', target);
    const move = touch('touchmove', target, 100 + distance);
    touch('touchend', target);
    return move;
  }

  function badge(): HTMLElement | null {
    return host.querySelector('[aria-hidden="true"]');
  }

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date());
    host = document.createElement('main');
    host.style.position = 'relative';
    host.style.overflowY = 'auto';
    document.body.appendChild(host);
    dimensions(host);
    TestBed.configureTestingModule({
      providers: [{ provide: ElementRef, useValue: new ElementRef(host) }],
    });
    directive = TestBed.runInInjectionContext(() => new PullToRefreshDirective());
    // Adaptadores de inputs públicos: signals reales, no API interna de
    // Angular ni fakeAsync/Zone. El effect de la directiva consume estos mismos
    // valores reactivos que un host enlazaría a sus input signals.
    disabled = signal(false);
    threshold = signal(70);
    Object.defineProperty(directive, 'ptrDisabled', { value: disabled });
    Object.defineProperty(directive, 'threshold', { value: threshold });
    refreshed = jasmine.createSpy('pullRefresh');
    directive.pullRefresh.subscribe(refreshed);
    TestBed.flushEffects();
    directive.ngOnInit();
  });

  afterEach(() => {
    try {
      directive.ngOnDestroy();
      TestBed.resetTestingModule();
      host.remove();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('host arriba: reclama el pull válido y emite exactamente una vez al soltar', () => {
    const move = pull();
    expect(move.defaultPrevented).toBeTrue();
    expect(refreshed).toHaveBeenCalledTimes(1);
    touch('touchend');
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it('por debajo del umbral deja el badge oculto y no emite', () => {
    expect(pull(host, 100).defaultPrevented).toBeTrue();
    expect(refreshed).not.toHaveBeenCalled();
    expect(badge()?.style.opacity).toBe('0');
  });

  it('respeta el input threshold y su frontera exacta después de resistencia', () => {
    threshold.set(90);
    pull(host, 178);
    expect(refreshed).not.toHaveBeenCalled();
    pull(host, 180);
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it('host desplazado conserva el scroll incluso si llega arriba en ese gesto', () => {
    host.scrollTop = 50;
    touch('touchstart');
    host.scrollTop = 0;
    const move = touch('touchmove', host, 400);
    touch('touchend');
    expect(move.defaultPrevented).toBeFalse();
    expect(refreshed).not.toHaveBeenCalled();
  });

  for (const overflow of ['auto', 'scroll']) {
    it(`hijo overflow-y:${overflow} desplazado no inicia aunque main esté arriba`, () => {
      const nested = child(overflow, 250);
      const target = child('visible', 0, nested);
      const move = pull(target);
      expect(host.scrollTop).toBe(0);
      expect(move.defaultPrevented).toBeFalse();
      expect(refreshed).not.toHaveBeenCalled();
      expect(badge()).toBeNull();
    });
  }

  it('hijo que arranca desplazado no se reclama al llegar arriba en el mismo gesto', () => {
    const nested = child('auto', 250);
    touch('touchstart', nested);
    nested.scrollTop = 0;
    const move = touch('touchmove', nested, 400);
    touch('touchend', nested);
    expect(move.defaultPrevented).toBeFalse();
    expect(refreshed).not.toHaveBeenCalled();
    expect(pull(nested).defaultPrevented).toBeTrue(); // siguiente gesto sí es válido
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it('permite el pull si el scroller hijo y el host empiezan arriba', () => {
    expect(pull(child('auto')).defaultPrevented).toBeTrue();
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it('un scroller intermedio desplazado bloquea aunque el más cercano esté arriba', () => {
    const parent = child('scroll', 75);
    const target = child('auto', 0, parent);
    expect(pull(target).defaultPrevented).toBeFalse();
    expect(refreshed).not.toHaveBeenCalled();
  });

  for (const overflow of ['visible', 'hidden']) {
    it(`overflow-y:${overflow} no se confunde con scroller por scrollHeight grande`, () => {
      expect(pull(child(overflow, 250)).defaultPrevented).toBeTrue();
      expect(refreshed).toHaveBeenCalledTimes(1);
    });
  }

  it('overflow auto sin contenido desplazable no bloquea por geometría ficticia', () => {
    const target = child('auto', 50);
    dimensions(target, 50, 200, 200);
    expect(pull(target).defaultPrevented).toBeTrue();
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it('composedPath conserva el scroller interno aunque target esté retargeteado al host', () => {
    const nested = child('auto', 250);
    touch('touchstart', host, 100, 1, [nested, document, host, window]);
    const move = touch('touchmove', host, 400);
    touch('touchend');
    expect(move.defaultPrevented).toBeFalse();
    expect(refreshed).not.toHaveBeenCalled();
  });

  it('fallback sin composedPath recorre target Text hasta su scroller', () => {
    const nested = child('auto', 250);
    const text = document.createTextNode('producto');
    nested.appendChild(text);
    touch('touchstart', text, 100, 1, []);
    expect(touch('touchmove', text, 400).defaultPrevented).toBeFalse();
    touch('touchend', text);
    expect(refreshed).not.toHaveBeenCalled();
  });

  it('fallback sin composedPath acepta un target Text válido arriba', () => {
    const text = document.createTextNode('producto');
    host.appendChild(text);
    touch('touchstart', text, 100, 1, []);
    expect(touch('touchmove', text, 400).defaultPrevented).toBeTrue();
    touch('touchend', text);
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it('ignora ancestros desplazados externos al host en composedPath', () => {
    const external = document.createElement('div');
    external.style.overflowY = 'auto';
    dimensions(external, 250);
    touch('touchstart', host, 100, 1, [host, external, document, window]);
    expect(touch('touchmove', host, 400).defaultPrevented).toBeTrue();
    touch('touchend');
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it('un recorrido ajeno al host o target null no permite capturar', () => {
    const external = document.createElement('div');
    for (const target of [external, null]) {
      touch('touchstart', host, 100, 1, [external], target);
      expect(touch('touchmove', host, 400).defaultPrevented).toBeFalse();
      touch('touchend');
    }
    expect(refreshed).not.toHaveBeenCalled();
  });

  it('si un scroller hijo se desplaza durante el pull cancela sin impedir su scroll', () => {
    const nested = child('auto');
    touch('touchstart', nested);
    touch('touchmove', nested, 250);
    nested.scrollTop = 20;
    expect(touch('touchmove', nested, 400).defaultPrevented).toBeFalse();
    nested.scrollTop = 0;
    touch('touchend', nested);
    expect(refreshed).not.toHaveBeenCalled();
    expect(badge()?.style.opacity).toBe('0');
  });

  it('si host se desplaza antes de soltar no emite con el umbral viejo', () => {
    touch('touchstart');
    touch('touchmove', host, 300);
    host.scrollTop = 10;
    touch('touchend');
    expect(refreshed).not.toHaveBeenCalled();
  });

  it('touchcancel sobre el umbral oculta el badge sin emitir', () => {
    touch('touchstart');
    touch('touchmove', host, 400);
    touch('touchcancel');
    touch('touchend');
    expect(refreshed).not.toHaveBeenCalled();
    expect(badge()?.style.opacity).toBe('0');
    pull();
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it('un gesto hacia arriba se abandona aunque luego baje sin nuevo start', () => {
    touch('touchstart');
    expect(touch('touchmove', host, 50).defaultPrevented).toBeFalse();
    expect(touch('touchmove', host, 400).defaultPrevented).toBeFalse();
    touch('touchend');
    expect(refreshed).not.toHaveBeenCalled();
  });

  it('POS disabled no intercepta ni muestra badge', () => {
    disabled.set(true);
    TestBed.flushEffects();
    expect(pull().defaultPrevented).toBeFalse();
    expect(refreshed).not.toHaveBeenCalled();
    expect(badge()).toBeNull();
  });

  it('disabled al soltar no emite aunque el effect todavía no haya corrido', () => {
    touch('touchstart');
    touch('touchmove', host, 400);
    disabled.set(true);
    touch('touchend');
    expect(refreshed).not.toHaveBeenCalled();
    expect(badge()?.style.opacity).toBe('0');
  });

  it('deshabilitar y re-habilitar cancela el gesto viejo, pero permite uno nuevo', () => {
    touch('touchstart');
    touch('touchmove', host, 400);
    disabled.set(true);
    TestBed.flushEffects();
    expect(badge()?.style.opacity).toBe('0');
    disabled.set(false);
    TestBed.flushEffects();
    touch('touchend');
    expect(refreshed).not.toHaveBeenCalled();
    pull();
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it('multitouch al iniciar no reclama gesto', () => {
    touch('touchstart', host, 100, 2);
    expect(touch('touchmove', host, 400).defaultPrevented).toBeFalse();
    touch('touchend');
    expect(refreshed).not.toHaveBeenCalled();
  });

  it('un segundo touchstart con dos dedos cancela el pull previo', () => {
    touch('touchstart');
    touch('touchmove', host, 400);
    touch('touchstart', host, 400, 2);
    touch('touchend');
    expect(refreshed).not.toHaveBeenCalled();
    expect(badge()?.style.opacity).toBe('0');
  });

  for (const touches of [0, 2]) {
    it(`touchmove con ${touches} dedos cancela sin excepción ni reanudación accidental`, () => {
      touch('touchstart');
      touch('touchmove', host, 400);
      expect(() => touch('touchmove', host, 500, touches)).not.toThrow();
      expect(touch('touchmove', host, 600).defaultPrevented).toBeFalse();
      touch('touchend');
      expect(refreshed).not.toHaveBeenCalled();
    });
  }

  it('touchend con dedos restantes no puede confirmar', () => {
    touch('touchstart');
    touch('touchmove', host, 400);
    touch('touchend', host, 400, 1);
    touch('touchend');
    expect(refreshed).not.toHaveBeenCalled();
  });

  it('ráfaga de 40 gestos emite una sola vez mientras refresca; luego se libera', () => {
    for (let i = 0; i < 40; i++) pull();
    expect(refreshed).toHaveBeenCalledTimes(1);
    jasmine.clock().tick(3999);
    pull();
    expect(refreshed).toHaveBeenCalledTimes(1);
    jasmine.clock().tick(1);
    pull();
    expect(refreshed).toHaveBeenCalledTimes(2);
  });

  it('reset cancela el timer viejo y no interrumpe un refresh posterior', () => {
    pull();
    jasmine.clock().tick(2000);
    directive.reset();
    const reset = spyOn(directive, 'reset').and.callThrough();
    pull();
    jasmine.clock().tick(2000); // vencimiento del timer que reset canceló
    expect(reset).not.toHaveBeenCalled();
    jasmine.clock().tick(2000);
    expect(reset).toHaveBeenCalledTimes(1);
    pull();
    expect(refreshed).toHaveBeenCalledTimes(3);
  });

  it('destroy elimina los cuatro listeners, el badge y el timer pendiente', () => {
    const remove = spyOn(host, 'removeEventListener').and.callThrough();
    pull();
    expect(badge()).not.toBeNull();
    directive.ngOnDestroy();
    const reset = spyOn(directive, 'reset').and.callThrough();
    expect(remove.calls.allArgs().map((args) => args[0])).toEqual([
      'touchstart', 'touchmove', 'touchend', 'touchcancel',
    ]);
    expect(badge()).toBeNull();
    pull();
    jasmine.clock().tick(5000);
    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it('registra move no pasivo y elimina exactamente los mismos callbacks', () => {
    directive.ngOnDestroy();
    const add = spyOn(host, 'addEventListener').and.callThrough();
    const remove = spyOn(host, 'removeEventListener').and.callThrough();
    directive = TestBed.runInInjectionContext(() => new PullToRefreshDirective());
    directive.ngOnInit();
    expect(add.calls.allArgs().map((args) => [args[0], args[2]])).toEqual([
      ['touchstart', { passive: true }],
      ['touchmove', { passive: false }],
      ['touchend', { passive: true }],
      ['touchcancel', { passive: true }],
    ]);
    directive.ngOnDestroy();
    for (const [type, callback] of add.calls.allArgs()) {
      expect(remove).toHaveBeenCalledWith(type, callback);
    }
  });

  it('destroy durante el output también cancela el timer recién creado', () => {
    directive.pullRefresh.subscribe(() => directive.ngOnDestroy());
    pull();
    const reset = spyOn(directive, 'reset').and.callThrough();
    jasmine.clock().tick(5000);
    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
    expect(badge()).toBeNull();
  });

  it('reset durante el output no deja un timer escondido', () => {
    directive.pullRefresh.subscribe(() => directive.reset());
    pull();
    const reset = spyOn(directive, 'reset').and.callThrough();
    jasmine.clock().tick(5000);
    expect(reset).not.toHaveBeenCalled();
    expect(refreshed).toHaveBeenCalledTimes(1);
  });
});
