import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SlowEndpoint } from '../../interfaces';

@Component({
  selector: 'app-slow-endpoints',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="rounded-xl overflow-hidden" style="background: var(--color-background); border: 1px solid var(--color-border);">
      <div class="px-4 py-3 flex items-center gap-2" style="border-bottom: 1px solid var(--color-border); background: linear-gradient(135deg, rgba(168,85,247,0.05) 0%, transparent 100%);">
        <span class="w-5 h-5 rounded flex items-center justify-center bg-purple-500/10">
          <svg class="w-3 h-3 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/>
          </svg>
        </span>
        <h4 class="text-sm font-semibold" style="color: var(--color-text-primary);">Top 10 Endpoints Más Lentos</h4>
      </div>

      <div *ngIf="loading" class="p-4 animate-pulse">
        <div class="space-y-2">
          <div *ngFor="let i of [1,2,3]" class="h-10 rounded-lg" style="background: var(--color-border); opacity: 0.3;"></div>
        </div>
      </div>

      <div *ngIf="!loading">
        <div *ngIf="!endpoints || endpoints.length === 0" class="py-8 text-center">
          <p class="text-sm" style="color: var(--color-text-muted);">Sin datos de endpoints aún</p>
        </div>

        <div *ngIf="endpoints && endpoints.length > 0" class="divide-y" style="border-color: var(--color-border);">
          <div *ngFor="let ep of endpoints; let i = index"
            class="flex items-center gap-3 px-4 py-2.5 hover:opacity-80 transition-opacity"
            style="border-bottom: 1px solid var(--color-border);">
            <span class="text-xs font-mono w-5 text-center" style="color: var(--color-text-muted);">{{ i + 1 }}</span>
            <span class="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
              [style.background]="getMethodBg(ep.method)"
              [style.color]="getMethodColor(ep.method)">
              {{ ep.method }}
            </span>
            <span class="flex-1 font-mono text-xs truncate" style="color: var(--color-text-primary);">{{ ep.path }}</span>
            <div class="flex items-center gap-4 shrink-0 text-xs font-mono">
              <span class="flex flex-col items-end">
                <span class="text-[9px] uppercase" style="color: var(--color-text-muted);">avg</span>
                <span [style.color]="getDurationColor(ep.avgDuration)" class="font-bold">{{ ep.avgDuration.toFixed(0) }}ms</span>
              </span>
              <span class="flex flex-col items-end">
                <span class="text-[9px] uppercase" style="color: var(--color-text-muted);">p95</span>
                <span [style.color]="getDurationColor(ep.p95Duration)" class="font-bold">{{ ep.p95Duration.toFixed(0) }}ms</span>
              </span>
              <span class="flex flex-col items-end">
                <span class="text-[9px] uppercase" style="color: var(--color-text-muted);">calls</span>
                <span style="color: var(--color-text-secondary);">{{ ep.count }}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class SlowEndpointsComponent {
  @Input() endpoints: SlowEndpoint[] | null = null;
  @Input() loading: boolean = false;

  getMethodBg(method: string): string {
    switch (method) {
      case 'GET': return 'rgba(34,197,94,0.1)';
      case 'POST': return 'rgba(59,130,246,0.1)';
      case 'PUT': case 'PATCH': return 'rgba(249,115,22,0.1)';
      case 'DELETE': return 'rgba(239,68,68,0.1)';
      default: return 'rgba(107,114,128,0.1)';
    }
  }

  getMethodColor(method: string): string {
    switch (method) {
      case 'GET': return '#22c55e';
      case 'POST': return '#3b82f6';
      case 'PUT': case 'PATCH': return '#f97316';
      case 'DELETE': return '#ef4444';
      default: return '#6b7280';
    }
  }

  getDurationColor(ms: number): string {
    if (ms < 200) return '#22c55e';
    if (ms < 500) return '#eab308';
    return '#ef4444';
  }
}
