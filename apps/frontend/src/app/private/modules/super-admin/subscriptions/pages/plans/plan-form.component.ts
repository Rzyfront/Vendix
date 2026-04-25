import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SubscriptionAdminService } from '../../services/subscription-admin.service';
import { AIFeatureFlags, PlanPricing } from '../../interfaces/subscription-admin.interface';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  TextareaComponent,
  ToggleComponent,
  ScrollableTabsComponent,
} from '../../../../../../shared/components';
import { AiFeatureMatrixComponent } from '../../components/ai-feature-matrix.component';
import { PricingCycleEditorComponent } from '../../components/pricing-cycle-editor.component';
import { GraceThresholdEditorComponent } from '../../components/grace-threshold-editor.component';

@Component({
  selector: 'app-plan-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    IconComponent,
    InputComponent,
    TextareaComponent,
    ToggleComponent,
    ScrollableTabsComponent,
    AiFeatureMatrixComponent,
    PricingCycleEditorComponent,
    GraceThresholdEditorComponent,
  ],
  template: `
    <div class="w-full max-w-4xl mx-auto">
      <div class="flex items-center gap-3 mb-6">
        <button
          type="button"
          class="p-2 rounded-lg hover:bg-gray-100 text-text-secondary"
          (click)="goBack()"
        >
          <app-icon name="arrow-left" [size]="20"></app-icon>
        </button>
        <h1 class="text-xl font-semibold text-text-primary">
          {{ isEdit() ? 'Edit Plan' : 'New Plan' }}
        </h1>
      </div>

      <form [formGroup]="form" (ngSubmit)="onSubmit()" class="space-y-6">
        <app-scrollable-tabs
          [tabs]="tabs"
          [activeTab]="activeTab()"
          (tabChange)="activeTab.set($event)"
        ></app-scrollable-tabs>

        @if (activeTab() === 'overview') {
          <div class="bg-surface rounded-card border border-border p-4 md:p-6 space-y-4">
            <app-input
              label="Name"
              formControlName="name"
              [control]="form.get('name')"
              [required]="true"
            ></app-input>

            <app-input
              label="Slug"
              formControlName="slug"
              [control]="form.get('slug')"
              [required]="true"
            ></app-input>

            <app-textarea
              label="Description"
              formControlName="description"
              [control]="form.get('description')"
              [rows]="3"
            ></app-textarea>

            <div class="flex items-center gap-6">
              <div class="flex items-center gap-2">
                <app-toggle formControlName="is_active"></app-toggle>
                <span class="text-sm text-text-primary">Active</span>
              </div>
              <div class="flex items-center gap-2">
                <app-toggle formControlName="is_public"></app-toggle>
                <span class="text-sm text-text-primary">Public</span>
              </div>
            </div>
          </div>
        }

        @if (activeTab() === 'ai-matrix') {
          <div class="bg-surface rounded-card border border-border p-4 md:p-6">
            <app-ai-feature-matrix
              [initialValue]="aiFeatures()"
              (valueChange)="onAIFeaturesChange($event)"
            ></app-ai-feature-matrix>
          </div>
        }

        @if (activeTab() === 'pricing') {
          <div class="bg-surface rounded-card border border-border p-4 md:p-6">
            <app-pricing-cycle-editor
              [initialValue]="pricing()"
              (valueChange)="onPricingChange($event)"
            ></app-pricing-cycle-editor>
          </div>
        }

        @if (activeTab() === 'grace') {
          <div class="bg-surface rounded-card border border-border p-4 md:p-6">
            <app-grace-threshold-editor
              [initialValue]="graceDays()"
              (valueChange)="onGraceChange($event)"
            ></app-grace-threshold-editor>
          </div>
        }

        <div class="flex justify-end gap-3">
          <app-button
            variant="ghost"
            type="button"
            (clicked)="goBack()"
          >
            Cancel
          </app-button>
          <app-button
            variant="primary"
            type="submit"
            [loading]="submitting()"
          >
            {{ isEdit() ? 'Update Plan' : 'Create Plan' }}
          </app-button>
        </div>
      </form>
    </div>
  `,
})
export class PlanFormComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private service = inject(SubscriptionAdminService);
  private destroyRef = inject(DestroyRef);

  readonly planId = signal<string | null>(null);
  readonly isEdit = signal(false);
  readonly submitting = signal(false);
  readonly activeTab = signal('overview');
  readonly aiFeatures = signal<AIFeatureFlags | undefined>(undefined);
  readonly pricing = signal<PlanPricing[] | undefined>(undefined);
  readonly graceDays = signal<number | undefined>(undefined);

  readonly tabs = [
    { id: 'overview', label: 'Overview', icon: 'file-text' },
    { id: 'ai-matrix', label: 'AI Matrix', icon: 'bot' },
    { id: 'pricing', label: 'Pricing', icon: 'credit-card' },
    { id: 'grace', label: 'Grace', icon: 'clock' },
  ];

  form: FormGroup = this.fb.group({
    name: ['', Validators.required],
    slug: ['', Validators.required],
    description: [''],
    is_active: [true],
    is_public: [true],
  });

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.planId.set(id);
      this.isEdit.set(true);
      this.loadPlan(id);
    }
  }

  loadPlan(id: string): void {
    this.service.getPlanById(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        if (res.success) {
          const plan = res.data;
          this.form.patchValue({
            name: plan.name,
            slug: plan.slug,
            description: plan.description,
            is_active: plan.is_active,
            is_public: plan.is_public,
          });
          this.aiFeatures.set(plan.ai_feature_flags);
          this.pricing.set(plan.pricing);
          this.graceDays.set(plan.grace_threshold_days);
        }
      },
    });
  }

  onAIFeaturesChange(flags: AIFeatureFlags): void {
    this.aiFeatures.set(flags);
  }

  onPricingChange(pricing: PlanPricing[]): void {
    this.pricing.set(pricing);
  }

  onGraceChange(days: number): void {
    this.graceDays.set(days);
  }

  goBack(): void {
    this.router.navigate(['/super-admin/subscriptions/plans']);
  }

  onSubmit(): void {
    if (this.form.invalid) return;

    this.submitting.set(true);
    const payload = {
      ...this.form.value,
      ai_feature_flags: this.aiFeatures(),
      pricing: this.pricing() ?? [],
      grace_threshold_days: this.graceDays() ?? 7,
    };

    const request = this.isEdit()
      ? this.service.updatePlan(this.planId()!, payload)
      : this.service.createPlan(payload);

    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        if (res.success) {
          this.router.navigate(['/super-admin/subscriptions/plans']);
        }
        this.submitting.set(false);
      },
      error: () => this.submitting.set(false),
    });
  }
}
