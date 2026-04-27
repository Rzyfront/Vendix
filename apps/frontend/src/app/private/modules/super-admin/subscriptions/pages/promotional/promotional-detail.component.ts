import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { DatePipe, JsonPipe } from '@angular/common';
import { environment } from '../../../../../../../environments/environment';
import {
  CardComponent,
  IconComponent,
  BadgeComponent,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';

@Component({
  selector: 'app-promotional-detail',
  standalone: true,
  imports: [
    RouterModule,
    CardComponent,
    IconComponent,
    BadgeComponent,
    CurrencyPipe,
    DatePipe,
    JsonPipe,
  ],
  template: `
    <div class="w-full max-w-5xl mx-auto p-2 md:p-4 space-y-4">
      <button
        type="button"
        class="flex items-center gap-2 text-text-secondary hover:text-text-primary text-sm"
        (click)="router.navigate(['/super-admin/subscriptions/promotional'])"
      >
        <app-icon name="arrow-left" [size]="18"></app-icon>
        <span>Volver</span>
      </button>

      @if (loading()) {
        <div class="text-center py-12 text-text-secondary">Cargando...</div>
      } @else if (promo(); as p) {
        <app-card>
          <h1 class="text-lg md:text-xl font-semibold mb-4">{{ p.name }}</h1>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <div class="text-text-secondary text-xs mb-1">Código</div>
              <div class="font-medium">{{ p.code }}</div>
            </div>
            <div>
              <div class="text-text-secondary text-xs mb-1">Estado</div>
              <app-badge>{{ p.state }}</app-badge>
            </div>
            <div>
              <div class="text-text-secondary text-xs mb-1">Tipo</div>
              <div class="font-medium">{{ p.plan_type }}</div>
            </div>
            <div>
              <div class="text-text-secondary text-xs mb-1">Precio base</div>
              <div class="font-medium">{{ p.base_price | currency }}</div>
            </div>
            <div class="md:col-span-2">
              <div class="text-text-secondary text-xs mb-1">Descripción</div>
              <div class="font-medium">{{ p.description ?? '—' }}</div>
            </div>
          </div>

          @if (p.promo_rules) {
            <div class="mt-4">
              <div class="text-text-secondary text-xs mb-1">Reglas de aplicación</div>
              <pre class="text-xs bg-background border border-border rounded-lg p-3 overflow-auto max-h-48">{{ p.promo_rules | json }}</pre>
            </div>
          }
        </app-card>

        <app-card>
          <h2 class="text-base font-semibold mb-3">
            Histórico de aplicaciones ({{ p.applications?.length ?? 0 }})
          </h2>
          @if ((p.applications?.length ?? 0) === 0) {
            <div class="text-center text-sm text-text-secondary py-4">
              Aún no se ha aplicado a ninguna tienda.
            </div>
          } @else {
            <div class="space-y-2">
              @for (app of p.applications; track app.id) {
                <div
                  class="flex items-center justify-between p-3 bg-background rounded-lg border border-border text-sm"
                >
                  <div>
                    <div class="font-medium">Suscripción #{{ app.store_subscription_id }}</div>
                    <div class="text-text-secondary text-xs">
                      {{ app.created_at | date:'medium' }}
                    </div>
                  </div>
                  <app-badge>{{ app.triggered_by_job ?? 'manual' }}</app-badge>
                </div>
              }
            </div>
          }
        </app-card>
      }
    </div>
  `,
})
export class PromotionalDetailComponent {
  readonly router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  private http = inject(HttpClient);

  readonly promo = signal<any>(null);
  readonly loading = signal(true);

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.load(id);
  }

  load(id: string): void {
    this.loading.set(true);
    this.http
      .get<any>(`${environment.apiUrl}/superadmin/subscriptions/promotional/${id}`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.promo.set(res?.data ?? res);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }
}
