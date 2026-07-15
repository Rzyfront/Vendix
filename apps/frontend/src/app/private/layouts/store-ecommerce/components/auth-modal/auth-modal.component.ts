import {
  ChangeDetectionStrategy,
  Component,
  inject,
  DestroyRef,
  input,
  output,
  effect,
  signal,
  computed,
  untracked,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { AuthFacade } from '../../../../../core/store';
import { TenantFacade } from '../../../../../core/store';
import { AuthService } from '../../../../../core/services/auth.service';
import { StoreAvailabilityService } from '../../../../../core/services/store-availability.service';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../shared/components/input/input.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import {
  LegalService,
  PendingDocument,
} from '../../../../../public/ecommerce/services/legal.service';
import { LegalPreviewModalComponent } from '../../../../../public/ecommerce/components/legal-preview-modal/legal-preview-modal.component';

@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    IconComponent,
    LegalPreviewModalComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (closed)="onClose()"
      size="sm"
      title=" "
      [overlayCloseButton]="true"
    >
      <!-- Custom Header with Logo -->
      <div
        slot="header"
        class="flex flex-col items-center text-center w-full py-2"
      >
        <!-- Store Logo -->
        <div class="mb-4">
          @if (storeLogo()) {
            <img
              [src]="storeLogo()"
              [alt]="storeName()"
              class="h-12 w-auto object-contain"
            />
          } @else {
            <div class="flex items-center gap-2 text-[var(--color-primary)]">
              <app-icon name="shopping-bag" [size]="32"></app-icon>
              <span
                class="text-xl font-bold text-[var(--color-text-primary)]"
                >{{ storeName() }}</span
              >
            </div>
          }
        </div>
        <!-- Title -->
        <h3 class="text-lg font-semibold text-[var(--color-text-primary)]">
          {{ headerTitle() }}
        </h3>
        <p class="text-sm text-[var(--color-text-secondary)] mt-1">
          {{ headerSubtitle() }}
        </p>
      </div>

      <div class="space-y-4 py-2">
        <!-- Tabs (solo login/registro; ocultos en modo recuperar contraseña) -->
        @if (!isForgot()) {
          <div class="flex border-b border-[var(--color-border)] mb-4">
            <button
              type="button"
              (click)="switchMode(true)"
              [class.border-b-2]="isLogin()"
              [class.border-[var(--color-primary)]]="isLogin()"
              [class.text-[var(--color-primary)]]="isLogin()"
              [class.text-[var(--color-text-secondary)]]="!isLogin()"
              class="flex-1 py-2 text-sm font-medium transition-colors"
            >
              Login
            </button>
            <button
              type="button"
              (click)="switchMode(false)"
              [class.border-b-2]="!isLogin()"
              [class.border-[var(--color-primary)]]="!isLogin()"
              [class.text-[var(--color-primary)]]="!isLogin()"
              [class.text-[var(--color-text-secondary)]]="isLogin()"
              class="flex-1 py-2 text-sm font-medium transition-colors"
            >
              Registro
            </button>
          </div>
        }

        <!-- Error Message -->
        @if (errorMessage()) {
          <div
            class="p-4 rounded-lg bg-red-50 border border-red-200"
            role="alert"
          >
            <div class="flex items-start gap-3">
              <app-icon
                name="alert-circle"
                [size]="20"
                class="text-red-500 mt-0.5 flex-shrink-0"
              ></app-icon>
              <div class="flex-1">
                <p class="text-sm font-medium text-red-800">{{ errorTitle() }}</p>
                <p class="text-sm text-red-700 mt-1">{{ errorMessage() }}</p>
              </div>
            </div>
          </div>
        }

        <!-- Customer account claim CTA — surfaces when the register
             endpoint reports AUTH_CUSTOMER_CLAIMABLE_001 (POS / backoffice
             pre-existing customer with the same email). Triggers the
             customer-only password reset flow. -->
        @if (claimableEmail()) {
          <div
            class="p-4 rounded-lg bg-amber-50 border border-amber-200"
            role="status"
          >
            <div class="flex items-start gap-3">
              <app-icon
                name="key-round"
                [size]="20"
                class="text-amber-600 mt-0.5 flex-shrink-0"
              ></app-icon>
              <div class="flex-1">
                <p class="text-sm font-medium text-amber-900">
                  ¿Ya tienes cuenta con este correo?
                </p>
                <p class="text-sm text-amber-800 mt-1">
                  Te enviamos un link para activar tu contraseña y
                  vincular tu cuenta a esta tienda.
                </p>
                <app-button
                  class="mt-3"
                  variant="primary"
                  size="sm"
                  [disabled]="recoveryPending()"
                  [loading]="recoveryPending()"
                  [showTextWhileLoading]="true"
                  (clicked)="onStartRecovery()"
                >
                  {{
                    recoveryPending()
                      ? 'Enviando...'
                      : 'Enviar link de activación'
                  }}
                </app-button>
              </div>
            </div>
          </div>
        }

        @if (isForgot() && passwordResetEmailSent()) {
          <!-- Confirmación tras enviar el email de recuperación -->
          <div
            class="p-4 rounded-lg bg-green-50 border border-green-200"
            role="status"
          >
            <div class="flex items-start gap-3">
              <app-icon
                name="check-circle"
                [size]="20"
                class="text-green-600 mt-0.5 flex-shrink-0"
              ></app-icon>
              <p class="text-sm text-green-800">
                Si el email existe, te enviamos instrucciones para restablecer tu
                contraseña. Revisa tu correo.
              </p>
            </div>
          </div>
          <button
            type="button"
            (click)="goToLogin()"
            class="w-full text-center text-sm text-[var(--color-primary)] font-medium hover:underline focus:outline-none mt-4"
          >
            Volver a iniciar sesión
          </button>
        } @else {
          <form
            id="authForm"
            [formGroup]="authForm"
            (ngSubmit)="onSubmit()"
            class="space-y-4"
          >
            @if (isRegister()) {
              <div class="grid grid-cols-2 gap-4">
                <app-input
                  label="Nombre"
                  placeholder="Ej. Juan"
                  formControlName="first_name"
                  [control]="firstNameControl"
                ></app-input>
                <app-input
                  label="Apellido"
                  placeholder="Ej. Perez"
                  formControlName="last_name"
                  [control]="lastNameControl"
                ></app-input>
              </div>
            }

            <app-input
              label="Correo Electronico"
              type="email"
              placeholder="tu@email.com"
              formControlName="email"
              [control]="emailControl"
            ></app-input>

            @if (!isForgot()) {
              <app-input
                label="Contrasena"
                type="password"
                placeholder="********"
                formControlName="password"
                [control]="passwordControl"
              ></app-input>
            }

            <!-- Link "¿Olvidaste tu contraseña?" (solo en login) -->
            @if (isLogin()) {
              <div class="text-right">
                <button
                  type="button"
                  (click)="goToForgot()"
                  class="text-sm text-[var(--color-primary)] hover:underline focus:outline-none"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
            }

            <!-- Link "Volver a iniciar sesión" (solo en recuperar contraseña) -->
            @if (isForgot()) {
              <div class="text-center">
                <button
                  type="button"
                  (click)="goToLogin()"
                  class="text-sm text-[var(--color-primary)] font-medium hover:underline focus:outline-none"
                >
                  Volver a iniciar sesión
                </button>
              </div>
            }

            <!-- Password requirements (always visible in register mode) -->
            @if (isRegister()) {
            <div
              class="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-100"
            >
              <app-icon
                name="info"
                [size]="16"
                class="text-blue-500 mt-0.5 flex-shrink-0"
              ></app-icon>
              <div class="text-xs text-blue-700">
                <p class="font-medium">Requisitos de contraseña:</p>
                <ul class="mt-1 space-y-0.5">
                  <li [class.text-green-600]="hasMinLength()">
                    {{ hasMinLength() ? '✓' : '○' }} Mínimo 8 caracteres
                  </li>
                  <li [class.text-green-600]="hasSpecialChar()">
                    {{ hasSpecialChar() ? '✓' : '○' }} Al menos un carácter
                    especial
                  </li>
                </ul>
              </div>
            </div>
          }

          <!-- Documentos Legales -->
          @if (isRegister() && pendingDocuments().length > 0) {
            <div class="space-y-3 pt-2">
              <p class="text-xs font-medium text-[var(--color-text-primary)]">
                Documentos Legales
              </p>
              @for (doc of pendingDocuments(); track doc.document_id) {
                <div class="flex items-start gap-2">
                  <input
                    type="checkbox"
                    [id]="'doc-' + doc.document_id"
                    [checked]="acceptedDocuments()[doc.document_id]"
                    (change)="toggleDoc(doc.document_id)"
                    class="mt-1 h-3.5 w-3.5 rounded border-gray-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                  />
                  <label
                    [for]="'doc-' + doc.document_id"
                    class="text-[11px] leading-tight text-[var(--color-text-secondary)]"
                  >
                    Acepto los
                    <button
                      type="button"
                      (click)="previewDocument(doc)"
                      class="text-[var(--color-primary)] font-medium hover:underline focus:outline-none"
                    >
                      {{ doc.title }}
                    </button>
                  </label>
                </div>
              }
            </div>
          }
          </form>
        }
      </div>

      <!-- Footer with Submit Button -->
      <div slot="footer" class="w-full">
        @if (!(isForgot() && passwordResetEmailSent())) {
          <app-button
            type="submit"
            form="authForm"
            [variant]="'primary'"
            [fullWidth]="true"
            [loading]="loading() || false"
          >
            {{
              isForgot()
                ? 'Enviar instrucciones'
                : isLogin()
                  ? 'Iniciar sesión'
                  : 'Crear cuenta'
            }}
          </app-button>
        }
      </div>
    </app-modal>

    <!-- Preview Modal -->
    <app-legal-preview-modal
      [(isOpen)]="showPreviewModal"
      [title]="previewDoc().title"
      [content]="previewDoc().content"
      [version]="previewDoc().version"
    ></app-legal-preview-modal>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthModalComponent {
  readonly isOpen = input(false);
  readonly initialMode = input<'login' | 'register' | 'forgot'>('login');
  readonly storeLogo = input<string | null>(null);
  readonly storeName = input('Tienda');
  readonly closed = output<void>();

  // Modo del modal como fuente de verdad. `isLogin`/`isRegister`/`isForgot`
  // se derivan de aquí para que el template siga invocando `isLogin()` igual.
  readonly mode = signal<'login' | 'register' | 'forgot'>('login');
  readonly isLogin = computed(() => this.mode() === 'login');
  readonly isRegister = computed(() => this.mode() === 'register');
  readonly isForgot = computed(() => this.mode() === 'forgot');
  readonly errorMessage = signal<string | null>(null);
  readonly errorTitle = signal('Error de autenticación');

  /**
   * Set when the backend returns AUTH_CUSTOMER_CLAIMABLE_001 — the email
   * the user tried to register is already on file as a POS / backoffice
   * customer. The UI then offers a one-click password reset to claim
   * the existing account instead of dead-ending with a generic 409.
   */
  readonly claimableEmail = signal<string | null>(null);
  readonly recoveryPending = signal(false);

  // Títulos/subtítulos derivados del modo (evita ternarios anidados en template).
  readonly headerTitle = computed(() =>
    this.isForgot()
      ? 'Recuperar contraseña'
      : this.isLogin()
        ? 'Iniciar Sesion'
        : 'Crear Cuenta',
  );
  readonly headerSubtitle = computed(() =>
    this.isForgot()
      ? 'Te enviaremos instrucciones a tu correo'
      : this.isLogin()
        ? 'Ingresa tus credenciales para continuar'
        : 'Registrate para realizar tu compra',
  );

  // Legal Documents state
  readonly pendingDocuments = signal<PendingDocument[]>([]);
  readonly acceptedDocuments = signal<Record<number, boolean>>({});
  readonly showPreviewModal = signal(false);
  readonly previewDoc = signal({ title: '', content: '', version: '' });

  private fb = inject(FormBuilder);
  private authFacade = inject(AuthFacade);
  private authService = inject(AuthService);
  private tenantFacade = inject(TenantFacade);
  private storeAvailability = inject(StoreAvailabilityService);
  private legalService = inject(LegalService);
  private destroyRef = inject(DestroyRef);
  private toast = inject(ToastService);

  loading = this.authFacade.authLoading;
  // Señal del facade: true cuando el email de recuperación se envió con éxito.
  readonly passwordResetEmailSent = this.authFacade.passwordResetEmailSent;
  authForm: FormGroup;

  // Password validation — computed signals reacting to form value changes
  private readonly passwordValue = signal('');
  readonly hasMinLength = computed(() => this.passwordValue().length >= 8);
  readonly hasSpecialChar = computed(() =>
    /[^A-Za-z0-9]/.test(this.passwordValue()),
  );

  constructor() {
    // Initialize form in constructor
    this.authForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: [
        '',
        [
          Validators.required,
          Validators.minLength(8),
          Validators.pattern(/.*[^A-Za-z0-9].*/), // Al menos un carácter especial
        ],
      ],
      first_name: [''],
      last_name: [''],
    });

    // Auto-close modal on successful authentication — effect sobre signal de facade
    effect(() => {
      const shouldClose =
        this.authFacade.isAuthenticated() && this.isOpen();
      if (shouldClose) {
        untracked(() => {
          this.processPendingAcceptances();
          this.onClose();
        });
      }
    });

    // Listen for auth errors — effect sobre signal de facade
    effect(() => {
      const error = this.authFacade.authError();
      const open = this.isOpen();
      if (error && open) {
        untracked(() => {
          const rawMessage =
            typeof error === 'string' ? error : extractApiErrorMessage(error);
          const { title, message } = this.mapErrorToUserFriendly(
            error,
            rawMessage,
          );
          this.errorTitle.set(title);
          this.errorMessage.set(message);
          this.toast.error(message, title, 4000);
        });
      }
    });

    // Clear error when user starts typing + track password value for computed signals
    this.authForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.passwordValue.set(value?.password ?? '');
        if (this.errorMessage()) {
          this.errorMessage.set(null);
        }
      });

    // React to parent input changes (replaces ngOnChanges).
    // untracked() evita que mutar isLogin o leer signals internos re-dispare el effect
    // y revierta el tab switch que el usuario hace via switchMode().
    effect(() => {
      const requestedMode = this.initialMode();
      const open = this.isOpen();

      untracked(() => {
        this.mode.set(requestedMode);
        this.updateValidators();

        if (open) {
          this.errorMessage.set(null);
          if (requestedMode === 'register') {
            this.loadPendingDocuments();
          }
        }
      });
    });
  }

  // Typed getters for form controls
  get emailControl() {
    return this.authForm.get('email')!;
  }
  get passwordControl() {
    return this.authForm.get('password')!;
  }
  get firstNameControl() {
    return this.authForm.get('first_name')!;
  }
  get lastNameControl() {
    return this.authForm.get('last_name')!;
  }

  /**
   * Maps backend error messages to user-friendly messages
   */
  private mapErrorToUserFriendly(
    error: any,
    fallbackMessage: string,
  ): {
    title: string;
    message: string;
  } {
    // Check structured error_code FIRST — robust against backend copy changes.
    // The customer-claimable CTA was previously dead because the string-based
    // check ran against the userMessage (already a generic fallback when
    // AUTH_CUSTOMER_CLAIMABLE_001 is not in ERROR_MESSAGES). Matching on
    // errorCode bypasses that chain.
    const parsed = parseApiError(error);
    if (parsed.errorCode === 'AUTH_CUSTOMER_CLAIMABLE_001') {
      this.claimableEmail.set(this.authForm.get('email')?.value ?? null);
      return {
        title: 'Ya tienes cuenta con este correo',
        message:
          'Detectamos que este correo ya está registrado como cliente. Te enviaremos un link para que actives tu contraseña.',
      };
    }

    const errorLower = fallbackMessage.toLowerCase();

    // Invalid credentials
    if (
      errorLower.includes('credenciales') ||
      errorLower.includes('invalid') ||
      errorLower.includes('incorrect')
    ) {
      return {
        title: 'Credenciales incorrectas',
        message:
          'El correo o la contraseña no coinciden. Verifica tus datos e intenta de nuevo.',
      };
    }

    // User not found
    if (
      errorLower.includes('no encontrado') ||
      errorLower.includes('not found') ||
      errorLower.includes('no existe')
    ) {
      return {
        title: 'Usuario no encontrado',
        message: 'No existe una cuenta con este correo electrónico.',
      };
    }

    // Customer account claimable via password reset (POS / backoffice
    // pre-existing customer). MUST come BEFORE the generic "ya existe"
    // check below because the backend message contains both substrings.
    if (
      errorLower.includes('auth_customer_claimable_001') ||
      errorLower.includes('recoverable via password reset')
    ) {
      this.claimableEmail.set(this.authForm.get('email')?.value ?? null);
      return {
        title: 'Ya tienes cuenta con este correo',
        message:
          'Detectamos que este correo ya está registrado como cliente. Te enviaremos un link para que actives tu contraseña.',
      };
    }

    // Email already exists
    if (
      errorLower.includes('ya existe') ||
      errorLower.includes('duplicate') ||
      errorLower.includes('already exists')
    ) {
      return {
        title: 'Correo ya registrado',
        message:
          'Ya existe una cuenta con este correo. Intenta iniciar sesión.',
      };
    }

    // Account locked
    if (
      errorLower.includes('bloqueado') ||
      errorLower.includes('locked') ||
      errorLower.includes('suspended')
    ) {
      return {
        title: 'Cuenta bloqueada',
        message:
          'Tu cuenta ha sido bloqueada temporalmente. Contacta al soporte si necesitas ayuda.',
      };
    }

    // Rate limit
    if (
      errorLower.includes('too many') ||
      errorLower.includes('rate limit') ||
      errorLower.includes('demasiados')
    ) {
      return {
        title: 'Demasiados intentos',
        message:
          'Has realizado demasiados intentos. Espera unos minutos antes de intentar de nuevo.',
      };
    }

    // Network errors
    if (
      errorLower.includes('network') ||
      errorLower.includes('timeout') ||
      errorLower.includes('conexión')
    ) {
      return {
        title: 'Error de conexión',
        message:
          'No se pudo conectar al servidor. Verifica tu conexión a internet.',
      };
    }

    // Default
    return {
      title: 'Error de autenticación',
      message: error,
    };
  }

  private initAcceptedDocuments(docs: PendingDocument[]): void {
    const accepted: Record<number, boolean> = {};
    docs.forEach((doc) => {
      accepted[doc.document_id] = false;
    });
    this.acceptedDocuments.set(accepted);
  }

  loadPendingDocuments(): void {
    this.legalService.getPendingDocumentsForCustomer().subscribe({
      next: (docs) => {
        let finalDocs: PendingDocument[];
        if (docs && docs.length > 0) {
          finalDocs = docs;
        } else {
          // Fallback if no documents returned: Show generic Terms
          finalDocs = [
            {
              document_id: -1, // ID negativo para identificar que es local
              title: 'Términos y Condiciones',
              content:
                'Al registrarte, aceptas los Términos y Condiciones y la Política de Privacidad de la tienda. Por favor, asegúrate de leerlos atentamente.\n\n(El contenido detallado de los términos no está disponible en este momento).',
              is_required: true,
              version: '1.0',
              document_type: 'TERMS_OF_SERVICE',
            },
          ];
        }
        this.pendingDocuments.set(finalDocs);
        this.initAcceptedDocuments(finalDocs);
      },
      error: (err) => {
        console.error('Error loading legal docs', err);
        // On error also show fallback
        const fallback: PendingDocument[] = [
          {
            document_id: -1,
            title: 'Términos y Condiciones',
            content:
              'Al registrarte, aceptas los Términos y Condiciones y la Política de Privacidad de la tienda.',
            is_required: true,
            version: '1.0',
            document_type: 'TERMS_OF_SERVICE',
          },
        ];
        this.pendingDocuments.set(fallback);
        this.initAcceptedDocuments(fallback);
      },
    });
  }

  toggleDoc(id: number): void {
    this.acceptedDocuments.update((current) => ({
      ...current,
      [id]: !current[id],
    }));
  }

  previewDocument(doc: PendingDocument): void {
    this.previewDoc.set({
      title: doc.title,
      content: doc.content,
      version: doc.version,
    });
    this.showPreviewModal.set(true);
  }

  private processPendingAcceptances(): void {
    const accepted = this.acceptedDocuments();
    const docIds = Object.keys(accepted)
      .map(Number)
      .filter((id) => accepted[id] && id > 0);

    // Gather metadata for acceptance
    const metadata = {
      ip: 'unknown', // Could be extracted from headers if available
      userAgent: navigator.userAgent || 'unknown',
    };

    docIds.forEach((id) => {
      this.legalService.acceptDocument(id, metadata).subscribe({
        error: (err) => console.error(`Error accepting document ${id}`, err),
      });
    });
  }

  switchMode(isLogin: boolean): void {
    this.mode.set(isLogin ? 'login' : 'register');
    this.errorMessage.set(null);
    this.authFacade.setAuthError(null);
    this.updateValidators();
    if (this.mode() === 'register') {
      this.loadPendingDocuments();
    }
  }

  /** Cambia a la vista "olvidé mi contraseña" (solo accesible desde login). */
  goToForgot(): void {
    this.mode.set('forgot');
    this.authFacade.setAuthError(null);
    this.authFacade.clearPasswordResetState();
    this.errorMessage.set(null);
    this.updateValidators();
  }

  /** Vuelve a la vista de inicio de sesión desde el flujo de recuperación. */
  goToLogin(): void {
    this.mode.set('login');
    this.authFacade.setAuthError(null);
    this.errorMessage.set(null);
    this.updateValidators();
  }

  updateValidators(): void {
    const emailControl = this.authForm.get('email');
    const passwordControl = this.authForm.get('password');
    const firstNameControl = this.authForm.get('first_name');
    const lastNameControl = this.authForm.get('last_name');

    // Email siempre requerido en los tres modos.
    emailControl?.setValidators([Validators.required, Validators.email]);

    if (this.isForgot()) {
      // Recuperar contraseña: solo email. Limpiamos el resto para que el
      // submit no quede bloqueado por campos vacíos.
      passwordControl?.clearValidators();
      firstNameControl?.clearValidators();
      lastNameControl?.clearValidators();
    } else {
      // Login / Registro: contraseña requerida (min 8 + carácter especial).
      passwordControl?.setValidators([
        Validators.required,
        Validators.minLength(8),
        Validators.pattern(/.*[^A-Za-z0-9].*/),
      ]);

      if (this.isLogin()) {
        firstNameControl?.clearValidators();
        lastNameControl?.clearValidators();
      } else {
        firstNameControl?.setValidators([Validators.required]);
        lastNameControl?.setValidators([Validators.required]);
      }
    }

    emailControl?.updateValueAndValidity();
    passwordControl?.updateValueAndValidity();
    firstNameControl?.updateValueAndValidity();
    lastNameControl?.updateValueAndValidity();
  }

  onClose(): void {
    this.errorMessage.set(null);
    this.claimableEmail.set(null);
    this.recoveryPending.set(false);
    this.authFacade.clearPasswordResetState();
    this.mode.set('login');
    this.closed.emit();
    this.authForm.reset();
    this.pendingDocuments.set([]);
    this.acceptedDocuments.set({});
  }

  /**
   * Triggered by the CTA the modal surfaces when the register endpoint
   * reports AUTH_CUSTOMER_CLAIMABLE_001. Fires the customer-only
   * password-reset request and shows the same generic toast regardless of
   * whether the email is on file, to avoid enumeration.
   */
  onStartRecovery(): void {
    const email = this.claimableEmail() ?? this.authForm.get('email')?.value;
    const storeId = this.tenantFacade.getCurrentStoreId();
    if (!email || !storeId) return;

    this.recoveryPending.set(true);
    this.authService.forgotCustomerPassword(email, storeId).subscribe({
      next: () => {
        this.recoveryPending.set(false);
        this.toast.success(
          'Te enviamos un email con un link para activar tu cuenta. Revisa tu bandeja de entrada (incluye spam).',
          'Email enviado',
          5000,
        );
      },
      error: () => {
        this.recoveryPending.set(false);
        // Same generic message — backend intentionally doesn't reveal
        // whether the email exists. Don't leak via the error either.
        this.toast.success(
          'Te enviamos un email con un link para activar tu cuenta. Revisa tu bandeja de entrada (incluye spam).',
          'Email enviado',
          5000,
        );
      },
    });
  }

  onSubmit(): void {
    // Store closed: re-surface the branded banner at the start of the auth
    // action (login/register). The banner overlays without blocking the modal;
    // the backend remains the real block.
    if (this.storeAvailability.unavailable()) {
      this.storeAvailability.reopen();
    }

    if (this.authForm.invalid) {
      this.authForm.markAllAsTouched();
      this.toast.warning(
        'Completa todos los campos requeridos',
        'Formulario incompleto',
      );
      return;
    }

    // Verificar aceptación de documentos legales en registro
    if (this.isRegister() && this.pendingDocuments().length > 0) {
      const accepted = this.acceptedDocuments();
      const allAccepted = this.pendingDocuments().every(
        (doc) => accepted[doc.document_id],
      );
      if (!allAccepted) {
        this.errorMessage.set(
          'Debes aceptar todos los documentos legales para continuar.',
        );
        return;
      }
    }

    // Clear previous errors
    this.errorMessage.set(null);

    if (this.isForgot()) {
      // Recuperar contraseña: solo requiere el email + store_id.
      const storeId = this.tenantFacade.getCurrentStoreId();

      if (!storeId) {
        this.errorMessage.set(
          'No se pudo identificar la tienda. Por favor, recarga la página.',
        );
        return;
      }

      this.authFacade.forgotCustomerPassword(this.authForm.value.email, storeId);
      // No cerramos el modal: la confirmación se muestra en la misma vista.
      return;
    }

    if (this.isLogin()) {
      // Use the dedicated loginCustomer for e-commerce
      const storeId = this.tenantFacade.getCurrentStoreId();

      if (!storeId) {
        this.errorMessage.set(
          'No se pudo identificar la tienda. Por favor, recarga la página.',
        );
        return;
      }

      this.authFacade.loginCustomer(
        this.authForm.value.email,
        this.authForm.value.password,
        storeId,
      );
    } else {
      // Get values from form
      const { email, password, first_name, last_name } = this.authForm.value;

      // Get store_id safely using the new robust method
      const storeId = this.tenantFacade.getCurrentStoreId();

      if (!storeId) {
        this.errorMessage.set(
          'No se pudo identificar la tienda. Por favor, recarga la página.',
        );
        return;
      }

      // Explicitly construct the payload to avoid any extra properties like 'type'
      const payload = {
        email,
        password,
        first_name,
        last_name,
        store_id: storeId,
      };

      this.authFacade.registerCustomer(payload);
    }
  }
}
