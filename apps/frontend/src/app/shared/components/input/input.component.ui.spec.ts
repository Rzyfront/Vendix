import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { FormControl, Validators } from '@angular/forms';
import { CurrencyFormatService } from '../../pipes/currency/currency.pipe';
import { InputComponent } from './input.component';

describe('InputComponent theme validation classes', () => {
  let fixture: ComponentFixture<InputComponent>;
  let component: InputComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InputComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: CurrencyFormatService,
          useValue: {
            currencyFormatStyle: () => 'dot_comma',
            currencyDecimals: () => 2,
            format: (value: number) => String(value),
            loadCurrency: () => undefined,
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(InputComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => TestBed.resetTestingModule());

  it('uses theme RGB tokens while preserving validation state opacities', async () => {
    const invalidControl = new FormControl('', Validators.required);
    invalidControl.markAsTouched();
    fixture.componentRef.setInput('control', invalidControl);
    await fixture.whenStable();

    const invalidClasses = component.inputClasses;
    expect(invalidClasses).toContain('bg-[rgba(var(--color-error-rgb),0.1)]');
    expect(invalidClasses).toContain('focus:shadow-[0_0_0_2px_rgba(var(--color-error-rgb),0.3)]');

    const validControl = new FormControl('ready', Validators.required);
    validControl.markAsTouched();
    fixture.componentRef.setInput('control', validControl);
    await fixture.whenStable();

    const validClasses = component.inputClasses;
    expect(validClasses).toContain('bg-[rgba(var(--color-success-rgb),0.1)]');
    expect(validClasses).not.toContain('239,68,68');
    expect(validClasses).not.toContain('126,215,165');
  });
});
