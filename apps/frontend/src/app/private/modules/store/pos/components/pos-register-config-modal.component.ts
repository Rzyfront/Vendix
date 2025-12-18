import {
    Component,
    EventEmitter,
    Input,
    Output,
    OnInit,
} from '@angular/core';
import {
    FormBuilder,
    FormGroup,
    Validators,
    ReactiveFormsModule,
} from '@angular/forms';
import { CommonModule } from '@angular/common';

import {
    ButtonComponent,
    ModalComponent,
    InputComponent,
    IconComponent,
} from '../../../../../shared/components';

@Component({
    selector: 'app-pos-register-config-modal',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        ButtonComponent,
        ModalComponent,
        InputComponent,
        IconComponent,
    ],
    template: `
    <app-modal
      [isOpen]="isOpen"
      [size]="'md'"
      (closed)="onCancel()"
      [showCloseButton]="true"
    >
      <!-- Modal Header -->
      <div
        class="flex items-center gap-3 p-6 border-b border-[var(--color-border)]"
      >
        <div
          class="w-10 h-10 rounded-full bg-[var(--color-primary-light)] flex items-center justify-center"
        >
          <app-icon
            name="settings"
            [size]="20"
            color="var(--color-primary)"
          ></app-icon>
        </div>
        <div>
          <h2 class="text-lg font-semibold text-[var(--color-text-primary)]">
            Configurar Caja
          </h2>
          <p class="text-sm text-[var(--color-text-secondary)]">
            Configura el identificador de la caja para este dispositivo
          </p>
        </div>
      </div>

      <!-- Modal Content -->
      <div class="p-6">
        <form [formGroup]="configForm" class="space-y-4">
          <app-input
            formControlName="registerId"
            label="ID de Caja *"
            placeholder="Ej: POS-01"
            type="text"
            [size]="'md'"
            [error]="getFieldError('registerId')"
            (blur)="onFieldBlur('registerId')"
          >
          </app-input>

          <div class="bg-blue-50 p-4 rounded-lg flex gap-3 text-sm text-blue-700">
            <app-icon name="info" [size]="18" class="text-blue-500 mt-0.5 flex-shrink-0"></app-icon>
            <p>
              Este identificador se asociará a todas las ventas realizadas desde este dispositivo.
            </p>
          </div>
        </form>
      </div>

      <!-- Modal Footer -->
      <div
        class="flex justify-between items-center p-6 border-t border-[var(--color-border)] bg-[var(--color-surface)]"
      >
        <app-button variant="outline" size="md" (clicked)="onSetDefault()">
          Default Config
        </app-button>

        <div class="flex gap-2">
          <app-button variant="secondary" size="md" (clicked)="onCancel()">
            Cancelar
          </app-button>

          <app-button
            variant="primary"
            size="md"
            (clicked)="onSave()"
            [disabled]="!configForm.valid"
          >
            <app-icon name="save" [size]="16" slot="icon"></app-icon>
            Guardar Configuración
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class PosRegisterConfigModalComponent implements OnInit {
    @Input() isOpen = false;
    @Output() closed = new EventEmitter<void>();
    @Output() saved = new EventEmitter<string>();

    configForm: FormGroup;

    constructor(private fb: FormBuilder) {
        this.configForm = this.fb.group({
            registerId: ['', [Validators.required, Validators.minLength(2)]],
        });
    }

    ngOnInit(): void {
        if (this.isOpen) {
            this.loadConfig();
        }
    }

    loadConfig(): void {
        const savedId = localStorage.getItem('pos_register_id');
        if (savedId) {
            this.configForm.patchValue({ registerId: savedId });
        }
    }

    onSetDefault(): void {
        this.configForm.patchValue({ registerId: 'POS-DEFAULT-01' });
    }

    getFieldError(fieldName: string): string | undefined {
        const field = this.configForm.get(fieldName);
        if (field && field.errors && field.touched) {
            if (field.errors['required']) {
                return 'Este campo es requerido';
            }
            if (field.errors['minlength']) {
                return `Mínimo ${field.errors['minlength'].requiredLength} caracteres`;
            }
        }
        return undefined;
    }

    onFieldBlur(fieldName: string): void {
        const field = this.configForm.get(fieldName);
        if (field) {
            field.markAsTouched();
        }
    }

    onSave(): void {
        if (this.configForm.valid) {
            const registerId = this.configForm.value.registerId;
            localStorage.setItem('pos_register_id', registerId);
            this.saved.emit(registerId);
            this.closed.emit();
        } else {
            this.configForm.markAllAsTouched();
        }
    }

    onCancel(): void {
        this.configForm.reset();
        this.closed.emit();
    }
}
