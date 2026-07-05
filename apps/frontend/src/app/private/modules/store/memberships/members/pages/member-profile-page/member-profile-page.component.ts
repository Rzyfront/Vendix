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
  Validators,
} from '@angular/forms';

import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  SpinnerComponent,
  StickyHeaderActionButton,
  StickyHeaderComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { formatDateOnlyUTC } from '../../../../../../../shared/utils/date.util';

import {
  GymMemberProfile,
  GymMembership,
  UpsertMemberProfileDto,
  GYM_MEMBERSHIP_STATUS_COLORS,
  GYM_MEMBERSHIP_STATUS_LABELS,
} from '../../interfaces';
import {
  MembershipMemberProfilesService,
  MembershipsService,
} from '../../services';

interface ProfileFormShape {
  date_of_birth: FormControl<string>;
  gender: FormControl<string>;
  emergency_contact_name: FormControl<string>;
  emergency_contact_phone: FormControl<string>;
  height_cm: FormControl<number | null>;
  weight_kg: FormControl<number | null>;
  medical_notes: FormControl<string>;
  goals: FormControl<string>;
}

@Component({
  selector: 'app-membership-member-profile-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    StickyHeaderComponent,
    CardComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    SpinnerComponent,
    TextareaComponent,
  ],
  templateUrl: './member-profile-page.component.html',
})
export class MembershipMemberProfilePageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly profilesService = inject(MembershipMemberProfilesService);
  private readonly membershipsService = inject(MembershipsService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly customerId = signal<number | null>(null);
  readonly isLoading = signal(false);
  readonly isSaving = signal(false);
  readonly memberships = signal<GymMembership[]>([]);
  readonly memberName = signal<string>('');

  readonly genderOptions: SelectorOption[] = [
    { value: 'masculino', label: 'Masculino' },
    { value: 'femenino', label: 'Femenino' },
    { value: 'otro', label: 'Otro' },
    { value: 'no_especifica', label: 'Prefiere no decir' },
  ];

  readonly form: FormGroup<ProfileFormShape> =
    this.fb.nonNullable.group<ProfileFormShape>({
      date_of_birth: this.fb.nonNullable.control(''),
      gender: this.fb.nonNullable.control(''),
      emergency_contact_name: this.fb.nonNullable.control('', {
        validators: [Validators.maxLength(160)],
      }),
      emergency_contact_phone: this.fb.nonNullable.control('', {
        validators: [Validators.maxLength(40)],
      }),
      height_cm: this.fb.nonNullable.control<number | null>(null, {
        validators: [Validators.min(0), Validators.max(300)],
      }),
      weight_kg: this.fb.nonNullable.control<number | null>(null, {
        validators: [Validators.min(0), Validators.max(999)],
      }),
      medical_notes: this.fb.nonNullable.control(''),
      goals: this.fb.nonNullable.control(''),
    });

  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'save',
      label: 'Guardar perfil',
      icon: 'save',
      variant: 'primary',
      loading: this.isSaving(),
      disabled: this.formStatus() !== 'VALID' || this.isSaving(),
    },
  ]);

  ngOnInit(): void {
    const rawId = this.route.snapshot.paramMap.get('customerId');
    const customerId = rawId ? Number(rawId) : NaN;
    if (!Number.isFinite(customerId)) {
      this.router.navigate(['/admin/memberships/members']);
      return;
    }
    this.customerId.set(customerId);
    this.memberName.set(`Socio #${customerId}`);
    this.loadProfile(customerId);
    this.loadMemberships(customerId);
  }

  private loadProfile(customerId: number): void {
    this.isLoading.set(true);
    this.profilesService
      .getByCustomer(customerId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (profile) => {
          if (profile) this.applyProfile(profile);
          this.isLoading.set(false);
        },
        error: (err: unknown) => {
          // A missing profile is not fatal — the form stays empty for a first
          // upsert. Only surface real errors.
          this.isLoading.set(false);
          if (typeof err === 'string') this.toastService.error(err);
        },
      });
  }

  private applyProfile(profile: GymMemberProfile): void {
    this.form.patchValue({
      date_of_birth: profile.date_of_birth
        ? String(profile.date_of_birth).substring(0, 10)
        : '',
      gender: profile.gender ?? '',
      emergency_contact_name: profile.emergency_contact_name ?? '',
      emergency_contact_phone: profile.emergency_contact_phone ?? '',
      height_cm: profile.height_cm ?? null,
      weight_kg: profile.weight_kg == null ? null : Number(profile.weight_kg),
      medical_notes: profile.medical_notes ?? '',
      goals: profile.goals ?? '',
    });
  }

  private loadMemberships(customerId: number): void {
    this.membershipsService
      .listPaginated({ customer_id: customerId, limit: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const rows = response.data ?? [];
          this.memberships.set(rows);
          const first = rows[0]?.customer;
          if (first) {
            const name = `${first.first_name ?? ''} ${first.last_name ?? ''}`.trim();
            if (name) this.memberName.set(name);
            else if (first.email) this.memberName.set(first.email);
          }
        },
        error: () => {
          /* memberships are supplementary; ignore load errors */
        },
      });
  }

  statusLabel(status: GymMembership['status']): string {
    return GYM_MEMBERSHIP_STATUS_LABELS[status] ?? status;
  }

  statusColor(status: GymMembership['status']): string {
    return GYM_MEMBERSHIP_STATUS_COLORS[status] ?? '#6b7280';
  }

  formatDate(value?: string | null): string {
    return value ? formatDateOnlyUTC(value) : 'Sin vigencia';
  }

  planName(m: GymMembership): string {
    return m.plan?.name ?? `Plan #${m.plan_id}`;
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'save') this.submit();
  }

  assignMembership(): void {
    this.router.navigate(['/admin/memberships/members/new'], {
      queryParams: { customer_id: this.customerId() },
    });
  }

  openMembership(m: GymMembership): void {
    this.router.navigate(['/admin/memberships/members', m.id]);
  }

  submit(): void {
    const customerId = this.customerId();
    if (customerId == null) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.toastService.warning('Revisa los campos marcados antes de guardar');
      return;
    }

    const raw = this.form.getRawValue();
    const dto: UpsertMemberProfileDto = {
      date_of_birth: raw.date_of_birth || undefined,
      gender: raw.gender || undefined,
      emergency_contact_name: raw.emergency_contact_name?.trim() || undefined,
      emergency_contact_phone: raw.emergency_contact_phone?.trim() || undefined,
      medical_notes: raw.medical_notes?.trim() || undefined,
      goals: raw.goals?.trim() || undefined,
      height_cm: raw.height_cm == null ? undefined : Number(raw.height_cm),
      weight_kg: raw.weight_kg == null ? undefined : Number(raw.weight_kg),
    };

    this.isSaving.set(true);
    this.profilesService
      .upsert(customerId, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (profile) => {
          this.applyProfile(profile);
          this.isSaving.set(false);
          this.toastService.success('Perfil del socio guardado correctamente');
        },
        error: (err: unknown) => {
          this.isSaving.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al guardar el perfil',
          );
        },
      });
  }
}
