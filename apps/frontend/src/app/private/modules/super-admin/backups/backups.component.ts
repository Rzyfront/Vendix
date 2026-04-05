import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, timer, forkJoin } from 'rxjs';
import { takeUntil, map, catchError, filter } from 'rxjs/operators';
import { of } from 'rxjs';
import { StatsComponent } from '../../../../shared/components';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { BackupService } from './services';
import { BackupStatus, SnapshotInfo } from './interfaces';

@Component({
  selector: 'app-backups',
  standalone: true,
  imports: [CommonModule, FormsModule, StatsComponent, IconComponent],
  providers: [BackupService, DatePipe],
  template: `
    <div style="background-color: var(--color-background);" class="space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between flex-wrap gap-4">
        <div class="flex items-center gap-3">
          <div
            class="w-10 h-10 rounded-lg flex items-center justify-center"
            style="background: linear-gradient(135deg, rgba(6,182,212,0.8), rgba(20,184,166,0.6));"
          >
            <app-icon name="hard-drive" [size]="20" class="text-white"></app-icon>
          </div>
          <div>
            <h2 class="text-xl font-bold" style="color: var(--color-text-primary);">
              Copias de Seguridad
            </h2>
            <p class="text-sm" style="color: var(--color-text-muted);">
              Gestion de snapshots de la base de datos RDS
            </p>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs" style="color: var(--color-text-muted);">Auto-refresh: 60s</span>
          <button
            (click)="showCreateModal = true"
            class="px-4 py-2 rounded-lg text-sm font-medium text-white flex items-center gap-2 transition-opacity hover:opacity-90"
            style="background: linear-gradient(135deg, #06b6d4, #14b8a6);"
            [disabled]="creating"
          >
            <app-icon name="plus" [size]="16" class="text-white"></app-icon>
            Crear Snapshot
          </button>
        </div>
      </div>

      <!-- Stats Cards -->
      <div class="stats-container">
        <app-stats
          title="Ultimo Backup"
          [value]="lastBackupValue"
          [smallText]="lastBackupSmall"
          iconName="clock"
          iconBgColor="bg-green-500/10"
          iconColor="text-green-500"
          [loading]="loadingStatus"
        ></app-stats>
        <app-stats
          title="Total Snapshots"
          [value]="totalSnapshotsValue"
          [smallText]="snapshotsBreakdown"
          iconName="database"
          iconBgColor="bg-blue-500/10"
          iconColor="text-blue-500"
          [loading]="loadingSnapshots"
        ></app-stats>
        <app-stats
          title="Retencion"
          [value]="retentionValue"
          [smallText]="instanceClassSmall"
          iconName="calendar"
          iconBgColor="bg-purple-500/10"
          iconColor="text-purple-500"
          [loading]="loadingStatus"
        ></app-stats>
        <app-stats
          title="PITR Disponible"
          [value]="pitrValue"
          [smallText]="pitrSmall"
          iconName="rotate-ccw"
          iconBgColor="bg-orange-500/10"
          iconColor="text-orange-500"
          [loading]="loadingStatus"
        ></app-stats>
      </div>

      <!-- Instance Info Bar -->
      <div
        *ngIf="status?.instance"
        class="rounded-card shadow-card p-4 flex items-center gap-4 flex-wrap"
        style="background: var(--color-surface); border: 1px solid var(--color-border);"
      >
        <app-icon name="server" [size]="18" style="color: var(--color-text-muted);"></app-icon>
        <span class="text-sm" style="color: var(--color-text-secondary);">
          Instancia: <strong style="color: var(--color-text-primary);">{{ status!.instance.id }}</strong>
        </span>
        <span class="text-xs px-2 py-0.5 rounded-full" style="background: var(--color-border); color: var(--color-text-secondary);">
          {{ status!.instance.engine }}
        </span>
        <span class="text-xs" style="color: var(--color-text-muted);">
          {{ status!.instance.storage_gb }} GB
        </span>
        <span
          class="text-xs font-medium px-2 py-0.5 rounded-full ml-auto"
          [style.background]="status!.instance.status === 'available' ? 'rgba(34,197,94,0.1)' : 'rgba(234,179,8,0.1)'"
          [style.color]="status!.instance.status === 'available' ? '#22c55e' : '#eab308'"
        >
          {{ status!.instance.status }}
        </span>
      </div>

      <!-- Snapshots Table Section -->
      <div
        class="rounded-card shadow-card"
        style="background: var(--color-surface); border: 1px solid var(--color-border);"
      >
        <div
          class="flex items-center gap-3 p-6"
          style="border-bottom: 1px solid var(--color-border); background: linear-gradient(135deg, rgba(6,182,212,0.05) 0%, transparent 100%);"
        >
          <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-cyan-500/10">
            <app-icon name="database" [size]="16" class="text-cyan-500"></app-icon>
          </div>
          <h3 class="text-lg font-semibold" style="color: var(--color-text-primary);">
            Snapshots de Base de Datos
          </h3>
          <span class="text-xs ml-auto" style="color: var(--color-text-muted);">
            {{ snapshots.length }} snapshot{{ snapshots.length !== 1 ? 's' : '' }}
          </span>
        </div>

        <div class="p-6">
          <!-- Loading state -->
          <div *ngIf="loadingSnapshots" class="flex items-center justify-center py-12">
            <div class="animate-spin w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full"></div>
            <span class="ml-3 text-sm" style="color: var(--color-text-muted);">Cargando snapshots...</span>
          </div>

          <!-- Empty state -->
          <div *ngIf="!loadingSnapshots && snapshots.length === 0" class="text-center py-12">
            <app-icon name="database" [size]="48" style="color: var(--color-text-muted); opacity: 0.3;"></app-icon>
            <p class="mt-3 text-sm" style="color: var(--color-text-muted);">No se encontraron snapshots</p>
          </div>

          <!-- Table -->
          <div *ngIf="!loadingSnapshots && snapshots.length > 0" class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr style="border-bottom: 1px solid var(--color-border);">
                  <th class="text-left py-3 px-3 text-xs font-medium uppercase tracking-wider" style="color: var(--color-text-muted);">Estado</th>
                  <th class="text-left py-3 px-3 text-xs font-medium uppercase tracking-wider" style="color: var(--color-text-muted);">Tipo</th>
                  <th class="text-left py-3 px-3 text-xs font-medium uppercase tracking-wider" style="color: var(--color-text-muted);">Nombre</th>
                  <th class="text-left py-3 px-3 text-xs font-medium uppercase tracking-wider" style="color: var(--color-text-muted);">Fecha de Creacion</th>
                  <th class="text-left py-3 px-3 text-xs font-medium uppercase tracking-wider" style="color: var(--color-text-muted);">Tamano</th>
                  <th class="text-right py-3 px-3 text-xs font-medium uppercase tracking-wider" style="color: var(--color-text-muted);">Acciones</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  *ngFor="let snapshot of snapshots"
                  style="border-bottom: 1px solid var(--color-border);"
                  class="hover:opacity-80 transition-opacity"
                >
                  <td class="py-3 px-3">
                    <span
                      class="text-xs font-medium px-2 py-1 rounded-full"
                      [style.background]="getStatusBg(snapshot.status)"
                      [style.color]="getStatusColor(snapshot.status)"
                    >
                      {{ snapshot.status }}
                    </span>
                  </td>
                  <td class="py-3 px-3">
                    <span
                      class="text-xs font-medium px-2 py-1 rounded-full"
                      [style.background]="snapshot.type === 'automated' ? 'rgba(59,130,246,0.1)' : 'rgba(139,92,246,0.1)'"
                      [style.color]="snapshot.type === 'automated' ? '#3b82f6' : '#8b5cf6'"
                    >
                      {{ snapshot.type === 'automated' ? 'Automatico' : 'Manual' }}
                    </span>
                  </td>
                  <td class="py-3 px-3">
                    <span class="font-mono text-xs" style="color: var(--color-text-primary);">{{ snapshot.id }}</span>
                  </td>
                  <td class="py-3 px-3" style="color: var(--color-text-secondary);">
                    {{ snapshot.created_at ? datePipe.transform(snapshot.created_at, 'dd/MM/yyyy HH:mm') : '--' }}
                  </td>
                  <td class="py-3 px-3" style="color: var(--color-text-secondary);">
                    {{ snapshot.size_gb > 0 ? snapshot.size_gb.toFixed(2) + ' GB' : '--' }}
                  </td>
                  <td class="py-3 px-3 text-right">
                    <button
                      *ngIf="snapshot.type === 'manual'"
                      (click)="deleteSnapshot(snapshot)"
                      [disabled]="deletingId === snapshot.id"
                      class="p-1.5 rounded-lg transition-colors hover:bg-red-500/10"
                      style="color: var(--color-text-muted);"
                      title="Eliminar snapshot"
                    >
                      <app-icon
                        [name]="deletingId === snapshot.id ? 'loader-2' : 'trash-2'"
                        [size]="16"
                        [class]="deletingId === snapshot.id ? 'animate-spin text-red-400' : 'hover:text-red-500'"
                      ></app-icon>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Create Snapshot Modal Overlay -->
      <div
        *ngIf="showCreateModal"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        style="background: rgba(0,0,0,0.5);"
        (click)="onOverlayClick($event)"
      >
        <div
          class="rounded-card shadow-card w-full max-w-md p-6 space-y-4"
          style="background: var(--color-surface); border: 1px solid var(--color-border);"
        >
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-cyan-500/10">
              <app-icon name="plus" [size]="16" class="text-cyan-500"></app-icon>
            </div>
            <h3 class="text-lg font-semibold" style="color: var(--color-text-primary);">
              Crear Snapshot Manual
            </h3>
          </div>

          <div>
            <label class="block text-sm font-medium mb-1.5" style="color: var(--color-text-secondary);">
              Nombre del Snapshot
            </label>
            <input
              [(ngModel)]="newSnapshotName"
              (keydown.enter)="confirmCreateSnapshot()"
              type="text"
              placeholder="mi-snapshot-manual"
              class="w-full px-3 py-2 rounded-lg text-sm outline-none transition-colors"
              style="background: var(--color-background); border: 1px solid var(--color-border); color: var(--color-text-primary);"
              [style.border-color]="snapshotNameError ? '#ef4444' : 'var(--color-border)'"
            />
            <p *ngIf="snapshotNameError" class="text-xs mt-1" style="color: #ef4444;">
              {{ snapshotNameError }}
            </p>
            <p class="text-xs mt-1" style="color: var(--color-text-muted);">
              Solo letras, numeros y guiones
            </p>
          </div>

          <div class="flex justify-end gap-2 pt-2">
            <button
              (click)="cancelCreateSnapshot()"
              class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              style="color: var(--color-text-secondary); background: var(--color-background); border: 1px solid var(--color-border);"
            >
              Cancelar
            </button>
            <button
              (click)="confirmCreateSnapshot()"
              [disabled]="creating || !newSnapshotName.trim()"
              class="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90 flex items-center gap-2 disabled:opacity-50"
              style="background: linear-gradient(135deg, #06b6d4, #14b8a6);"
            >
              <app-icon *ngIf="creating" name="loader-2" [size]="14" class="animate-spin text-white"></app-icon>
              {{ creating ? 'Creando...' : 'Crear' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [],
})
export class BackupsComponent implements OnInit, OnDestroy {
  status: BackupStatus | null = null;
  snapshots: SnapshotInfo[] = [];

  loadingStatus = true;
  loadingSnapshots = true;
  creating = false;
  deletingId: string | null = null;

  showCreateModal = false;
  newSnapshotName = '';
  snapshotNameError = '';

  private destroy$ = new Subject<void>();
  private paused = false;
  private visibilityHandler = () => this.onVisibilityChange();

  constructor(
    private readonly backupService: BackupService,
    public readonly datePipe: DatePipe,
  ) {}

  // -- Computed values for stats cards --

  get lastBackupValue(): string {
    if (!this.status?.last_backup?.created_at) return '--';
    return this.getRelativeTime(this.status.last_backup.created_at);
  }

  get lastBackupSmall(): string {
    if (!this.status?.last_backup) return '';
    return this.status.last_backup.type === 'automated' ? 'Automatico' : 'Manual';
  }

  get totalSnapshotsValue(): string {
    return this.snapshots.length.toString();
  }

  get snapshotsBreakdown(): string {
    const auto = this.snapshots.filter((s) => s.type === 'automated').length;
    const manual = this.snapshots.filter((s) => s.type === 'manual').length;
    return `${auto} auto / ${manual} manual`;
  }

  get retentionValue(): string {
    if (!this.status) return '--';
    return `${this.status.retention_days} dias`;
  }

  get instanceClassSmall(): string {
    return this.status?.instance?.class || '';
  }

  get pitrValue(): string {
    if (!this.status) return '--';
    return this.status.pitr.latest ? 'Activo' : 'Inactivo';
  }

  get pitrSmall(): string {
    if (!this.status?.pitr?.latest) return 'No disponible';
    return this.datePipe.transform(this.status.pitr.latest, 'dd/MM/yyyy HH:mm') || '';
  }

  // -- Lifecycle --

  ngOnInit(): void {
    document.addEventListener('visibilitychange', this.visibilityHandler);

    timer(0, 60000)
      .pipe(
        filter(() => !this.paused),
        takeUntil(this.destroy$),
      )
      .subscribe(() => {
        this.fetchStatus();
        this.fetchSnapshots();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    document.removeEventListener('visibilitychange', this.visibilityHandler);
  }

  // -- Actions --

  confirmCreateSnapshot(): void {
    const name = this.newSnapshotName.trim();
    if (!name) return;

    if (!/^[a-zA-Z0-9-]+$/.test(name)) {
      this.snapshotNameError = 'Solo se permiten letras, numeros y guiones';
      return;
    }

    this.snapshotNameError = '';
    this.creating = true;

    this.backupService
      .createSnapshot(name)
      .pipe(
        catchError(() => {
          this.creating = false;
          this.snapshotNameError = 'Error al crear el snapshot';
          return of(null);
        }),
        takeUntil(this.destroy$),
      )
      .subscribe((res) => {
        this.creating = false;
        if (res) {
          this.showCreateModal = false;
          this.newSnapshotName = '';
          this.fetchStatus();
          this.fetchSnapshots();
        }
      });
  }

  cancelCreateSnapshot(): void {
    this.showCreateModal = false;
    this.newSnapshotName = '';
    this.snapshotNameError = '';
  }

  deleteSnapshot(snapshot: SnapshotInfo): void {
    if (this.deletingId) return;
    this.deletingId = snapshot.id;

    this.backupService
      .deleteSnapshot(snapshot.id)
      .pipe(
        catchError(() => {
          this.deletingId = null;
          return of(null);
        }),
        takeUntil(this.destroy$),
      )
      .subscribe((res) => {
        this.deletingId = null;
        if (res) {
          this.fetchStatus();
          this.fetchSnapshots();
        }
      });
  }

  onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.cancelCreateSnapshot();
    }
  }

  // -- Helpers --

  getStatusBg(status: string): string {
    switch (status) {
      case 'available':
        return 'rgba(34,197,94,0.1)';
      case 'creating':
        return 'rgba(234,179,8,0.1)';
      default:
        return 'rgba(156,163,175,0.1)';
    }
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'available':
        return '#22c55e';
      case 'creating':
        return '#eab308';
      default:
        return '#9ca3af';
    }
  }

  getRelativeTime(dateStr: string): string {
    const now = new Date().getTime();
    const date = new Date(dateStr).getTime();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    const diffH = Math.floor(diffMs / 3600000);
    const diffD = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return 'Ahora';
    if (diffMin < 60) return `Hace ${diffMin}m`;
    if (diffH < 24) return `Hace ${diffH}h`;
    return `Hace ${diffD}d`;
  }

  // -- Private --

  private onVisibilityChange(): void {
    this.paused = document.hidden;
  }

  private fetchStatus(): void {
    this.backupService
      .getStatus()
      .pipe(
        map((res) => res.data),
        catchError(() => of(null)),
        takeUntil(this.destroy$),
      )
      .subscribe((data) => {
        this.status = data;
        this.loadingStatus = false;
      });
  }

  private fetchSnapshots(): void {
    this.backupService
      .getSnapshots()
      .pipe(
        map((res) => res.data),
        catchError(() => of([])),
        takeUntil(this.destroy$),
      )
      .subscribe((data) => {
        this.snapshots = data;
        this.loadingSnapshots = false;
      });
  }
}
