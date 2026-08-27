import { Component, ElementRef, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PrintCanvasDragDirective } from '../print-canvas-drag.directive';

/**
 * [print-editor-dsk P4.3] — Contract of the pointer-driven drag/resize
 * directive. The directive is a thin event translator:
 *  - emits `dragStart` once on pointerdown with the current mm geometry
 *  - emits `dragMove` per pointermove with deltas in mm
 *  - emits `dragEnd` on pointerup
 *  - rounds deltas to whole millimetres when `snap` is true (default)
 *
 * We test by attaching the directive to a host div and dispatching
 * pointer events at the native level. Jasmine's DOM is good enough for
 * this — no Angular Zone tricks required.
 */
@Component({
  standalone: true,
  imports: [PrintCanvasDragDirective],
  template: `
    <div
      class="drag-target"
      style="position: absolute; left: 0mm; top: 0mm; width: 100mm; height: 50mm;"
      appCanvasDrag
      [handle]="handle"
      [snap]="snap"
      (dragStart)="onDragStart($event)"
      (dragMove)="onDragMove($event)"
      (dragEnd)="onDragEnd()"
    ></div>
  `,
})
class HostComponent {
  handle: 'body' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' = 'body';
  snap = true;

  dragStartCount = 0;
  dragStartPayload: any = null;
  dragMoveCount = 0;
  lastDragMove: any = null;
  dragEndCount = 0;

  @ViewChild('target') targetRef?: ElementRef<HTMLDivElement>;
  @ViewChild(PrintCanvasDragDirective) directive?: PrintCanvasDragDirective;

  onDragStart(payload: any): void {
    this.dragStartCount++;
    this.dragStartPayload = payload;
  }
  onDragMove(payload: any): void {
    this.dragMoveCount++;
    this.lastDragMove = payload;
  }
  onDragEnd(): void {
    this.dragEndCount++;
  }
}

describe('PrintCanvasDragDirective (P4.3)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('emits dragStart with the initial mm geometry on pointerdown', () => {
    const el = fixture.nativeElement.querySelector('.drag-target') as HTMLElement;
    const evt = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 100,
    });
    el.dispatchEvent(evt);
    fixture.detectChanges();

    expect(host.dragStartCount).toBe(1);
    expect(host.dragStartPayload).toBeTruthy();
    expect(typeof host.dragStartPayload.x_mm).toBe('number');
    expect(typeof host.dragStartPayload.y_mm).toBe('number');
    expect(typeof host.dragStartPayload.width_mm).toBe('number');
    expect(typeof host.dragStartPayload.height_mm).toBe('number');
  });

  it('does nothing on pointerdown when handle=body and event.target is not the host', () => {
    const el = fixture.nativeElement.querySelector('.drag-target') as HTMLElement;
    // Create a child span, dispatch pointerdown on the child — body
    // drag should ignore because handle('body') skips inner targets.
    const child = document.createElement('span');
    child.style.position = 'absolute';
    el.appendChild(child);
    const evt = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 100,
    });
    child.dispatchEvent(evt);
    fixture.detectChanges();

    expect(host.dragStartCount).toBe(0);
  });

  it('snap=true rounds dragMove deltas to whole millimetres (15.7 → 16)', () => {
    host.snap = true;
    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('.drag-target') as HTMLElement;
    el.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 0,
        clientY: 0,
      }),
    );
    // 15.7 mm at 96 DPI / 25.4 = 15.7 * (96/25.4) ≈ 59.36 px
    const dxPx = 15.7 * (96 / 25.4);
    window.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: dxPx,
        clientY: 0,
      }),
    );
    fixture.detectChanges();

    expect(host.lastDragMove).toBeTruthy();
    expect(host.lastDragMove.dx_mm).toBe(16);
    expect(host.lastDragMove.dy_mm).toBe(0);
    expect(host.lastDragMove.dw_mm).toBe(0);
    expect(host.lastDragMove.dh_mm).toBe(0);
  });

  it('snap=false emits fractional deltas', () => {
    host.snap = false;
    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('.drag-target') as HTMLElement;
    el.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 0,
        clientY: 0,
      }),
    );
    const dxPx = 15.7 * (96 / 25.4);
    window.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: dxPx,
        clientY: 0,
      }),
    );
    fixture.detectChanges();

    expect(host.lastDragMove).toBeTruthy();
    // Allow ±1 mm rounding from event precision in jsdom.
    expect(host.lastDragMove.dx_mm).toBeGreaterThan(14.5);
    expect(host.lastDragMove.dx_mm).toBeLessThan(16.5);
    // Confirm it is NOT an integer (proves snap=false path was taken).
    expect(Number.isInteger(host.lastDragMove.dx_mm)).toBe(false);
  });

  it('resize from SE handle: dx_mm=0, dy_mm=0, dw_mm>0, dh_mm>0', () => {
    host.handle = 'se';
    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('.drag-target') as HTMLElement;
    el.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 0,
        clientY: 0,
      }),
    );
    window.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: 10 * (96 / 25.4),
        clientY: 5 * (96 / 25.4),
      }),
    );
    fixture.detectChanges();

    expect(host.lastDragMove).toBeTruthy();
    expect(host.lastDragMove.dx_mm).toBe(0);
    expect(host.lastDragMove.dy_mm).toBe(0);
    expect(host.lastDragMove.dw_mm).toBe(10);
    expect(host.lastDragMove.dh_mm).toBe(5);
  });

  it('emits dragEnd on pointerup and stops emitting further dragMove', () => {
    const el = fixture.nativeElement.querySelector('.drag-target') as HTMLElement;
    el.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 0,
        clientY: 0,
      }),
    );
    window.dispatchEvent(new PointerEvent('pointerup', {}));
    fixture.detectChanges();

    expect(host.dragEndCount).toBe(1);

    // Subsequent move should not produce more dragMove.
    const before = host.dragMoveCount;
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 999, clientY: 999 }));
    fixture.detectChanges();
    expect(host.dragMoveCount).toBe(before);
  });
});