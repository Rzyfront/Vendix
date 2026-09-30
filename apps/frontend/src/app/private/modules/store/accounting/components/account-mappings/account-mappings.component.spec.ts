import { Component, forwardRef, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NgClass } from '@angular/common';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import { AccountMappingsComponent } from './account-mappings.component';
import { AccountMapping } from '../../interfaces/accounting.interface';
import { selectAccountMappings, selectAccountMappingsLoading } from '../../state/selectors/accounting.selectors';
import { saveAccountMappings } from '../../state/actions/accounting.actions';
import { TenantFacade } from '../../../../../../core/store/tenant/tenant.facade';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

@Component({ selector: 'app-card', standalone: true, template: '<ng-content />' })
class CardStub {
  readonly responsive = input(false);
  readonly padding = input(true);
}

@Component({ selector: 'app-button', standalone: true, template: '<button [disabled]="disabled()" (click)="clicked.emit()"><ng-content /></button>' })
class ButtonStub {
  readonly variant = input('primary');
  readonly size = input('md');
  readonly disabled = input(false);
  readonly clicked = output<void>();
}

@Component({ selector: 'app-icon', standalone: true, template: '' })
class IconStub {
  readonly name = input('');
  readonly size = input(16);
}

@Component({ selector: 'app-empty-state', standalone: true, template: '' })
class EmptyStateStub {
  readonly icon = input('');
  readonly title = input('');
  readonly description = input('');
  readonly showActionButton = input(false);
  readonly showRefreshButton = input(false);
  readonly showClearFilters = input(false);
}

@Component({
  selector: 'app-account-select',
  standalone: true,
  template: '<button type="button" (click)="chooseAccount()">Elegir cuenta</button>',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => AccountSelectStub), multi: true }],
})
class AccountSelectStub implements ControlValueAccessor {
  private onChange: (value: number) => void = () => {};

  writeValue(_value: number | null): void {}
  registerOnChange(fn: (value: number) => void): void { this.onChange = fn; }
  registerOnTouched(_fn: () => void): void {}
  chooseAccount(): void { this.onChange(777); }
}

describe('AccountMappingsComponent — D.2 prepared disposition keys', () => {
  let fixture: ComponentFixture<AccountMappingsComponent>;
  let store: { select: jasmine.Spy; dispatch: jasmine.Spy };

  const keys = [
    'order_item.prepared_waste.shrinkage',
    'order_item.prepared_reuse.inventory',
    'order_item.prepared_disposition.cogs',
  ];
  const mappings: AccountMapping[] = [
    ...keys.map((mapping_key, index) => ({
      mapping_key,
      account_code: ['5295', '1435', '6135'][index],
      account_id: index + 1,
      description: `Cuenta D2 ${index + 1}`,
      source: 'default' as const,
    })),
    {
      mapping_key: 'order_item.unrelated.inventory',
      account_code: '1435',
      account_id: 4,
      description: 'No mostrar esta cuenta',
      source: 'default',
    },
    {
      mapping_key: 'order_item.prepared_waste.shrinkage.extra',
      account_code: '5295',
      account_id: 5,
      description: 'No mostrar este sufijo',
      source: 'default',
    },
  ];

  beforeEach(async () => {
    store = {
      select: jasmine.createSpy('select').and.callFake((selector: unknown) => {
        if (selector === selectAccountMappings) return of(mappings);
        if (selector === selectAccountMappingsLoading) return of(false);
        throw new Error('Unexpected selector');
      }),
      dispatch: jasmine.createSpy('dispatch'),
    };

    await TestBed.configureTestingModule({
      imports: [AccountMappingsComponent],
      providers: [
        { provide: Store, useValue: store },
        { provide: HttpClient, useValue: { get: () => of({ data: keys.map((key, index) => ({ key, description: `Etiqueta D2 ${index + 1}` })) }) } },
        { provide: TenantFacade, useValue: { currentEnvironment: signal(null) } },
        { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') } },
      ],
    }).overrideComponent(AccountMappingsComponent, {
      set: { imports: [FormsModule, NgClass, CardStub, ButtonStub, IconStub, EmptyStateStub, AccountSelectStub] },
    }).compileComponents();

    fixture = TestBed.createComponent(AccountMappingsComponent);
    fixture.detectChanges();
  });

  it('renders only the three D.2 order-item mappings and saves a selected override', () => {
    const component = fixture.componentInstance;
    expect(component.mapping_groups().map((group) => group.key)).toEqual(['restaurant_ops']);
    expect(component.mapping_groups()[0].mappings.map((mapping) => mapping.mapping_key)).toEqual(keys);

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Cocina y Produccion');
    keys.forEach((_key, index) => expect(text).toContain(`Etiqueta D2 ${index + 1}`));
    expect(text).not.toContain('No mostrar esta cuenta');
    expect(text).not.toContain('No mostrar este sufijo');

    const selectButton = fixture.nativeElement.querySelector('app-account-select button') as HTMLButtonElement;
    selectButton.click();
    fixture.detectChanges();
    expect(component.changed_mappings().get(keys[0])).toBe(777);

    const saveButton = fixture.nativeElement.querySelectorAll('app-button button')[1] as HTMLButtonElement;
    expect(saveButton.disabled).toBeFalse();
    saveButton.click();
    expect(store.dispatch).toHaveBeenCalledWith(saveAccountMappings({
      mappings: [{ mapping_key: keys[0], account_id: 777 }],
    }));
  });
});
