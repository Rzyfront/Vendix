import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs/operators';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';

import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  SettingToggleComponent,
  SpinnerComponent,
  StatsComponent,
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
  StickyHeaderComponent,
  TextareaComponent,
  TimelineComponent,
  TimelineStep,
  ToastService,
} from '../../../../../../../shared/components/index';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../../../shared/pipes/currency';
import { formatDateOnlyUTC } from '../../../../../../../shared/utils/date.util';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';

import {
  GymMembership,
  GymMembershipStatus,
  GYM_MEMBERSHIP_STATUS_COLORS,
  GYM_MEMBERSHIP_STATUS_LABELS,
} from '../../interfaces';
import { MembershipsService } from '../../services';
import { RenewMembershipModalComponent } from '../../components/renew-membership-modal/renew-membership-modal.component';
import { EditMembershipModalComponent } from '../../components/edit-membership-modal/edit-membership-modal.component';

import { MembershipAccessService } from '../../../access/services/membership-access.service';
import {
  GymAccessCredential,
  GymAccessLog,
  GymAccessResult,
  GymCredentialType,
  GYM_ACCESS_RESULT_COLORS,
  GYM_ACCESS_RESULT_LABELS,
  GYM_CREDENTIAL_TYPE_LABELS,
} from '../../../access/interfaces';

interface MetaFormShape {
  auto_renew: FormControl<boolean>;
  notes: FormControl<string>;
}

const MS_PER_DAY = 86_400_000;

