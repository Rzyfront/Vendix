import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  DestroyRef,
  model,
  output,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { ModalComponent } from '../modal/modal.component';
import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';
import { WelcomeStepComponent } from './steps/welcome-step.component';
import { EmailVerificationStepComponent } from './steps/email-verification-step.component';
import { UserSetupStepComponent } from './steps/user-setup-step.component';
import { OrganizationSetupStepComponent } from './steps/organization-setup-step.component';
import { StoreSetupStepComponent } from './steps/store-setup-step.component';
import { AppConfigStepComponent } from './steps/app-config-step.component';
import { CompletionStepComponent } from './steps/completion-step.component';
import { TermsStepComponent } from './steps/terms-step.component';
import { OnboardingWizardService } from '../../../core/services/onboarding-wizard.service';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { ToastService } from '../toast/toast.service';
import { EnvironmentSwitchService } from '../../../core/services/environment-switch.service';

interface WizardStep {
  id: number;
  title: string;
  description: string;
  icon: string;
}

@Component({
  selector: 'app-onboarding-modal',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    WelcomeStepComponent,
    EmailVerificationStepComponent,
    UserSetupStepComponent,
    OrganizationSetupStepComponent,
    StoreSetupStepComponent,
    AppConfigStepComponent,
    CompletionStepComponent,
    TermsStepComponent
],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      [title]="currentStepInfo()?.title || ''"
      [subtitle]="currentStepInfo()?.description || ''"
      size="xl-mid"
      [showCloseButton]="false"
      [closeOnBackdrop]="false"
      (closed)="onClosed()"
      >
      <!-- Progress Bar -->
      @if (businessType()) {
        <div class="mb-6">
          <div class="flex justify-between items-center mb-2">
            <span class="text-sm text-[var(--color-text-secondary)]"
              >Paso {{ currentStep() }} de {{ steps().length }}</span
              >
              <span class="text-sm text-[var(--color-text-secondary)]"
                >{{ Math.round(progress()) }}%</span
                >
              </div>
              <div class="w-full bg-[var(--color-background)] rounded-full h-2">
                <div
                  class="bg-[var(--color-primary)] h-2 rounded-full transition-all duration-300 ease-out"
                  [style.width.%]="progress()"
                ></div>
              </div>
            </div>
          }
    
          <!-- Step Content -->
          <div class="min-h-[300px] sm:min-h-[400px]">
            <!-- Step 1: Welcome & App Type Selection (Obligatorio) -->
            @if (currentStep() === 1) {
              <app-welcome-step
                [userFirstName]="userName()"
                (businessTypeSelected)="onBusinessTypeSelected($event)"
                (selectionChanged)="onSelectionChanged()"
              ></app-welcome-step>
            }
    
            <!-- Step 2: Email Verification (Obligatorio) -->
            @if (currentStep() === 2 && businessType()) {
              <app-email-verification-step
                (nextStep)="nextStep()"
                (previousStep)="previousStep()"
              ></app-email-verification-step>
            }
    
            <!-- Step 3: User Setup with Address (Obligatorio) -->
            @if (currentStep() === 3 && businessType()) {
              <app-user-setup-step
                [formGroup]="userForm"
                (previousStep)="previousStep()"
              ></app-user-setup-step>
            }
    
            <!-- Store Flow (Steps 4-6) -->
            @if (businessType() === 'STORE' && currentStep() > 3) {
              <!-- Step 4: Store Setup -->
              @if (currentStep() === 4) {
                <app-store-setup-step
                  [formGroup]="storeForm"
                  (previousStep)="previousStep()"
                ></app-store-setup-step>
              }
              <!-- Step 5: App Configuration -->
              @if (currentStep() === 5) {
                <app-app-config-step
                  [formGroup]="appConfigForm"
                  (previousStep)="previousStep()"
                ></app-app-config-step>
              }
              <!-- Step 6: Terms & Conditions -->
              @if (currentStep() === 6) {
                <app-terms-step
                  (completed)="onTermsAccepted()"
                  (back)="previousStep()"
                ></app-terms-step>
              }
              <!-- Step 7: Completion -->
              @if (currentStep() === 7) {
                <app-completion-step
                  [wizardData]="wizardData()"
                  [isCompleting]="isSubmitting()"
                  (complete)="completeWizard()"
                  (goBack)="previousStep()"
                ></app-completion-step>
              }
            }
    
            <!-- Organization Flow (Steps 4-8) -->
            @if (businessType() === 'ORGANIZATION' && currentStep() > 3) {
              <!-- Step 4: Organization Setup -->
              @if (currentStep() === 4) {
                <app-organization-setup-step
                  [formGroup]="organizationForm"
                  [isAutoGenerated]="false"
                  (previousStep)="previousStep()"
                ></app-organization-setup-step>
              }
              <!-- Step 5: Store Setup (Preloaded with organization data) -->
              @if (currentStep() === 5) {
                <app-store-setup-step
                  [formGroup]="storeForm"
                  (previousStep)="previousStep()"
                ></app-store-setup-step>
              }
              <!-- Step 6: App Configuration -->
              @if (currentStep() === 6) {
                <app-app-config-step
                  [formGroup]="appConfigForm"
                  (previousStep)="previousStep()"
                ></app-app-config-step>
              }
              <!-- Step 7: Terms & Conditions -->
              @if (currentStep() === 7) {
                <app-terms-step
                  (completed)="onTermsAccepted()"
                  (back)="previousStep()"
                ></app-terms-step>
              }
              <!-- Step 8: Completion -->
              @if (currentStep() === 8) {
                <app-completion-step
                  [wizardData]="wizardData()"
                  [isCompleting]="isSubmitting()"
                  (complete)="completeWizard()"
                  (goBack)="previousStep()"
                ></app-completion-step>
              }
            }
          </div>
    
          <!-- Unified Footer Navigation - Always visible except on step 1 without business type -->
          @if (showFooter()) {
            <div class="onboarding-footer" slot="footer">
              <!-- Left side: Back button + Skip -->
              <div class="flex items-center gap-2">
                @if (canGoBack() && !isCompletionStep()) {
                  <app-button
                    variant="outline"
                    size="xsm"
                    (clicked)="previousStep()"
                    >
                    <app-icon name="arrow-left" size="14" slot="icon"></app-icon>
                    @if (!isTermsStep()) {
                      Anterior
                    }
                  </app-button>
                }
              </div>
              <!-- Right side: Next/Complete/Terms Actions -->
              <div class="flex items-center gap-2">
                <!-- Terms step: Accept All button -->
                @if (isTermsStep() && termsStep()) {
                  <app-button
                    variant="outline"
                    size="xsm"
                    [disabled]="termsStep()!.submitting()"
                    (clicked)="termsStep()!.acceptAllAndSubmit()"
                    >
                    <app-icon name="check-check" size="14" slot="icon"></app-icon>
                    Aceptar todo
                  </app-button>
                }
                <!-- Completion step: Go to store button -->
                @if (isCompletionStep()) {
                  <app-button
                    variant="primary"
                    size="xsm"
                    [disabled]="isSubmitting() || isProcessing()"
                    (clicked)="completeWizard()"
                    >
                    {{ isSubmitting() ? 'Finalizando...' : 'Ir a mi tienda' }}
                    @if (!isSubmitting()) {
                      <app-icon
                        name="arrow-right"
                        size="14"
                        slot="icon"
                      ></app-icon>
                    }
                    @if (isSubmitting()) {
                      <app-icon
                        name="loader-2"
                        size="14"
                        slot="icon"
                        [spin]="true"
                      ></app-icon>
                    }
                  </app-button>
                }
                <!-- Regular next button (not on completion or terms) -->
                @if (!isCompletionStep() && !isTermsStep()) {
                  <app-button
                    variant="primary"
                    size="xsm"
                    (clicked)="nextStep()"
            [disabled]="
              isSubmitting() || isProcessing() || !canProceedFromCurrentStep()
            "
                    >
                    {{ nextButtonText() }}
                    @if (!isSubmitting()) {
                      <app-icon
                        name="arrow-right"
                        size="14"
                        slot="icon"
                      ></app-icon>
                    }
                    @if (isSubmitting()) {
                      <app-icon
                        name="loader-2"
                        size="14"
                        slot="icon"
                        [spin]="true"
                      ></app-icon>
                    }
                  </app-button>
                }
                <!-- Terms step: Accept selected button -->
                @if (isTermsStep() && termsStep()) {
                  <app-button
                    variant="primary"
                    size="xsm"
                    [disabled]="!termsStep()!.allAccepted || termsStep()!.submitting()"
                    (clicked)="termsStep()!.submitAcceptances()"
                    >
                    {{ termsStep()!.submitting() ? 'Procesando...' : 'Continuar' }}
                    @if (!termsStep()!.submitting()) {
                      <app-icon
                        name="arrow-right"
                        size="14"
                        slot="icon"
                      ></app-icon>
                    }
                    @if (termsStep()!.submitting()) {
                      <app-icon
                        name="loader-2"
                        size="14"
                        slot="icon"
                        [spin]="true"
                      ></app-icon>
                    }
                  </app-button>
                }
              </div>
            </div>
          }
        </app-modal>
    `,
  styleUrls: ['./onboarding-modal.component.scss'],
})
export class OnboardingModalComponent {
  // --- Two-way binding ---
  readonly isOpen = model<boolean>(false);

  // --- Outputs ---
  readonly completed = output<void>();

  // --- ViewChild as signals ---
  readonly termsStep = viewChild(TermsStepComponent);
  readonly emailVerificationStep = viewChild(EmailVerificationStepComponent);
  readonly welcomeStep = viewChild(WelcomeStepComponent);

  // --- Services ---
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);
  private readonly wizardService = inject(OnboardingWizardService);
  private readonly authFacade = inject(AuthFacade);
  private readonly toastService = inject(ToastService);
  private readonly envSwitchService = inject(EnvironmentSwitchService);


  // --- State signals ---
  readonly isProcessing = signal(false);
  readonly currentStep = signal(1);
  readonly isSubmitting = signal(false);
  readonly wizardData = signal<any>({});
  readonly wizardStatus = signal<any>(null);
  readonly businessType = signal<'STORE' | 'ORGANIZATION' | null>(null);
  readonly userName = signal('');

  // Dynamic steps based on business type
  readonly steps = signal<WizardStep[]>([]);

  // Store-specific steps (6 steps total - Store first, organization auto-generated)
  storeSteps: WizardStep[] = [
    {
      id: 1,
      title: '¡Bienvenido a Vendix!',
      description: 'Vamos a configurar tu tienda',
      icon: 'sparkles',
    },
    {
      id: 2,
      title: 'Verifica tu email',
      description: 'Confirma tu identidad para continuar',
      icon: 'mail',
    },
    {
      id: 3,
      title: 'Tu información',
      description: 'Completa tu perfil y dirección',
      icon: 'user',
    },
    {
      id: 4,
      title: 'Configura tu tienda',
      description: 'Datos básicos de tu negocio',
      icon: 'store',
    },
    {
      id: 5,
      title: 'Personaliza tu app',
      description: 'Branding, colores y dominio',
      icon: 'palette',
    },
    {
      id: 6,
      title: 'Términos y Condiciones',
      description: 'Revisa y acepta los documentos legales',
      icon: 'file-text',
    },
    {
      id: 7,
      title: '¡Todo listo!',
      description: 'Tu tienda está configurada',
      icon: 'check-circle',
    },
  ];

  // Organization-specific steps (8 steps total - Organization first)
  organizationSteps: WizardStep[] = [
    {
      id: 1,
      title: '¡Bienvenido a Vendix!',
      description: 'Vamos a configurar tu organización',
      icon: 'sparkles',
    },
    {
      id: 2,
      title: 'Verifica tu email',
      description: 'Confirma tu identidad para continuar',
      icon: 'mail',
    },
    {
      id: 3,
      title: 'Tu información',
      description: 'Completa tu perfil y dirección',
      icon: 'user',
    },
    {
      id: 4,
      title: 'Configura tu organización',
      description: 'Datos de tu empresa',
      icon: 'building',
    },
    {
      id: 5,
      title: 'Configura tu tienda',
      description: 'Tu punto de venta principal',
      icon: 'store',
    },
    {
      id: 6,
      title: 'Personaliza tu app',
      description: 'Branding, colores y dominio',
      icon: 'palette',
    },
    {
      id: 7,
      title: 'Términos y Condiciones',
      description: 'Revisa y acepta los documentos legales',
      icon: 'file-text',
    },
    {
      id: 8,
      title: '¡Todo listo!',
      description: 'Tu organización está configurada',
      icon: 'check-circle',
    },
  ];

  // Forms
  userForm: FormGroup = new FormGroup({});
  organizationForm: FormGroup = new FormGroup({});
  storeForm: FormGroup = new FormGroup({});
  appConfigForm: FormGroup = new FormGroup({});

  // Math utility for template
  readonly Math = Math;

  constructor() {
    this.initializeForms();
    this.loadUserData();
    this.subscribeToWizardData();
  }

  onBusinessTypeSelected(event: { type: 'STORE' | 'ORGANIZATION' }): void {
    if (this.isProcessing()) return;
    this.isProcessing.set(true);

    this.businessType.set(event.type);

    // Smart Check: Skip if already selected same type
    const currentAppType =
      this.wizardStatus()?.user_settings?.config?.selected_app_type;
    const newAppType = event.type === 'STORE' ? 'STORE_ADMIN' : 'ORG_ADMIN';

    if (currentAppType === newAppType) {
      this.steps.set(
        event.type === 'STORE' ? this.storeSteps : this.organizationSteps,
      );
      this.updateAppConfigForm();
      this.updateFormBasedOnBusinessType();
      this.wizardService.nextStep();
      this.isProcessing.set(false);
      return;
    }

    // Call backend to save app type selection
    this.wizardService
      .selectAppType({
        app_type: event.type === 'STORE' ? 'STORE_ADMIN' : 'ORG_ADMIN',
        notes: `User selected ${event.type} approach`,
      })
      .subscribe({
        next: (response) => {
          this.toastService.success(
            'Tipo de negocio seleccionado correctamente',
          );

          // Update local state
          this.steps.set(
            event.type === 'STORE' ? this.storeSteps : this.organizationSteps,
          );
          this.updateAppConfigForm();
          this.updateFormBasedOnBusinessType();

          // Move to next step
          this.wizardService.nextStep();
          this.isProcessing.set(false);
        },
        error: (error) => {
          console.error('Error selecting app type:', error);
          this.toastService.error(
            error?.error?.message || 'Error al seleccionar tipo de negocio',
            'Error',
          );
          this.isProcessing.set(false);
        },
      });
  }

  onSelectionChanged(): void {
    // No-op: signals trigger CD automatically
  }

  private updateAppConfigForm(): void {
    if (this.businessType() === 'STORE') {
      this.appConfigForm.patchValue({
        app_type: 'STORE_ADMIN',
      });
    } else {
      this.appConfigForm.patchValue({
        app_type: 'ORG_ADMIN',
      });
    }
  }

  private updateFormBasedOnBusinessType(): void {
    if (this.businessType() === 'STORE') {
      // For single store, organization is auto-generated in backend when store is created
      // No need to populate organization form since it won't be shown
    } else if (this.businessType() === 'ORGANIZATION') {
      // For organization first, preload store form with organization data
      this.organizationForm.valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((orgData) => {
          if (orgData.name) {
            // Extract base name without "Org" if exists
            const baseName = orgData.name.replace(/\s+Org$/i, '');
            this.storeForm.patchValue({
              name: baseName,
              description: `Tienda principal de ${orgData.name}`,
              phone: orgData.phone || '',
            });
          }
        });
    }
  }

  private initializeForms(): void {
    // User Form with Address
    this.userForm = this.fb.group({
      // Personal Information (all optional as shown in UI)
      first_name: [''],
      last_name: [''],
      phone: [''],

      // Address Information
      address_line1: [''],
      address_line2: [''],
      city: [''],
      state_province: [''],
      postal_code: [''],
      country_code: ['CO'],
    });

    // Organization Form
    this.organizationForm = this.fb.group({
      name: ['', Validators.required],
      description: [''],
      legal_name: [''],
      tax_id: [''],
      email: ['', [Validators.required, Validators.email]],
      phone: [''],
      website: [''],
    });

    // Store Form
    this.storeForm = this.fb.group({
      name: ['', Validators.required],
      description: [''],
      store_type: ['hybrid', Validators.required],
      timezone: ['America/Bogota', Validators.required],
      currency: ['COP', Validators.required],
      // Address fields are now optional as requested
      address_line1: [''],
      city: [''],
      state_province: [''],
      postal_code: [''],
      country_code: ['CO'],
    });

    // App Config Form
    this.appConfigForm = this.fb.group({
      app_type: ['ORG_ADMIN', Validators.required],
      primary_color: ['#3B82F6', Validators.required],
      secondary_color: ['#10B981', Validators.required],
      accent_color: ['#F59E0B'], // Optional accent/tertiary color
      use_custom_domain: [false],
      custom_domain: [''],
      subdomain: [''],
    });

    // Setup data preloading
    this.setupDataPreloading();
  }

  private setupDataPreloading(): void {
    // User address → Store address preloading
    this.userForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((userData) => {
        if (
          userData.address_line1 ||
          userData.city ||
          userData.state_province ||
          userData.postal_code ||
          userData.country_code
        ) {
          this.storeForm.patchValue(
            {
              address_line1: userData.address_line1 || '',
              city: userData.city || '',
              state_province: userData.state_province || '',
              postal_code: userData.postal_code || '',
              country_code: userData.country_code || 'CO',
            },
            { emitEvent: false },
          );
        }
      });

    // User address → Organization address preloading
    this.userForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((userData) => {
        // For organization, we can preload phone if available
        if (userData.phone && !this.organizationForm.value.phone) {
          this.organizationForm.patchValue(
            {
              phone: userData.phone,
            },
            { emitEvent: false },
          );
        }
      });

    // Organization address → Store address preloading
    this.organizationForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((orgData) => {
        if (orgData.name) {
          // Extract base name without "Org" if exists
          const baseName = orgData.name.replace(/\s+Org$/i, '');
          this.storeForm.patchValue(
            {
              name: baseName,
              description: `Tienda principal de ${orgData.name}`,
              phone: orgData.phone || '',
            },
            { emitEvent: false },
          );
        }
      });
  }

  private loadUserData(): void {
    this.authFacade.user$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) => {
        if (user) {
          // Set user name for welcome greeting
          this.userName.set(user.first_name || 'Usuario');

          // Pre-fill user form with personal information
          if (user.first_name)
            this.userForm.patchValue({ first_name: user.first_name });
          if (user.last_name)
            this.userForm.patchValue({ last_name: user.last_name });
          if (user.phone) this.userForm.patchValue({ phone: user.phone });

          // Pre-fill user address if available
          if (user.addresses && user.addresses.length > 0) {
            const primaryAddress =
              user.addresses.find((addr: any) => addr.is_primary) ||
              user.addresses[0];
            if (primaryAddress) {
              this.userForm.patchValue({
                address_line1: primaryAddress.address_line1 || '',
                address_line2: primaryAddress.address_line2 || '',
                city: primaryAddress.city || '',
                state_province: primaryAddress.state_province || '',
                postal_code: primaryAddress.postal_code || '',
                country_code: primaryAddress.country_code || 'CO',
              });
            }
          }

          // Pre-fill organization form
          if (user.organizations?.name) {
            this.organizationForm.patchValue({
              name: user.organizations.name,
              description: user.organizations.description || '',
              legal_name: user.organizations.legal_name || '',
              tax_id: user.organizations.tax_id || '',
              email: user.organizations.email || user.email,
              phone: user.organizations.phone || user.phone,
              website: user.organizations.website || '',
            });
          }
        }
      });
  }

  private subscribeToWizardData(): void {
    this.wizardService.currentStep$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((step) => {
        this.currentStep.set(step);
      });

    // Load wizard status from backend to sync current step - only once on init
    this.wizardService.getWizardStatus().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.wizardStatus.set(response.data); // Save status for smart navigation
          // Set business type based on selected app type
          const userSettings = response.data.user_settings?.config;
          const selectedAppType = userSettings?.selected_app_type;

          if (selectedAppType) {
            const resolvedType: 'STORE' | 'ORGANIZATION' =
              selectedAppType === 'STORE_ADMIN' ? 'STORE' : 'ORGANIZATION';
            this.businessType.set(resolvedType);

            // Sync service state
            this.wizardService.setAppType(selectedAppType);

            this.steps.set(
              resolvedType === 'STORE' ? this.storeSteps : this.organizationSteps,
            );
            this.updateAppConfigForm();
            this.updateFormBasedOnBusinessType();

            // Pre-fill App Config form with previous data if exists
            if (response.data.onboarding_data) {
              this.appConfigForm.patchValue(response.data.onboarding_data, {
                emitEvent: false,
              });
            }
          }

          // Sync current step from backend
          if (response.data.current_step) {
            this.wizardService.goToStep(response.data.current_step);
          }
        }
      },
      error: (error) => {
        console.error('Error loading wizard status:', error);
      },
    });
  }

  readonly currentStepInfo = computed<WizardStep | undefined>(() =>
    this.steps().find((s) => s.id === this.currentStep()),
  );

  readonly progress = computed<number>(() => {
    // If no business type selected yet, show 0%
    if (!this.businessType()) return 0;
    return (this.currentStep() / this.steps().length) * 100;
  });

  readonly canGoBack = computed<boolean>(() => this.currentStep() > 1);

  readonly canGoNext = computed<boolean>(
    () => this.currentStep() < this.steps().length,
  );

  /**
   * Check if the user can proceed from the current step.
   * Step 1: Business type must be selected
   * Step 2: Email must be verified
   */
  readonly canProceedFromCurrentStep = computed<boolean>(() => {
    // Step 1 requires business type selection
    if (this.currentStep() === 1) {
      return !!this.welcomeStep()?.selectedType || !!this.businessType();
    }
    // Step 2 is email verification - require verified email
    if (this.currentStep() === 2) {
      return this.emailVerificationStep()?.isEmailVerified ?? false;
    }
    return true;
  });

  readonly isTermsStep = computed<boolean>(
    () =>
      (this.businessType() === 'STORE' && this.currentStep() === 6) ||
      (this.businessType() === 'ORGANIZATION' && this.currentStep() === 7),
  );

  readonly isCompletionStep = computed<boolean>(
    () =>
      (this.businessType() === 'STORE' && this.currentStep() === 7) ||
      (this.businessType() === 'ORGANIZATION' && this.currentStep() === 8),
  );

  /**
   * Determines whether to show the unified footer navigation.
   * Hidden on step 1 (welcome step handles its own navigation via card selection).
   */
  readonly showFooter = computed<boolean>(() => this.currentStep() > 1);

  /**
   * Dynamic text for the next button based on current step.
   */
  readonly nextButtonText = computed<string>(() => {
    if (this.isSubmitting()) return 'Procesando...';
    if (this.currentStep() === 1) return 'Continuar';
    return 'Siguiente';
  });

  nextStep(): void {
    if (!this.canGoNext() || this.isProcessing()) return;

    // Handle form submission based on current step
    switch (this.currentStep()) {
      case 1: { // Welcome - Business Type Selection
        const selectedType = this.welcomeStep()?.selectedType;
        if (selectedType) {
          this.onBusinessTypeSelected({ type: selectedType });
        } else {
          this.isProcessing.set(false);
        }
        break;
      }
      case 3: // User Setup
        this.isProcessing.set(true);
        this.submitUserSetup();
        break;
      case 4: // Store Setup or Organization Setup (conditional)
        this.isProcessing.set(true);
        if (this.businessType() === 'STORE') {
          this.submitStoreSetup();
        } else {
          this.submitOrganizationSetup();
        }
        break;
      case 5: // App Configuration (Store flow) or Store Setup (Org flow)
        this.isProcessing.set(true);
        if (this.businessType() === 'STORE') {
          this.submitAppConfig();
        } else {
          this.submitStoreSetup();
        }
        break;
      case 6: // App Configuration (Org flow) or Terms (Store flow)
        if (this.businessType() === 'STORE') {
          // Store flow: step 6 is Terms, handled by component
          this.isProcessing.set(false);
        } else {
          this.isProcessing.set(true);
          this.submitAppConfig();
        }
        break;
      case 7: // Terms (Org flow) or Completion (Store flow)
        if (this.businessType() === 'STORE') {
          // Store flow: step 7 is completion
          this.isProcessing.set(true);
          this.wizardService.nextStep();
          this.isProcessing.set(false);
        } else {
          // Org flow: step 7 is Terms, handled by component
          this.isProcessing.set(false);
        }
        break;
      default:
        // For steps without form submission, just move to next step
        this.isProcessing.set(true);
        this.wizardService.nextStep();
        this.isProcessing.set(false);
    }
  }

  onTermsAccepted(): void {
    this.wizardService.nextStep();
  }

  previousStep(): void {
    if (this.canGoBack() && !this.isProcessing()) {
      this.wizardService.previousStep();
    }
  }

  private submitUserSetup(): void {
    if (this.userForm.invalid) {
      // Mark form fields as touched to show validation errors
      Object.keys(this.userForm.controls).forEach((key) => {
        this.userForm.get(key)?.markAsTouched();
      });
      this.toastService.warning('Por favor completa los campos requeridos');
      this.isProcessing.set(false);
      return;
    }

    this.isSubmitting.set(true);
    const userData = this.userForm.value;

    // Smart Check: Skip if already done and form not modified
    if (
      this.wizardStatus()?.has_user_data &&
      this.wizardStatus()?.has_user_address &&
      this.userForm.pristine
    ) {
      this.isSubmitting.set(false);
      this.isProcessing.set(false);
      this.wizardService.nextStep();
      return;
    }

    this.wizardService.setupUser(userData).subscribe({
      next: (response) => {
        this.isSubmitting.set(false);
        this.isProcessing.set(false);
        if (response.success) {
          this.wizardData.update((d) => ({ ...d, user: userData }));
          this.toastService.success('Perfil actualizado correctamente');
          // The service already calls nextStep() automatically
        }
      },
      error: (error) =>
        this.handleOnboardingError(error, 'Error al configurar tu perfil'),
    });
  }

  private submitStoreSetup(): void {
    if (this.storeForm.invalid) {
      Object.keys(this.storeForm.controls).forEach((key) => {
        this.storeForm.get(key)?.markAsTouched();
      });
      this.toastService.warning(
        'Por favor completa los campos requeridos de la tienda',
      );
      this.isProcessing.set(false);
      return;
    }

    this.isSubmitting.set(true);
    const storeData = this.storeForm.value;

    // Smart Check
    if (
      this.wizardStatus()?.has_store &&
      this.wizardStatus()?.has_store_address &&
      this.storeForm.pristine
    ) {
      this.isSubmitting.set(false);
      this.isProcessing.set(false);
      this.wizardService.nextStep();
      return;
    }

    this.wizardService.setupStore(storeData).subscribe({
      next: (response) => {
        this.isSubmitting.set(false);
        this.isProcessing.set(false);
        if (response.success) {
          this.wizardData.update((d) => ({ ...d, store: storeData }));
          this.toastService.success('Tienda configurada correctamente');
          // The service already calls nextStep() automatically
        }
      },
      error: (error) =>
        this.handleOnboardingError(error, 'Error al configurar la tienda'),
    });
  }

  private submitOrganizationSetup(): void {
    if (this.organizationForm.invalid) {
      Object.keys(this.organizationForm.controls).forEach((key) => {
        this.organizationForm.get(key)?.markAsTouched();
      });
      this.toastService.warning(
        'Por favor completa los campos requeridos de la organización',
      );
      this.isProcessing.set(false);
      return;
    }

    this.isSubmitting.set(true);
    const organizationData = this.organizationForm.value;

    // Smart Check
    if (this.wizardStatus()?.has_organization && this.organizationForm.pristine) {
      this.isSubmitting.set(false);
      this.isProcessing.set(false);
      this.wizardService.nextStep();
      return;
    }

    this.wizardService.setupOrganization(organizationData).subscribe({
      next: (response) => {
        this.isSubmitting.set(false);
        this.isProcessing.set(false);
        if (response.success) {
          this.wizardData.update((d) => ({ ...d, organization: organizationData }));
          this.toastService.success('Organización creada correctamente');
          // The service already calls nextStep() automatically
        }
      },
      error: (error) =>
        this.handleOnboardingError(
          error,
          'Error al configurar la organización',
        ),
    });
  }

  private submitAppConfig(): void {
    if (this.appConfigForm.invalid) {
      Object.keys(this.appConfigForm.controls).forEach((key) => {
        this.appConfigForm.get(key)?.markAsTouched();
      });
      this.toastService.warning(
        'Por favor completa la configuración de la aplicación',
      );
      this.isProcessing.set(false);
      return;
    }

    this.isSubmitting.set(true);
    const formData = this.appConfigForm.value;

    // Smart Check
    if (
      this.wizardStatus()?.step_app_config_completed &&
      this.appConfigForm.pristine
    ) {
      this.isSubmitting.set(false);
      this.isProcessing.set(false);
      this.wizardService.nextStep();
      return;
    }

    // Sanitize payload: only send fields the backend expects
    const appConfigData: any = {
      app_type: formData.app_type,
      primary_color: formData.primary_color,
      secondary_color: formData.secondary_color,
      use_custom_domain: formData.use_custom_domain,
    };

    // Include accent_color if provided
    if (formData.accent_color) {
      appConfigData.accent_color = formData.accent_color;
    }

    // Only include subdomain if it has a value
    if (formData.subdomain && formData.subdomain.trim()) {
      appConfigData.subdomain = formData.subdomain.trim();
    }

    // Only include custom_domain if using custom domain and has a value
    if (
      formData.use_custom_domain &&
      formData.custom_domain &&
      formData.custom_domain.trim()
    ) {
      appConfigData.custom_domain = formData.custom_domain.trim();
    }

    this.wizardService.setupAppConfig(appConfigData).subscribe({
      next: (response) => {
        this.isSubmitting.set(false);
        this.isProcessing.set(false);
        if (response.success) {
          this.wizardData.update((d) => ({ ...d, appConfig: appConfigData }));
          this.toastService.success('Configuración guardada correctamente');
          // The service already calls nextStep() automatically
        }
      },
      error: (error) =>
        this.handleOnboardingError(error, 'Error al guardar la configuración'),
    });
  }

  async completeWizard(): Promise<void> {
    if (this.isProcessing()) return;
    this.isProcessing.set(true);
    this.isSubmitting.set(true);

    try {
      const response = await this.wizardService.completeWizard().toPromise();

      if (response?.success) {
        // Get app type from service or fallback to local state
        const app_type =
          this.wizardService.getAppType() ||
          (this.businessType() === 'STORE' ? 'STORE_ADMIN' : 'ORG_ADMIN');

        if (app_type === 'STORE_ADMIN') {
          const store_slug = this.wizardService.getCreatedStoreSlug();

          if (store_slug) {
            try {
              await this.envSwitchService.performEnvironmentSwitch(
                'STORE_ADMIN',
                store_slug,
              );
            } catch (switchError) {
              console.error('Error switching environment:', switchError);
              this.toastService.error('Error al cambiar al entorno de tienda');
              // Fallback reload to ensure clean state
              window.location.reload();
            }
          } else {
            // Si no hay slug, redirigir al dashboard general sin switch de entorno
            this.toastService.warning(
              'No se pudo identificar la tienda específica, redirigiendo al panel general',
            );
            // Fallback reload to ensure clean state
            window.location.reload();
          }
        } else if (app_type === 'ORG_ADMIN') {
          // Para ORG_ADMIN, hacer switch a entorno de organización
          try {
            await this.envSwitchService.performEnvironmentSwitch('ORG_ADMIN');
          } catch (switchError) {
            console.error(
              'Error switching to organization environment:',
              switchError,
            );
            // Fallback reload to ensure clean state
            window.location.reload();
          }
        } else {
          this.toastService.warning(
            'Tipo de aplicación no reconocido, redirigiendo al panel general',
          );
          window.location.reload();
        }

        this.toastService.success(
          '¡Configuración completada! Bienvenido a Vendix',
          'Éxito',
        );
        this.completed.emit();
        this.close();
      } else {
        this.toastService.error(
          response?.message || 'No se pudo completar la configuración',
          'Error',
        );
      }
    } catch (error: any) {
      this.handleOnboardingError(error, 'Error al completar la configuración');
    } finally {
      this.isSubmitting.set(false);
      this.isProcessing.set(false);
    }
  }

  /**
   * Centralized error handler for onboarding operations
   * Translates technical errors (especially missing steps) into friendly Spanish messages
   */
  private handleOnboardingError(error: any, defaultMessage: string): void {
    console.error('Onboarding Error:', error);
    this.isSubmitting.set(false);
    this.isProcessing.set(false);

    // Check for "Missing steps" error specifically
    const errorMessage = error?.error?.message || error?.message || '';

    if (
      errorMessage.includes('Missing steps') ||
      errorMessage.includes('missing steps')
    ) {
      // Extract the missing steps list
      const match = errorMessage.match(/steps: (.+)/i);
      if (match && match[1]) {
        const rawSteps = match[1].split(',').map((s: string) => s.trim());
        const friendlySteps = rawSteps.map((step: string) => {
          switch (step) {
            case 'email_verification':
              return 'Verificación de Correo';
            case 'app_type_selection':
              return 'Selección de Tipo de Negocio';
            case 'organization_setup':
              return 'Configuración de Organización';
            case 'store_setup':
              return 'Configuración de Tienda';
            case 'app_configuration':
              return 'Configuración de Aplicación';
            default:
              return step;
          }
        });

        this.toastService.warning(
          `No se puede completar el proceso. Pasos pendientes: ${friendlySteps.join(', ')}`,
          'Pasos Incompletos',
          6000,
        );
        return;
      }
    }

    // Handle generic errors with translation if possible
    let displayMessage = defaultMessage;

    if (error?.error?.message) {
      // Translate common backend errors if needed, or display as is if readable
      displayMessage = error.error.message;

      // Simple translation map for common auth/validation errors
      if (displayMessage.includes('Unique constraint failed')) {
        if (displayMessage.includes('hostname'))
          displayMessage = 'Este dominio ya está en uso. Por favor elige otro.';
        else if (displayMessage.includes('email'))
          displayMessage = 'Este correo electrónico ya está registrado.';
        else if (displayMessage.includes('slug'))
          displayMessage =
            'El identificador generado ya existe, intenta con otro nombre.';
        else displayMessage = 'Ya existe un registro con esta información.';
      }
    }

    this.toastService.error(displayMessage, 'Error');
  }

  close(): void {
    if (!this.isProcessing()) {
      this.isOpen.set(false);
    }
  }

  onClosed(): void {
    // Optional: Handle any cleanup when modal closes
  }
}
