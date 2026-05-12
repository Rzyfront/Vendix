import { Component, model, input, output, signal, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import {
  ButtonComponent,
  ModalComponent,
  InputComponent,
} from '../../../../../shared/components/index';
import { UsersService } from '../services/users.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';

@Component({
  selector: 'app-invite-user-modal',
  standalone: true,
  imports: [ReactiveFormsModule, ButtonComponent, ModalComponent, InputComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      [size]="'md'"
      title="Invitar Usuario"
      subtitle="Enviar invitación por email para crear una cuenta"
    >
      <form [formGroup]="inviteForm" (ngSubmit)="onSubmit()">
        <div class="space-y-4">
          <p class="text-sm text-[var(--color-text-secondary)]">
            Se enviará un correo de invitación al usuario. El usuario deberá
            completar su registro haciendo clic en el enlace.
          </p>

          <app-input
            formControlName="first_name"
            label="Nombre *"
            placeholder="Juan"
            [required]="true"
            [control]="inviteForm.get('first_name')"
            [disabled]="isSending()"
          ></app-input>

          <app-input
            formControlName="last_name"
            label="Apellido *"
            placeholder="Pérez"
            [required]="true"
            [control]="inviteForm.get('last_name')"
            [disabled]="isSending()"
          ></app-input>

          <app-input
            formControlName="email"
            label="Email *"
            type="email"
            placeholder="juan@ejemplo.com"
            [required]="true"
            [control]="inviteForm.get('email')"
            [disabled]="isSending()"
          ></app-input>

          <div class="space-y-2">
            <label class="block text-sm font-medium text-[var(--color-text-primary)]">
              Aplicación
            </label>
            <select
              formControlName="app"
              class="w-full px-3 py-2 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)]"
              [disabled]="isSending()"
            >
              <option value="ORG_ADMIN">ORG_ADMIN</option>
              <option value="STORE_ADMIN">STORE_ADMIN</option>
              <option value="STORE_ECOMMERCE">STORE_ECOMMERCE</option>
            </select>
          </div>
        </div>
      </form>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="outline"
          (clicked)="onClose()"
          [disabled]="isSending()"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onSubmit()"
          [loading]="isSending()"
          [disabled]="inviteForm.invalid || isSending()"
        >
          Enviar Invitación
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [`
    :host { display: block; }
  `],
})
export class InviteUserModalComponent {
  private fb = inject(FormBuilder);
  private usersService = inject(UsersService);
  private toastService = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly isOpenChange = output<boolean>();
  readonly onInvited = output<void>();

  readonly isSending = signal(false);

  inviteForm: FormGroup;

  constructor() {
    this.inviteForm = this.fb.group({
      first_name: ['', [Validators.required, Validators.maxLength(100)]],
      last_name: ['', [Validators.required, Validators.maxLength(100)]],
      email: ['', [Validators.required, Validators.email, Validators.maxLength(255)]],
      app: ['ORG_ADMIN'],
    });
  }

  onClose(): void {
    this.isOpen.set(false);
    this.isOpenChange.emit(false);
    this.inviteForm.reset({ app: 'ORG_ADMIN' });
  }

  onSubmit(): void {
    if (this.inviteForm.invalid || this.isSending()) {
      Object.keys(this.inviteForm.controls).forEach((key) => {
        this.inviteForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.isSending.set(true);

    this.usersService.inviteUser(this.inviteForm.value).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => {
        this.isSending.set(false);
        this.toastService.success('Invitación enviada exitosamente');
        this.onInvited.emit();
        this.onClose();
      },
      error: (err: unknown) => {
        this.isSending.set(false);
        const message = extractApiErrorMessage(err);
        this.toastService.error(message);
      },
    });
  }
}