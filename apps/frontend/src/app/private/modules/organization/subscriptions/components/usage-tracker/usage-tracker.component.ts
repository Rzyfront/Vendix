import { Component, input, inject, signal, OnInit, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../../../../../environments/environment';
import {
  IconComponent,
  CardComponent,
} from '../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';

interface QuotaUsage {
  feature: string;
  used: number;
  cap: number | null;
  period: 'daily' | 'monthly';
  period_label: string;
}

interface UsageResponse {
  success: boolean;
  data: {
    features: Record<string, {
      used: number;
      cap: number | null;
      period: 'daily' | 'monthly';
    }>;
  };
}

@Component({
  selector: 'app-usage-tracker',
  standalone: true,
  imports: [IconComponent, CardComponent, DecimalPipe],
  template: `
    <app-card>
      <div class="p-4 space-y-4">
        <div class="flex items-center gap-2">
          <app-icon name="activity" [size]="20" class="text-primary"></app-icon>
          <h3 class="font-semibold text-text-primary">Uso de AI</h3>
        </div>

        @if (loading()) {
          <div class="p-4 text-center">
            <div class="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
          </div>
        }

        @if (!loading() && usage().length === 0) {
          <p class="text-sm text-text-muted text-center py-4">
            Sin datos de uso disponibles
          </p>
        }

        @if (!loading() && usage().length > 0) {
          <div class="space-y-3">
            @for (item of usage(); track item.feature) {
              <div class="space-y-1">
                <div class="flex justify-between items-center">
                  <span class="text-sm font-medium text-text-primary capitalize">
                    {{ formatFeatureName(item.feature) }}
                  </span>
                  <span class="text-sm text-text-secondary">
                    {{ item.used | number }} / {{ item.cap ? (item.cap | number) : '∞' }}
                    <span class="text-xs text-text-muted">({{ item.period_label }})</span>
                  </span>
                </div>
                @if (item.cap) {
                  <div class="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      class="h-full rounded-full transition-all duration-300"
                      [class.bg-green-500]="getUsagePercent(item) < 70"
                      [class.bg-yellow-500]="getUsagePercent(item) >= 70 && getUsagePercent(item) < 90"
                      [class.bg-red-500]="getUsagePercent(item) >= 90"
                      [style.width.%]="getUsagePercent(item)"
                    ></div>
                  </div>
                }
              </div>
            }
          </div>
        }

        @if (error()) {
          <p class="text-xs text-red-500">{{ error() }}</p>
        }
      </div>
    </app-card>
  `,
})
export class UsageTrackerComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private http = inject(HttpClient);
  private currencyService = inject(CurrencyFormatService);

  readonly storeId = input<number | null>(null);

  readonly usage = signal<QuotaUsage[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.loadUsage();
  }

  private loadUsage(): void {
    const storeId = this.storeId();
    if (!storeId) {
      this.error.set('Store ID no disponible');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    const params = new HttpParams().set('store_id', String(storeId));
    this.http.get<UsageResponse>(`${environment.apiUrl}/organization/subscriptions/usage`, { params })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.loading.set(false);
          if (res.success && res.data?.features) {
            const usageList: QuotaUsage[] = [];
            for (const [feature, data] of Object.entries(res.data.features)) {
              usageList.push({
                feature,
                used: data.used,
                cap: data.cap,
                period: data.period,
                period_label: this.getPeriodLabel(data.period),
              });
            }
            this.usage.set(usageList);
          }
        },
        error: () => {
          this.loading.set(false);
          this.error.set('Error al cargar uso');
        },
      });
  }

  getUsagePercent(item: QuotaUsage): number {
    if (!item.cap) return 0;
    return Math.min(100, (item.used / item.cap) * 100);
  }

  formatFeatureName(feature: string): string {
    const names: Record<string, string> = {
      text_generation: 'Generación de Texto',
      streaming_chat: 'Chat en Vivo',
      conversations: 'Conversaciones',
      tool_agents: 'Agentes',
      rag_embeddings: 'Embeddings RAG',
      async_queue: 'Cola Async',
    };
    return names[feature] || feature.replace(/_/g, ' ');
  }

  getPeriodLabel(period: 'daily' | 'monthly'): string {
    return period === 'daily' ? 'hoy' : 'este mes';
  }
}
