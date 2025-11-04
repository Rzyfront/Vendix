import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { OnboardingWizardService } from '../../../core/services/onboarding-wizard.service';
import { EmailVerificationStepComponent } from './steps/email-verification-step.component';
import { UserSetupStepComponent } from './steps/user-setup-step.component';
import { OrganizationSetupStepComponent } from './steps/organization-setup-step.component';
import { StoreSetupStepComponent } from './steps/store-setup-step.component';
import { AppConfigStepComponent } from './steps/app-config-step.component';
import { CompletionStepComponent } from './steps/completion-step.component';

interface WizardStep {
  id: number;
  title: string;
  description: string;
  icon: string;
  canSkip: boolean;
}

@Component({
  selector: 'app-onboarding-wizard',
  standalone: true,
  imports: [
    CommonModule,
    EmailVerificationStepComponent,
    UserSetupStepComponent,
    OrganizationSetupStepComponent,
    StoreSetupStepComponent,
    AppConfigStepComponent,
    CompletionStepComponent,
  ],
  templateUrl: './onboarding-wizard.component.html',
  styleUrls: ['./onboarding-wizard.component.scss'],
})
export class OnboardingWizardComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  currentStep = 1;
  isLoading = false;

  steps: WizardStep[] = [
    {
      id: 1,
      title: '¡Bienvenido a Vendix! 🎉',
      description: 'Configura tu negocio en menos de 5 minutos',
      icon: '🎉',
      canSkip: false,
    },
    {
      id: 2,
      title: 'Verifica tu email 📧',
      description: 'Confirma tu correo para continuar',
      icon: '📧',
      canSkip: false,
    },
    {
      id: 3,
      title: 'Tus datos 👤',
      description: 'Cuéntanos sobre ti',
      icon: '👤',
      canSkip: true,
    },
    {
      id: 4,
      title: 'Tu organización 🏢',
      description: 'Configura tu empresa',
      icon: '🏢',
      canSkip: false,
    },
    {
      id: 5,
      title: 'Tu tienda 🏪',
      description: 'Prepara tu punto de venta',
      icon: '🏪',
      canSkip: false,
    },
    {
      id: 6,
      title: 'Personaliza tu app 🎨',
      description: 'Colores y dominio',
      icon: '🎨',
      canSkip: false,
    },
    {
      id: 7,
      title: '¡Listo! 🚀',
      description: 'Tu negocio está configurado',
      icon: '🚀',
      canSkip: false,
    },
  ];

  constructor(
    private wizardService: OnboardingWizardService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    // Subscribe to current step changes
    this.wizardService.currentStep$
      .pipe(takeUntil(this.destroy$))
      .subscribe((step: number) => {
        this.currentStep = step;
      });

    // Load wizard status
    this.loadWizardStatus();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadWizardStatus(): void {
    this.isLoading = true;
    this.wizardService.getWizardStatus().subscribe({
      next: (response: any) => {
        this.isLoading = false;
        if (response.success && response.data) {
          // If already completed, redirect to dashboard
          if (response.data.onboarding_completed) {
            this.router.navigate(['/dashboard']);
          }
        }
      },
      error: (error: any) => {
        this.isLoading = false;
        console.error('Error loading wizard status:', error);
      },
    });
  }

  goToStep(stepNumber: number): void {
    this.wizardService.goToStep(stepNumber);
  }

  nextStep(): void {
    this.wizardService.nextStep();
  }

  previousStep(): void {
    this.wizardService.previousStep();
  }

  get currentStepInfo(): WizardStep | undefined {
    return this.steps.find((s) => s.id === this.currentStep);
  }

  get progress(): number {
    return (this.currentStep / this.steps.length) * 100;
  }

  get canGoBack(): boolean {
    return this.currentStep > 1;
  }

  get canGoNext(): boolean {
    return this.currentStep < this.steps.length;
  }
}
