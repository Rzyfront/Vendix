import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import {
  ButtonComponent,
  IconComponent,
  SpinnerComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../shared/components/index';
import type { StickyHeaderActionButton } from '../../../../../shared/components/index';
import {
  DnsInstructionRecord,
  DnsInstructions,
  DomainProvisioningStage,
  StoreDomain,
  UpdateStoreDomainDto,
} from './domain.interface';
import { StoreDomainsService } from './store-domains.service';

const PENDING_PROVISIONING_STATUSES = new Set([
  'pending_ssl',
  'pending_certificate',
  'issuing_certificate',
  'pending_alias',
  'propagating',
  'https_check_pending',
]);

@Component({
  selector: 'app-domain-setup-page',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    ReactiveFormsModule,
    ButtonComponent,
    IconComponent,
    SpinnerComponent,
    StickyHeaderComponent,
  ],
  template: `
    <div class="min-h-full bg-background">
      <app-sticky-header
        [title]="headerTitle()"
        [subtitle]="headerSubtitle()"
        icon="globe"
        [showBackButton]="true"
        [backRoute]="['/admin/settings/domains']"
        [badgeText]="headerBadgeText()"
        [badgeColor]="headerBadgeColor()"
        [badgePulse]="isPendingStatus()"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      />

      <div
        class="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 pb-3 md:gap-6 md:px-6 md:pb-6"
      >
        @if (isLoading()) {
          <div
            class="flex min-h-[320px] items-center justify-center rounded-lg border border-slate-200 bg-white"
          >
            <app-spinner
              text="Cargando dominio"
              color="text-sky-600"
            ></app-spinner>
          </div>
        } @else if (domain(); as item) {
          <section
            class="rounded-lg border border-slate-200 bg-white p-4 md:p-6"
          >
            <div
              class="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
            >
              <div>
                <h2 class="text-base font-semibold text-slate-950">Progreso</h2>
                <p class="text-sm text-slate-600">
                  Vendix revisa el dominio automáticamente; tú solo debes actuar
                  cuando un paso lo pida.
                </p>
              </div>
              @if (waitingStage(); as stage) {
                <div
                  class="flex items-center gap-2 rounded-full bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700"
                >
                  <app-spinner size="sm" color="text-sky-600"></app-spinner>
                  {{ stage.label }}
                </div>
              }
            </div>

            <div class="grid gap-3 md:grid-cols-6">
              @for (stage of provisioningStages(); track stage.key) {
                <div class="rounded-lg border p-3 {{ stageCardClass(stage) }}">
                  <div class="mb-2 flex items-center gap-2">
                    <span
                      class="flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold {{
                        stageDotClass(stage)
                      }}"
                    >
                      @if (stage.waiting) {
                        <span
                          class="h-2.5 w-2.5 animate-pulse rounded-full bg-current"
                        ></span>
                      } @else {
                        <app-icon
                          [name]="
                            stage.status === 'complete' ? 'check' : 'circle'
                          "
                          [size]="14"
                        ></app-icon>
                      }
                    </span>
                    <span
                      class="text-sm font-semibold leading-tight {{
                        stageTextClass(stage)
                      }}"
                    >
                      {{ stage.label }}
                    </span>
                  </div>
                  <p class="text-xs leading-relaxed text-slate-600">
                    {{ stage.detail }}
                  </p>
                </div>
              }
            </div>
          </section>

          @if (dnsInstructions()?.root_hostname) {
            <section
              class="rounded-lg border border-slate-200 bg-white p-4 md:p-6"
            >
              <div
                class="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between"
              >
                <div>
                  <h2 class="text-base font-semibold text-slate-950">
                    Dominio base
                  </h2>
                  <p class="text-sm text-slate-600">
                    Este dominio ya puede alimentar el dominio principal y
                    subdominios de un nivel dentro de Vendix.
                  </p>
                </div>
                <span
                  class="inline-flex w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
                >
                  {{ dnsInstructions()?.root_hostname }}
                </span>
              </div>

              <div class="grid gap-3 md:grid-cols-2">
                <div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span
                    class="block text-xs font-semibold uppercase text-slate-500"
                    >Wildcard</span
                  >
                  <span class="mt-1 block font-mono text-sm text-slate-950">
                    {{
                      dnsInstructions()?.wildcard_hostname ||
                        '*.' + dnsInstructions()?.root_hostname
                    }}
                  </span>
                  <p class="mt-1 text-xs text-slate-600">
                    Cubre subdominios como promo.{{
                      dnsInstructions()?.root_hostname
                    }}
                    sin repetir el flujo de certificado.
                  </p>
                </div>

                <div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span
                    class="block text-xs font-semibold uppercase text-slate-500"
                    >Asignaciones</span
                  >
                  @if ((dnsInstructions()?.assignments?.length ?? 0) > 0) {
                    <div class="mt-2 space-y-2">
                      @for (
                        assignment of dnsInstructions()?.assignments;
                        track assignment.id
                      ) {
                        <div
                          class="flex items-center justify-between gap-3 rounded-md bg-white px-2 py-2"
                        >
                          <div class="min-w-0">
                            <span
                              class="block truncate text-sm font-medium text-slate-950"
                              >{{ assignment.hostname }}</span
                            >
                            <span class="block text-xs text-slate-500">{{
                              appTypeLabel(assignment.app_type)
                            }}</span>
                          </div>
                          <span
                            class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold {{
                              statusPillClass(assignment.status)
                            }}"
                          >
                            {{ statusLabel(assignment.status) }}
                          </span>
                        </div>
                      }
                    </div>
                  } @else {
                    <p class="mt-1 text-sm text-slate-600">
                      Aún no hay hostnames asociados a este dominio base.
                    </p>
                  }
                </div>
              </div>
            </section>
          }

          <div
            class="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]"
          >
            <section
              class="rounded-lg border border-slate-200 bg-white p-4 md:p-6"
            >
              <h2 class="mb-1 text-base font-semibold text-slate-950">
                Ajustes
              </h2>
              <p class="mb-4 text-sm text-slate-600">
                Cambia a qué app apunta el dominio y si debe ser principal.
              </p>

              <form [formGroup]="form" class="space-y-4">
                <div>
                  <label class="mb-1 block text-sm font-medium text-slate-700"
                    >Aplicación</label
                  >
                  <select
                    formControlName="app_type"
                    class="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950"
                  >
                    <option value="STORE_ECOMMERCE">E-commerce</option>
                    <option value="STORE_LANDING">Landing tienda</option>
                    <option value="STORE_ADMIN">Admin tienda</option>
                  </select>
                </div>

                <div>
                  <label class="mb-1 block text-sm font-medium text-slate-700"
                    >Tipo de dominio</label
                  >
                  <select
                    formControlName="domain_type"
                    class="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950"
                  >
                    <option value="ecommerce">E-commerce</option>
                    <option value="store">Tienda</option>
                  </select>
                </div>

                <label
                  class="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
                >
                  <input
                    type="checkbox"
                    formControlName="is_primary"
                    class="mt-1 h-4 w-4 rounded border-slate-300"
                  />
                  <span>
                    <span class="block text-sm font-semibold text-slate-950"
                      >Dominio principal</span
                    >
                    <span class="block text-xs text-slate-600"
                      >Se usará como dominio por defecto para esta app.</span
                    >
                  </span>
                </label>
              </form>

              <div class="mt-5 flex flex-col gap-2 sm:flex-row">
                @if (!isOwnershipComplete()) {
                  <app-button
                    variant="primary"
                    type="button"
                    (clicked)="verifyDomain()"
                    [disabled]="isSaving()"
                  >
                    Verificar DNS
                  </app-button>
                }
                @if (canProvision()) {
                  <app-button
                    variant="outline"
                    type="button"
                    (clicked)="provisionDomain()"
                    [disabled]="isSaving()"
                  >
                    Sincronizar estado
                  </app-button>
                }
              </div>
            </section>

            <section
              class="rounded-lg border border-slate-200 bg-white p-4 md:p-6"
            >
              <h2 class="mb-1 text-base font-semibold text-slate-950">
                Diagnóstico
              </h2>
              <p class="mb-4 text-sm text-slate-600">
                Estos datos salen desde verificaciones públicas, no desde el
                navegador del cliente.
              </p>

              <div class="space-y-3">
                <div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span
                    class="block text-xs font-semibold uppercase tracking-wide text-slate-500"
                    >Certificado SSL</span
                  >
                  <span class="mt-1 block text-sm font-medium text-slate-950">
                    {{ certificateProcessLabel() }}
                  </span>
                </div>
                <div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span
                    class="block text-xs font-semibold uppercase tracking-wide text-slate-500"
                    >Conexión del dominio</span
                  >
                  <span class="mt-1 block text-sm font-medium text-slate-950">
                    {{ connectionProcessLabel() }}
                  </span>
                </div>
                <div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span
                    class="block text-xs font-semibold uppercase tracking-wide text-slate-500"
                    >Prueba segura</span
                  >
                  <span class="mt-1 block text-sm font-medium text-slate-950">
                    {{ httpsProbeLabel() }}
                  </span>
                </div>
              </div>
            </section>
          </div>

          <section
            class="rounded-lg border border-slate-200 bg-white p-4 md:p-6"
          >
            <div class="mb-4">
              <h2 class="text-base font-semibold text-slate-950">
                Registros DNS
              </h2>
              <p class="text-sm text-slate-600">
                Copia el <strong>Host en proveedor</strong> y el
                <strong>Valor</strong>. Evita copiar el dominio completo si tu
                proveedor ya lo agrega automáticamente.
              </p>
            </div>

            <div class="grid gap-4 xl:grid-cols-3">
              <div class="space-y-3">
                <h3 class="text-sm font-semibold text-emerald-900">
                  Verificación Vendix
                </h3>
                @if (recordsFor('ownership').length === 0) {
                  <ng-container
                    [ngTemplateOutlet]="emptyCard"
                    [ngTemplateOutletContext]="{
                      title: 'Sin acción requerida',
                      detail:
                        'La propiedad ya fue verificada o está cubierta por otro dominio.',
                    }"
                  ></ng-container>
                }
                @for (
                  record of recordsFor('ownership');
                  track record.record_type + record.name + record.value
                ) {
                  <ng-container
                    [ngTemplateOutlet]="dnsCard"
                    [ngTemplateOutletContext]="{
                      record: record,
                      tone: 'emerald',
                    }"
                  ></ng-container>
                }
              </div>
              <div class="space-y-3">
                <h3 class="text-sm font-semibold text-sky-900">
                  Certificado SSL
                </h3>
                @if (awsCertificateIssued()) {
                  <p
                    class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
                  >
                    El certificado ya fue verificado. Conserva los CNAME para
                    renovaciones.
                  </p>
                }
                @if (recordsFor('certificate').length === 0) {
                  <ng-container
                    [ngTemplateOutlet]="emptyCard"
                    [ngTemplateOutletContext]="{
                      title: certificateEmptyTitle(),
                      detail: certificateEmptyDetail(),
                    }"
                  ></ng-container>
                }
                @for (
                  record of recordsFor('certificate');
                  track record.record_type + record.name + record.value
                ) {
                  <ng-container
                    [ngTemplateOutlet]="dnsCard"
                    [ngTemplateOutletContext]="{ record: record, tone: 'sky' }"
                  ></ng-container>
                }
              </div>
              <div class="space-y-3">
                <h3 class="text-sm font-semibold text-slate-900">
                  Enrutamiento
                </h3>
                @if (recordsFor('routing').length === 0) {
                  <ng-container
                    [ngTemplateOutlet]="emptyCard"
                    [ngTemplateOutletContext]="{
                      title: 'Sin registros de enrutamiento',
                      detail:
                        'Vendix todavía está preparando las instrucciones.',
                    }"
                  ></ng-container>
                }
                @for (
                  record of recordsFor('routing');
                  track record.record_type + record.name + record.value
                ) {
                  <ng-container
                    [ngTemplateOutlet]="dnsCard"
                    [ngTemplateOutletContext]="{
                      record: record,
                      tone: 'slate',
                    }"
                  ></ng-container>
                }
              </div>
            </div>
          </section>
        } @else {
          <div
            class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            No se pudo cargar el dominio.
          </div>
        }
      </div>
    </div>

    <ng-template #dnsCard let-record="record">
      <article class="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div class="mb-3 flex items-start justify-between gap-2">
          <div>
            <span class="text-sm font-semibold text-slate-950">{{
              record.record_type
            }}</span>
            @if (record.domain_name) {
              <span class="ml-1 text-xs text-slate-500">{{
                record.domain_name
              }}</span>
            }
          </div>
          <span
            class="rounded-full px-2 py-0.5 text-[11px] font-semibold {{
              recordStatusPillClass(record.status)
            }}"
          >
            {{ instructionStatusLabel(record.status) }}
          </span>
        </div>

        <div class="space-y-3">
          <div>
            <span class="mb-1 block text-xs font-medium text-slate-600"
              >Host en proveedor</span
            >
            <button
              type="button"
              class="flex w-full items-start gap-2 rounded-md bg-white px-2 py-2 text-left font-mono text-xs text-slate-950"
              (click)="copyToClipboard(providerHost(record))"
            >
              <span class="min-w-0 flex-1 break-all">{{
                providerHost(record)
              }}</span>
              <app-icon name="copy" [size]="14"></app-icon>
            </button>
            @if (record.fqdn_name) {
              <span class="mt-1 block break-all text-[11px] text-slate-500">{{
                record.fqdn_name
              }}</span>
            }
          </div>

          <div>
            <span class="mb-1 block text-xs font-medium text-slate-600"
              >Valor</span
            >
            <button
              type="button"
              class="flex w-full items-start gap-2 rounded-md bg-white px-2 py-2 text-left font-mono text-xs text-slate-950"
              (click)="copyToClipboard(record.value)"
            >
              <span class="min-w-0 flex-1 break-all">{{ record.value }}</span>
              <app-icon name="copy" [size]="14"></app-icon>
            </button>
          </div>
        </div>

        @if (record.status_reason || (record.seen_in?.length ?? 0) > 0) {
          <p class="mt-3 text-xs leading-relaxed text-slate-600">
            {{ record.status_reason }}
            @if ((record.seen_in?.length ?? 0) > 0) {
              <span> Detectado por DNS público.</span>
            }
          </p>
        }
      </article>
    </ng-template>

    <ng-template #emptyCard let-title="title" let-detail="detail">
      <article
        class="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3"
      >
        <div class="flex items-start gap-2">
          <app-icon
            name="info"
            [size]="16"
            class="mt-0.5 text-slate-500"
          ></app-icon>
          <div>
            <h4 class="text-sm font-semibold text-slate-800">{{ title }}</h4>
            <p class="mt-1 text-xs leading-relaxed text-slate-600">
              {{ detail }}
            </p>
          </div>
        </div>
      </article>
    </ng-template>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DomainSetupPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly domainsService = inject(StoreDomainsService);
  private readonly toastService = inject(ToastService);

  readonly domain = signal<StoreDomain | null>(null);
  readonly dnsInstructions = signal<DnsInstructions | null>(null);
  readonly isLoading = signal(true);
  readonly isSaving = signal(false);
  readonly copied = signal(false);

  readonly form = this.fb.group({
    app_type: ['STORE_ECOMMERCE', Validators.required],
    domain_type: ['ecommerce', Validators.required],
    is_primary: [false],
  });

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'open',
      label: 'Abrir',
      variant: 'outline',
      icon: 'external-link',
      visible: !!this.domain(),
    },
    {
      id: 'save',
      label: 'Guardar',
      variant: 'primary',
      icon: 'save',
      loading: this.isSaving(),
      disabled: !this.domain() || this.form.invalid,
    },
  ]);

  readonly headerTitle = computed(
    () => this.domain()?.hostname || 'Configuración de dominio',
  );

  readonly headerSubtitle = computed(() => this.antiPanicMessage());

  readonly headerBadgeText = computed(() =>
    this.domain() ? this.statusLabel(this.domain()!.status) : '',
  );

  readonly headerBadgeColor = computed<
    'green' | 'blue' | 'yellow' | 'gray' | 'red'
  >(() => {
    const status = this.domain()?.status || '';
    if (status === 'active') return 'green';
    if (status.startsWith('failed')) return 'red';
    if (PENDING_PROVISIONING_STATUSES.has(status)) return 'blue';
    return 'yellow';
  });

  readonly provisioningStages = computed<DomainProvisioningStage[]>(() => {
    const domain = this.domain();
    return (
      this.dnsInstructions()?.stages ?? [
        {
          key: 'ownership',
          label: 'Verificación Vendix',
          status: domain?.last_verified_at ? 'complete' : 'pending',
          detail: domain?.last_verified_at
            ? 'La propiedad ya fue verificada.'
            : 'Agrega el TXT de propiedad.',
          waiting: !domain?.last_verified_at,
        },
      ]
    );
  });

  readonly waitingStage = computed(
    () =>
      this.provisioningStages().find((stage) => stage.waiting) ??
      (PENDING_PROVISIONING_STATUSES.has(this.domain()?.status || '')
        ? {
            key: 'cloudfront',
            label: this.statusLabel(this.domain()?.status || ''),
            status: 'waiting',
            detail: 'Vendix está revisando el dominio automáticamente.',
            waiting: true,
          }
        : null),
  );

  readonly antiPanicMessage = computed(() => {
    const dns = this.dnsInstructions();
    if (
      dns?.routing_status === 'complete' &&
      dns?.https_probe_status !== 'passed'
    ) {
      return 'Vendix ya ve tus DNS desde internet. Si tu navegador aún falla, puede ser caché o DNS de tu red.';
    }
    return 'No pruebes el dominio como definitivo hasta que quede Activo; puede mostrar error SSL mientras el certificado y la conexión terminan.';
  });

  readonly isPendingStatus = computed(() =>
    PENDING_PROVISIONING_STATUSES.has(this.domain()?.status || ''),
  );

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!Number.isFinite(id)) {
      this.toastService.error('Dominio inválido');
      this.goBack();
      return;
    }

    this.loadDomain(id);
    this.startPolling(id);
  }

  private startPolling(id: number): void {
    interval(15000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (!this.isPendingStatus() || this.isSaving()) return;
        this.loadDomain(id, true);
      });
  }

  loadDomain(id: number, silent = false): void {
    if (!silent) this.isLoading.set(true);
    this.domainsService
      .getDomainById(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.domain.set(response.data);
            this.form.patchValue({
              app_type: response.data.app_type,
              domain_type: response.data.domain_type,
              is_primary: response.data.is_primary,
            });
            if (this.isCustomDomain(response.data)) {
              this.loadDnsInstructions(response.data.id, true);
            }
          }
          this.isLoading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar el dominio');
          this.isLoading.set(false);
        },
      });
  }

  loadDnsInstructions(id: number, silent = false): void {
    this.domainsService
      .getDnsInstructions(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success) this.dnsInstructions.set(response.data);
        },
        error: () => {
          if (!silent)
            this.toastService.error('Error al cargar instrucciones DNS');
        },
      });
  }

  saveSettings(): void {
    const current = this.domain();
    if (!current || this.form.invalid) return;
    this.isSaving.set(true);
    const dto: UpdateStoreDomainDto = {
      ...this.form.getRawValue(),
      config: current.config || {},
    } as UpdateStoreDomainDto;

    this.domainsService
      .updateDomain(current.id, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.toastService.success('Dominio actualizado');
          this.domain.set(response.data);
          this.isSaving.set(false);
        },
        error: () => {
          this.toastService.error('Error al actualizar el dominio');
          this.isSaving.set(false);
        },
      });
  }

  verifyDomain(): void {
    const current = this.domain();
    if (!current) return;
    this.isSaving.set(true);
    this.domainsService
      .verifyDomain(current.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success && response.data.verified) {
            this.toastService.success('Propiedad verificada');
          } else {
            this.toastService.warning('No se encontró el TXT de verificación');
          }
          this.loadDomain(current.id, true);
          this.isSaving.set(false);
        },
        error: () => {
          this.toastService.error('Error al verificar el dominio');
          this.isSaving.set(false);
        },
      });
  }

  provisionDomain(): void {
    const current = this.domain();
    if (!current) return;
    this.isSaving.set(true);
    this.domainsService
      .provisionNext(current.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Estado sincronizado');
          this.loadDomain(current.id, true);
          this.isSaving.set(false);
        },
        error: () => {
          this.toastService.error('Error al sincronizar el dominio');
          this.isSaving.set(false);
        },
      });
  }

  recordsFor(
    group: 'ownership' | 'certificate' | 'routing',
  ): DnsInstructionRecord[] {
    return (
      this.dnsInstructions()?.instructions.filter(
        (record) => (record.group || record.purpose) === group,
      ) ?? []
    );
  }

  providerHost(record: DnsInstructionRecord): string {
    return record.provider_host || record.name;
  }

  copyToClipboard(value: string): void {
    if (!value) return;
    navigator.clipboard?.writeText(value).then(() => {
      this.toastService.success('Copiado');
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1400);
    });
  }

  goBack(): void {
    this.router.navigate(['/admin/settings/domains']);
  }

  openDomain(domain: StoreDomain): void {
    window.open(`https://${domain.hostname}`, '_blank');
  }

  onHeaderAction(actionId: string): void {
    const current = this.domain();
    if (actionId === 'open' && current) this.openDomain(current);
    if (actionId === 'save') this.saveSettings();
  }

  isCustomDomain(domain: StoreDomain): boolean {
    return (
      domain.ownership === 'custom_domain' ||
      domain.ownership === 'custom_subdomain'
    );
  }

  isOwnershipComplete(): boolean {
    const domain = this.domain();
    const dns = this.dnsInstructions();
    return (
      dns?.ownership_status === 'complete' ||
      dns?.ownership_status === 'covered_by_parent' ||
      !!domain?.last_verified_at ||
      (domain?.status !== undefined && domain.status !== 'pending_ownership')
    );
  }

  canProvision(): boolean {
    const domain = this.domain();
    return !!(
      domain &&
      this.isCustomDomain(domain) &&
      domain.last_verified_at &&
      domain.status !== 'active' &&
      domain.status !== 'failed_ownership'
    );
  }

  awsCertificateIssued(): boolean {
    const domain = this.domain();
    return (
      this.dnsInstructions()?.aws_certificate_status === 'ISSUED' ||
      domain?.config?.ssl?.aws_certificate_status === 'ISSUED' ||
      domain?.ssl_status === 'issued'
    );
  }

  httpsProbeLabel(): string {
    const status =
      this.dnsInstructions()?.https_probe_status ||
      this.domain()?.config?.ssl?.https_probe_status;
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      passed: 'Aprobado',
      failed: 'Esperando propagación',
    };
    return labels[status || ''] || 'Pendiente';
  }

  certificateProcessLabel(): string {
    const status =
      this.dnsInstructions()?.aws_certificate_status ||
      this.domain()?.config?.ssl?.aws_certificate_status;
    const labels: Record<string, string> = {
      ISSUED: 'Verificado',
      PENDING_VALIDATION: 'Esperando registros DNS',
      FAILED: 'Falló',
      VALIDATION_TIMED_OUT: 'Tiempo agotado',
      EXPIRED: 'Expirado',
      REVOKED: 'Revocado',
    };
    return labels[status || ''] || status || 'Pendiente';
  }

  connectionProcessLabel(): string {
    const status =
      this.dnsInstructions()?.cloudfront_status ||
      this.domain()?.config?.ssl?.cloudfront_status;
    const labels: Record<string, string> = {
      Deployed: 'Conectado',
      InProgress: 'Conectando',
      Updating: 'Conectando',
      Unknown: 'Pendiente',
    };
    return labels[status || ''] || status || 'Pendiente';
  }

  certificateEmptyTitle(): string {
    if (this.awsCertificateIssued()) return 'Certificado verificado';
    return 'Esperando registros del certificado';
  }

  certificateEmptyDetail(): string {
    if (this.awsCertificateIssued()) {
      return 'El certificado ya fue verificado. No hay registros nuevos por copiar en este momento.';
    }
    return 'Vendix mostrará aquí los CNAME cuando el proceso de certificado los entregue.';
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending_dns: 'Pendiente DNS',
      pending_ownership: 'Acción requerida',
      verifying_ownership: 'Verificando propiedad',
      pending_ssl: 'Pendiente SSL',
      pending_certificate: 'Esperando certificado',
      issuing_certificate: 'Validando certificado',
      pending_alias: 'Conectando dominio',
      propagating: 'Propagando SSL',
      https_check_pending: 'Probando HTTPS',
      failed_ownership: 'Falló propiedad',
      failed_certificate: 'Falló certificado',
      failed_alias: 'Falló conexión',
      active: 'Activo',
      disabled: 'Deshabilitado',
    };
    return labels[status] || status;
  }

  appTypeLabel(appType: string): string {
    const labels: Record<string, string> = {
      STORE_ECOMMERCE: 'E-commerce',
      STORE_LANDING: 'Landing tienda',
      STORE_ADMIN: 'Admin tienda',
    };
    return labels[appType] || appType;
  }

  instructionStatusLabel(status?: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      waiting: 'Esperando',
      complete: 'Detectado',
      covered_by_parent: 'Heredado',
      not_required: 'No requerido',
      failed: 'Falló',
    };
    return labels[status || ''] || 'Pendiente';
  }

  statusPillClass(status: string): string {
    if (status === 'active') return 'bg-emerald-100 text-emerald-700';
    if (status.startsWith('failed')) return 'bg-red-100 text-red-700';
    if (PENDING_PROVISIONING_STATUSES.has(status))
      return 'bg-sky-100 text-sky-700';
    return 'bg-amber-100 text-amber-700';
  }

  recordStatusPillClass(status?: string): string {
    if (status === 'complete' || status === 'covered_by_parent') {
      return 'bg-emerald-100 text-emerald-700';
    }
    if (status === 'failed') return 'bg-red-100 text-red-700';
    return 'bg-amber-100 text-amber-700';
  }

  stageCardClass(stage: DomainProvisioningStage): string {
    if (stage.status === 'complete' || stage.status === 'covered_by_parent') {
      return 'border-emerald-200 bg-emerald-50/70';
    }
    if (stage.status === 'failed') return 'border-red-200 bg-red-50/70';
    if (stage.waiting || stage.status === 'waiting')
      return 'border-sky-200 bg-sky-50/70';
    return 'border-slate-200 bg-slate-50/70';
  }

  stageDotClass(stage: DomainProvisioningStage): string {
    if (stage.status === 'complete' || stage.status === 'covered_by_parent') {
      return 'border-emerald-500 bg-emerald-500 text-white';
    }
    if (stage.status === 'failed')
      return 'border-red-500 bg-red-500 text-white';
    if (stage.waiting || stage.status === 'waiting') {
      return 'border-sky-500 bg-white text-sky-600';
    }
    return 'border-slate-300 bg-white text-slate-400';
  }

  stageTextClass(stage: DomainProvisioningStage): string {
    if (stage.status === 'complete' || stage.status === 'covered_by_parent') {
      return 'text-emerald-900';
    }
    if (stage.status === 'failed') return 'text-red-900';
    if (stage.waiting || stage.status === 'waiting') return 'text-sky-900';
    return 'text-slate-600';
  }
}
