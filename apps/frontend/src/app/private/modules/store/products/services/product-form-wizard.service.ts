import { Injectable, signal, computed } from '@angular/core';

export interface StepValidity {
  stepIndex: number;
  stepName: string;
  isValid: boolean;
  completionPercent: number;
  errors: string[];
}

export interface WizardStep {
  name: string;
  key: string;
}

@Injectable({ providedIn: 'root' })
export class ProductFormWizardService {
  private readonly _steps = signal<WizardStep[]>([
    { name: 'Información', key: 'info' },
    { name: 'Precios', key: 'pricing' },
    { name: 'Inventario', key: 'inventory' },
    { name: 'Variantes', key: 'variants' },
    { name: 'Publicar', key: 'publish' },
  ]);

  private readonly _currentStep = signal(0);
  private readonly _stepValidity = signal<StepValidity[]>(
    this._steps().map((step, index) => ({
      stepIndex: index,
      stepName: step.name,
      isValid: false,
      completionPercent: 0,
      errors: [],
    }))
  );

  readonly steps = this._steps.asReadonly();
  readonly currentStep = this._currentStep.asReadonly();
  readonly stepValidity = this._stepValidity.asReadonly();

  readonly globalValid = computed(() =>
    this._stepValidity().every((s) => s.isValid)
  );

  readonly completionPercent = computed(() => {
    const validities = this._stepValidity();
    if (validities.length === 0) return 0;
    const totalPercent = validities.reduce(
      (sum, s) => sum + s.completionPercent,
      0
    );
    return Math.round(totalPercent / validities.length);
  });

  readonly currentStepData = computed(
    () => this._steps()[this._currentStep()]
  );

  readonly canGoNext = computed(
    () => this._currentStep() < this._steps().length - 1
  );

  readonly canGoPrevious = computed(() => this._currentStep() > 0);

  readonly isFirstStep = computed(() => this._currentStep() === 0);

  readonly isLastStep = computed(
    () => this._currentStep() === this._steps().length - 1
  );

  updateStepValidity(stepIndex: number, validity: Partial<StepValidity>): void {
    this._stepValidity.update((steps) =>
      steps.map((s) =>
        s.stepIndex === stepIndex
          ? { ...s, ...validity }
          : s
      )
    );
  }

  setCurrentStep(index: number): void {
    if (index >= 0 && index < this._steps().length) {
      this._currentStep.set(index);
    }
  }

  nextStep(): void {
    if (this.canGoNext()) {
      this._currentStep.update((s) => s + 1);
    }
  }

  previousStep(): void {
    if (this.canGoPrevious()) {
      this._currentStep.update((s) => s - 1);
    }
  }

  goToStep(index: number): void {
    this.setCurrentStep(index);
  }

  resetWizard(): void {
    this._currentStep.set(0);
    this._stepValidity.set(
      this._steps().map((step, index) => ({
        stepIndex: index,
        stepName: step.name,
        isValid: false,
        completionPercent: 0,
        errors: [],
      }))
    );
  }
}
