import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import { InputComponent } from '../../input/input.component';
import { ButtonComponent } from '../../button/button.component';
import { IconComponent } from '../../icon/icon.component';

import { UserConfigData } from '../interfaces/onboarding.interface';

@Component({
  selector: 'app-user-config-step',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputComponent, IconComponent],
  template: `
    <div class="space-y-6">
      <!-- Header del Paso -->
      <div class="text-center">
        <div
          class="inline-flex items-center justify-center w-16 h-16 bg-[var(--color-primary)]/10 rounded-full mb-4"
        >
          <app-icon
            name="user"
            [size]="32"
            class="text-[var(--color-primary)]"
          ></app-icon>
        </div>
        <h3
          class="text-[var(--fs-lg)] font-[var(--fw-semibold)] text-[var(--color-text-primary)] mb-2"
        >
          Configura tu Perfil
        </h3>
        <p
          class="text-[var(--fs-sm)] text-[var(--color-text-secondary)] max-w-md mx-auto"
        >
          Completa tu información personal para personalizar tu experiencia
        </p>
      </div>

      <!-- Formulario -->
      <form [formGroup]="form" class="space-y-4">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- Nombre -->
          <div>
            <label
              class="block text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)] mb-2"
            >
              Nombre *
            </label>
            <app-input
              formControlName="first_name"
              placeholder="Tu nombre"
              [size]="'md'"
              [error]="getErrorMessage('first_name')"
            ></app-input>
          </div>

          <!-- Apellido -->
          <div>
            <label
              class="block text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)] mb-2"
            >
              Apellido *
            </label>
            <app-input
              formControlName="last_name"
              placeholder="Tu apellido"
              [size]="'md'"
              [error]="getErrorMessage('last_name')"
            ></app-input>
          </div>
        </div>

        <!-- Teléfono -->
        <div>
          <label
            class="block text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)] mb-2"
          >
            Teléfono
          </label>
          <app-input
            formControlName="phone"
            placeholder="+1 (555) 123-4567"
            [size]="'md'"
            [error]="getErrorMessage('phone')"
          ></app-input>
          <p class="text-[var(--fs-xs)] text-[var(--color-text-muted)] mt-1">
            Opcional: para notificaciones importantes
          </p>
        </div>

        <!-- Biografía -->
        <div>
          <label
            class="block text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)] mb-2"
          >
            Biografía
          </label>
          <textarea
            formControlName="bio"
            rows="4"
            class="w-full px-3 py-2 border border-[var(--color-border)] rounded-[var(--radius-md)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] focus:border-[var(--color-primary)] bg-[var(--color-surface)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] resize-none"
            placeholder="Cuéntanos brevemente sobre ti..."
          ></textarea>
          <p class="text-[var(--fs-xs)] text-[var(--color-text-muted)] mt-1">
            Opcional: una breve descripción sobre ti
          </p>
        </div>
      </form>

      <!-- Información Adicional -->
      <div
        class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4"
      >
        <div class="flex items-start gap-3">
          <app-icon
            name="info"
            [size]="16"
            class="text-[var(--color-primary)] mt-0.5"
          ></app-icon>
          <div class="flex-1">
            <h4
              class="text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)] mb-1"
            >
              ¿Por qué esta información?
            </h4>
            <p class="text-[var(--fs-xs)] text-[var(--color-text-secondary)]">
              Tu información nos ayudará a personalizar tu experiencia y será
              utilizada para autocompletar datos en los siguientes pasos de la
              configuración.
            </p>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      textarea {
        font-family: inherit;
        font-size: var(--fs-sm);
        line-height: 1.5;
      }

      textarea:focus {
        outline: none;
        box-shadow: 0 0 0 2px var(--color-ring);
      }
    `,
  ],
})
export class UserConfigStepComponent implements OnInit, OnChanges {
  @Input() form: FormGroup;
  @Input() data: UserConfigData = {
    first_name: '',
    last_name: '',
    phone: '',
    bio: '',
  };
  @Output() dataChange = new EventEmitter<UserConfigData>();
  @Output() validityChange = new EventEmitter<boolean>();

  constructor(private fb: FormBuilder) {
    this.form = this.fb.group({});
  }

  ngOnInit(): void {
    this.initializeForm();
    this.setupFormListeners();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data'] && changes['data'].currentValue) {
      this.updateFormData();
    }
  }

  private initializeForm(): void {
    this.form = this.fb.group({
      first_name: [
        this.data?.first_name || '',
        [
          Validators.required,
          Validators.minLength(2),
          Validators.maxLength(50),
        ],
      ],
      last_name: [
        this.data?.last_name || '',
        [
          Validators.required,
          Validators.minLength(2),
          Validators.maxLength(50),
        ],
      ],
      phone: [
        this.data?.phone || '',
        [
          Validators.pattern(
            /^[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,9}$/,
          ),
        ],
      ],
      bio: [this.data?.bio || '', [Validators.maxLength(500)]],
    });
  }

  private setupFormListeners(): void {
    this.form.valueChanges.subscribe((values) => {
      this.dataChange.emit(values as UserConfigData);
      this.validityChange.emit(this.form.valid);
    });
  }

  private updateFormData(): void {
    if (this.form && this.data) {
      this.form.patchValue(this.data, { emitEvent: false });
    }
  }

  getErrorMessage(fieldName: string): string {
    const field = this.form.get(fieldName);
    if (!field || !field.errors) return '';

    const errors = field.errors;

    if (errors['required']) {
      return 'Este campo es requerido';
    }

    if (errors['minlength']) {
      return `Mínimo ${errors['minlength'].requiredLength} caracteres`;
    }

    if (errors['maxlength']) {
      return `Máximo ${errors['maxlength'].requiredLength} caracteres`;
    }

    if (errors['pattern']) {
      return 'Formato de teléfono inválido';
    }

    return 'Campo inválido';
  }
}
