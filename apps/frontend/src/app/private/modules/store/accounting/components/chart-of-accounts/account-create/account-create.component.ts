import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, inject } from '@angular/core';

import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Store } from '@ngrx/store';

import { ChartAccount, CreateAccountDto, UpdateAccountDto } from '../../../interfaces/accounting.interface';
import { createAccount, updateAccount } from '../../../state/actions/accounting.actions';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
} from '../../../../../../../shared/components/index';

@Component({
  selector: 'vendix-account-create',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent
],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      [title]="editAccount ? 'Editar Cuenta' : 'Nueva Cuenta'"
      size="md"
    >
      <div class="p-4 space-y-4">
        <form [formGroup]="form">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              label="Código de Cuenta"
              formControlName="code"
              [control]="form.get('code')"
              [required]="true"
              [disabled]="!!editAccount"
              placeholder="Ej: 1101"
            ></app-input>

            <app-input
              label="Nombre de Cuenta"
              formControlName="name"
              [control]="form.get('name')"
              [required]="true"
              placeholder="Ej: Efectivo"
            ></app-input>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <app-selector
              label="Tipo de Cuenta"
              formControlName="account_type"
              [options]="account_type_options"
              [required]="true"
            ></app-selector>

            <app-selector
              label="Naturaleza"
              formControlName="nature"
              [options]="nature_options"
              [required]="true"
            ></app-selector>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <app-selector
              label="Cuenta Padre"
              formControlName="parent_id"
              [options]="parent_account_options"
            ></app-selector>

            <div class="flex items-center gap-4 pt-6">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" formControlName="is_active"
                       class="rounded border-gray-300 text-primary focus:ring-primary" />
                <span class="text-sm text-text-primary">Activo</span>
              </label>

              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" formControlName="accepts_entries"
                       class="rounded border-gray-300 text-primary focus:ring-primary" />
                <span class="text-sm text-text-primary">Acepta Asientos</span>
              </label>
            </div>
          </div>
        </form>
      </div>

      <div slot="footer">
        <div class="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <app-button variant="outline" (clicked)="onClose()">Cancelar</app-button>
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="form.invalid || is_submitting"
            [loading]="is_submitting"
          >
            {{ editAccount ? 'Actualizar' : 'Crear' }}
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class AccountCreateComponent implements OnChanges {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Input() editAccount: ChartAccount | null = null;
  @Input() accounts: ChartAccount[] = [];

  private fb = inject(FormBuilder);
  private store = inject(Store);

  is_submitting = false;

  account_type_options = [
    { value: 'asset', label: 'Activo' },
    { value: 'liability', label: 'Pasivo' },
    { value: 'equity', label: 'Patrimonio' },
    { value: 'revenue', label: 'Ingresos' },
    { value: 'expense', label: 'Gasto' },
  ];

  nature_options = [
    { value: 'debit', label: 'Débito' },
    { value: 'credit', label: 'Crédito' },
  ];

  get parent_account_options() {
    const options = [{ value: null as any, label: 'Ninguno (Cuenta Raíz)' }];
    this.flattenForSelect(this.accounts, options, 0);
    return options;
  }

  form = this.fb.group({
    code: ['', [Validators.required]],
    name: ['', [Validators.required]],
    account_type: ['asset', [Validators.required]],
    nature: ['debit', [Validators.required]],
    parent_id: [null as number | null],
    is_active: [true],
    accepts_entries: [true],
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['editAccount'] && this.editAccount) {
      this.form.patchValue({
        code: this.editAccount.code,
        name: this.editAccount.name,
        account_type: this.editAccount.account_type,
        nature: this.editAccount.nature,
        parent_id: this.editAccount.parent_id || null,
        is_active: this.editAccount.is_active,
        accepts_entries: this.editAccount.accepts_entries,
      });
    } else if (changes['editAccount'] && !this.editAccount) {
      this.form.reset({
        code: '',
        name: '',
        account_type: 'asset',
        nature: 'debit',
        parent_id: null,
        is_active: true,
        accepts_entries: true,
      });
    }
  }

  onSubmit(): void {
    if (this.form.invalid) return;

    this.is_submitting = true;
    const values = this.form.getRawValue();

    if (this.editAccount) {
      const dto: UpdateAccountDto = {
        name: values.name!,
        account_type: values.account_type as any,
        nature: values.nature as any,
        parent_id: values.parent_id || undefined,
        is_active: values.is_active!,
        accepts_entries: values.accepts_entries!,
      };
      this.store.dispatch(updateAccount({ id: this.editAccount.id, account: dto }));
    } else {
      const dto: CreateAccountDto = {
        code: values.code!,
        name: values.name!,
        account_type: values.account_type as any,
        nature: values.nature as any,
        parent_id: values.parent_id || undefined,
        is_active: values.is_active!,
        accepts_entries: values.accepts_entries!,
      };
      this.store.dispatch(createAccount({ account: dto }));
    }

    this.is_submitting = false;
    this.onClose();
  }

  onClose(): void {
    this.isOpenChange.emit(false);
    this.editAccount = null;
    this.form.reset({
      code: '',
      name: '',
      account_type: 'asset',
      nature: 'debit',
      parent_id: null,
      is_active: true,
      accepts_entries: true,
    });
  }

  private flattenForSelect(
    accounts: ChartAccount[],
    options: { value: any; label: string }[],
    depth: number,
  ): void {
    for (const account of accounts) {
      const prefix = '\u00A0\u00A0'.repeat(depth);
      options.push({ value: account.id, label: `${prefix}${account.code} - ${account.name}` });
      if (account.children?.length) {
        this.flattenForSelect(account.children, options, depth + 1);
      }
    }
  }
}
