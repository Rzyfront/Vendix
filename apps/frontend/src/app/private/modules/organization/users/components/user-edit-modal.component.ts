import { Component, OnInit, inject, input, output, model, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import {
  InputComponent,
  ButtonComponent,
  ModalComponent,
  IconComponent,
  ImageSourceModalComponent,
} from '../../../../../shared/components/index';
import { UsersService } from '../services/users.service';
import { User, UpdateUserDto, UserState } from '../interfaces/user.interface';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { ImageUploadService } from '../../../../../shared/services/image-upload.service';
import { dataUrlToFile } from '../../../../../shared/utils/data-url.util';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';

@Component({
  selector: 'app-user-edit-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    ButtonComponent,
    ModalComponent,
    IconComponent,
    ImageSourceModalComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Editar Usuario"
      subtitle="Actualiza la información del usuario seleccionado"
    >
      @if (user()) {
        <form [formGroup]="userForm" (ngSubmit)="onSubmit()">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              formControlName="first_name"
              label="Nombre *"
              placeholder="Juan"
              [required]="true"
              [control]="userForm.get('first_name')"
              [disabled]="isUpdating()"
            ></app-input>
            <app-input
              formControlName="last_name"
              label="Apellido *"
              placeholder="Pérez"
              [required]="true"
              [control]="userForm.get('last_name')"
              [disabled]="isUpdating()"
            ></app-input>
            <app-input
              formControlName="username"
              label="Nombre de Usuario *"
              placeholder="juanperez"
              [required]="true"
              [control]="userForm.get('username')"
              [disabled]="isUpdating()"
              helpText="Mínimo 3 caracteres, solo letras, números y guiones bajos"
            ></app-input>
            <app-input
              formControlName="email"
              label="Email *"
              type="email"
              placeholder="juan@ejemplo.com"
              [required]="true"
              [control]="userForm.get('email')"
              [disabled]="isUpdating()"
            ></app-input>
            <app-input
              formControlName="phone"
              label="Teléfono"
              type="tel"
              placeholder="+57 300 123 4567"
              [control]="userForm.get('phone')"
              [disabled]="isUpdating()"
            ></app-input>
            <div class="space-y-2">
              <label class="block text-sm font-medium text-[var(--color-text-primary)]">
                Tipo de Documento
              </label>
              <select
                formControlName="document_type"
                class="w-full px-3 py-2 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)]"
                [disabled]="isUpdating()"
              >
                <option value="">Seleccionar</option>
                <option value="CC">Cédula de Ciudadanía</option>
                <option value="CE">Cédula de Extranjería</option>
                <option value="PASSPORT">Pasaporte</option>
                <option value="NIT">NIT</option>
                <option value="OTHER">Otro</option>
              </select>
            </div>
            <app-input
              formControlName="document_number"
              label="Número de Documento"
              placeholder="1234567890"
              [control]="userForm.get('document_number')"
              [disabled]="isUpdating()"
            ></app-input>
            <app-input
              formControlName="password"
              label="Nueva Contraseña (opcional)"
              type="password"
              placeholder="Dejar en blanco para mantener actual"
              [control]="userForm.get('password')"
              [disabled]="isUpdating()"
              helpText="Mínimo 8 caracteres, debe incluir mayúscula, minúscula, número y carácter especial"
            ></app-input>
            <div class="space-y-2">
              <label class="block text-sm font-medium text-[var(--color-text-primary)]">
                Estado
              </label>
              <select
                formControlName="state"
                class="w-full px-3 py-2 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)]"
                [disabled]="isUpdating()"
              >
                <option value="">Seleccionar estado</option>
                <option [value]="UserState.ACTIVE">Activo</option>
                <option [value]="UserState.INACTIVE">Inactivo</option>
                <option [value]="UserState.PENDING_VERIFICATION">
                  Pendiente de Verificación
                </option>
                <option [value]="UserState.SUSPENDED">Suspendido</option>
                <option [value]="UserState.ARCHIVED">Archivado</option>
              </select>
            </div>
          </div>

          <div class="col-span-2 space-y-2 mt-4">
            <label class="block text-sm font-medium text-[var(--color-text-primary)]">
              Avatar
            </label>
            <div class="flex items-center gap-4">
              <div
                class="relative w-16 h-16 rounded-xl overflow-hidden border-2 border-primary-200 cursor-pointer group flex-shrink-0"
                (click)="openAvatarModal()"
              >
                @if (avatarPreview()) {
                  <img
                    [src]="avatarPreview()"
                    alt="Avatar"
                    class="w-full h-full object-contain"
                  />
                } @else {
                  <div
                    class="w-full h-full bg-primary-100 flex items-center justify-center text-primary-600"
                  >
                    <app-icon name="user" [size]="24"></app-icon>
                  </div>
                }
                <div
                  class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <app-icon name="camera" [size]="18" class="text-white"></app-icon>
                </div>
              </div>
              <div class="flex flex-col gap-1">
                <button
                  type="button"
                  class="text-primary-600 hover:text-primary-700 text-sm font-medium text-left"
                  (click)="openAvatarModal()"
                  [disabled]="uploadingAvatar() || isUpdating()"
                >
                  {{ uploadingAvatar() ? 'Subiendo...' : (avatarPreview() ? 'Cambiar foto' : 'Subir foto') }}
                </button>
                @if (avatarPreview()) {
                  <button
                    type="button"
                    class="text-red-500 hover:text-red-600 text-xs font-medium text-left"
                    (click)="onAvatarRemoved()"
                    [disabled]="uploadingAvatar() || isUpdating()"
                  >
                    Eliminar foto
                  </button>
                }
              </div>
            </div>
          </div>

          <!-- User Info -->
          <div class="mt-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Información del Usuario
            </h4>
            <div class="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span class="text-gray-500 dark:text-gray-400">ID:</span>
                <span class="ml-2 text-gray-900 dark:text-gray-100">{{
                  user()?.id
                }}</span>
              </div>
              <div>
                <span class="text-gray-500 dark:text-gray-400">Creado:</span>
                <span class="ml-2 text-gray-900 dark:text-gray-100">{{
                  formatDate(user()?.created_at ?? '')
                }}</span>
              </div>
              <div>
                <span class="text-gray-500 dark:text-gray-400">Email Verificado:</span>
                <span
                  class="ml-2"
                  [class]="user()?.email_verified ? 'text-green-600' : 'text-yellow-600'"
                >
                  {{ user()?.email_verified ? 'Sí' : 'No' }}
                </span>
              </div>
              <div>
                <span class="text-gray-500 dark:text-gray-400">2FA:</span>
                <span
                  class="ml-2"
                  [class]="user()?.two_factor_enabled ? 'text-green-600' : 'text-gray-600'"
                >
                  {{ user()?.two_factor_enabled ? 'Habilitado' : 'Deshabilitado' }}
                </span>
              </div>
              @if (user()?.phone) {
                <div>
                  <span class="text-gray-500 dark:text-gray-400">Teléfono:</span>
                  <span class="ml-2 text-gray-900 dark:text-gray-100">{{ user()?.phone }}</span>
                </div>
              }
              @if (user()?.document_number) {
                <div>
                  <span class="text-gray-500 dark:text-gray-400">Documento:</span>
                  <span class="ml-2 text-gray-900 dark:text-gray-100">
                    {{ user()?.document_type }} {{ user()?.document_number }}
                  </span>
                </div>
              }
            </div>
          </div>
        </form>
      }

      <app-image-source-modal
        [(isOpen)]="avatarModalOpen"
        [singleImage]="true"
        [headerTitle]="'Foto de perfil'"
        (imagesAdded)="onAvatarImages($event)"
      ></app-image-source-modal>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="outline"
          (clicked)="onCancel()"
          [disabled]="isUpdating()"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onSubmit()"
          [disabled]="userForm.invalid || isUpdating()"
          [loading]="isUpdating()"
        >
          Actualizar Usuario
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class UserEditModalComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private fb = inject(FormBuilder);
  private usersService = inject(UsersService);
  private toastService = inject(ToastService);
  private imageUploadService = inject(ImageUploadService);

  readonly user = input<User | null>(null);
  readonly isOpen = model<boolean>(false);
  readonly isOpenChange = output<boolean>();
  readonly onUserUpdated = output<void>();

  userForm!: FormGroup;
  readonly isUpdating = signal(false);
  readonly avatarPreview = signal<string | null>(null);
  readonly uploadingAvatar = signal(false);
  readonly avatarModalOpen = signal(false);
  UserState = UserState;

  ngOnInit(): void {
    this.userForm = this.fb.group({
      first_name: ['', [Validators.required, Validators.maxLength(100)]],
      last_name: ['', [Validators.required, Validators.maxLength(100)]],
      username: [
        '',
        [
          Validators.required,
          Validators.minLength(3),
          Validators.maxLength(50),
          Validators.pattern(/^[a-zA-Z0-9_]+$/),
        ],
      ],
      email: [
        '',
        [Validators.required, Validators.email, Validators.maxLength(255)],
      ],
      phone: ['', [Validators.maxLength(20)]],
      document_type: [''],
      document_number: ['', [Validators.maxLength(50)]],
      password: [
        '',
        [
          Validators.minLength(8),
          Validators.pattern(
            /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
          ),
        ],
      ],
      state: [UserState.ACTIVE],
      avatar_url: [''],
    });
  }

  ngOnChanges(): void {
    const user = this.user();
    if (user) {
      this.userForm.patchValue({
        first_name: user.first_name,
        last_name: user.last_name,
        username: user.username,
        email: user.email,
        phone: user.phone || '',
        document_type: user.document_type || '',
        document_number: user.document_number || '',
        state: user.state,
        avatar_url: user.avatar_url || '',
      });
      // `user.avatar_url` arrives signed from the backend → use it for preview only.
      this.avatarPreview.set(user.avatar_url || null);
    }
  }

  openAvatarModal(): void {
    if (this.uploadingAvatar() || this.isUpdating()) return;
    this.avatarModalOpen.set(true);
  }

  onAvatarImages(dataUrls: string[]): void {
    const dataUrl = dataUrls[0];
    if (!dataUrl) return;

    // Optimistic local preview while uploading
    this.avatarPreview.set(dataUrl);

    const file = dataUrlToFile(dataUrl, `avatar-${Date.now()}.jpg`);

    this.uploadingAvatar.set(true);
    this.imageUploadService
      .uploadFile(file, 'avatars')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          // Persist the real S3 key (not file.name) on the form control.
          this.userForm.patchValue({ avatar_url: result.key });
          this.avatarPreview.set(result.url);
          this.uploadingAvatar.set(false);
        },
        error: (error: unknown) => {
          this.uploadingAvatar.set(false);
          this.toastService.error(extractApiErrorMessage(error));
        },
      });
  }

  onAvatarRemoved(): void {
    this.avatarPreview.set(null);
    this.userForm.patchValue({ avatar_url: '' });
  }

  onCancel(): void {
    this.isOpen.set(false);
    this.isOpenChange.emit(false);
  }

  onSubmit(): void {
    const user = this.user();
    if (this.userForm.invalid || this.isUpdating() || !user) {
      Object.keys(this.userForm.controls).forEach((key) => {
        this.userForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.isUpdating.set(true);
    const userData: UpdateUserDto = this.userForm.value;

    if (!userData.password) {
      delete userData.password;
    }

    this.usersService
      .updateUser(user.id, userData)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isUpdating.set(false);
          this.toastService.success('Usuario actualizado exitosamente');
          this.onUserUpdated.emit();
          this.isOpenChange.emit(false);
        },
        error: (error: unknown) => {
          this.isUpdating.set(false);
          const message = extractApiErrorMessage(error);
          this.toastService.error(message);
        },
      });
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
}