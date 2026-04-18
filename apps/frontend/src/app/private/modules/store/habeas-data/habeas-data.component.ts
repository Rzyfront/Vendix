import { Component, inject, signal, DestroyRef } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';

import { StatsComponent } from '../../../../shared/components/stats/stats.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { ToggleComponent } from '../../../../shared/components/toggle/toggle.component';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { HabeasDataService } from './services/habeas-data.service';
import {
  UserConsent,
  ExportRequest,
  HabeasDataStats,
  SearchUser,
} from './interfaces/habeas-data.interface';

type TabKey = 'consents' | 'exports' | 'anonymization';

@Component({
  selector: 'app-habeas-data',
  standalone: true,
  imports: [
    FormsModule,
    StatsComponent,
    ButtonComponent,
    IconComponent,
    ToggleComponent,
    DatePipe
],
  template: `
    <div class="w-full">
      <!-- Stats -->
      <div class="sticky top-0 z-20 bg-white dark:bg-gray-900 pb-2 md:static md:z-auto">
        <div class="flex gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-4 md:overflow-visible">
          <app-stats
            title="Consentimientos"
            [value]="stats().total_consents"
            iconName="shield-check"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
            [loading]="statsLoading()"
          ></app-stats>
          <app-stats
            title="Marketing Activo"
            [value]="stats().active_marketing"
            iconName="mail"
            iconBgColor="bg-green-100"
            iconColor="text-green-600"
            [loading]="statsLoading()"
          ></app-stats>
          <app-stats
            title="Exportaciones"
            [value]="stats().total_exports"
            iconName="download"
            iconBgColor="bg-orange-100"
            iconColor="text-orange-600"
            [loading]="statsLoading()"
          ></app-stats>
          <app-stats
            title="Anonimizaciones"
            [value]="stats().total_anonymizations"
            iconName="user-x"
            iconBgColor="bg-red-100"
            iconColor="text-red-600"
            [loading]="statsLoading()"
          ></app-stats>
        </div>
      </div>
    
      <!-- Tabs -->
      <div class="mt-4 border-b border-gray-200 dark:border-gray-700">
        <nav class="flex gap-4 overflow-x-auto" aria-label="Tabs">
          @for (tab of tabs; track tab) {
            <button
              (click)="activeTab.set(tab.key)"
            [class]="activeTab() === tab.key
              ? 'border-primary text-primary font-medium'
              : 'border-transparent text-text-secondary hover:text-text-primary hover:border-gray-300'"
              class="whitespace-nowrap border-b-2 pb-3 px-1 text-sm transition-colors"
              >
              {{ tab.label }}
            </button>
          }
        </nav>
      </div>
    
      <!-- Tab Content -->
      <div class="mt-4">
    
        <!-- ─── Consentimientos ─── -->
        @if (activeTab() === 'consents') {
          <div>
            <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Consentimientos del Usuario</h2>
              <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
                Gestione los tipos de tratamiento de datos autorizados.
              </p>
              @if (consentsLoading()) {
                <div class="space-y-4">
                  @for (i of [1,2,3,4]; track i) {
                    <div class="h-16 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse"></div>
                  }
                </div>
              }
              @if (!consentsLoading()) {
                <div class="space-y-3">
                  @for (consent of consentTypes; track consent) {
                    <div
                      class="flex items-center justify-between p-4 rounded-lg border border-gray-200 dark:border-gray-700"
                      >
                      <div>
                        <h3 class="text-sm font-medium text-gray-900 dark:text-white">{{ consent.label }}</h3>
                        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ consent.description }}</p>
                      </div>
                      <app-toggle
                        [checked]="getConsentValue(consent.key)"
                        (toggled)="onConsentToggle(consent.key, $event)"
                        [disabled]="consentSaving()"
                      ></app-toggle>
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        }
    
        <!-- ─── Exportacion ─── -->
        @if (activeTab() === 'exports') {
          <div>
            <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-3">
                <div>
                  <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Exportacion de Datos</h2>
                  <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Derecho a portabilidad de datos (1 solicitud cada 24h).
                  </p>
                </div>
                <app-button
                  variant="primary"
                  size="sm"
                  (clicked)="onRequestExport()"
                  [disabled]="exportRequesting()"
                  [loading]="exportRequesting()"
                  >
                  <app-icon name="download" [size]="14" slot="icon"></app-icon>
                  Solicitar Exportacion
                </app-button>
              </div>
              @if (exportsLoading()) {
                <div class="space-y-3">
                  @for (i of [1,2,3]; track i) {
                    <div class="h-16 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse"></div>
                  }
                </div>
              }
              <!-- Empty state -->
              @if (!exportsLoading() && exports().length === 0) {
                <div
                  class="py-12 flex flex-col items-center rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600">
                  <app-icon name="download" [size]="32" class="text-gray-400 mb-3"></app-icon>
                  <p class="text-sm text-text-secondary">No hay solicitudes de exportacion</p>
                </div>
              }
              <!-- Export list -->
              @if (!exportsLoading() && exports().length > 0) {
                <div class="space-y-3">
                  @for (exp of exports(); track exp) {
                    <div
                      class="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-lg border border-gray-200 dark:border-gray-700 gap-3"
                      >
                      <div class="flex items-center gap-3 min-w-0">
                        <div [class]="getExportStatusIconClass(exp.status)"
                          class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center">
                          <app-icon [name]="getExportStatusIcon(exp.status)" [size]="16"></app-icon>
                        </div>
                        <div class="min-w-0">
                          <span class="text-sm font-medium text-gray-900 dark:text-white block">
                            Solicitud #{{ exp.request_id }}
                          </span>
                          <span class="text-xs text-gray-500 dark:text-gray-400">
                            {{ exp.requested_at | date:'dd/MM/yyyy HH:mm' }}
                          </span>
                        </div>
                      </div>
                      <div class="flex items-center gap-2">
                        <span [class]="getExportStatusBadgeClass(exp.status)"
                          class="px-2 py-0.5 rounded-full text-xs font-medium">
                          {{ getExportStatusLabel(exp.status) }}
                        </span>
                        @if (exp.status === 'completed' && exp.has_file) {
                          <app-button
                            variant="outline"
                            size="xsm"
                            (clicked)="onDownloadExport(exp.request_id)"
                            >
                            <app-icon name="download" [size]="12" slot="icon"></app-icon>
                            Descargar
                          </app-button>
                        }
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        }
    
        <!-- ─── Anonimizacion ─── -->
        @if (activeTab() === 'anonymization') {
          <div>
            <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Derecho al Olvido</h2>
              <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
                Anonimizacion irreversible de datos personales. Esta accion NO se puede deshacer.
              </p>
              <!-- Search -->
              <div class="mb-6">
                <label class="block text-sm font-medium text-text-primary mb-1">Buscar usuario</label>
                <input
                  type="text"
                  [ngModel]="searchQuery()"
                  (ngModelChange)="onSearchQueryChange($event)"
                  placeholder="Nombre, email o documento..."
                class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm
                       text-text-primary placeholder-text-secondary focus:border-primary
                       focus:outline-none focus:ring-1 focus:ring-primary"
                  />
              </div>
              <!-- Search results -->
              @if (searchLoading()) {
                <div class="space-y-2">
                  @for (i of [1,2,3]; track i) {
                    <div class="h-14 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse"></div>
                  }
                </div>
              }
              @if (!searchLoading() && searchResults().length > 0) {
                <div class="space-y-2 mb-6">
                  @for (user of searchResults(); track user) {
                    <div
                      class="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
                      >
                      <div>
                        <span class="text-sm font-medium text-gray-900 dark:text-white">
                          {{ user.first_name }} {{ user.last_name }}
                        </span>
                        <span class="text-xs text-gray-500 dark:text-gray-400 block">
                          {{ user.email }} &middot; {{ user.document_type }} {{ user.document_number }}
                        </span>
                      </div>
                      <app-button
                        variant="outline-danger"
                        size="xsm"
                        (clicked)="onSelectUserForAnon(user)"
                        >
                        <app-icon name="user-x" [size]="12" slot="icon"></app-icon>
                        Anonimizar
                      </app-button>
                    </div>
                  }
                </div>
              }
              @if (!searchLoading() && searchQuery().length >= 2 && searchResults().length === 0) {
                <div
                  class="py-6 flex flex-col items-center rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 mb-6">
                  <app-icon name="search" [size]="24" class="text-gray-400 mb-2"></app-icon>
                  <p class="text-sm text-text-secondary">No se encontraron usuarios</p>
                </div>
              }
              <!-- Anonymization confirmation -->
              @if (selectedUserForAnon()) {
                <div class="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                  <h3 class="text-sm font-bold text-red-800 dark:text-red-300 mb-3">
                    Confirmar anonimizacion de: {{ selectedUserForAnon()!.first_name }} {{ selectedUserForAnon()!.last_name }}
                  </h3>
                  <div class="mb-3">
                    <label class="block text-sm font-medium text-red-700 dark:text-red-400 mb-1">Motivo (obligatorio)</label>
                    <textarea
                      [ngModel]="anonReason()"
                      (ngModelChange)="anonReason.set($event)"
                      rows="2"
                  class="w-full rounded-lg border border-red-300 dark:border-red-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm
                         text-text-primary placeholder-text-secondary focus:border-red-500
                         focus:outline-none focus:ring-1 focus:ring-red-500 resize-none"
                      placeholder="Motivo de la anonimizacion..."
                    ></textarea>
                  </div>
                  <div class="flex items-center gap-2 mb-3">
                    <input
                      type="checkbox"
                      [ngModel]="anonConfirm1()"
                      (ngModelChange)="anonConfirm1.set($event)"
                      id="anonConfirm1"
                      class="rounded border-red-300 text-red-600 focus:ring-red-500"
                      />
                    <label for="anonConfirm1" class="text-xs text-red-700 dark:text-red-400">
                      Entiendo que esta accion es IRREVERSIBLE
                    </label>
                  </div>
                  <div class="flex items-center gap-2 mb-4">
                    <input
                      type="checkbox"
                      [ngModel]="anonConfirm2()"
                      (ngModelChange)="anonConfirm2.set($event)"
                      id="anonConfirm2"
                      class="rounded border-red-300 text-red-600 focus:ring-red-500"
                      />
                    <label for="anonConfirm2" class="text-xs text-red-700 dark:text-red-400">
                      Confirmo que se han agotado los plazos legales de retencion
                    </label>
                  </div>
                  <div class="flex gap-2">
                    <app-button
                      variant="outline"
                      size="sm"
                      (clicked)="onCancelAnon()"
                      >
                      Cancelar
                    </app-button>
                    <app-button
                      variant="danger"
                      size="sm"
                      (clicked)="onRequestAnonymization()"
                      [disabled]="!anonConfirm1() || !anonConfirm2() || !anonReason().trim() || anonLoading()"
                      [loading]="anonLoading()"
                      >
                      <app-icon name="user-x" [size]="14" slot="icon"></app-icon>
                      Ejecutar Anonimizacion
                    </app-button>
                  </div>
                </div>
              }
            </div>
          </div>
        }
    
      </div>
    </div>
    `,
})
export class HabeasDataComponent {
  private habeasDataService = inject(HabeasDataService);
  private authFacade = inject(AuthFacade);
  private toastService = inject(ToastService);
  private destroyRef = inject(DestroyRef);
  private searchSubject$ = new Subject<string>(); // LEGÍTIMO — debounceTime+distinctUntilChanged search stream

