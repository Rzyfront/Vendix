import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import { ModalComponent } from '../modal/modal.component';
import { IconComponent } from '../icon/icon.component';
import { ButtonComponent } from '../button/button.component';

import { OnboardingService } from './services/onboarding.service';
import {
  OnboardingStep,
  OnboardingStepId,
  OnboardingData,
  OnboardingStepChangeEvent,
  OnboardingCompleteEvent,
  DEFAULT_ONBOARDING_STEPS,
  DEFAULT_USER_CONFIG,
  DEFAULT_ORGANIZATION_CONFIG,
  DEFAULT_STORE_CONFIG,
  DEFAULT_DOMAIN_CONFIG,
} from './interfaces/onboarding.interface';

// Importar componentes de pasos
import { UserConfigStepComponent } from './steps/user-config-step.component';
import { OrganizationConfigStepComponent } from './steps/organization-config-step.component';
import { StoreConfigStepComponent } from './steps/store-config-step.component';
import { DomainConfigStepComponent } from './steps/domain-config-step.component';

@Component({
  selector: 'app-onboarding-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    IconComponent,
    ButtonComponent,
    UserConfigStepComponent,
    OrganizationConfigStepComponent,
    StoreConfigStepComponent,
    DomainConfigStepComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [isOpen]="isOpen"
      [size]="'lg'"
      [showCloseButton]="false"
      [closeOnBackdrop]="false"
      [closeOnEscape]="false"
      (closed)="onModalClosed()"
    >
      <div slot="header">
        <div class="flex items-center justify-between">
          <div>
            <h2
              class="text-[var(--fs-xl)] font-[var(--fw-semibold)] text-[var(--color-text-primary)]"
            >
              Configuración Inicial
            </h2>
            <p
              class="text-[var(--fs-sm)] text-[var(--color-text-secondary)] mt-1"
            >
              Completa los pasos para configurar tu cuenta
            </p>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[var(--fs-sm)] text-[var(--color-text-muted)]">
              Paso {{ getCurrentStepIndex() + 1 }} de {{ steps.length }}
            </span>
          </div>
        </div>
      </div>

      <!-- Timeline de Progreso -->
      <div
        class="px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface)]"
      >
        <div class="flex items-center justify-between relative">
          <!-- Línea de progreso -->
          <div
            class="absolute left-0 top-1/2 w-full h-0.5 bg-[var(--color-border)] -translate-y-1/2 z-0"
          ></div>
          <div
            class="absolute left-0 top-1/2 h-0.5 bg-[var(--color-primary)] -translate-y-1/2 z-0 transition-all duration-500"
            [style.width.%]="getProgressPercentage()"
          ></div>

          <!-- Pasos -->
          <div
            *ngFor="let step of steps; let i = index"
            class="relative z-10 flex flex-col items-center"
          >
            <div
              class="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300"
              [class]="getStepClasses(step)"
            >
              <app-icon
                *ngIf="step.status === 'completed'; else stepIcon"
                [name]="'check'"
                [size]="16"
                class="text-white"
              ></app-icon>
              <ng-template #stepIcon>
                <app-icon
                  [name]="step.icon"
                  [size]="16"
                  [class]="
                    step.status === 'in_progress'
                      ? 'text-white'
                      : 'text-[var(--color-text-muted)]'
                  "
                ></app-icon>
              </ng-template>
            </div>
            <div class="mt-2 text-center max-w-[80px]">
              <p
                class="text-[var(--fs-xs)] font-medium text-[var(--color-text-primary)]"
              >
                {{ step.title }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Contenido del Paso Actual -->
      <div class="flex-1 overflow-y-auto">
        <div class="p-6">
          <!-- Paso 1: Configuración del Usuario -->
          <app-user-config-step
            *ngIf="currentStep === 'user'"
            [form]="userForm"
            [data]="onboardingData.user"
            (dataChange)="onUserDataChange($event)"
            (validityChange)="onUserValidityChange($event)"
          ></app-user-config-step>

          <!-- Paso 2: Configuración de la Organización -->
          <app-organization-config-step
            *ngIf="currentStep === 'organization'"
            [form]="organizationForm"
            [data]="onboardingData.organization"
            [userData]="onboardingData.user"
            (dataChange)="onOrganizationDataChange($event)"
            (validityChange)="onOrganizationValidityChange($event)"
          ></app-organization-config-step>

          <!-- Paso 3: Configuración de la Tienda -->
          <app-store-config-step
            *ngIf="currentStep === 'store'"
            [form]="storeForm"
            [data]="onboardingData.store"
            [organizationData]="onboardingData.organization"
            (dataChange)="onStoreDataChange($event)"
            (validityChange)="onStoreValidityChange($event)"
          ></app-store-config-step>

          <!-- Paso 4: Configuración de Dominios -->
          <app-domain-config-step
            *ngIf="currentStep === 'domain'"
            [form]="domainForm"
            [data]="onboardingData.domain"
            [organizationData]="onboardingData.organization"
            (dataChange)="onDomainDataChange($event)"
            (validityChange)="onDomainValidityChange($event)"
          ></app-domain-config-step>
        </div>
      </div>

      <!-- Footer con Botones de Navegación -->
      <div slot="footer">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <app-button
              *ngIf="!isFirstStep()"
              variant="outline"
              size="md"
              (clicked)="goToPreviousStep()"
              [disabled]="loading"
            >
              <app-icon name="arrow-left" [size]="16" slot="icon"></app-icon>
              Anterior
            </app-button>
          </div>

          <div class="flex items-center gap-3">
            <!-- Botón de Omitir (solo para pasos no requeridos) -->
            <app-button
              *ngIf="!isLastStep() && !isCurrentStepRequired()"
              variant="ghost"
              size="md"
              (clicked)="skipCurrentStep()"
              [disabled]="loading"
            >
              Omitir
            </app-button>

            <!-- Botón Principal -->
            <app-button
              *ngIf="!isLastStep()"
              variant="primary"
              size="md"
              (clicked)="goToNextStep()"
              [disabled]="!isCurrentStepValid() || loading"
              [loading]="loading"
            >
              Siguiente
              <app-icon name="arrow-right" [size]="16" slot="icon"></app-icon>
            </app-button>

            <!-- Botón de Completar -->
            <app-button
              *ngIf="isLastStep()"
              variant="primary"
              size="md"
              (clicked)="completeOnboarding()"
              [disabled]="!isCurrentStepValid() || loading"
              [loading]="loading"
            >
              <app-icon name="check" [size]="16" slot="icon"></app-icon>
              Completar Configuración
            </app-button>
          </div>
        </div>

        <!-- Mensaje de Error -->
        <div
          *ngIf="error"
          class="mt-4 p-3 bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 rounded-[var(--radius-md)]"
        >
          <p class="text-[var(--fs-sm)] text-[var(--color-error)]">
            {{ error }}
          </p>
        </div>
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
export class OnboardingModalComponent implements OnInit, OnDestroy {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() completed = new EventEmitter<OnboardingCompleteEvent>();
  @Output() stepChanged = new EventEmitter<OnboardingStepChangeEvent>();

  // Estado del onboarding
  steps: OnboardingStep[] = [...DEFAULT_ONBOARDING_STEPS];
  currentStep: OnboardingStepId = 'user';
  onboardingData: OnboardingData = {
    user: { ...DEFAULT_USER_CONFIG },
    organization: { ...DEFAULT_ORGANIZATION_CONFIG },
    store: { ...DEFAULT_STORE_CONFIG },
    domain: { ...DEFAULT_DOMAIN_CONFIG },
  };

  // Formularios reactivos
  userForm: FormGroup;
  organizationForm: FormGroup;
  storeForm: FormGroup;
  domainForm: FormGroup;

  // Estado de validación de cada paso
  stepValidity: Record<OnboardingStepId, boolean> = {
    user: false,
    organization: false,
    store: false,
    domain: false,
  };

  // Estado de carga y errores
  loading = false;
  error: string | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private onboardingService: OnboardingService,
  ) {
    // Inicializar formularios
    this.userForm = this.fb.group({});
    this.organizationForm = this.fb.group({});
    this.storeForm = this.fb.group({});
    this.domainForm = this.fb.group({});
  }

  ngOnInit(): void {
    // Escuchar cambios en el estado del servicio
    this.onboardingService.onboardingState$
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        this.loading = state.loading;
        this.error = state.error;
        this.currentStep = state.currentStep;
        this.updateStepsStatus();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Métodos de navegación

  getCurrentStepIndex(): number {
    return this.steps.findIndex((step) => step.id === this.currentStep);
  }

  isFirstStep(): boolean {
    return this.getCurrentStepIndex() === 0;
  }

  isLastStep(): boolean {
    return this.getCurrentStepIndex() === this.steps.length - 1;
  }

  isCurrentStepRequired(): boolean {
    const currentStepData = this.steps.find(
      (step) => step.id === this.currentStep,
    );
    return currentStepData?.isRequired || false;
  }

  isCurrentStepValid(): boolean {
    return this.stepValidity[this.currentStep] || false;
  }

  getProgressPercentage(): number {
    const currentIndex = this.getCurrentStepIndex();
    return (currentIndex / (this.steps.length - 1)) * 100;
  }

  getStepClasses(step: OnboardingStep): string {
    const baseClasses = 'border-2 transition-all duration-300';

    if (step.status === 'completed') {
      return `${baseClasses} bg-[var(--color-primary)] border-[var(--color-primary)]`;
    } else if (step.status === 'in_progress') {
      return `${baseClasses} bg-[var(--color-primary)] border-[var(--color-primary)]`;
    } else {
      return `${baseClasses} bg-[var(--color-surface)] border-[var(--color-border)]`;
    }
  }

  goToPreviousStep(): void {
    const currentIndex = this.getCurrentStepIndex();
    if (currentIndex > 0) {
      const previousStep = this.steps[currentIndex - 1];
      this.changeStep(previousStep.id, 'previous');
    }
  }

  goToNextStep(): void {
    const currentIndex = this.getCurrentStepIndex();
    if (currentIndex < this.steps.length - 1) {
      const nextStep = this.steps[currentIndex + 1];
      this.changeStep(nextStep.id, 'next');
    }
  }

  skipCurrentStep(): void {
    const currentIndex = this.getCurrentStepIndex();
    if (currentIndex < this.steps.length - 1) {
      const nextStep = this.steps[currentIndex + 1];

      // Marcar paso actual como omitido
      const currentStepData = this.steps.find(
        (step) => step.id === this.currentStep,
      );
      if (currentStepData) {
        currentStepData.status = 'skipped';
        currentStepData.isCompleted = true;
      }

      this.changeStep(nextStep.id, 'next');
    }
  }

  changeStep(stepId: OnboardingStepId, direction: 'next' | 'previous'): void {
    // Actualizar estado del paso actual
    const currentStepData = this.steps.find(
      (step) => step.id === this.currentStep,
    );
    if (currentStepData) {
      currentStepData.status = 'completed';
      currentStepData.isCompleted = true;
    }

    // Cambiar al nuevo paso
    this.currentStep = stepId;
    this.onboardingService.setCurrentStep(stepId);

    // Actualizar estado del nuevo paso
    const newStepData = this.steps.find((step) => step.id === stepId);
    if (newStepData) {
      newStepData.status = 'in_progress';
    }

    // Emitir evento de cambio
    this.stepChanged.emit({ step: stepId, direction });
  }

  completeOnboarding(): void {
    if (!this.isCurrentStepValid()) {
      return;
    }

    this.loading = true;
    this.error = null;

    // Aquí se implementaría la lógica para completar el onboarding
    // llamando a los servicios correspondientes
    this.onboardingService
      .completeOnboarding({
        organization_id: 1, // Estos IDs vendrían de las respuestas del backend
        store_id: 1,
        domain_id: 1,
      })
      .subscribe({
        next: () => {
          this.loading = false;
          this.onboardingService.setCompleted(true);
          this.completed.emit({
            data: {
              organization_id: 1,
              store_id: 1,
              domain_id: 1,
            },
          });
          this.closeModal();
        },
        error: (error) => {
          this.loading = false;
          this.error = error.message || 'Error al completar la configuración';
        },
      });
  }

  // Métodos para manejo de datos de los pasos

  onUserDataChange(data: any): void {
    this.onboardingData.user = { ...this.onboardingData.user, ...data };

    // Autocompletar datos de organización si es el primer cambio
    if (data.first_name || data.last_name) {
      const orgData = this.onboardingService.generateOrganizationFromUser(
        this.onboardingData.user,
      );
      this.onboardingData.organization = {
        ...this.onboardingData.organization,
        ...orgData,
      };
    }
  }

  onOrganizationDataChange(data: any): void {
    this.onboardingData.organization = {
      ...this.onboardingData.organization,
      ...data,
    };

    // Autocompletar datos de tienda
    const storeData = this.onboardingService.generateStoreFromOrganization(
      this.onboardingData.organization,
    );
    this.onboardingData.store = { ...this.onboardingData.store, ...storeData };

    // Autocompletar datos de dominio
    const domainData = this.onboardingService.generateDomainFromOrganization(
      this.onboardingData.organization,
    );
    this.onboardingData.domain = {
      ...this.onboardingData.domain,
      ...domainData,
    };
  }

  onStoreDataChange(data: any): void {
    this.onboardingData.store = { ...this.onboardingData.store, ...data };
  }

  onDomainDataChange(data: any): void {
    this.onboardingData.domain = { ...this.onboardingData.domain, ...data };
  }

  // Métodos para manejo de validación

  onUserValidityChange(isValid: boolean): void {
    this.stepValidity.user = isValid;
  }

  onOrganizationValidityChange(isValid: boolean): void {
    this.stepValidity.organization = isValid;
  }

  onStoreValidityChange(isValid: boolean): void {
    this.stepValidity.store = isValid;
  }

  onDomainValidityChange(isValid: boolean): void {
    this.stepValidity.domain = isValid;
  }

  // Métodos privados

  private updateStepsStatus(): void {
    this.steps.forEach((step, index) => {
      const currentIndex = this.getCurrentStepIndex();

      if (index < currentIndex) {
        step.status = 'completed';
        step.isCompleted = true;
      } else if (index === currentIndex) {
        step.status = 'in_progress';
      } else {
        step.status = 'pending';
        step.isCompleted = false;
      }
    });
  }

  private closeModal(): void {
    this.isOpen = false;
    this.isOpenChange.emit(false);
    this.onboardingService.closeOnboarding();
  }
}
