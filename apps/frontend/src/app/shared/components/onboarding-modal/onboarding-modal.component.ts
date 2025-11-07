import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ModalComponent } from '../modal/modal.component';
import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';
import { OnboardingWizardService } from '../../../core/services/onboarding-wizard.service';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
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
      <div class="mb-6">
        <div class="flex justify-between items-center mb-2">
          <span class="text-sm text-[var(--color-text-secondary)]">Paso {{ currentStep }} de {{ steps.length }}</span>
          <span class="text-sm text-[var(--color-text-secondary)]">{{ Math.round(progress) }}%</span>
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
        <!-- Email Verification Step -->
        <ng-container *ngIf="currentStep === 1">
          <app-email-verification-step
            (nextStep)="nextStep()"
            (skipStep)="skipStep()"
          ></app-email-verification-step>
        </ng-container>

        <!-- User Setup Step -->
        <ng-container *ngIf="currentStep === 2">
          <app-user-setup-step
            [formGroup]="userForm"
            (nextStep)="nextStep()"
            (skipStep)="skipStep()"
            (previousStep)="previousStep()"
          ></app-user-setup-step>
        </ng-container>

        <!-- Organization Setup Step -->
        <ng-container *ngIf="currentStep === 3">
          <app-organization-setup-step
            [formGroup]="organizationForm"
            (nextStep)="nextStep()"
            (skipStep)="skipStep()"
            (previousStep)="previousStep()"
          ></app-organization-setup-step>
        </ng-container>

        <!-- Store Setup Step -->
        <ng-container *ngIf="currentStep === 4">
          <app-store-setup-step
            [formGroup]="storeForm"
            (nextStep)="nextStep()"
            (skipStep)="skipStep()"
            (previousStep)="previousStep()"
          ></app-store-setup-step>
        </ng-container>

        <!-- App Config Step -->
        <ng-container *ngIf="currentStep === 5">
          <app-app-config-step
            [formGroup]="appConfigForm"
            (nextStep)="nextStep()"
            (skipStep)="skipStep()"
            (previousStep)="previousStep()"
          ></app-app-config-step>
        </ng-container>

        <!-- Completion Step -->
        <ng-container *ngIf="currentStep === 6">
          <app-completion-step
            [wizardData]="wizardData"
            (complete)="completeWizard()"
          ></app-completion-step>
        </ng-container>
      </div>

      <!-- Navigation -->
      <div class="flex justify-between items-center pt-4 border-t border-[var(--color-border)]" slot="footer">
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
            *ngIf="canSkip && currentStep !== 6"
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
            *ngIf="currentStep !== 6"
            variant="secondary"
            size="sm"
            (clicked)="close()"
          >
            <app-icon name="x" size="16" slot="icon"></app-icon>
            Guardar y continuar después
          </app-button>

          <app-button
            *ngIf="currentStep !== 6"
            variant="primary"
            size="sm"
            (clicked)="nextStep()"
          >
            Siguiente
            <app-icon name="arrow-right" size="16" slot="icon"></app-icon>
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

  currentStep = 1;
  isSubmitting = false;
  wizardData: any = {};

  steps: WizardStep[] = [
    {
      id: 1,
      title: 'Verifica tu email',
      description: 'Confirma tu correo para continuar',
      icon: 'mail',
      canSkip: false,
    },
    {
      id: 2,
      title: 'Tus datos',
      description: 'Completa tu perfil',
      icon: 'user',
      canSkip: true,
    },
    {
      id: 3,
      title: 'Tu organización',
      description: 'Configura tu empresa',
      icon: 'building',
      canSkip: false,
    },
    {
      id: 4,
      title: 'Tu tienda',
      description: 'Prepara tu punto de venta',
      icon: 'store',
      canSkip: false,
    },
    {
      id: 5,
      title: 'Personaliza tu app',
      description: 'Colores y dominio',
      icon: 'palette',
      canSkip: false,
    },
    {
      id: 6,
      title: '¡Listo!',
      description: 'Tu negocio está configurado',
      icon: 'check-circle',
      canSkip: false,
    },
  ];

  // Forms
  userForm: FormGroup;
  organizationForm: FormGroup;
  storeForm: FormGroup;
  appConfigForm: FormGroup;

  constructor(
    private fb: FormBuilder,
    private wizardService: OnboardingWizardService,
    private authFacade: AuthFacade,
  ) {
    this.initializeForms();
  }

  ngOnInit(): void {
    this.loadUserData();
    this.subscribeToWizardData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initializeForms(): void {
    // User Form
    this.userForm = this.fb.group({
      first_name: ['', Validators.required],
      last_name: ['', Validators.required],
      phone: [''],
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
      timezone: ['America/Mexico_City', Validators.required],
      address_line1: ['', Validators.required],
      city: ['', Validators.required],
      state_province: ['', Validators.required],
      postal_code: ['', Validators.required],
      country_code: ['MX', Validators.required],
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
  }

  private loadUserData(): void {
    this.authFacade.user$.pipe(takeUntil(this.destroy$)).subscribe(user => {
      if (user) {
        // Pre-fill user form
        if (user.first_name) this.userForm.patchValue({ first_name: user.first_name });
        if (user.last_name) this.userForm.patchValue({ last_name: user.last_name });
        if (user.phone) this.userForm.patchValue({ phone: user.phone });

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
    this.wizardService.currentStep$.pipe(takeUntil(this.destroy$)).subscribe(step => {
      this.currentStep = step;
    });

    this.wizardService.getWizardData();
  }

  get currentStepInfo(): WizardStep | undefined {
    return this.steps.find(s => s.id === this.currentStep);
  }

  get progress(): number {
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

  nextStep(): void {
    if (this.canGoNext) {
      this.wizardService.nextStep();
    }
  }

  previousStep(): void {
    if (this.canGoBack) {
      this.wizardService.previousStep();
    }
  }

  skipStep(): void {
    if (this.canSkip) {
      this.wizardService.nextStep();
    }
  }

  completeWizard(): void {
    this.isSubmitting = true;
    this.wizardService.completeWizard().subscribe({
      next: (response) => {
        this.isSubmitting = false;
        if (response.success) {
          this.completed.emit();
          this.close();
        }
      },
      error: (error) => {
        this.isSubmitting = false;
        console.error('Error completing wizard:', error);
      },
    });
  }

  close(): void {
    this.isOpen = false;
    this.isOpenChange.emit(false);
  }

  onClosed(): void {
    // Optional: Handle any cleanup when modal closes
  }
}