  private userId = 0;

  // State
  activeTab = signal<TabKey>('consents');
  statsLoading = signal(true);
  stats = signal<HabeasDataStats>({ total_consents: 0, active_marketing: 0, total_exports: 0, total_anonymizations: 0 });

  // Consents
  consentsLoading = signal(true);
  consentSaving = signal(false);
  consents = signal<UserConsent[]>([]);

  // Exports
  exportsLoading = signal(true);
  exportRequesting = signal(false);
  exports = signal<ExportRequest[]>([]);

  // Anonymization
  searchQuery = signal('');
  searchLoading = signal(false);
  searchResults = signal<SearchUser[]>([]);
  selectedUserForAnon = signal<SearchUser | null>(null);
  anonReason = signal('');
  anonConfirm1 = signal(false);
  anonConfirm2 = signal(false);
  anonLoading = signal(false);

  tabs: { key: TabKey; label: string }[] = [
    { key: 'consents', label: 'Consentimientos' },
    { key: 'exports', label: 'Exportacion de Datos' },
    { key: 'anonymization', label: 'Anonimizacion' },
  ];

  consentTypes = [
    { key: 'marketing', label: 'Marketing', description: 'Recibir comunicaciones comerciales y promocionales' },
    { key: 'analytics', label: 'Analiticas', description: 'Uso de datos para analisis y mejora del servicio' },
    { key: 'third_party', label: 'Terceros', description: 'Compartir datos con socios comerciales autorizados' },
    { key: 'profiling', label: 'Perfilamiento', description: 'Creacion de perfiles de consumo y preferencias' },
  ];

