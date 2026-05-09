import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';

import {
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  SpinnerComponent,
  StickyHeaderComponent,
  TableColumn,
} from '../../../../../shared/components';
import { formatDateOnlyUTC } from '../../../../../shared/utils/date.util';
import { ChangeScopeWizardComponent } from './components/change-scope-wizard.component';
import {
  OperatingScopeApplyResult,
  OperatingScopeAuditLogEntry,
  OperatingScopeCurrentState,
  OperatingScopeValue,
  OperatingScopeWizardService,
} from './services/operating-scope.service';

@Component({
  selector: 'app-operating-scope',
  standalone: true,
  imports: [
    AlertBannerComponent,
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    ChangeScopeWizardComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    SpinnerComponent,
    StickyHeaderComponent,
  ],
  templateUrl: './operating-scope.component.html',
  styleUrl: './operating-scope.component.scss',
})
export class OperatingScopeComponent {
  private readonly service = inject(OperatingScopeWizardService);
  private readonly destroyRef = inject(DestroyRef);

  // ---------- state ----------
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly state = signal<OperatingScopeCurrentState | null>(null);
  readonly wizardOpen = signal(false);
  readonly pendingTarget = signal<OperatingScopeValue>('STORE');

  // ---------- computed ----------
  readonly current = computed<OperatingScopeValue>(
    () => this.state()?.current ?? 'STORE',
  );
  readonly isPartner = computed(() => this.state()?.is_partner === true);
  readonly editable = computed(
    () => this.state()?.editable === true && !this.loading(),
  );
  readonly auditLog = computed<OperatingScopeAuditLogEntry[]>(
    () => this.state()?.audit_log_recent ?? [],
  );

  readonly currentLabel = computed(() =>
    this.current() === 'ORGANIZATION'
      ? 'Organización (consolidado)'
      : 'Por tienda',
  );

  // ---------- audit log table/card config ----------
  readonly auditColumns: TableColumn[] = [
    {
      key: 'changed_at',
      label: 'Fecha',
      sortable: true,
      priority: 1,
      transform: (value: string) => this.formatTimestamp(value),
    },
    {
      key: 'changes',
      label: 'Cambio',
      priority: 1,
      transform: (_value: any, item: OperatingScopeAuditLogEntry) =>
        `${this.scopeLabel(item.previous_value)} → ${this.scopeLabel(item.new_value)}`,
    },
    {
      key: 'changed_by_user_id',
      label: 'Usuario',
      priority: 2,
      transform: (value: number | null) =>
        value ? `#${value}` : 'Sistema',
    },
    {
      key: 'reason',
      label: 'Razón',
      priority: 3,
      defaultValue: '—',
      transform: (value: string | null) => value?.trim() || '—',
    },
  ];

  readonly auditCardConfig: ItemListCardConfig = {
    titleKey: 'changed_at',
    titleTransform: (item: OperatingScopeAuditLogEntry) =>
      this.formatTimestamp(item.changed_at),
    subtitleKey: 'new_value',
    subtitleTransform: (item: OperatingScopeAuditLogEntry) =>
      `${this.scopeLabel(item.previous_value)} → ${this.scopeLabel(item.new_value)}`,
    avatarFallbackIcon: 'history',
    avatarShape: 'circle',
    footerKey: 'changed_by_user_id',
    footerLabel: 'Usuario',
    footerTransform: (value: number | null) =>
      value ? `#${value}` : 'Sistema',
    detailKeys: [
      { key: 'reason', label: 'Razón', icon: 'message-square' },
    ],
  };

  constructor() {
    this.loadCurrent();
  }

  loadCurrent(): void {
    this.loading.set(true);
    this.error.set(null);

    this.service
      .getCurrent()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (value) => {
          this.state.set(value);
          this.loading.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.loading.set(false);
          this.error.set(this.humanError(err));
        },
      });
  }

  // ---------- actions ----------
  selectScope(target: OperatingScopeValue): void {
    if (!this.editable() || target === this.current()) return;
    this.pendingTarget.set(target);
    this.wizardOpen.set(true);
  }

  openWizardForToggle(): void {
    if (!this.editable()) return;
    const target: OperatingScopeValue =
      this.current() === 'ORGANIZATION' ? 'STORE' : 'ORGANIZATION';
    this.pendingTarget.set(target);
    this.wizardOpen.set(true);
  }

  onApplied(_result: OperatingScopeApplyResult): void {
    // Refresh state so the audit log + current scope reflect reality.
    this.loadCurrent();
  }

  // ---------- formatting helpers ----------
  formatTimestamp(value: string): string {
    if (!value) return '-';
    try {
      const d = new Date(value);
      // Display in es-CO locale; backend stores UTC, browser converts to org/user TZ.
      return d.toLocaleString('es-CO', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return formatDateOnlyUTC(value);
    }
  }

  scopeLabel(value: OperatingScopeValue | null | undefined): string {
    if (!value) return '—';
    return value === 'ORGANIZATION' ? 'Organización' : 'Por tienda';
  }

  private humanError(err: HttpErrorResponse): string {
    const status = err?.status;
    const code: string | undefined = err?.error?.error_code;
    if (status === 0 || status === undefined) {
      return 'No se pudo conectar con el servidor.';
    }
    if (code === 'AUTH_PERM_001' || status === 401 || status === 403) {
      return 'No tienes permisos para ver el modo operativo. Si los permisos se actualizaron recientemente, cierra sesión y vuelve a iniciar.';
    }
    const payload: any = err?.error;
    const msg = payload?.message;
    if (Array.isArray(msg)) return msg.filter(Boolean).join('. ');
    if (typeof msg === 'string' && msg.trim()) return msg;
    if (typeof payload === 'string' && payload.trim()) return payload;
    return 'No se pudo cargar el modo operativo de la organización.';
  }

  scopeCardClasses(scope: OperatingScopeValue): string {
    const selected = this.current() === scope;
    return [
      'w-full rounded-2xl border p-5 text-left transition-all duration-200',
      'focus:outline-none focus:ring-2 focus:ring-primary/40',
      this.editable() ? 'hover:-translate-y-0.5' : 'cursor-not-allowed opacity-70',
      selected
        ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20'
        : 'border-[var(--color-border)] bg-white hover:border-primary/50 hover:shadow-md',
    ].join(' ');
  }
}
