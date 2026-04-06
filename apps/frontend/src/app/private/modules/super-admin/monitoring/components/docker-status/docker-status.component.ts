import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProcessInfo } from '../../interfaces';

@Component({
  selector: 'app-process-info',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="rounded-xl overflow-hidden" style="background: var(--color-background); border: 1px solid var(--color-border);">
      <div class="px-4 py-3 flex items-center gap-2" style="border-bottom: 1px solid var(--color-border); background: linear-gradient(135deg, rgba(34,197,94,0.05) 0%, transparent 100%);">
        <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
        <h4 class="text-sm font-semibold" style="color: var(--color-text-primary);">Proceso Node.js</h4>
        <span class="ml-auto text-xs font-mono px-2 py-0.5 rounded-full bg-green-500/10 text-green-600">PID {{ info?.pid }}</span>
      </div>

      <div *ngIf="loading" class="p-6 animate-pulse">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div *ngFor="let i of [1,2,3,4]" class="h-14 rounded-lg" style="background: var(--color-border); opacity: 0.3;"></div>
        </div>
      </div>

      <div *ngIf="!loading && info" class="p-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div class="p-3 rounded-lg text-center" style="background: var(--color-surface);">
            <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Version</p>
            <p class="font-mono text-sm font-bold" style="color: var(--color-text-primary);">{{ info.nodeVersion }}</p>
          </div>
          <div class="p-3 rounded-lg text-center" style="background: var(--color-surface);">
            <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Uptime</p>
            <p class="font-mono text-sm font-bold" style="color: var(--color-text-primary);">{{ formatUptime(info.uptime) }}</p>
          </div>
          <div class="p-3 rounded-lg text-center" style="background: var(--color-surface);">
            <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">Heap Usado</p>
            <p class="font-mono text-sm font-bold" style="color: var(--color-text-primary);">{{ formatBytes(info.memoryHeapUsed) }}</p>
            <p class="text-[10px]" style="color: var(--color-text-muted);">de {{ formatBytes(info.memoryHeapTotal) }}</p>
          </div>
          <div class="p-3 rounded-lg text-center" style="background: var(--color-surface);">
            <p class="text-[10px] uppercase tracking-wider font-medium mb-1" style="color: var(--color-text-muted);">RSS</p>
            <p class="font-mono text-sm font-bold" style="color: var(--color-text-primary);">{{ formatBytes(info.memoryRss) }}</p>
          </div>
        </div>

        <!-- Memory progress bar -->
        <div class="mt-3 p-3 rounded-lg" style="background: var(--color-surface);">
          <div class="flex justify-between items-center mb-1.5">
            <span class="text-[10px] uppercase tracking-wider font-medium" style="color: var(--color-text-muted);">Heap Usage</span>
            <span class="text-xs font-mono" style="color: var(--color-text-secondary);">{{ heapPercent }}%</span>
          </div>
          <div class="w-full h-2 rounded-full overflow-hidden" style="background: var(--color-border);">
            <div class="h-full rounded-full transition-all duration-500"
              [style.width.%]="heapPercent"
              [style.background]="heapPercent > 80 ? '#ef4444' : heapPercent > 60 ? '#eab308' : '#22c55e'">
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class ProcessInfoComponent {
  @Input() info: ProcessInfo | null = null;
  @Input() loading: boolean = false;

  get heapPercent(): number {
    if (!this.info) return 0;
    return Math.round((this.info.memoryHeapUsed / this.info.memoryHeapTotal) * 100);
  }

  formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    parts.push(`${m}m`);
    return parts.join(' ');
  }

  formatBytes(bytes: number): string {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }
}
