import { Component, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PrintRegionHandleComponent } from '../print-region-handle.component';

/**
 * [print-editor-dsk P4.3] — Contract of the resize-handle overlay.
 *
 * The handle component is intentionally dumb: it renders 8 absolutely-
 * positioned spans when `visible=true` and nothing otherwise. Each span
 * exposes a `data-handle` attribute that the parent uses to route the
 * gesture into the matching `PrintCanvasDragDirective` mode.
 */
@Component({
  standalone: true,
  imports: [PrintRegionHandleComponent],
  template: `
    <div class="host-region" style="position: relative; width: 100px; height: 50px;">
      <app-print-region-handle
        [visible]="visible"
        [handleSize]="handleSize"
        (handlePressed)="onHandlePressed($event)"
      ></app-print-region-handle>
    </div>
  `,
})
class HostComponent {
  visible = true;
  handleSize = 8;
  lastPressed: { handle: string } | null = null;

  @ViewChild(PrintRegionHandleComponent) handleCmp!: PrintRegionHandleComponent;

  onHandlePressed(payload: { event: PointerEvent; handle: string }): void {
    this.lastPressed = { handle: payload.handle };
  }
}

describe('PrintRegionHandleComponent (P4.3)', () => {
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

  it('renders 8 resize handles when visible=true', () => {
    const handles = fixture.nativeElement.querySelectorAll('.resize-handle');
    expect(handles.length).toBe(8);
  });

  it('exposes the 8 expected handle kinds via data-handle', () => {
    const kinds = Array.from(
      fixture.nativeElement.querySelectorAll('.resize-handle'),
    ).map((el) => (el as HTMLElement).getAttribute('data-handle'));
    expect(kinds).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
  });

  it('renders nothing when visible=false', () => {
    host.visible = false;
    fixture.detectChanges();

    const handles = fixture.nativeElement.querySelectorAll('.resize-handle');
    expect(handles.length).toBe(0);
  });

  it('emits handlePressed with the matching handle key on pointerdown', () => {
    const seHandle = fixture.nativeElement.querySelector(
      '.resize-handle[data-handle="se"]',
    ) as HTMLElement;
    expect(seHandle).toBeTruthy();

    const evt = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    seHandle.dispatchEvent(evt);
    fixture.detectChanges();

    expect(host.lastPressed).toEqual({ handle: 'se' });
  });
});