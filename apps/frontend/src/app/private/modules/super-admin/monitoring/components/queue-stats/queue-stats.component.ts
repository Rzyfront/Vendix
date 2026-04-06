import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { QueueStats } from '../../interfaces';

@Component({
  selector: 'app-queue-stats',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="rounded-xl overflow-hidden" style="background: var(--color-background); border: 1px solid var(--color-border);">
      <div class="px-4 py-3 flex items-center gap-2" style="border-bottom: 1px solid var(--color-border); background: linear-gradient(135deg, rgba(99,102,241,0.05) 0%, transparent 100%);">
        <span class="w-5 h-5 rounded flex items-center justify-center bg-indigo-500/10">
          <svg class="w-3 h-3 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
          </svg>
        </span>
        <h4 class="text-sm font-semibold" style="color: var(--color-text-primary);">Colas BullMQ</h4>
      </div>

      <div *ngIf="loading" class="p-4 animate-pulse">
        <div class="grid grid-cols-4 gap-3 mb-4">
          <div *ngFor="let i of [1,2,3,4]" class="h-16 rounded-lg" style="background: var(--color-border); opacity: 0.3;"></div>
        </div>
      </div>

      <div *ngIf="!loading" class="p-4">
        <!-- Aggregate stats -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div class="p-3 rounded-lg text-center" style="background: var(--color-surface);">
            <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Activos</p>
            <p class="text-xl font-bold text-green-500">{{ totalActive }}</p>
          </div>
          <div class="p-3 rounded-lg text-center" style="background: var(--color-surface);">
            <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">En Espera</p>
            <p class="text-xl font-bold text-yellow-500">{{ totalWaiting }}</p>
          </div>
          <div class="p-3 rounded-lg text-center" style="background: var(--color-surface);">
            <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Completados</p>
            <p class="text-xl font-bold text-blue-500">{{ totalCompleted | number }}</p>
          </div>
          <div class="p-3 rounded-lg text-center" style="background: var(--color-surface);">
            <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Fallidos</p>
            <p class="text-xl font-bold" [class.text-red-500]="totalFailed > 0" [style.color]="totalFailed === 0 ? 'var(--color-text-muted)' : ''">{{ totalFailed }}</p>
          </div>
        </div>

        <!-- Per-queue cards (better than table for mobile) -->
        <div class="space-y-2" *ngIf="queues && queues.length > 0">
          <div *ngFor="let q of queues"
            class="flex items-center gap-3 p-3 rounded-lg transition-colors"
            style="background: var(--color-surface); border: 1px solid var(--color-border);">
            <div class="flex-1 min-w-0">
              <p class="font-mono text-xs font-semibold truncate" style="color: var(--color-text-primary);">{{ q.name }}</p>
            </div>
            <div class="flex items-center gap-4 text-xs font-mono shrink-0">
              <span class="flex flex-col items-center">
                <span class="text-[9px] uppercase" style="color: var(--color-text-muted);">act</span>
                <span class="text-green-500 font-bold">{{ q.active }}</span>
              </span>
              <span class="flex flex-col items-center">
                <span class="text-[9px] uppercase" style="color: var(--color-text-muted);">wait</span>
                <span class="text-yellow-500 font-bold">{{ q.waiting }}</span>
              </span>
              <span class="flex flex-col items-center">
                <span class="text-[9px] uppercase" style="color: var(--color-text-muted);">done</span>
                <span class="text-blue-500 font-bold">{{ q.completed }}</span>
              </span>
              <span class="flex flex-col items-center">
                <span class="text-[9px] uppercase" style="color: var(--color-text-muted);">fail</span>
                <span [class.text-red-500]="q.failed > 0" [style.color]="q.failed === 0 ? 'var(--color-text-muted)' : ''" class="font-bold">{{ q.failed }}</span>
              </span>
            </div>
          </div>
        </div>

        <!-- Empty state -->
        <div *ngIf="!queues || queues.length === 0" class="py-6 text-center">
          <p class="text-sm" style="color: var(--color-text-muted);">Sin colas activas</p>
        </div>
      </div>
    </div>
  `,
})
export class QueueStatsComponent {
  @Input() queues: QueueStats[] | undefined | null;
  @Input() loading: boolean = false;

  get totalActive(): number {
    return this.queues?.reduce((sum, q) => sum + q.active, 0) ?? 0;
  }

  get totalWaiting(): number {
    return this.queues?.reduce((sum, q) => sum + q.waiting, 0) ?? 0;
  }

  get totalCompleted(): number {
    return this.queues?.reduce((sum, q) => sum + q.completed, 0) ?? 0;
  }

  get totalFailed(): number {
    return this.queues?.reduce((sum, q) => sum + q.failed, 0) ?? 0;
  }
}
