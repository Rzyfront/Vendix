import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SubscriptionAdminService } from '../../services/subscription-admin.service';
import { PartnerOrganization } from '../../interfaces/subscription-admin.interface';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ToggleComponent,
  BadgeComponent,
} from '../../../../../../shared/components';
import { MarginCapInputComponent } from '../../components/margin-cap-input.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';

@Component({
  selector: 'app-partner-detail',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    IconComponent,
    ToggleComponent,
    BadgeComponent,
    MarginCapInputComponent,
    CurrencyPipe,
  ],
  template: `
    <div class="w-full max-w-3xl mx-auto">
      @if (loading()) {
        <div class="p-8 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="mt-2 text-text-secondary">Loading partner...</p>
        </div>
      } @else if (partner()) {
        <div class="flex items-center gap-3 mb-6">
          <button
            type="button"
            class="p-2 rounded-lg hover:bg-gray-100 text-text-secondary"
            (click)="router.navigate(['/super-admin/subscriptions/partners'])"
          >
            <app-icon name="arrow-left" [size]="20"></app-icon>
          </button>
          <h1 class="text-xl font-semibold text-text-primary">{{ partner()!.name }}</h1>
          @if (partner()!.is_partner) {
            <app-badge variant="primary" size="sm">Partner</app-badge>
          }
        </div>

        <div class="bg-surface rounded-card border border-border p-4 md:p-6 space-y-6">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <span class="text-sm text-text-secondary">Email</span>
              <p class="text-text-primary">{{ partner()!.email }}</p>
            </div>
            <div>
              <span class="text-sm text-text-secondary">Slug</span>
              <p class="text-text-primary">{{ partner()!.slug }}</p>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div class="p-4 bg-background rounded-lg border border-border">
              <span class="text-sm text-text-secondary">Total Earnings</span>
              <p class="text-lg font-semibold text-text-primary">{{ partner()!.total_earnings | currency }}</p>
            </div>
            <div class="p-4 bg-background rounded-lg border border-border">
              <span class="text-sm text-text-secondary">Pending Payout</span>
              <p class="text-lg font-semibold text-text-primary">{{ partner()!.pending_payout | currency }}</p>
            </div>
            <div class="p-4 bg-background rounded-lg border border-border">
              <span class="text-sm text-text-secondary">Referred Stores</span>
              <p class="text-lg font-semibold text-text-primary">{{ partner()!.total_referred_stores }}</p>
            </div>
          </div>

          <div class="border-t border-border pt-6">
            <h2 class="text-sm font-semibold text-text-primary mb-4">Partner Settings</h2>

            <form [formGroup]="form" class="space-y-4">
              <div class="flex items-center gap-3">
                <app-toggle formControlName="is_partner"></app-toggle>
                <span class="text-sm text-text-primary">Is Partner</span>
              </div>

              <app-margin-cap-input
                [initialPercent]="partner()!.partner_margin_percent"
                [initialCap]="partner()!.partner_margin_cap"
                (valueChange)="onMarginChange($event)"
              ></app-margin-cap-input>

              <div class="flex justify-end gap-3">
                <app-button
                  variant="ghost"
                  type="button"
                  (clicked)="router.navigate(['/super-admin/subscriptions/partners'])"
                >
                  Cancel
                </app-button>
                <app-button
                  variant="primary"
                  type="button"
                  [loading]="saving()"
                  (clicked)="onSave()"
                >
                  Save Changes
                </app-button>
              </div>
            </form>
          </div>
        </div>
      }
    </div>
  `,
})
export class PartnerDetailComponent {
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  readonly router = inject(Router);
  private fb = inject(FormBuilder);
  private service = inject(SubscriptionAdminService);

  readonly partner = signal<PartnerOrganization | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);

  readonly marginPercent = signal(10);
  readonly marginCap = signal<number | null>(null);

  form: FormGroup = this.fb.group({
    is_partner: [false],
  });

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadPartner(id);
    }
  }

  loadPartner(id: string): void {
    this.loading.set(true);
    this.service.getPartnerById(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        if (res.success) {
          this.partner.set(res.data);
          this.form.patchValue({ is_partner: res.data.is_partner });
          this.marginPercent.set(res.data.partner_margin_percent);
          this.marginCap.set(res.data.partner_margin_cap);
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  onMarginChange(values: { percent: number; cap: number | null }): void {
    this.marginPercent.set(values.percent);
    this.marginCap.set(values.cap);
  }

  onSave(): void {
    if (!this.partner()) return;

    this.saving.set(true);
    this.service
      .updatePartner(this.partner()!.id, {
        is_partner: this.form.value.is_partner,
        partner_margin_percent: this.marginPercent(),
        partner_margin_cap: this.marginCap(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success) {
            this.partner.set(res.data);
          }
          this.saving.set(false);
        },
        error: () => this.saving.set(false),
      });
  }
}
