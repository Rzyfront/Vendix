import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { ChangeFiscalScopeWizardComponent } from './components/change-fiscal-scope-wizard.component';
import {
  FiscalScopeApplyResult,
  FiscalScopeAuditLogEntry,
  FiscalScopeCurrentState,
  FiscalScopeValue,
  FiscalScopeWizardService,
} from './services/fiscal-scope.service';

type FiscalScopeAuditLogRow = FiscalScopeAuditLogEntry & {
  changeLabel: string;
  reasonLabel: string;
  userLabel: string;
};

@Component({
  selector: 'app-fiscal-scope',
  standalone: true,
  imports: [
    AlertBannerComponent,
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    ChangeFiscalScopeWizardComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    SpinnerComponent,
    StickyHeaderComponent,
  ],
  templateUrl: './fiscal-scope.component.html',
  styleUrl: './fiscal-scope.component.scss',
})
export class FiscalScopeComponent {
  private readonly service = inject(FiscalScopeWizardService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly authFacade = inject(AuthFacade);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly state = signal<FiscalScopeCurrentState | null>(null);
  readonly wizardOpen = signal(false);
  readonly pendingTarget = signal<FiscalScopeValue>('STORE');

  readonly current = computed<FiscalScopeValue>(
    () => this.state()?.current ?? 'STORE',
  );
  readonly operatingScope = computed(() => this.state()?.operating_scope ?? 'STORE');
  readonly editable = computed(
    () => this.state()?.editable === true && !this.loading(),
  );
  readonly currentLabel = computed(() =>
    this.current() === 'ORGANIZATION'
      ? 'Organización (NIT consolidado)'
      : 'Por tienda (NIT por tienda)',
  );
  readonly invalidOrganizationTarget = computed(
    () => this.operatingScope() === 'STORE',
  );
  readonly auditLog = computed<FiscalScopeAuditLogRow[]>(() =>
    (this.state()?.audit_log_recent ?? []).map((entry) => ({
      ...entry,
      changeLabel: this.changeLabel(entry),
      reasonLabel: this.reasonLabel(entry.reason),
      userLabel: this.userLabel(entry.changed_by_user_id),
    })),
  );

  readonly auditColumns: TableColumn[] = [
    {
      key: 'changed_at',
      label: 'Fecha',
      sortable: true,
      priority: 1,
      transform: (value: string) => this.formatTimestamp(value),
    },
    { key: 'changeLabel', label: 'Cambio', priority: 1 },
    { key: 'userLabel', label: 'Usuario', priority: 2 },
    {
      key: 'reasonLabel',
      label: 'Razón',
      priority: 3,
      defaultValue: 'Sin razón registrada',
    },
  ];

  readonly auditCardConfig: ItemListCardConfig = {
    titleKey: 'changed_at',
    titleTransform: (item: FiscalScopeAuditLogRow) =>
      this.formatTimestamp(item.changed_at),
    subtitleKey: 'changeLabel',
    avatarFallbackIcon: 'history',
    avatarShape: 'circle',
    footerKey: 'userLabel',
    footerLabel: 'Usuario',
    detailKeys: [
      { key: 'reasonLabel', label: 'Razón', icon: 'message-square' },
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

  selectScope(target: FiscalScopeValue): void {
    if (!this.editable() || target === this.current()) return;
    if (target === 'ORGANIZATION' && this.invalidOrganizationTarget()) return;
    this.pendingTarget.set(target);
    this.wizardOpen.set(true);
  }

  openWizardForToggle(): void {
    if (!this.editable()) return;
    const target: FiscalScopeValue =
      this.current() === 'ORGANIZATION' ? 'STORE' : 'ORGANIZATION';
    this.selectScope(target);
  }

  onApplied(_result: FiscalScopeApplyResult): void {
    this.loadCurrent();
    this.authFacade.refreshUser();
  }

  formatTimestamp(value: string): string {
    if (!value) return '-';
    try {
      return new Date(value).toLocaleString('es-CO', {
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

  scopeLabel(value: FiscalScopeValue | null | undefined): string {
    if (!value) return '-';
    return value === 'ORGANIZATION' ? 'Organización' : 'Por tienda';
  }

  operatingLabel(): string {
    return this.operatingScope() === 'ORGANIZATION'
      ? 'Operación consolidada'
      : 'Operación por tienda';
  }

  scopeCardClasses(scope: FiscalScopeValue): string {
    const selected = this.current() === scope;
    const disabled =
      !this.editable() ||
      (scope === 'ORGANIZATION' && this.invalidOrganizationTarget());
    return [
      'w-full rounded-2xl border p-5 text-left transition-all duration-200',
      'focus:outline-none focus:ring-2 focus:ring-primary/40',
      disabled ? 'cursor-not-allowed opacity-60' : 'hover:-translate-y-0.5',
      selected
        ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20'
        : 'border-[var(--color-border)] bg-white hover:border-primary/50 hover:shadow-md',
    ].join(' ');
  }

  private changeLabel(entry: FiscalScopeAuditLogEntry): string {
    return `${this.scopeLabel(entry.previous_value)} -> ${this.scopeLabel(entry.new_value)}`;
  }

  private reasonLabel(value: string | null | undefined): string {
    return value?.trim() || 'Sin razón registrada';
  }

  private userLabel(value: number | null | undefined): string {
    return value ? `#${value}` : 'Sistema';
  }

  private humanError(err: HttpErrorResponse): string {
    const status = err?.status;
    if (status === 0 || status === undefined) {
      return 'No se pudo conectar con el servidor.';
    }
    if (status === 401 || status === 403) {
      return 'No tienes permisos para ver o cambiar el modo fiscal.';
    }
    const payload: any = err?.error;
    const msg = payload?.message;
    if (Array.isArray(msg)) return msg.filter(Boolean).join('. ');
    if (typeof msg === 'string' && msg.trim()) return msg;
    return 'No se pudo cargar el modo fiscal de la organización.';
  }
}