@Component({
  selector: 'app-membership-detail-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    StickyHeaderComponent,
    CardComponent,
    ButtonComponent,
    IconComponent,
    SpinnerComponent,
    StatsComponent,
    TimelineComponent,
    SettingToggleComponent,
    TextareaComponent,
    CurrencyPipe,
    RenewMembershipModalComponent,
    EditMembershipModalComponent,
  ],
  templateUrl: './membership-detail-page.component.html',
  styleUrls: ['./membership-detail-page.component.css'],
})
export class MembershipDetailPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly membershipsService = inject(MembershipsService);
  private readonly accessService = inject(MembershipAccessService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly authFacade = inject(AuthFacade);

  readonly membership = signal<GymMembership | null>(null);
  readonly isLoading = signal(false);
  readonly isSavingMeta = signal(false);
  readonly actionInProgress = signal(false);
  readonly showRenewModal = signal(false);
  readonly showEditModal = signal(false);

  /**
   * UI gate for the admin "Editar membresía" action. The backend
   * (`store:memberships:update`) remains the source of truth; this only hides
   * the button for users without the permission. Reads the reactive
   * permissions signal from the auth facade (frontend permissions come from
   * `response.data.permissions`, not the JWT claim).
   */
  readonly canEditMembership = computed(() =>
    this.authFacade.hasPermission('store:memberships:update'),
  );

  // ── Access enrichment (credentials + recent access logs) ──────────
  readonly credentials = signal<GymAccessCredential[]>([]);
  readonly accessLogs = signal<GymAccessLog[]>([]);
  readonly isLoadingAccess = signal(false);

  readonly statusLabel = computed(() => {
    const s = this.membership()?.status;
    return s ? (GYM_MEMBERSHIP_STATUS_LABELS[s] ?? s) : '';
  });

  readonly statusColor = computed(() => {
    const s = this.membership()?.status;
    return s ? (GYM_MEMBERSHIP_STATUS_COLORS[s] ?? '#6b7280') : '#6b7280';
  });

  /** Sticky-header badge uses named colors, not hex. */
  readonly headerBadgeColor = computed<StickyHeaderBadgeColor>(() => {
    const s = this.membership()?.status;
    if (!s) return 'gray';
    const map: Record<GymMembershipStatus, StickyHeaderBadgeColor> = {
      active: 'green',
      pending_payment: 'yellow',
      frozen: 'blue',
      suspended: 'gray',
      expired: 'red',
      cancelled: 'red',
    };
    return map[s] ?? 'gray';
  });

  readonly headerSubtitle = computed(() => {
    const m = this.membership();
    if (!m) return '';
    const plan = m.plan?.name ?? `Plan #${m.plan_id}`;
    return `${this.customerName()} • ${plan}`;
  });

  readonly customerInitial = computed(() => {
    const m = this.membership();
    const c = m?.customer;
    const raw =
      c?.first_name?.charAt(0) || c?.last_name?.charAt(0) || c?.email?.charAt(0) || 'S';
    return raw.toUpperCase();
  });

  readonly planName = computed(() => {
    const m = this.membership();
    return m?.plan?.name ?? (m ? `Plan #${m.plan_id}` : '');
  });

  readonly planPrice = computed<number>(
    () => Number(this.membership()?.plan?.price ?? 0) || 0,
  );

  readonly planPriceDisplay = computed(() =>
    this.currencyService.format(this.planPrice()),
  );

  // ── Vigencia / progreso ───────────────────────────────────────────
  readonly daysRemaining = computed<number | null>(() => {
    const end = this.membership()?.period_end;
    if (!end) return null;
    return this.calendarDaysBetween(new Date(), new Date(end));
  });

  readonly daysRemainingDisplay = computed<string>(() => {
    const d = this.daysRemaining();
    if (d === null) return '—';
    if (d < 0) return 'Vencida';
    return `${d}`;
  });

  readonly daysRemainingSmall = computed<string>(() => {
    const d = this.daysRemaining();
    if (d === null) return 'Sin vigencia definida';
    if (d < 0) return `Venció hace ${Math.abs(d)} día(s)`;
    if (d === 0) return 'Vence hoy';
    return 'Días para el vencimiento';
  });

  readonly vigencia = computed(() => {
    const m = this.membership();
    const start = m?.period_start ? new Date(m.period_start) : null;
    const end = m?.period_end ? new Date(m.period_end) : null;
    if (!start || !end) {
      return { totalDays: 0, elapsedDays: 0, percent: 0, hasRange: false };
    }
    const totalDays = Math.max(this.calendarDaysBetween(start, end), 0);
    const rawElapsed = this.calendarDaysBetween(start, new Date());
    const elapsedDays = Math.min(Math.max(rawElapsed, 0), totalDays);
    const percent =
      totalDays > 0 ? Math.min(Math.round((elapsedDays / totalDays) * 100), 100) : 0;
    return { totalDays, elapsedDays, percent, hasRange: true };
  });

  readonly membershipAgeDays = computed<number>(() => {
    const created = this.membership()?.created_at;
    if (!created) return 0;
    return Math.max(this.calendarDaysBetween(new Date(created), new Date()), 0);
  });

  // ── Transition guards (unchanged) ─────────────────────────────────
  readonly canSuspend = computed(() =>
    this.statusIn('active', 'frozen', 'pending_payment'),
  );
  readonly canFreeze = computed(() => this.statusIn('active'));
  readonly canCancel = computed(() =>
    this.statusIn('active', 'frozen', 'suspended', 'pending_payment', 'expired'),
  );
  readonly canReactivate = computed(() => this.statusIn('suspended', 'frozen'));

  readonly hasTransitions = computed(
    () =>
      this.canReactivate() ||
      this.canFreeze() ||
      this.canSuspend() ||
      this.canCancel(),
  );

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    const actions: StickyHeaderActionButton[] = [];
    if (this.canEditMembership()) {
      actions.push({
        id: 'edit',
        label: 'Editar membresía',
        icon: 'edit',
        variant: 'outline',
        disabled: !this.membership() || this.actionInProgress(),
      });
    }
    actions.push({
      id: 'renew',
      label: 'Renovar',
      icon: 'refresh-cw',
      variant: 'primary',
      disabled: !this.membership() || this.actionInProgress(),
    });
    return actions;
  });

  // ── Access log timeline (most recent first) ───────────────────────
  readonly accessTimelineSteps = computed<TimelineStep[]>(() =>
    this.accessLogs().map((log, i) => ({
      key: `access-${log.id}`,
      label: this.accessResultLabel(log.result),
      status: i === 0 ? ('current' as const) : ('completed' as const),
      date: this.formatAccessDateTime(log.access_at),
      data: log,
    })),
  );

  readonly metaForm: FormGroup<MetaFormShape> =
    this.fb.nonNullable.group<MetaFormShape>({
      auto_renew: this.fb.nonNullable.control(false),
      notes: this.fb.nonNullable.control(''),
    });

  private readonly metaStatus = toSignal(
    this.metaForm.statusChanges.pipe(startWith(this.metaForm.status)),
    { initialValue: this.metaForm.status },
  );

  readonly canSaveMeta = computed(
    () => this.metaStatus() === 'VALID' && !this.isSavingMeta(),
  );

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.router.navigate(['/admin/memberships/members']);
      return;
    }
    this.loadMembership(Number(id));
  }

  private statusIn(...statuses: GymMembershipStatus[]): boolean {
    const s = this.membership()?.status;
    return s != null && statuses.includes(s);
  }

  private calendarDaysBetween(from: Date, to: Date): number {
    const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
    const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
    return Math.round((b - a) / MS_PER_DAY);
  }

  private loadMembership(id: number): void {
    this.isLoading.set(true);
    this.membershipsService
      .getById(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (membership) => {
          this.applyMembership(membership);
          this.isLoading.set(false);
          // Enrich with access data — never blocks the view.
          this.loadAccessData(membership.customer_id);
        },
        error: (err: unknown) => {
          this.toastService.error(
            typeof err === 'string' ? err : 'No se pudo cargar la membresía',
          );
          this.isLoading.set(false);
          this.router.navigate(['/admin/memberships/members']);
        },
      });
  }

  /**
   * Fetches credentials + recent access logs for the member. Degrades
   * gracefully: on error / forbidden / empty, the signals stay empty and the
   * cards render their empty state — the detail view is never broken.
   */
  private loadAccessData(customerId: number): void {
    if (!customerId) return;
    this.isLoadingAccess.set(true);

    this.accessService
      .listCredentials({ customer_id: customerId, limit: 20 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.credentials.set(res?.data ?? []),
        error: () => this.credentials.set([]),
      });

    this.accessService
      .listLogs({ customer_id: customerId, limit: 8 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const logs = [...(res?.data ?? [])].sort(
            (a, b) =>
              new Date(b.access_at).getTime() - new Date(a.access_at).getTime(),
          );
          this.accessLogs.set(logs);
          this.isLoadingAccess.set(false);
        },
        error: () => {
          this.accessLogs.set([]);
          this.isLoadingAccess.set(false);
        },
      });
  }

  private applyMembership(membership: GymMembership): void {
    this.membership.set(membership);
    this.metaForm.patchValue(
      {
        auto_renew: membership.auto_renew ?? false,
        notes: membership.notes ?? '',
      },
      { emitEvent: false },
    );
    this.metaForm.markAsPristine();
  }

  customerName(): string {
    const m = this.membership();
    if (!m) return '';
    const c = m.customer;
    if (!c) return `Socio #${m.customer_id}`;
    const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
    return name || c.email || `Socio #${m.customer_id}`;
  }

  formatDate(value?: string | null): string {
    return value ? formatDateOnlyUTC(value) : 'Sin definir';
  }

  /** Access logs are timestamps → local date + time is acceptable. */
  formatAccessDateTime(value: string | Date): string {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('es-CO', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  credentialTypeLabel(type: GymCredentialType): string {
    return GYM_CREDENTIAL_TYPE_LABELS[type] ?? type;
  }

  credentialIcon(type: GymCredentialType): string {
    const map: Record<GymCredentialType, string> = {
      qr: 'scan-line',
      pin: 'hash',
      external_ref: 'fingerprint',
    };
    return map[type] ?? 'key-round';
  }

  accessResultLabel(result: GymAccessResult): string {
    return GYM_ACCESS_RESULT_LABELS[result] ?? result;
  }

  accessResultColor(result: GymAccessResult): string {
    return GYM_ACCESS_RESULT_COLORS[result] ?? '#6b7280';
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'renew') this.showRenewModal.set(true);
    else if (actionId === 'edit') this.showEditModal.set(true);
  }

  goToProfile(): void {
    const m = this.membership();
    if (!m) return;
    this.router.navigate(['/admin/memberships/members/profile', m.customer_id]);
  }

  runTransition(action: 'suspend' | 'freeze' | 'cancel' | 'reactivate'): void {
    const m = this.membership();
    if (!m) return;
    this.actionInProgress.set(true);
    this.membershipsService[action](m.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.applyMembership(updated);
          this.actionInProgress.set(false);
          this.toastService.success('Estado de la membresía actualizado');
        },
        error: (err: unknown) => {
          this.actionInProgress.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'No se pudo actualizar el estado',
          );
        },
      });
  }

  saveMeta(): void {
    const m = this.membership();
    if (!m) return;
    const raw = this.metaForm.getRawValue();
    this.isSavingMeta.set(true);
    this.membershipsService
      .update(m.id, { auto_renew: raw.auto_renew, notes: raw.notes?.trim() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.applyMembership(updated);
          this.isSavingMeta.set(false);
          this.toastService.success('Membresía actualizada');
        },
        error: (err: unknown) => {
          this.isSavingMeta.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'No se pudo actualizar la membresía',
          );
        },
      });
  }

  onRenewed(updated: GymMembership): void {
    this.applyMembership(updated);
    // Refresh access data after a renewal (status may have changed).
    this.loadAccessData(updated.customer_id);
  }

  onEdited(updated: GymMembership): void {
    this.applyMembership(updated);
    // Plan/status/vigencia may have changed — refresh access enrichment too.
    this.loadAccessData(updated.customer_id);
  }
}
