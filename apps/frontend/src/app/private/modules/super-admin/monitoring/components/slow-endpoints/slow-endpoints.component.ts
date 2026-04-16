import { Component, Input, ChangeDetectionStrategy, input } from '@angular/core';

import { SlowEndpoint } from '../../interfaces';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';

@Component({
  selector: 'app-slow-endpoints',
  standalone: true,
  imports: [IconComponent, CardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card
      [padding]="false"
      overflow="hidden"
      customClasses="!overflow-hidden"
    >
      <div
        class="px-4 py-3 flex items-center justify-between"
        style="border-bottom: 1px solid var(--color-border); background: linear-gradient(135deg, rgba(168,85,247,0.05) 0%, transparent 100%);"
      >
        <div class="flex items-center gap-2">
          <span
            class="w-5 h-5 rounded flex items-center justify-center bg-purple-500/10"
          >
            <svg
              class="w-3 h-3 text-purple-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </span>
          <h4
            class="text-sm font-semibold"
            style="color: var(--color-text-primary);"
          >
            Endpoints Más Lentos
          </h4>
        </div>
        @if (endpoints && endpoints.length > 0) {
          <span
            class="text-xs font-mono px-2 py-0.5 rounded-full"
            style="background: var(--color-surface); color: var(--color-text-muted);"
          >
            Mostrando
            {{
              displayedCount > endpoints.length
                ? endpoints.length
                : displayedCount
            }}
            de {{ endpoints.length }}
          </span>
        }
      </div>

      @if (loading()) {
        <div class="p-4 animate-pulse">
          <div class="space-y-2">
            @for (i of [1, 2, 3]; track $index) {
              <div
                class="h-10 rounded-lg"
                style="background: var(--color-border); opacity: 0.3;"
              ></div>
            }
          </div>
        </div>
      }

      @if (!loading()) {
        <div>
          @if (!endpoints || endpoints.length === 0) {
            <div class="py-8 text-center">
              <p class="text-sm" style="color: var(--color-text-muted);">
                Sin datos de endpoints aún
              </p>
            </div>
          }
          @if (endpoints && endpoints.length > 0) {
            <div>
              <div class="divide-y" style="border-color: var(--color-border);">
                @for (
                  ep of visibleEndpoints;
                  track trackByEndpoint(i, ep);
                  let i = $index
                ) {
                  <div
                    class="flex items-center gap-3 px-4 py-2.5 hover:opacity-80 transition-opacity"
                    style="border-bottom: 1px solid var(--color-border);"
                  >
                    <span
                      class="text-xs font-mono w-5 text-center"
                      style="color: var(--color-text-muted);"
                      >{{ i + 1 }}</span
                    >
                    <span
                      class="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                      [style.background]="getMethodBg(ep.method)"
                      [style.color]="getMethodColor(ep.method)"
                    >
                      {{ ep.method }}
                    </span>
                    <span
                      class="flex-1 font-mono text-xs truncate"
                      style="color: var(--color-text-primary);"
                      >{{ ep.path }}</span
                    >
                    <div
                      class="flex items-center gap-4 shrink-0 text-xs font-mono"
                    >
                      <span class="flex flex-col items-end">
                        <span
                          class="text-[9px] uppercase"
                          style="color: var(--color-text-muted);"
                          >avg</span
                        >
                        <span
                          [style.color]="getDurationColor(ep.avgDuration)"
                          class="font-bold"
                          >{{ ep.avgDuration.toFixed(0) }}ms</span
                        >
                      </span>
                      <span class="flex flex-col items-end">
                        <span
                          class="text-[9px] uppercase"
                          style="color: var(--color-text-muted);"
                          >p95</span
                        >
                        <span
                          [style.color]="getDurationColor(ep.p95Duration)"
                          class="font-bold"
                          >{{ ep.p95Duration.toFixed(0) }}ms</span
                        >
                      </span>
                      <span class="flex flex-col items-end">
                        <span
                          class="text-[9px] uppercase"
                          style="color: var(--color-text-muted);"
                          >calls</span
                        >
                        <span style="color: var(--color-text-secondary);">{{
                          ep.count
                        }}</span>
                      </span>
                    </div>
                  </div>
                }
              </div>
              <!-- Pagination footer -->
              @if (endpoints.length > pageSize) {
                <div
                  class="px-4 py-3 flex justify-center"
                  style="border-top: 1px solid var(--color-border);"
                >
                  <button
                    (click)="toggleShowMore()"
                    class="flex items-center gap-1.5 text-xs font-medium transition-colors px-3 py-1.5 rounded-lg"
                    style="color: var(--color-primary); background: var(--color-surface);"
                  >
                    <app-icon
                      [name]="isExpanded ? 'chevron-up' : 'chevron-down'"
                      [size]="14"
                    ></app-icon>
                    {{
                      isExpanded
                        ? 'Ver menos'
                        : 'Ver más (' +
                          (endpoints.length - pageSize) +
                          ' restantes)'
                    }}
                  </button>
                </div>
              }
            </div>
          }
        </div>
      }
    </app-card>
  `,
})
export class SlowEndpointsComponent {
  @Input() endpoints: SlowEndpoint[] | null = null;
  readonly loading = input<boolean>(false);
  @Input() pageSize: number = 10;

  displayedCount = 10;
  isExpanded = false;

  get visibleEndpoints(): SlowEndpoint[] {
    if (!this.endpoints) return [];
    return this.endpoints.slice(0, this.displayedCount);
  }

  toggleShowMore(): void {
    if (this.isExpanded) {
      this.displayedCount = this.pageSize;
      this.isExpanded = false;
    } else {
      this.displayedCount = this.endpoints?.length ?? this.pageSize;
      this.isExpanded = true;
    }
  }

  trackByEndpoint(index: number, ep: SlowEndpoint): string {
    return `${ep.method}:${ep.path}`;
  }

  trackByIndex(index: number): number {
    return index;
  }

  getMethodBg(method: string): string {
    switch (method) {
      case 'GET':
        return 'rgba(34,197,94,0.1)';
      case 'POST':
        return 'rgba(59,130,246,0.1)';
      case 'PUT':
      case 'PATCH':
        return 'rgba(249,115,22,0.1)';
      case 'DELETE':
        return 'rgba(239,68,68,0.1)';
      default:
        return 'rgba(107,114,128,0.1)';
    }
  }

  getMethodColor(method: string): string {
    switch (method) {
      case 'GET':
        return '#22c55e';
      case 'POST':
        return '#3b82f6';
      case 'PUT':
      case 'PATCH':
        return '#f97316';
      case 'DELETE':
        return '#ef4444';
      default:
        return '#6b7280';
    }
  }

  getDurationColor(ms: number): string {
    if (ms < 200) return '#22c55e';
    if (ms < 500) return '#eab308';
    return '#ef4444';
  }
}
