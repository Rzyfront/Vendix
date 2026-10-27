import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ModalComponent } from './modal.component';

@Component({
  standalone: true,
  imports: [ModalComponent],
  template: `
    <app-modal [(isOpen)]="parentOpen" [dialog]="true" title="Checkout">
      <button id="checkout-action" type="button">Cobrar</button>
    </app-modal>
    <app-modal [(isOpen)]="childOpen" [dialog]="true" title="Cliente">
      <button id="customer-action" type="button">Buscar cliente</button>
    </app-modal>
  `,
})
class NestedModalsHost {
  readonly parentOpen = signal(true);
  readonly childOpen = signal(true);
}

describe('ModalComponent nested keyboard ownership', () => {
  let fixture: ComponentFixture<NestedModalsHost>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [NestedModalsHost] }).compileComponents();
    fixture = TestBed.createComponent(NestedModalsHost);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  it('Escape closes only the topmost customer modal and preserves checkout', async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(fixture.componentInstance.childOpen()).toBeFalse();
    expect(fixture.componentInstance.parentOpen()).toBeTrue();
    expect(document.body.style.overflow).toBe('hidden');
    const remainingWrapper = document.querySelector('[data-vendix-modal-wrapper]');
    expect(remainingWrapper?.contains(document.activeElement)).toBeTrue();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.parentOpen()).toBeFalse();
    expect(document.body.style.overflow).toBe('');
  });

  it('focus and Tab stay inside the topmost dialog', async () => {
    const wrappers = document.querySelectorAll('[data-vendix-modal-wrapper]');
    const customerWrapper = wrappers[wrappers.length - 1];
    expect(customerWrapper.contains(document.activeElement)).toBeTrue();

    (document.getElementById('checkout-action') as HTMLButtonElement).focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(customerWrapper.contains(document.activeElement)).toBeTrue();
  });
});

@Component({
  standalone: true,
  imports: [ModalComponent],
  template: `
    <app-modal [(isOpen)]="open" title="Producto">
      <input id="product-name" type="text" />
    </app-modal>
  `,
})
class DefaultModalHost {
  readonly open = signal(true);
}

describe('ModalComponent default dialog (QUI-746)', () => {
  let fixture: ComponentFixture<DefaultModalHost>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DefaultModalHost] }).compileComponents();
    fixture = TestBed.createComponent(DefaultModalHost);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  it('exposes role="dialog" without opting in and focuses the container, not the first input', () => {
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null;
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(dialog);
    expect(document.activeElement?.id).not.toBe('product-name');
  });
});
