import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { CurrencyFormatService } from '../pipes/currency/currency.pipe';
import { CurrencyInputDirective } from './currency-input.directive';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, CurrencyInputDirective],
  template: `<input appCurrencyInput [selectOnFocus]="select()" [currencyDecimals]="0" [formControl]="control" />`,
})
class HostComponent {
  readonly select = signal(true);
  readonly control = new FormControl<number | null>(25000);
}

/** Hallazgo demo 11-nov (T4): «Efectivo recibido» prellenado; lo que se escribía se pegaba al número. */
describe('CurrencyInputDirective — selectOnFocus', () => {
  const currencyStub = {
    currencyFormatStyle: signal('dot_comma'),
    currencyDecimals: signal(0),
  };

  let hostEl: HTMLElement | null = null;

  function setup(select: boolean): HTMLInputElement {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: CurrencyFormatService, useValue: currencyStub }],
    });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.select.set(select);
    fixture.detectChanges();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    hostEl = fixture.nativeElement;
    document.body.appendChild(fixture.nativeElement);
    return input;
  }

  beforeEach(() => jasmine.clock().install());
  afterEach(() => {
    jasmine.clock().uninstall();
    hostEl?.remove();
    hostEl = null;
  });

  it('con selectOnFocus, al enfocar selecciona todo el valor prellenado', () => {
    const input = setup(true);
    input.focus();
    input.dispatchEvent(new Event('focus'));
    jasmine.clock().tick(0);
    expect(input.value.length).toBeGreaterThan(0);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it('sin selectOnFocus no cambia la selección (comportamiento anterior)', () => {
    const input = setup(false);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event('focus'));
    jasmine.clock().tick(0);
    expect(input.selectionStart).toBe(input.value.length);
  });
});
