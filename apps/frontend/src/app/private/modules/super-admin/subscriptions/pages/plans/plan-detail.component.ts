import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SubscriptionAdminService } from '../../services/subscription-admin.service';
import { SubscriptionPlan } from '../../interfaces/subscription-admin.interface';
import {
  ButtonComponent,
  IconComponent,
  BadgeComponent,
  CardComponent,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';

@Component({
  selector: 'app-plan-detail',
  standalone: true,
  imports: [RouterModule, ButtonComponent, IconComponent, BadgeComponent, CardComponent, CurrencyPipe],
  template: `
    <div class="w-full max-w-4xl mx-auto">
      @if (loading()) {
        <div class="p-8 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="mt-2 text-text-secondary">Loading plan...</p>
        </div>
      } @else if (plan()) {
        <div class="flex items-center gap-3 mb-6">
          <button
            type="button"
            class="p-2 rounded-lg hover:bg-gray-100 text-text-secondary"
            (click)="router.navigate(['/super-admin/subscriptions/plans'])"
          >
            <app-icon name="arrow-left" [size]="20"></app-icon>
          </button>
          <h1 class="text-xl font-semibold text-text-primary">{{ plan()!.name }}</h1>
          <div class="flex gap-2">
            @if (plan()!.is_active) {
              <app-badge variant="success" size="sm">Active</app-badge>
            } @else {
              <app-badge variant="neutral" size="sm">Inactive</app-badge>
            }
          </div>
          <div class="flex-1"></div>
          <app-button
            variant="outline"
            size="sm"
            (clicked)="router.navigate(['/super-admin/subscriptions/plans', plan()!.id, 'edit'])"
          >
            <app-icon name="edit" [size]="16" slot="icon"></app-icon>
            Edit
          </app-button>
        </div>

        <app-card [responsive]="true" [padding]="false">
          <div class="p-4 md:p-6 space-y-6">
            <div>
              <h2 class="text-sm font-medium text-text-secondary mb-1">Slug</h2>
              <p class="text-text-primary">{{ plan()!.slug }}</p>
            </div>

            <div>
              <h2 class="text-sm font-medium text-text-secondary mb-1">Description</h2>
              <p class="text-text-primary">{{ plan()!.description }}</p>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <h2 class="text-sm font-medium text-text-secondary mb-1">Visibility</h2>
                <p class="text-text-primary">{{ plan()!.is_public ? 'Public' : 'Private' }}</p>
              </div>
              <div>
                <h2 class="text-sm font-medium text-text-secondary mb-1">Grace Period</h2>
                <p class="text-text-primary">{{ plan()!.grace_threshold_days }} days</p>
              </div>
            </div>

            <div>
              <h2 class="text-sm font-semibold text-text-primary mb-3">Pricing</h2>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                @for (p of plan()!.pricing; track p.id) {
                  <div class="p-3 bg-background rounded-lg border border-border">
                    <div class="flex items-center justify-between mb-2">
                      <span class="text-sm font-medium text-text-primary capitalize">{{ p.billing_cycle }}</span>
                      @if (p.is_default) {
                        <app-badge variant="primary" size="sm">Default</app-badge>
                      }
                    </div>
                    <p class="text-lg font-semibold text-text-primary">{{ p.price | currency }}</p>
                  </div>
                }
              </div>
            </div>

            <div>
              <h2 class="text-sm font-semibold text-text-primary mb-3">AI Features</h2>
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div class="flex items-center gap-2 text-sm">
                  <app-icon name="check" [size]="16" class="text-green-500"></app-icon>
                  <span class="text-text-primary">Chat</span>
                </div>
                <div class="flex items-center gap-2 text-sm">
                  <app-icon name="check" [size]="16" class="text-green-500"></app-icon>
                  <span class="text-text-primary">Embeddings</span>
                </div>
                <div class="flex items-center gap-2 text-sm">
                  <app-icon name="check" [size]="16" class="text-green-500"></app-icon>
                  <span class="text-text-primary">RAG</span>
                </div>
                <div class="flex items-center gap-2 text-sm">
                  <app-icon name="check" [size]="16" class="text-green-500"></app-icon>
                  <span class="text-text-primary">Streaming</span>
                </div>
              </div>
            </div>
          </div>
        </app-card>
      }
    </div>
  `,
})
export class PlanDetailComponent {
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  readonly router = inject(Router);
  private service = inject(SubscriptionAdminService);

  readonly plan = signal<SubscriptionPlan | null>(null);
  readonly loading = signal(true);

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadPlan(id);
    }
  }

  loadPlan(id: string): void {
    this.loading.set(true);
    this.service.getPlanById(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        if (res.success) this.plan.set(res.data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
