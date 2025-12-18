import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
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
import { OnboardingWizardService } from '../../../core/services/onboarding-wizard.service';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { ToastService } from '../toast/toast.service';
import { EnvironmentSwitchService } from '../../../core/services/environment-switch.service';
import { CountryService } from '../../../services/country.service';
import { Subject, takeUntil } from 'rxjs';

interface WizardStep {
  id: number;
  title: string;
  description: string;
  icon: string;
  canSkip: boolean;
}

@Component({
  selector: 'app-onboarding-modal',
  standalone: true,
  imports: [
    CommonModule,
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
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      [title]="currentStepInfo?.title || ''"
      [subtitle]="currentStepInfo?.description || ''"
      size="lg"
      [showCloseButton]="false"
      [closeOnBackdrop]="false"
      (closed)="onClosed()"
    >
      <!-- Progress Bar -->
      <div class="mb-6" *ngIf="businessType">
        <div class="flex justify-between items-center mb-2">
          <span class="text-sm text-[var(--color-text-secondary)]"
            >Paso {{ currentStep }} de {{ steps.length }}</span
          >
          <span class="text-sm text-[var(--color-text-secondary)]"
            >{{ Math.round(progress) }}%</span
          >
        </div>
        <div class="w-full bg-[var(--color-background)] rounded-full h-2">
          <div
            class="bg-[var(--color-primary)] h-2 rounded-full transition-all duration-300 ease-out"
            [style.width.%]="progress"
          ></div>
        </div>
      </div>

      <!-- Step Content -->
      <div class="min-h-[400px]">
        <!-- Step 1: Welcome & App Type Selection (Obligatorio) -->
        <ng-container *ngIf="currentStep === 1">
          <app-welcome-step
            [userFirstName]="userName"
            (businessTypeSelected)="onBusinessTypeSelected($event)"
            (skipSetup)="skipSetup()"
          ></app-welcome-step>
        </ng-container>

        <!-- Step 2: Email Verification (Obligatorio) -->
        <ng-container *ngIf="currentStep === 2 && businessType">
          <app-email-verification-step
            (nextStep)="nextStep()"
            (skipStep)="skipStep()"
            (previousStep)="previousStep()"
          ></app-email-verification-step>
        </ng-container>

        <!-- Step 3: User Setup with Address (Obligatorio) -->
        <ng-container *ngIf="currentStep === 3 && businessType">
          <app-user-setup-step
            [formGroup]="userForm"
            (skipStep)="skipStep()"
            (previousStep)="previousStep()"
          ></app-user-setup-step>
        </ng-container>

        <!-- Store Flow (Steps 4-6) -->
        <ng-container *ngIf="businessType === 'STORE' && currentStep > 3">
          <!-- Step 4: Store Setup -->
          <ng-container *ngIf="currentStep === 4">
            <app-store-setup-step
              [formGroup]="storeForm"
              (skipStep)="skipStep()"
              (previousStep)="previousStep()"
            ></app-store-setup-step>
          </ng-container>

          <!-- Step 5: App Configuration -->
          <ng-container *ngIf="currentStep === 5">
            <app-app-config-step
              [formGroup]="appConfigForm"
              (skipStep)="skipStep()"
              (previousStep)="previousStep()"
            ></app-app-config-step>
          </ng-container>

          <!-- Step 6: Completion -->
          <ng-container *ngIf="currentStep === 6">
            <app-completion-step
              [wizardData]="wizardData"
              (complete)="completeWizard()"
            ></app-completion-step>
          </ng-container>
        </ng-container>

        <!-- Organization Flow (Steps 4-7) -->
        <ng-container
          *ngIf="businessType === 'ORGANIZATION' && currentStep > 3"
        >
          <!-- Step 4: Organization Setup -->
          <ng-container *ngIf="currentStep === 4">
            <app-organization-setup-step
              [formGroup]="organizationForm"
              [isAutoGenerated]="false"
              (skipStep)="skipStep()"
              (previousStep)="previousStep()"
            ></app-organization-setup-step>
          </ng-container>

          <!-- Step 5: Store Setup (Preloaded with organization data) -->
          <ng-container *ngIf="currentStep === 5">
            <app-store-setup-step
              [formGroup]="storeForm"
              (skipStep)="skipStep()"
              (previousStep)="previousStep()"
            ></app-store-setup-step>
          </ng-container>

          <!-- Step 6: App Configuration -->
          <ng-container *ngIf="currentStep === 6">
            <app-app-config-step
              [formGroup]="appConfigForm"
              (skipStep)="skipStep()"
              (previousStep)="previousStep()"
            ></app-app-config-step>
          </ng-container>

          <!-- Step 7: Completion -->
          <ng-container *ngIf="currentStep === 7">
            <app-completion-step
              [wizardData]="wizardData"
              (complete)="completeWizard()"
            ></app-completion-step>
          </ng-container>
        </ng-container>
      </div>

      <!-- Navigation -->
      <div
        class="flex justify-between items-center pt-4 border-t border-[var(--color-border)]"
        slot="footer"
      >
        <div class="flex space-x-3">
          <app-button
            *ngIf="canGoBack"
            variant="outline"
            size="sm"
            (clicked)="previousStep()"
          >
            <app-icon name="arrow-left" size="16" slot="icon"></app-icon>
            Anterior
          </app-button>

          <app-button
            *ngIf="
              canSkip &&
              (currentStep < 5 ||
                (currentStep < 6 && businessType === 'ORGANIZATION'))
            "
            variant="ghost"
            size="sm"
            (clicked)="skipStep()"
          >
            <app-icon name="skip-forward" size="16" slot="icon"></app-icon>
            Omitir
          </app-button>
        </div>

        <div class="flex space-x-3">
          <app-button
            *ngIf="!isCompletionStep"
            variant="outline-danger"
            size="sm"
            (clicked)="close()"
          >
            <app-icon name="x" size="16" slot="icon"></app-icon>
            Omitir
          </app-button>

          <app-button
            *ngIf="!isCompletionStep"
            variant="primary"
            size="sm"
            (clicked)="nextStep()"
            [disabled]="isSubmitting || isProcessing"
          >
            {{
              isSubmitting
                ? 'Procesando...'
                : currentStep === 6 ||
                    (currentStep === 5 && businessType === 'STORE')
                  ? 'Finalizar configuración'
                  : 'Siguiente'
            }}
            <app-icon
              name="arrow-right"
              size="16"
              slot="icon"
              *ngIf="!isSubmitting"
            ></app-icon>
            <app-icon
              name="loader-2"
              size="16"
              slot="icon"
              [spin]="true"
              *ngIf="isSubmitting"
            ></app-icon>
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
  styleUrls: ['./onboarding-modal.component.scss'],
})
export class OnboardingModalComponent implements OnInit, OnDestroy {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() completed = new EventEmitter<void>();

  private destroy$ = new Subject<void>();

  // Prevent multiple simultaneous actions (public for template access)
  isProcessing = false;

  currentStep = 1;
  isSubmitting = false;
  wizardData: any = {};
  businessType: 'STORE' | 'ORGANIZATION' | null = null;
  userName: string = '';

  // Dynamic steps based on business type
  steps: WizardStep[] = [];

  // Store-specific steps (6 steps total - Store first, organization auto-generated)
  storeSteps: WizardStep[] = [
    {
      id: 1,
      title: '¡Bienvenido a Vendix!',
      description: 'Vamos a configurar tu tienda',
      icon: 'sparkles',
      canSkip: false,
    },
    {
      id: 2,
      title: 'Verifica tu email',
      description: 'Confirma tu identidad para continuar',
      icon: 'mail',
      canSkip: false,
    },
    {
      id: 3,
      title: 'Tu información',
      description: 'Completa tu perfil y dirección',
      icon: 'user',
      canSkip: false,
    },
    {
      id: 4,
      title: 'Configura tu tienda',
      description: 'Datos básicos de tu negocio',
      icon: 'store',
      canSkip: false,
    },
    {
      id: 5,
      title: 'Personaliza tu app',
      description: 'Branding, colores y dominio',
      icon: 'palette',
      canSkip: false,
    },
    {
      id: 6,
      title: '¡Todo listo!',
      description: 'Tu tienda está configurada',
      icon: 'check-circle',
      canSkip: false,
    },
  ];

  // Organization-specific steps (7 steps total - Organization first)
  organizationSteps: WizardStep[] = [
    {
      id: 1,
      title: '¡Bienvenido a Vendix!',
      description: 'Vamos a configurar tu organización',
      icon: 'sparkles',
      canSkip: false,
    },
    {
      id: 2,
      title: 'Verifica tu email',
      description: 'Confirma tu identidad para continuar',
      icon: 'mail',
      canSkip: false,
    },
    {
      id: 3,
      title: 'Tu información',
      description: 'Completa tu perfil y dirección',
      icon: 'user',
      canSkip: false,
    },
    {
      id: 4,
      title: 'Configura tu organización',
      description: 'Datos de tu empresa',
      icon: 'building',
      canSkip: false,
    },
    {
      id: 5,
      title: 'Configura tu tienda',
      description: 'Tu punto de venta principal',
      icon: 'store',
      canSkip: false,
    },
    {
      id: 6,
      title: 'Personaliza tu app',
      description: 'Branding, colores y dominio',
      icon: 'palette',
      canSkip: false,
    },
    {
      id: 7,
      title: '¡Todo listo!',
      description: 'Tu organización está configurada',
      icon: 'check-circle',
      canSkip: false,
    },
  ];

  // Forms
  userForm: FormGroup = new FormGroup({});
  organizationForm: FormGroup = new FormGroup({});
  storeForm: FormGroup = new FormGroup({});
  appConfigForm: FormGroup = new FormGroup({});

  // Math utility for template
  readonly Math = Math;

  constructor(
    private fb: FormBuilder,
    private wizardService: OnboardingWizardService,
    private authFacade: AuthFacade,
    private cdr: ChangeDetectorRef,
    private toastService: ToastService,
    private envSwitchService: EnvironmentSwitchService,
    private countryService: CountryService,
  ) {
    this.initializeForms();
  }

  ngOnInit(): void {
    this.loadUserData();
    this.subscribeToWizardData();
  }

  onBusinessTypeSelected(event: { type: 'STORE' | 'ORGANIZATION' }): void {
    if (this.isProcessing) return;
    this.isProcessing = true;

    this.businessType = event.type;

    // Call backend to save app type selection
    this.wizardService
      .selectAppType({
        app_type: event.type === 'STORE' ? 'STORE_ADMIN' : 'ORG_ADMIN',
        notes: `User selected ${event.type} approach`,
      })
      .subscribe({
        next: (response) => {
          console.log('App type selected successfully:', response);
          this.toastService.success(
            'Tipo de negocio seleccionado correctamente',
          );

          // Update local state
          this.steps =
            event.type === 'STORE' ? this.storeSteps : this.organizationSteps;
          this.updateAppConfigForm();
          this.updateFormBasedOnBusinessType();

          // Move to next step
          this.wizardService.nextStep();
          this.isProcessing = false;
          this.cdr.markForCheck(); // Trigger change detection
        },
        error: (error) => {
          console.error('Error selecting app type:', error);
          this.toastService.error(
            error?.error?.message || 'Error al seleccionar tipo de negocio',
            'Error',
          );
          this.isProcessing = false;
          this.cdr.markForCheck(); // Trigger change detection
        },
      });
  }

  private updateAppConfigForm(): void {
    if (this.businessType === 'STORE') {
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
    if (this.businessType === 'STORE') {
      // For single store, organization is auto-generated in backend when store is created
      // No need to populate organization form since it won't be shown
      console.log('Store flow: Organization will be auto-generated in backend');
    } else if (this.businessType === 'ORGANIZATION') {
      // For organization first, preload store form with organization data
      this.organizationForm.valueChanges
        .pipe(takeUntil(this.destroy$))
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

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
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
      store_type: ['physical', Validators.required],
      timezone: ['America/Bogota', Validators.required],
      address_line1: ['', Validators.required],
      city: ['', Validators.required],
      state_province: ['', Validators.required],
      postal_code: ['', Validators.required],
      country_code: ['CO', Validators.required],
    });

    // App Config Form
    this.appConfigForm = this.fb.group({
      app_type: ['ORG_ADMIN', Validators.required],
      primary_color: ['#3B82F6', Validators.required],
      secondary_color: ['#10B981', Validators.required],
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
      .pipe(takeUntil(this.destroy$))
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
      .pipe(takeUntil(this.destroy$))
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
      .pipe(takeUntil(this.destroy$))
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
    this.authFacade.user$.pipe(takeUntil(this.destroy$)).subscribe((user) => {
      if (user) {
        // Set user name for welcome greeting
        this.userName = user.first_name || 'Usuario';

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
      .pipe(takeUntil(this.destroy$))
      .subscribe((step) => {
        this.currentStep = step;
        this.cdr.markForCheck(); // Trigger change detection
      });

    // Load wizard status from backend to sync current step - only once on init
    this.wizardService.getWizardStatus().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          // Set business type based on selected app type
          const userSettings = response.data.user_settings?.config;
          const selectedAppType = userSettings?.selected_app_type;

          if (selectedAppType) {
            this.businessType =
              selectedAppType === 'STORE_ADMIN' ? 'STORE' : 'ORGANIZATION';

            // Sync service state
            this.wizardService.setAppType(selectedAppType);

            this.steps =
              this.businessType === 'STORE'
                ? this.storeSteps
                : this.organizationSteps;
            this.updateAppConfigForm();
            this.updateFormBasedOnBusinessType();
          }

          // Sync current step from backend
          if (response.data.current_step) {
            this.wizardService.goToStep(response.data.current_step);
          }
          this.cdr.markForCheck(); // Trigger change detection
        }
      },
      error: (error) => {
        console.error('Error loading wizard status:', error);
      },
    });
  }

  get currentStepInfo(): WizardStep | undefined {
    return this.steps.find((s) => s.id === this.currentStep);
  }

  get progress(): number {
    // If no business type selected yet, show 0%
    if (!this.businessType) return 0;
    return (this.currentStep / this.steps.length) * 100;
  }

  get canGoBack(): boolean {
    return this.currentStep > 1;
  }

  get canSkip(): boolean {
    return this.currentStepInfo?.canSkip || false;
  }

  get canGoNext(): boolean {
    return this.currentStep < this.steps.length;
  }

  get isCompletionStep(): boolean {
    return (
      (this.businessType === 'STORE' && this.currentStep === 6) ||
      (this.businessType === 'ORGANIZATION' && this.currentStep === 7)
    );
  }

  nextStep(): void {
    if (!this.canGoNext || this.isProcessing) return;
    this.isProcessing = true;

    // Handle form submission based on current step
    switch (this.currentStep) {
      case 3: // User Setup
        this.submitUserSetup();
        break;
      case 4: // Store Setup or Organization Setup (conditional)
        if (this.businessType === 'STORE') {
          this.submitStoreSetup();
        } else {
          this.submitOrganizationSetup();
        }
        break;
      case 5: // App Configuration (Store flow) or Store Setup (Org flow)
        if (this.businessType === 'STORE') {
          this.submitAppConfig();
        } else {
          this.submitStoreSetup();
        }
        break;
      case 6: // App Configuration (Org flow) or Completion (Store flow)
        if (this.businessType === 'STORE') {
          // Store flow: step 6 is completion, no form submission needed
          this.isProcessing = false;
          this.wizardService.nextStep();
        } else {
          this.submitAppConfig();
        }
        break;
      default:
        // For steps without form submission, just move to next step
        this.isProcessing = false;
        this.wizardService.nextStep();
    }
  }

  previousStep(): void {
    if (this.canGoBack && !this.isProcessing) {
      this.wizardService.previousStep();
    }
  }

  skipStep(): void {
    if (this.canSkip && !this.isProcessing) {
      this.wizardService.nextStep();
    }
  }

  skipSetup(): void {
    // Skip entire onboarding process and mark as completed
    this.completeWizard();
  }

  private submitUserSetup(): void {
    if (this.userForm.invalid) {
      // Mark form fields as touched to show validation errors
      Object.keys(this.userForm.controls).forEach((key) => {
        this.userForm.get(key)?.markAsTouched();
      });
      this.toastService.warning('Por favor completa los campos requeridos');
      this.isProcessing = false;
      this.cdr.markForCheck();
      return;
    }

    this.isSubmitting = true;
    this.cdr.markForCheck();
    const userData = this.userForm.value;

    this.wizardService.setupUser(userData).subscribe({
      next: (response) => {
        this.isSubmitting = false;
        this.isProcessing = false;
        if (response.success) {
          this.wizardData.user = userData;
          this.toastService.success('Perfil actualizado correctamente');
          // The service already calls nextStep() automatically
        }
        this.cdr.markForCheck();
      },
      error: (error) => this.handleOnboardingError(error, 'Error al configurar tu perfil'),
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
      this.isProcessing = false;
      this.cdr.markForCheck();
      return;
    }

    this.isSubmitting = true;
    this.cdr.markForCheck();
    const storeData = this.storeForm.value;

    this.wizardService.setupStore(storeData).subscribe({
      next: (response) => {
        this.isSubmitting = false;
        this.isProcessing = false;
        if (response.success) {
          this.wizardData.store = storeData;
          this.toastService.success('Tienda configurada correctamente');
          // The service already calls nextStep() automatically
        }
        this.cdr.markForCheck();
      },
      error: (error) => this.handleOnboardingError(error, 'Error al configurar la tienda'),
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
      this.isProcessing = false;
      this.cdr.markForCheck();
      return;
    }

    this.isSubmitting = true;
    this.cdr.markForCheck();
    const organizationData = this.organizationForm.value;

    this.wizardService.setupOrganization(organizationData).subscribe({
      next: (response) => {
        this.isSubmitting = false;
        this.isProcessing = false;
        if (response.success) {
          this.wizardData.organization = organizationData;
          this.toastService.success('Organización creada correctamente');
          // The service already calls nextStep() automatically
        }
        this.cdr.markForCheck();
      },
      error: (error) => this.handleOnboardingError(error, 'Error al configurar la organización'),
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
      this.isProcessing = false;
      this.cdr.markForCheck();
      return;
    }

    this.isSubmitting = true;
    this.cdr.markForCheck();
    const appConfigData = this.appConfigForm.value;

    // Sanitize payload: if not using custom domain, ensure it's empty
    if (!appConfigData.use_custom_domain) {
      appConfigData.custom_domain = '';
    }

    this.wizardService.setupAppConfig(appConfigData).subscribe({
      next: (response) => {
        this.isSubmitting = false;
        this.isProcessing = false;
        if (response.success) {
          this.wizardData.appConfig = appConfigData;
          this.toastService.success('Configuración guardada correctamente');
          // The service already calls nextStep() automatically
        }
        this.cdr.markForCheck();
      },
      error: (error) => this.handleOnboardingError(error, 'Error al guardar la configuración'),
    });
  }

  async completeWizard(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.isSubmitting = true;
    this.cdr.markForCheck();

    try {
      const response = await this.wizardService.completeWizard().toPromise();

      if (response?.success) {
        // Get app type from service or fallback to local state
        const app_type =
          this.wizardService.getAppType() ||
          (this.businessType === 'STORE' ? 'STORE_ADMIN' : 'ORG_ADMIN');

        if (app_type === 'STORE_ADMIN') {
          const store_slug = this.wizardService.getCreatedStoreSlug();
          console.log(
            'Complete wizard - App type:',
            app_type,
            'Store slug:',
            store_slug,
          );

          if (store_slug) {
            try {
              console.log(
                '✅ Switching to STORE_ADMIN environment with slug:',
                store_slug,
              );
              await this.envSwitchService.performEnvironmentSwitch(
                'STORE_ADMIN',
                store_slug,
              );
              console.log('✅ Environment switch completed successfully');
            } catch (switchError) {
              console.error('❌ Error switching environment:', switchError);
              this.toastService.error('Error al cambiar al entorno de tienda');
              // Fallback reload to ensure clean state
              window.location.reload();
            }
          } else {
            console.warn('⚠️ No se encontró slug de store');
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
            console.log('✅ Switching to ORG_ADMIN environment');
            await this.envSwitchService.performEnvironmentSwitch('ORG_ADMIN');
            console.log(
              '✅ Organization environment switch completed successfully',
            );
          } catch (switchError) {
            console.error(
              '❌ Error switching to organization environment:',
              switchError,
            );
            // Fallback reload to ensure clean state
            window.location.reload();
          }
        } else {
          console.warn('⚠️ Unknown app type:', app_type);
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
      this.isSubmitting = false;
      this.isProcessing = false;
      this.cdr.markForCheck();
    }
  }

  /**
   * Centralized error handler for onboarding operations
   * Translates technical errors (especially missing steps) into friendly Spanish messages
   */
  private handleOnboardingError(error: any, defaultMessage: string): void {
    console.error('Onboarding Error:', error);
    this.isSubmitting = false;
    this.isProcessing = false;

    // Check for "Missing steps" error specifically
    const errorMessage = error?.error?.message || error?.message || '';

    if (errorMessage.includes('Missing steps') || errorMessage.includes('missing steps')) {
      // Extract the missing steps list
      const match = errorMessage.match(/steps: (.+)/i);
      if (match && match[1]) {
        const rawSteps = match[1].split(',').map((s: string) => s.trim());
        const friendlySteps = rawSteps.map((step: string) => {
          switch (step) {
            case 'email_verification': return 'Verificación de Correo';
            case 'app_type_selection': return 'Selección de Tipo de Negocio';
            case 'organization_setup': return 'Configuración de Organización';
            case 'store_setup': return 'Configuración de Tienda';
            case 'app_configuration': return 'Configuración de Aplicación';
            default: return step;
          }
        });

        this.toastService.warning(
          `No se puede completar el proceso. Pasos pendientes: ${friendlySteps.join(', ')}`,
          'Pasos Incompletos',
          6000
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
        if (displayMessage.includes('hostname')) displayMessage = 'Este dominio ya está en uso. Por favor elige otro.';
        else if (displayMessage.includes('email')) displayMessage = 'Este correo electrónico ya está registrado.';
        else if (displayMessage.includes('slug')) displayMessage = 'El identificador generado ya existe, intenta con otro nombre.';
        else displayMessage = 'Ya existe un registro con esta información.';
      }
    }

    this.toastService.error(displayMessage, 'Error');
    this.cdr.markForCheck();
  }

  close(): void {
    if (!this.isProcessing) {
      this.isOpen = false;
      this.isOpenChange.emit(false);
    }
  }

  onClosed(): void {
    // Optional: Handle any cleanup when modal closes
  }
}
