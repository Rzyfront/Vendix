import { Component, OnInit, inject, input, output, signal, DestroyRef } from '@angular/core';
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
import { CreateUserDto, UserState } from '../interfaces/user.interface';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { ImageUploadService } from '../../../../../shared/services/image-upload.service';
import { dataUrlToFile } from '../../../../../shared/utils/data-url.util';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';

@Component({
  selector: 'app-user-create-modal',
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
      title="Crear Nuevo Usuario"
      subtitle="Completa el formulario para agregar un nuevo usuario a la organización"
    >
      <form [formGroup]="userForm" (ngSubmit)="onSubmit()">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <app-input
            formControlName="first_name"
            label="Nombre *"
            placeholder="Juan"
            [required]="true"
            [control]="userForm.get('first_name')"
            [disabled]="isCreating()"
          ></app-input>

          <app-input
            formControlName="last_name"
            label="Apellido *"
            placeholder="Pérez"
            [required]="true"
            [control]="userForm.get('last_name')"
            [disabled]="isCreating()"
          ></app-input>

          <app-input
            formControlName="username"
            label="Nombre de Usuario *"
            placeholder="juanperez"
            [required]="true"
            [control]="userForm.get('username')"
            [disabled]="isCreating()"
            helpText="Mínimo 3 caracteres, solo letras, números y guiones bajos"
          ></app-input>

          <app-input
            formControlName="email"
            label="Email *"
            type="email"
            placeholder="juan@ejemplo.com"
            [required]="true"
            [control]="userForm.get('email')"
            [disabled]="isCreating()"
          ></app-input>

          <app-input
            formControlName="phone"
            label="Teléfono"
            type="tel"
            placeholder="+57 300 123 4567"
            [control]="userForm.get('phone')"
            [disabled]="isCreating()"
          ></app-input>

          <div class="space-y-2">
            <label class="block text-sm font-medium text-[var(--color-text-primary)]">
              Tipo de Documento
            </label>
            <select
              formControlName="document_type"
              class="w-full px-3 py-2 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)]"
              [disabled]="isCreating()"
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
            [disabled]="isCreating()"
          ></app-input>

          <app-input
            formControlName="password"
            label="Contraseña *"
            type="password"
            placeholder="••••••••••"
            [required]="true"
            [control]="userForm.get('password')"
            [disabled]="isCreating()"
            helpText="Mínimo 8 caracteres, debe incluir mayúscula, minúscula, número y carácter especial"
          ></app-input>

          <div class="space-y-2">
            <label class="block text-sm font-medium text-[var(--color-text-primary)]">
              Estado Inicial
            </label>
            <select
              formControlName="state"
              class="w-full px-3 py-2 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)]"
              [disabled]="isCreating()"
            >
              <option value="">Seleccionar estado</option>
              <option [value]="UserState.ACTIVE">Activo</option>
              <option [value]="UserState.INACTIVE">Inactivo</option>
              <option [value]="UserState.PENDING_VERIFICATION">
                Pendiente de Verificación
              </option>
            </select>
          </div>

          <div class="col-span-2 space-y-2">
            <label class="block text-sm font-medium text-[var(--color-text-primary)]">
              Tienda Principal
            </label>
            <select
              formControlName="main_store_id"
              class="w-full px-3 py-2 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)]"
              [disabled]="isCreating()"
            >
              <option [ngValue]="null">Sin tienda principal</option>
              @for (store of stores(); track store.id) {
                <option [value]="store.id">{{ store.name }}</option>
              }
            </select>
            <p class="text-xs text-gray-500">
              Selecciona la tienda principal del usuario (opcional)
            </p>
          </div>

          <div class="col-span-2 space-y-2">
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
                  [disabled]="uploadingAvatar() || isCreating()"
                >
                  {{ uploadingAvatar() ? 'Subiendo...' : (avatarPreview() ? 'Cambiar foto' : 'Subir foto') }}
                </button>
                @if (avatarPreview()) {
                  <button
                    type="button"
                    class="text-red-500 hover:text-red-600 text-xs font-medium text-left"
                    (click)="onAvatarRemoved()"
                    [disabled]="uploadingAvatar() || isCreating()"
                  >
                    Eliminar foto
                  </button>
                }
              </div>
            </div>
          </div>
        </div>
      </form>

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
          [disabled]="isCreating()"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onSubmit()"
          [disabled]="userForm.invalid || isCreating()"
          [loading]="isCreating()"
        >
          Crear Usuario
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
export class UserCreateModalComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private fb = inject(FormBuilder);
  private usersService = inject(UsersService);
  private toastService = inject(ToastService);
  private imageUploadService = inject(ImageUploadService);

  readonly isOpen = input<boolean>(false);
  readonly isOpenChange = output<boolean>();
  readonly onUserCreated = output<void>();
  readonly stores = input<Array<{ id: number; name: string }>>([]);

  userForm!: FormGroup;
  readonly isCreating = signal(false);
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
          Validators.required,
          Validators.minLength(8),
          Validators.pattern(
            /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
          ),
        ],
      ],
      state: [UserState.PENDING_VERIFICATION],
      main_store_id: [null],
      avatar_url: [''],
    });
  }

  openAvatarModal(): void {
    if (this.uploadingAvatar() || this.isCreating()) return;
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
          this.avatarPreview.set(null);
          this.userForm.patchValue({ avatar_url: '' });
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
    this.isOpenChange.emit(false);
    this.resetForm();
  }

  onSubmit(): void {
    if (this.userForm.invalid || this.isCreating()) {
      Object.keys(this.userForm.controls).forEach((key) => {
        this.userForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.isCreating.set(true);
    const userData: CreateUserDto = this.userForm.value;

    this.usersService
      .createUser(userData)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isCreating.set(false);
          this.toastService.success('Usuario creado exitosamente');
          this.onUserCreated.emit();
          this.isOpenChange.emit(false);
          this.resetForm();
        },
        error: (error: unknown) => {
          this.isCreating.set(false);
          const message = extractApiErrorMessage(error);
          this.toastService.error(message);
        },
      });
  }

  resetForm(): void {
    this.userForm.reset({
      first_name: '',
      last_name: '',
      username: '',
      email: '',
      phone: '',
      document_type: '',
      document_number: '',
      password: '',
      state: UserState.PENDING_VERIFICATION,
      main_store_id: null,
      avatar_url: '',
    });
    this.avatarPreview.set(null);
  }
}
