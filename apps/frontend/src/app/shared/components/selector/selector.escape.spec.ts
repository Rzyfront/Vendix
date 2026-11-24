import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ModalComponent } from '../modal/modal.component';
import { SelectorComponent } from './selector.component';

@Component({
  standalone: true,
  imports: [ModalComponent, SelectorComponent],
  template: `
    <app-modal [(isOpen)]="open" title="Nuevo Ingreso de Estación">
      <app-selector
        label="Producto"
        [options]="options"
        [searchable]="true"
        searchPlaceholder="Buscar por nombre o SKU…"
      />
    </app-modal>
  `,
})
class SelectorInModalHost {
  readonly open = signal(true);
  readonly options = [
    { value: 1, label: 'Aceite 20W50' },
    { value: 2, label: 'Gaseosa' },
  ];
}

/**
 * QUI-1059: Esc while searching inside a searchable selector closes only its
 * panel; the surrounding modal (and what was typed in it) stays. With the panel
 * closed, Esc still reaches the modal and closes it as before.
 */
describe('SelectorComponent Escape inside a modal (QUI-1059)', () => {
  let fixture: ComponentFixture<SelectorInModalHost>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SelectorInModalHost] }).compileComponents();
    fixture = TestBed.createComponent(SelectorInModalHost);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  const host = () => fixture.nativeElement as HTMLElement;
  const trigger = () => host().querySelector('app-selector button') as HTMLButtonElement;
  const searchInput = () => host().querySelector('app-selector input') as HTMLInputElement | null;

  function pressEscape(target: HTMLElement): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function openPanel(): Promise<void> {
    trigger().click();
    await settle();
  }

  it('Esc in the search box closes only the panel, keeps the modal open and returns focus to the trigger', async () => {
    await openPanel();
    const input = searchInput();
    expect(input).withContext('the search box is rendered').not.toBeNull();
    input!.value = 'gas';
    input!.dispatchEvent(new Event('input'));
    await settle();

    const event = pressEscape(input!);
    await settle();

    expect(searchInput()).withContext('the panel is closed').toBeNull();
    expect(fixture.componentInstance.open()).withContext('the modal stays open').toBeTrue();
    expect(host().querySelector('[data-vendix-modal-wrapper]')).not.toBeNull();
    expect(event.defaultPrevented).toBeTrue();
    expect(document.activeElement).toBe(trigger());
  });

  it('Esc on the trigger with the panel open also closes only the panel', async () => {
    await openPanel();
    trigger().focus();

    pressEscape(trigger());
    await settle();

    expect(searchInput()).toBeNull();
    expect(fixture.componentInstance.open()).toBeTrue();
  });

  it('Esc with the panel closed is not intercepted: the modal closes as before', async () => {
    trigger().focus();

    const event = pressEscape(trigger());
    await settle();

    expect(event.defaultPrevented).toBeFalse();
    expect(fixture.componentInstance.open()).toBeFalse();
  });

  it('after closing the panel with Esc, a second Esc closes the modal', async () => {
    await openPanel();
    pressEscape(searchInput()!);
    await settle();
    expect(fixture.componentInstance.open()).toBeTrue();

    pressEscape(trigger());
    await settle();

    expect(fixture.componentInstance.open()).toBeFalse();
  });
});
