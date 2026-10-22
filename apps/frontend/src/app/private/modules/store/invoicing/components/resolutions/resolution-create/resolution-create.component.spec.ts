import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { EMPTY } from 'rxjs';

import { ConfirmationModalComponent } from '../../../../../../../shared/components/confirmation-modal/confirmation-modal.component';
import { DianResolutionFormValue } from '../../../../../../../shared/components/dian';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { selectResolutions } from '../../../state/selectors/invoicing.selectors';
import { ResolutionCreateComponent } from './resolution-create.component';

describe('ResolutionCreateComponent confirmacion de serie de notas', () => {
  const value: DianResolutionFormValue = {
    document_type: 'credit_note',
    resolution_number: '',
    resolution_date: '2026-01-01',
    prefix: 'NCVS',
    range_from: 1,
    range_to: 1000,
    valid_from: '2026-01-01',
    valid_to: '2126-01-01',
    is_active: true,
  };

  function mount() {
    TestBed.configureTestingModule({
      imports: [ResolutionCreateComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideMockActions(() => EMPTY),
        provideMockStore({
          selectors: [{ selector: selectResolutions, value: [] }],
        }),
        { provide: CurrencyFormatService, useValue: {} },
      ],
    });
    const fixture = TestBed.createComponent(ResolutionCreateComponent);
    fixture.componentRef.setInput('siblingResolutions', [
      { id: 1, prefix: 'NC', document_type: 'credit_note', is_active: true },
    ]);
    fixture.detectChanges();
    return fixture;
  }

  it('cerrar la confirmacion con X/Escape libera el estado y permite reabrirla', () => {
    const fixture = mount();
    const cmp = fixture.componentInstance;

    cmp.onSave(value);
    fixture.detectChanges();
    expect(cmp.pendingConfirm()).not.toBeNull();

    const modal = fixture.debugElement.query(By.directive(ConfirmationModalComponent));
    expect(modal).toBeTruthy();
    modal.componentInstance.isOpen.set(false);
    fixture.detectChanges();
    expect(cmp.pendingConfirm()).toBeNull();

    cmp.onSave(value);
    fixture.detectChanges();
    expect(cmp.pendingConfirm()).not.toBeNull();
    expect(fixture.debugElement.query(By.directive(ConfirmationModalComponent))).toBeTruthy();
  });
});
