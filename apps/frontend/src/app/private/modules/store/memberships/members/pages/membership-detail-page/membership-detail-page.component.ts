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
  StickyHeaderActionButton,
  StickyHeaderComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { formatDateOnlyUTC } from '../../../../../../../shared/utils/date.util';

import {
  GymMembership,
  GymMembershipStatus,
  GYM_MEMBERSHIP_STATUS_COLORS,
  GYM_MEMBERSHIP_STATUS_LABELS,
} from '../../interfaces';
import { MembershipsService } from '../../services';
import { RenewMembershipModalComponent } from '../../components/renew-membership-modal/renew-membership-modal.component';

interface MetaFormShape {
  auto_renew: FormControl<boolean>;
  notes: FormControl<string>;
}

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
    SettingToggleComponent,
    TextareaComponent,
    RenewMembershipModalComponent,
  ],
  templateUrl: './membership-detail-page.component.html',
})
export class MembershipDetailPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly membershipsService = inject(MembershipsService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly membership = signal<GymMembership | null>(null);
  readonly isLoading = signal(false);
  readonly isSavingMeta = signal(false);
  readonly actionInProgress = signal(false);
  readonly showRenewModal = signal(false);

  readonly statusLabel = computed(() => {
    const s = this.membership()?.status;
    return s ? (GYM_MEMBERSHIP_STATUS_LABELS[s] ?? s) : '';
  });

  readonly statusColor = computed(() => {
    const s = this.membership()?.status;
    return s ? (GYM_MEMBERSHIP_STATUS_COLORS[s] ?? '#6b7280') : '#6b7280';
  });

  readonly canSuspend = computed(() =>
    this.statusIn('active', 'frozen', 'pending_payment'),
  );
  readonly canFreeze = computed(() => this.statusIn('active'));
  readonly canCancel = computed(() =>
    this.statusIn('active', 'frozen', 'suspended', 'pending_payment', 'expired'),
  );
  readonly canReactivate = computed(() =>
    this.statusIn('suspended', 'frozen'),
  );

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'renew',
      label: 'Renovar',
      icon: 'refresh-cw',
      variant: 'primary',
      disabled: !this.membership() || this.actionInProgress(),
    },
  ]);

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

  private loadMembership(id: number): void {
    this.isLoading.set(true);
    this.membershipsService
      .getById(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (membership) => {
          this.applyMembership(membership);
          this.isLoading.set(false);
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

  onHeaderAction(actionId: string): void {
    if (actionId === 'renew') this.showRenewModal.set(true);
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
  }
}