  constructor() {
    this.userId = this.authFacade.userId() || 0;
    this.loadStats();
    this.loadConsents();
    this.loadExports();

    // Debounced search
    this.searchSubject$.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((query) => {
      if (query.length < 2) {
        this.searchResults.set([]);
        this.searchLoading.set(false);
        return;
      }
      this.performSearch(query);
    });
  }

  // ─── Data Loading ───

  private loadStats(): void {
    this.statsLoading.set(true);
    this.habeasDataService.getStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.stats.set(res.data);
          this.statsLoading.set(false);
        },
        error: () => this.statsLoading.set(false),
      });
  }

  private loadConsents(): void {
    if (!this.userId) return;
    this.consentsLoading.set(true);
    this.habeasDataService.getUserConsents(this.userId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.consents.set(res.data || []);
          this.consentsLoading.set(false);
        },
        error: () => this.consentsLoading.set(false),
      });
  }

  private loadExports(): void {
    this.exportsLoading.set(true);
    this.habeasDataService.getMyExports()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.exports.set(res.data || []);
          this.exportsLoading.set(false);
        },
        error: () => this.exportsLoading.set(false),
      });
  }

  // ─── Consents ───

  getConsentValue(type: string): boolean {
    const consent = this.consents().find((c) => c.consent_type === type);
    return consent?.granted || false;
  }

  onConsentToggle(type: string, granted: boolean): void {
    if (!this.userId) return;
    this.consentSaving.set(true);
    this.habeasDataService.updateConsents(this.userId, [{ consent_type: type, granted }])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          const updated = this.consents().map((c) =>
            c.consent_type === type ? { ...c, granted } : c,
          );
          // If consent type not found in list, add it
          if (!updated.find((c) => c.consent_type === type)) {
            updated.push({ consent_type: type, granted } as UserConsent);
          }
          this.consents.set(updated);
          this.consentSaving.set(false);
          this.toastService.show({
            variant: 'success',
            description: `Consentimiento de ${type} ${granted ? 'otorgado' : 'revocado'}`,
          });
          this.loadStats();
        },
        error: () => {
          this.consentSaving.set(false);
          this.toastService.show({ variant: 'error', description: 'Error al actualizar consentimiento' });
        },
      });
  }

  // ─── Exports ───

  onRequestExport(): void {
    if (!this.userId) return;
    this.exportRequesting.set(true);
    this.habeasDataService.requestExport(this.userId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.exportRequesting.set(false);
          this.toastService.show({ variant: 'success', description: 'Solicitud de exportacion creada. Recibiras un email cuando este lista.' });
          this.loadExports();
          this.loadStats();
        },
        error: () => {
          this.exportRequesting.set(false);
          this.toastService.show({ variant: 'error', description: 'Error al solicitar exportacion. Puede que ya tengas una solicitud en las ultimas 24h.' });
        },
      });
  }

  onDownloadExport(requestId: number): void {
    this.habeasDataService.getExportDownloadUrl(requestId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const url = res.data?.download_url;
          if (url) {
            window.open(url, '_blank');
          }
        },
        error: () => {
          this.toastService.show({ variant: 'error', description: 'Error al obtener enlace de descarga' });
        },
      });
  }

  getExportStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      processing: 'Procesando',
      completed: 'Completado',
      failed: 'Error',
    };
    return labels[status] || status;
  }

  getExportStatusBadgeClass(status: string): string {
    const classes: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      processing: 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
    };
    return classes[status] || 'bg-gray-100 text-gray-800';
  }

  getExportStatusIcon(status: string): string {
    const icons: Record<string, string> = {
      pending: 'clock',
      processing: 'loader-2',
      completed: 'check-circle',
      failed: 'x-circle',
    };
    return icons[status] || 'info';
  }

  getExportStatusIconClass(status: string): string {
    const classes: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-600',
      processing: 'bg-blue-100 text-blue-600',
      completed: 'bg-green-100 text-green-600',
      failed: 'bg-red-100 text-red-600',
    };
    return classes[status] || 'bg-gray-100 text-gray-600';
  }

  // ─── Anonymization ───

  onSearchQueryChange(query: string): void {
    this.searchQuery.set(query);
    if (query.length >= 2) {
      this.searchLoading.set(true);
    }
    this.searchSubject$.next(query);
  }

  private performSearch(query: string): void {
    this.habeasDataService.searchUsers(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.searchResults.set(res.data || []);
          this.searchLoading.set(false);
        },
        error: () => {
          this.searchResults.set([]);
          this.searchLoading.set(false);
        },
      });
  }

  onSelectUserForAnon(user: SearchUser): void {
    this.selectedUserForAnon.set(user);
    this.anonReason.set('');
    this.anonConfirm1.set(false);
    this.anonConfirm2.set(false);
  }

  onCancelAnon(): void {
    this.selectedUserForAnon.set(null);
    this.anonReason.set('');
    this.anonConfirm1.set(false);
    this.anonConfirm2.set(false);
  }

  onRequestAnonymization(): void {
    const user = this.selectedUserForAnon();
    if (!user || !this.anonReason().trim() || !this.anonConfirm1() || !this.anonConfirm2()) return;

    this.anonLoading.set(true);

    // Step 1: Create request
    this.habeasDataService.requestAnonymization(user.id, this.anonReason().trim())
      .pipe(
        switchMap((res) => {
          const requestId = res.data?.request_id;
          // Step 2: Confirm immediately (double confirmation done via UI)
          return this.habeasDataService.confirmAnonymization(requestId);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.anonLoading.set(false);
          this.toastService.show({ variant: 'success', description: 'Usuario anonimizado exitosamente' });
          this.onCancelAnon();
          this.searchResults.set([]);
          this.searchQuery.set('');
          this.loadStats();
        },
        error: () => {
          this.anonLoading.set(false);
          this.toastService.show({ variant: 'error', description: 'Error al anonimizar usuario' });
        },
      });
  }
}
