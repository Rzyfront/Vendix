import {
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import {
  ButtonComponent,
  CardComponent,
  ConfirmationModalComponent,
  InputsearchComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableAction,
  TableColumn,
} from '../../../../../../../shared/components/index';
import type { ItemListCardConfig } from '../../../../../../../shared/components/index';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import {
  PlatformInvoiceProfile,
  PlatformInvoiceProfileDetail,
} from '../../../../subscriptions/interfaces/fiscal-billing.interface';
import { ModuleShellActionsService } from '../../../../../../../shared/components/module-tabs-shell/module-shell-actions.service';
import { PlatformInvoicingStore } from '../../platform-invoicing.store';

/**
 * Perfiles de facturación del riel plataforma (VENDIX_ADMIN).
 *
 * Espejo completo de `InvoiceProfilesPageComponent` del riel tienda, adaptado al
 * contexto de plataforma. Incluye stats, filtros por estado y tipo de operación,
 * y las cinco acciones (editar, clonar, activar/desactivar, set-default, eliminar
 * con confirmación dura).
 */
@Component({
  selector: 'app-platform-profiles',
  standalone: true,
  imports: [
    CardComponent,
    ButtonComponent,
    ConfirmationModalComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
  ],
  template: `
    <!-- Stats -->
    <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
      <app-stats
        title="Perfiles"
        [value]="stats().total"
        smallText="Configuraciones de plataforma"
        iconName="file-stack"
        iconBgColor="bg-primary/10"
        iconColor="text-primary"
      ></app-stats>
      <app-stats
        title="Activos"
        [value]="stats().active"
        smallText="Disponibles para emitir"
        iconName="check-circle"
        iconBgColor="bg-success/10"
        iconColor="text-success"
      ></app-stats>
      <app-stats
        title="AIU"
        [value]="stats().aiu"
        smallText="Tipo operación 09"
        iconName="percent"
        iconBgColor="bg-warning/10"
        iconColor="text-warning"
      ></app-stats>
      <app-stats
        title="Predeterminados"
        [value]="stats().defaults"
        smallText="Uno por tipo de operación"
        iconName="star"
        iconBgColor="bg-primary/10"
        iconColor="text-primary"
      ></app-stats>
    </div>

    <app-card [responsive]="true" [padding]="false">
      <!-- Error banner inline sobre la tabla -->
      @if (error(); as message) {
        <div class="m-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger" role="alert">
          {{ message }}
        </div>
      }

      <!--
        Barra de FILTROS, no una segunda cabecera.

        Antes esto era un bloque sticky a top-[99px] que se pegaba justo debajo
        del sticky-header del módulo y repetía su título: dos cabeceras fijas,
        una sobre otra. El título y el botón «Nuevo perfil» ahora los publica
        el componente en el sticky-header del shell; acá queda sólo lo que de
        verdad filtra la tabla.
      -->
      <div class="px-2 py-1.5 md:px-4 md:py-4 md:border-b md:border-border">
        <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
          <app-inputsearch
            class="w-full md:w-72"
            placeholder="Buscar por nombre…"
            [debounceTime]="300"
            (searchChange)="onSearch($event)"
          ></app-inputsearch>
        </div>

        <!-- Chips de filtro -->
        <div class="mt-2 flex flex-wrap items-center gap-1.5 md:mt-3">
          @for (chip of state_chips; track chip.value) {
            <button
              type="button"
              class="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors md:text-xs"
              [class.bg-primary]="filters().state === chip.value"
              [class.text-white]="filters().state === chip.value"
              [class.border-primary]="filters().state === chip.value"
              [class.border-border]="filters().state !== chip.value"
              [class.text-text-secondary]="filters().state !== chip.value"
              (click)="onStateFilter(chip.value)"
            >
              {{ chip.label }}
            </button>
          }
          <span class="mx-1 h-4 w-px bg-border"></span>
          @for (chip of operation_chips; track chip.value) {
            <button
              type="button"
              class="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors md:text-xs"
              [class.bg-primary]="filters().operation_type === chip.value"
              [class.text-white]="filters().operation_type === chip.value"
              [class.border-primary]="filters().operation_type === chip.value"
              [class.border-border]="filters().operation_type !== chip.value"
              [class.text-text-secondary]="filters().operation_type !== chip.value"
              (click)="onOperationFilter(chip.value)"
            >
              {{ chip.label }}
            </button>
          }
        </div>
      </div>

      <div class="relative p-2 md:p-4">
        <app-responsive-data-view
          [columns]="columns"
          [data]="filteredRows()"
          [cardConfig]="cardConfig"
          [actions]="actions"
          [loading]="loading()"
          emptyMessage="No hay perfiles plataforma que mostrar."
          emptyIcon="file-stack"
          (actionClick)="onAction($event)"
        ></app-responsive-data-view>
      </div>
    </app-card>

    <!-- Activar / Desactivar -->
    @if (pending_toggle(); as row) {
      <app-confirmation-modal
        [isOpen]="true"
        [title]="row.state === 'active' ? 'Desactivar perfil' : 'Activar perfil'"
        [message]="row.state === 'active'
          ? 'El perfil dejará de aparecer en el selector del asistente de emisión. Las facturas ya emitidas conservarán su configuración.'
          : 'El perfil volverá a aparecer en el selector del asistente de emisión.'"
        [confirmText]="row.state === 'active' ? 'Desactivar' : 'Activar'"
        cancelText="Cancelar"
        [confirmVariant]="row.state === 'active' ? 'danger' : 'primary'"
        (confirm)="confirmToggle(row)"
        (cancel)="pending_toggle.set(null)"
      ></app-confirmation-modal>
    }

    <!-- Set default -->
    @if (pending_default(); as row) {
      <app-confirmation-modal
        [isOpen]="true"
        title="Marcar como predeterminado"
        [message]="'El perfil ' + row.name + ' será el predeterminado para su tipo de operación.'"
        confirmText="Marcar"
        cancelText="Cancelar"
        confirmVariant="primary"
        (confirm)="confirmDefault(row)"
        (cancel)="pending_default.set(null)"
      ></app-confirmation-modal>
    }

    <!-- Borrado con confirmación DURA -->
    @if (pending_delete(); as row) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-profile-title"
        (document:keydown.escape)="cancelDelete()"
      >
        <div class="w-full max-w-md rounded-xl bg-surface p-4 shadow-xl md:p-6">
          <h3 id="delete-profile-title" class="text-base font-semibold text-text-primary md:text-lg">
            Eliminar perfil de facturación
          </h3>
          <p class="mt-2 text-xs text-text-secondary md:text-sm">
            Vas a eliminar <strong class="text-text-primary">{{ row.name }}</strong>.
            Esta acción no se puede deshacer.
          </p>
          <p class="mt-1 text-xs text-text-secondary md:text-sm">
            Escribe <strong>{{ row.name }}</strong> para confirmar.
          </p>
          <label class="mt-3 block text-xs font-medium text-text-primary md:text-sm" for="confirm-delete-name">
            Confirmación
          </label>
          <input
            id="confirm-delete-name"
            type="text"
            class="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            autocomplete="off"
            [value]="delete_confirmation()"
            (input)="onDeleteConfirmationInput($event)"
          />
          <div class="mt-4 flex justify-end gap-2">
            <app-button variant="secondary" (clicked)="cancelDelete()">Cancelar</app-button>
            <app-button
              variant="danger"
              [disabled]="!canConfirmDelete() || deleting()"
              (clicked)="confirmDelete(row)"
            >
              {{ deleting() ? 'Eliminando…' : 'Eliminar' }}
            </app-button>
          </div>
        </div>
      </div>
    }
  `,
})
export class PlatformProfilesComponent implements OnInit, OnDestroy {
  private readonly store = inject(PlatformInvoicingStore);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly shellActions = inject(ModuleShellActionsService);

  /**
   * «Nuevo perfil» vive en el sticky-header del módulo, no en una barra propia
   * debajo. Ver el comentario del bloque de filtros en el template.
   */
  ngOnInit(): void {
    this.shellActions.set([
      {
        id: 'new',
        label: 'Nuevo perfil',
        variant: 'primary',
        icon: 'plus',
        run: () =>
          this.router.navigate([
            '/super-admin/fiscal/invoicing/profiles',
            'new',
          ]),
      },
    ]);
  }

  ngOnDestroy(): void {
    this.shellActions.clear();
  }

  readonly profiles = this.store.profiles;
  readonly loading = this.store.loadingProfiles;
  readonly total = computed(() => this.store.profilesMeta()?.total ?? this.profiles().length);

  readonly error = signal<string | null>(null);
  readonly pending_delete = signal<PlatformInvoiceProfile | null>(null);
  readonly pending_toggle = signal<PlatformInvoiceProfile | null>(null);
  readonly pending_default = signal<PlatformInvoiceProfile | null>(null);
  readonly delete_confirmation = signal('');
  readonly deleting = signal(false);

  readonly filters = signal({ state: '' as '', operation_type: '', search: '' });
  readonly searchTerm = signal('');

  readonly state_chips = [
    { value: '' as const, label: 'Todos' },
    { value: 'active' as const, label: 'Activos' },
    { value: 'inactive' as const, label: 'Inactivos' },
  ];

  readonly operation_chips = [
    { value: '' as const, label: 'Toda operación' },
    { value: '10', label: 'Estándar' },
    { value: '09', label: 'AIU' },
  ];

  readonly stats = computed(() => {
    const list = this.profiles();
    return {
      total: this.store.profilesMeta()?.total ?? list.length,
      active: list.filter((p) => p.state === 'active').length,
      aiu: list.filter((p) => p.operation_type === '09').length,
      defaults: list.filter((p) => p.is_default).length,
    };
  });

  readonly canConfirmDelete = computed(() => {
    const row = this.pending_delete();
    if (!row) return false;
    return this.delete_confirmation().trim() === row.name.trim();
  });

  readonly filteredRows = computed(() => {
    const list = this.profiles();
    const { state, operation_type, search } = this.filters();
    return list.filter((p) => {
      if (state && p.state !== state) return false;
      if (operation_type && p.operation_type !== operation_type) return false;
      if (search) {
        const term = search.toLowerCase();
        if (!p.name.toLowerCase().includes(term)) return false;
      }
      return true;
    });
  });

  readonly columns: TableColumn[] = [
    { key: 'name', label: 'Nombre' },
    {
      key: 'operation_type',
      label: 'Tipo operación',
      transform: (v: string) => {
        const map: Record<string, string> = { '10': 'Estándar', '09': 'AIU', '11': 'Mandato', '12': 'Consorcio' };
        return map[v] ?? v;
      },
    },
    {
      key: 'state',
      label: 'Estado',
      badge: true,
      badgeConfig: {
        type: 'status',
        colorMap: { active: 'success', inactive: 'neutral' },
      },
    },
    {
      key: 'is_default',
      label: 'Predeterminado',
      transform: (v: boolean) => v ? '★' : '',
    },
    {
      key: 'current_version',
      label: 'Versión',
      transform: (v: number) => `v${v}`,
    },
    {
      key: 'updated_at',
      label: 'Actualizado',
      transform: (v: string) => v ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'short' }).format(new Date(v)) : '—',
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleTransform: (p: PlatformInvoiceProfile) => {
      const map: Record<string, string> = { '10': 'Estándar', '09': 'AIU' };
      return `${map[p.operation_type] ?? p.operation_type} · v${p.current_version}`;
    },
    badgeKey: 'state',
    badgeConfig: {
      type: 'status',
      colorMap: { active: 'success', inactive: 'neutral' },
    },
  };

  readonly actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'pencil',
      action: (p: PlatformInvoiceProfile) => this.router.navigate([
        '/super-admin/fiscal/invoicing/profiles',
        p.id,
        'edit',
      ]),
    },
    {
      label: 'Clonar',
      icon: 'copy',
      action: (p: PlatformInvoiceProfile) => this.cloneProfile(p),
    },
    {
      label: 'Activar',
      icon: 'check-circle',
      action: (p: PlatformInvoiceProfile) => this.pending_toggle.set(p),
      show: (p: PlatformInvoiceProfile) => p.state === 'inactive',
    },
    {
      label: 'Desactivar',
      icon: 'x-circle',
      action: (p: PlatformInvoiceProfile) => this.pending_toggle.set(p),
      show: (p: PlatformInvoiceProfile) => p.state === 'active',
    },
    {
      label: 'Predeterminado',
      icon: 'star',
      action: (p: PlatformInvoiceProfile) => this.pending_default.set(p),
      show: (p: PlatformInvoiceProfile) => !p.is_default,
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (p: PlatformInvoiceProfile) => this.pending_delete.set(p),
      variant: 'danger',
    },
  ];

  constructor() {
    this.store.loadProfiles();
    this.store.loadResolutions();
  }

  onSearch(term: string): void {
    this.filters.update((f) => ({ ...f, search: term }));
  }

  onStateFilter(value: string): void {
    this.filters.update((f) => ({ ...f, state: value as any }));
  }

  onOperationFilter(value: string): void {
    this.filters.update((f) => ({ ...f, operation_type: value }));
  }

  onAction(event: { action: TableAction; item: PlatformInvoiceProfile }): void {
    event.action.action?.(event.item);
  }

  // ─── Toggle ────────────────────────────────────────────────────────
  confirmToggle(row: PlatformInvoiceProfile): void {
    this.pending_toggle.set(null);
    const obs$ = row.state === 'active'
      ? this.store.deactivateProfile(row.id)
      : this.store.activateProfile(row.id);
    obs$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toast.success(
          row.state === 'active' ? 'Perfil desactivado' : 'Perfil activado',
          row.name,
        );
        this.store.loadProfiles(true);
      },
      error: (err: any) => {
        this.toast.error(`${err?.error_code ?? 'ERR'}: ${err?.message ?? 'Error'}`, '');
      },
    });
  }

  // ─── Default ─────────────────────────────────────────────────────
  confirmDefault(row: PlatformInvoiceProfile): void {
    this.pending_default.set(null);
    this.store.setDefaultProfile(row.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toast.success('Perfil marcado como predeterminado', row.name);
        this.store.loadProfiles(true);
      },
      error: (err: any) => {
        this.toast.error(`${err?.error_code ?? 'ERR'}: ${err?.message ?? 'Error'}`, '');
      },
    });
  }

  // ─── Clone ───────────────────────────────────────────────────────
  cloneProfile(row: PlatformInvoiceProfile): void {
    const name = `${row.name} (copia)`;
    this.store.cloneProfile(row.id, { name }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (cloned) => {
        this.toast.success('Perfil clonado', name);
        this.store.loadProfiles(true);
        this.router.navigate([
          '/super-admin/fiscal/invoicing/profiles',
          (cloned as any).id,
          'edit',
        ]);
      },
      error: (err: any) => {
        this.toast.error(this.describeApiError(err, 'Error al clonar'), '');
      },
    });
  }

  // ─── Delete ─────────────────────────────────────────────────────
  onDeleteConfirmationInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.delete_confirmation.set(value);
  }

  cancelDelete(): void {
    this.pending_delete.set(null);
    this.delete_confirmation.set('');
  }

  confirmDelete(row: PlatformInvoiceProfile): void {
    if (!this.canConfirmDelete()) return;
    this.deleting.set(true);
    this.store.deleteProfile(row.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toast.success('Perfil eliminado', row.name);
        this.pending_delete.set(null);
        this.delete_confirmation.set('');
        this.deleting.set(false);
        this.store.loadProfiles(true);
      },
      error: (err: any) => {
        this.deleting.set(false);
        this.pending_delete.set(null);
        this.delete_confirmation.set('');
        this.toast.error(this.describeApiError(err, 'No se pudo eliminar el perfil.'), '');
      },
    });
  }

  /**
   * Traduce un error HTTP al mensaje que el backend realmente escribio.
   *
   * El store re-emite el HttpErrorResponse crudo, y ese objeto lleva en
   * `message` el texto de transporte de Angular
   * ("Http failure response for https://api...: 409 Conflict"), no el motivo
   * de negocio. El envelope del backend
   * ({ statusCode, error_code, message, details }) viaja dentro de `err.error`,
   * asi que hay que bajar un nivel antes de leer. Sin esto, un 409 legitimo se
   * muestra como "ERR: Http failure response ..." y el operador no tiene forma
   * de saber que el perfil esta fijado por facturas emitidas.
   */
  private describeApiError(err: any, fallback: string): string {
    const envelope = err?.error ?? err;
    const code = envelope?.error_code ?? err?.error_code ?? '';
    const raw = envelope?.message ?? envelope?.error ?? '';
    const message = Array.isArray(raw) ? raw.join(' · ') : raw;
    const text = typeof message === 'string' && message.trim() ? message : fallback;
    return code ? `${code}: ${text}` : text;
  }
}
