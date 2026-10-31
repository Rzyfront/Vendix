import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  SelectorComponent,
  SpinnerComponent,
  StoreUserSelectComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../shared/components';
import type { SelectorOption } from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { CrmService } from '../shared/crm.service';
import {
  CrmConsent,
  CrmCustomerSource,
  CrmNote,
  CrmPipeline,
  CrmTag,
  CrmTimelineItem,
  CrmTimelineType,
  CustomerCrmProfile,
  UpdateCustomerCrmProfile,
  personName,
} from '../shared/crm.interface';
import {
  CRM_CONSENT_LABELS,
  CRM_SOURCE_LABELS,
  CRM_TIMELINE_META,
  crmCanSeeAll,
  formatDateTime,
} from '../shared/crm.utils';
import { TaskFormModalComponent } from '../shared/task-form-modal.component';

const TIMELINE_PAGE = 20;
const CONSENT_CHANNELS = [
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'sms', label: 'SMS' },
  { key: 'email', label: 'Correo' },
] as const;

/**
 * Pestaña CRM de la ficha del cliente (PLAN-CRM §7, H2): responsable, origen,
 * etapa, consentimientos, etiquetas, RFM, notas libres y la línea de tiempo
 * unificada (pedidos, pagos, cotizaciones, reservas, mensajes, tareas, notas).
 */
@Component({
  selector: 'app-customer-crm-panel',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    CurrencyPipe,
    EmptyStateComponent,
    IconComponent,
    SelectorComponent,
    SpinnerComponent,
    StoreUserSelectComponent,
    TextareaComponent,
    TaskFormModalComponent,
  ],
  template: `
    @if (loading() && !profile()) {
      <div class="flex justify-center py-12"><app-spinner></app-spinner></div>
    } @else if (error() && !profile()) {
      <app-card>
        <app-empty-state
          icon="alert-triangle"
          title="No pudimos cargar el CRM del cliente"
          [description]="error()!"
          [showActionButton]="false"
          [showRefreshButton]="true"
          (refreshClick)="reload()"
        ></app-empty-state>
      </app-card>
    } @else if (profile(); as p) {
      <div class="flex flex-col gap-4 md:gap-6">
        <!-- Relationship -->
        <app-card>
          <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 class="text-base font-semibold text-[var(--color-text-primary)]">Relación comercial</h3>
            <div class="flex flex-wrap gap-2">
              @if (canManageTasks()) {
                <app-button variant="outline" size="sm" (clicked)="taskModalOpen.set(true)">
                  Nueva tarea
                </app-button>
              }
              @if (canReadPipeline()) {
                <a
                  routerLink="/admin/customers/pipeline"
                  class="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover,rgba(0,0,0,0.04))]"
                >
                  <app-icon name="trending-up" [size]="14"></app-icon>
                  Pipeline
                </a>
              }
            </div>
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <app-selector
              label="Etapa"
              placeholder="Sin etapa"
              [options]="stageOptions()"
              [disabled]="!canUpdate() || saving()"
              [ngModel]="p.stage?.id ?? ''"
              (ngModelChange)="patch({ stage_id: $event ? +$event : null })"
            ></app-selector>

            <app-selector
              label="Origen"
              placeholder="Sin origen"
              [options]="sourceOptions"
              [disabled]="!canUpdate() || saving()"
              [ngModel]="p.source ?? ''"
              (ngModelChange)="patch({ source: $event || null })"
            ></app-selector>

            <div class="flex flex-col gap-1">
              <span class="text-sm font-medium text-[var(--color-text-primary)]">Responsable</span>
              @if (canAssign()) {
                <app-store-user-select
                  placeholder="Sin asignar"
                  lookupMode="staff"
                  [disabled]="saving()"
                  [value]="p.owner?.id ?? null"
                  (valueChange)="onOwnerChange($event)"
                ></app-store-user-select>
              } @else {
                <span class="text-sm text-[var(--color-text-secondary)]">
                  {{ ownerName() || 'Sin asignar' }}
                </span>
              }
            </div>
          </div>

          <div
            class="mt-4 grid grid-cols-2 gap-4 border-t border-[var(--color-border)] pt-4 sm:grid-cols-4"
          >
            <div class="flex flex-col gap-1">
              <span class="text-xs text-[var(--color-text-muted)]">Tareas abiertas</span>
              <span class="text-sm font-semibold text-[var(--color-text-primary)]">
                {{ p.open_tasks }}
                @if (p.overdue_tasks) {
                  <span class="ml-1 text-xs font-semibold text-[var(--color-error)]">
                    · {{ p.overdue_tasks }} vencida{{ p.overdue_tasks === 1 ? '' : 's' }}
                  </span>
                }
              </span>
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-xs text-[var(--color-text-muted)]">Oportunidades abiertas</span>
              <span class="text-sm font-semibold text-[var(--color-text-primary)]">
                {{ p.open_opportunities.count }} · {{ +p.open_opportunities.amount | currency }}
              </span>
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-xs text-[var(--color-text-muted)]">Último contacto</span>
              <span class="text-sm font-semibold text-[var(--color-text-primary)]">
                {{ p.last_contact_at ? dateTime(p.last_contact_at) : '—' }}
              </span>
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-xs text-[var(--color-text-muted)]">Consentimientos</span>
              <div class="flex flex-wrap gap-1">
                @for (channel of consentChannels; track channel.key) {
                  <select
                    class="h-7 rounded-md border border-[var(--color-border)] bg-surface px-1 text-xs text-[var(--color-text-primary)]"
                    [attr.aria-label]="'Consentimiento ' + channel.label"
                    [disabled]="!canUpdate() || saving()"
                    [ngModel]="p.consents[channel.key]"
                    (ngModelChange)="setConsent(channel.key, $event)"
                  >
                    @for (option of consentOptions; track option.value) {
                      <option [value]="option.value">{{ channel.label }}: {{ option.label }}</option>
                    }
                  </select>
                }
              </div>
            </div>
          </div>
        </app-card>

        <div class="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
          <!-- RFM -->
          <app-card>
            <h3 class="mb-3 text-base font-semibold text-[var(--color-text-primary)]">
              Valor del cliente (RFM)
            </h3>
            @if (p.rfm.segment) {
              <div class="flex flex-col gap-3">
                <div class="flex flex-wrap items-center gap-2">
                  <app-badge [variant]="rfmVariant()" size="md">{{ p.rfm.segment }}</app-badge>
                  @if (p.rfm.scores; as s) {
                    <span class="text-xs text-[var(--color-text-muted)]">
                      R {{ s.r }} · F {{ s.f }} · M {{ s.m }} (de 5)
                    </span>
                  }
                </div>
                <p class="text-sm text-[var(--color-text-secondary)]">{{ p.rfm.description }}</p>
                <div class="grid grid-cols-3 gap-3 text-center">
                  <div class="rounded-lg bg-[var(--color-background)] p-2">
                    <div class="text-xs text-[var(--color-text-muted)]">Última compra</div>
                    <div class="text-sm font-semibold">hace {{ p.rfm.recency_days }} d</div>
                  </div>
                  <div class="rounded-lg bg-[var(--color-background)] p-2">
                    <div class="text-xs text-[var(--color-text-muted)]">Compras</div>
                    <div class="text-sm font-semibold">{{ p.rfm.frequency }}</div>
                  </div>
                  <div class="rounded-lg bg-[var(--color-background)] p-2">
                    <div class="text-xs text-[var(--color-text-muted)]">Gastado</div>
                    <div class="text-sm font-semibold">{{ +p.rfm.monetary | currency }}</div>
                  </div>
                </div>
                <p class="text-xs text-[var(--color-text-muted)]">
                  Comparado con los clientes que compraron en los últimos {{ p.rfm.period_days }} días.
                </p>
              </div>
            } @else {
              <p class="text-sm text-[var(--color-text-secondary)]">
                Sin compras finalizadas en los últimos {{ p.rfm.period_days }} días: aún no hay segmento.
              </p>
            }
          </app-card>

          <!-- Tags -->
          <app-card>
            <h3 class="mb-3 text-base font-semibold text-[var(--color-text-primary)]">Etiquetas</h3>
            <div class="flex flex-wrap gap-2">
              @for (tag of p.tags; track tag.id) {
                <span
                  class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold"
                  [style.border-color]="tag.color || 'var(--color-border)'"
                  [style.color]="tag.color || 'var(--color-text-primary)'"
                >
                  {{ tag.name }}
                  @if (canUpdate()) {
                    <button
                      type="button"
                      class="rounded-full p-0.5 hover:bg-black/5"
                      [attr.aria-label]="'Quitar etiqueta ' + tag.name"
                      [disabled]="saving()"
                      (click)="removeTag(tag.id)"
                    >
                      <app-icon name="x" [size]="12"></app-icon>
                    </button>
                  }
                </span>
              } @empty {
                <span class="text-sm text-[var(--color-text-secondary)]">Sin etiquetas.</span>
              }
            </div>
            @if (canUpdate()) {
              <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
                <app-selector
                  class="flex-1"
                  label="Agregar etiqueta"
                  placeholder="Elige una etiqueta"
                  [options]="availableTagOptions()"
                  [disabled]="saving() || !availableTagOptions().length"
                  [ngModel]="''"
                  (ngModelChange)="$event && addTag(+$event)"
                ></app-selector>
                @if (canManageTags()) {
                  <div class="flex gap-2">
                    <input
                      class="h-10 flex-1 rounded-lg border border-[var(--color-border)] bg-surface px-3 text-sm"
                      placeholder="Nueva etiqueta"
                      maxlength="60"
                      aria-label="Nombre de la nueva etiqueta"
                      [ngModel]="newTag()"
                      (ngModelChange)="newTag.set($event)"
                      (keydown.enter)="createTag()"
                    />
                    <app-button
                      variant="outline"
                      size="md"
                      [disabled]="!newTag().trim()"
                      [loading]="saving()"
                      (clicked)="createTag()"
                    >
                      Crear
                    </app-button>
                  </div>
                }
              </div>
            }
          </app-card>
        </div>

        <!-- Notes -->
        <app-card>
          <h3 class="mb-3 text-base font-semibold text-[var(--color-text-primary)]">Notas</h3>
          @if (canUpdate()) {
            <div class="flex flex-col gap-2">
              <app-textarea
                placeholder="Escribe una nota sobre el cliente..."
                [ngModel]="noteDraft()"
                (ngModelChange)="noteDraft.set($event)"
              ></app-textarea>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <label class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                  <input
                    type="checkbox"
                    [ngModel]="notePinned()"
                    (ngModelChange)="notePinned.set($event)"
                  />
                  Fijar arriba
                </label>
                <app-button
                  variant="primary"
                  size="sm"
                  [disabled]="!noteDraft().trim()"
                  [loading]="savingNote()"
                  (clicked)="addNote()"
                >
                  Guardar nota
                </app-button>
              </div>
            </div>
          }
          <ul class="mt-4 flex flex-col gap-3">
            @for (note of notes(); track note.id) {
              <li
                class="rounded-lg border border-[var(--color-border)] p-3"
                [class.border-amber-300]="note.is_pinned"
                [class.bg-amber-50]="note.is_pinned"
              >
                <div class="mb-1 flex items-center justify-between gap-2 text-xs text-[var(--color-text-muted)]">
                  <span>
                    @if (note.is_pinned) {
                      <app-icon name="pin" [size]="12"></app-icon>
                    }
                    {{ name(note.created_by) || 'Alguien del equipo' }} · {{ dateTime(note.created_at) }}
                  </span>
                  @if (canUpdate()) {
                    <button
                      type="button"
                      class="text-xs font-semibold text-primary hover:underline"
                      (click)="togglePin(note)"
                    >
                      {{ note.is_pinned ? 'Desfijar' : 'Fijar' }}
                    </button>
                  }
                </div>
                <p class="whitespace-pre-line text-sm text-[var(--color-text-primary)]">{{ note.body }}</p>
              </li>
            } @empty {
              <li class="text-sm text-[var(--color-text-secondary)]">Aún no hay notas.</li>
            }
          </ul>
        </app-card>

        <!-- Timeline -->
        <app-card>
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 class="text-base font-semibold text-[var(--color-text-primary)]">Línea de tiempo</h3>
          </div>
          <div class="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtrar línea de tiempo">
            <button
              type="button"
              class="h-8 rounded-full border px-3 text-xs font-semibold"
              [style.border-color]="types().length ? 'var(--color-border)' : 'var(--color-primary)'"
              [style.color]="types().length ? 'var(--color-text-secondary)' : 'var(--color-primary)'"
              [attr.aria-pressed]="!types().length"
              (click)="setTypes([])"
            >
              Todo
            </button>
            @for (type of timelineTypes; track type) {
              <button
                type="button"
                class="inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-semibold"
                [style.border-color]="types().includes(type) ? 'var(--color-primary)' : 'var(--color-border)'"
                [style.color]="types().includes(type) ? 'var(--color-primary)' : 'var(--color-text-secondary)'"
                [attr.aria-pressed]="types().includes(type)"
                (click)="toggleType(type)"
              >
                <app-icon [name]="meta(type).icon" [size]="12"></app-icon>
                {{ meta(type).label }}
              </button>
            }
          </div>

          @if (timelineError()) {
            <p class="text-sm text-[var(--color-error)]">{{ timelineError() }}</p>
          }
          <ol class="relative flex flex-col gap-4 border-l border-[var(--color-border)] pl-5">
            @for (item of timeline(); track item.type + '-' + item.ref.id + '-' + item.at) {
              <li class="relative">
                <span
                  class="absolute -left-[29px] flex h-6 w-6 items-center justify-center rounded-full border border-[var(--color-border)] bg-surface"
                >
                  <app-icon [name]="meta(item.type).icon" [size]="12"></app-icon>
                </span>
                <div class="flex flex-wrap items-baseline justify-between gap-2">
                  <span class="text-sm font-semibold text-[var(--color-text-primary)]">
                    @if (item.type === 'message') {
                      <a class="hover:underline" routerLink="/admin/customers/inbox" [queryParams]="{ c: item.ref.id }">{{ item.title }}</a>
                    } @else {
                      {{ item.title }}
                    }
                  </span>
                  <span class="text-xs text-[var(--color-text-muted)]">{{ dateTime(item.at) }}</span>
                </div>
                <div class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                  @if (item.status) {
                    <app-badge variant="neutral" size="xs">{{ item.status }}</app-badge>
                  }
                  @if (item.amount !== null) {
                    <span class="font-semibold">{{ +item.amount | currency }}</span>
                  }
                  @if (item.actor) {
                    <span>· {{ name(item.actor) }}</span>
                  }
                </div>
                @if (item.summary) {
                  <p class="mt-1 whitespace-pre-line text-sm text-[var(--color-text-secondary)]">{{ item.summary }}</p>
                }
              </li>
            } @empty {
              @if (!timelineLoading()) {
                <li class="text-sm text-[var(--color-text-secondary)]">Sin actividad todavía.</li>
              }
            }
          </ol>
          @if (timelineLoading()) {
            <div class="flex justify-center py-4"><app-spinner size="sm"></app-spinner></div>
          } @else if (nextBefore()) {
            <div class="mt-4 flex justify-center">
              <app-button variant="outline" size="sm" (clicked)="loadTimeline(false)">Cargar más</app-button>
            </div>
          }
        </app-card>
      </div>

      <app-crm-task-form-modal
        [isOpen]="taskModalOpen()"
        (isOpenChange)="taskModalOpen.set($event)"
        [fixedCustomer]="p.customer"
        (saved)="onTaskSaved()"
      ></app-crm-task-form-modal>
    }
  `,
})
export class CustomerCrmPanelComponent {
  private readonly crm = inject(CrmService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthFacade);

  readonly customerId = input.required<number>();

  protected readonly profile = signal<CustomerCrmProfile | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly pipelines = signal<CrmPipeline[]>([]);
  protected readonly tagCatalog = signal<CrmTag[]>([]);
  protected readonly newTag = signal('');
  protected readonly notes = signal<CrmNote[]>([]);
  protected readonly noteDraft = signal('');
  protected readonly notePinned = signal(false);
  protected readonly savingNote = signal(false);
  protected readonly timeline = signal<CrmTimelineItem[]>([]);
  protected readonly timelineLoading = signal(false);
  protected readonly timelineError = signal<string | null>(null);
  protected readonly nextBefore = signal<string | null>(null);
  protected readonly types = signal<CrmTimelineType[]>([]);
  protected readonly taskModalOpen = signal(false);

  protected readonly consentChannels = CONSENT_CHANNELS;
  protected readonly timelineTypes = Object.keys(CRM_TIMELINE_META) as CrmTimelineType[];
  protected readonly sourceOptions: SelectorOption[] = (
    Object.keys(CRM_SOURCE_LABELS) as CrmCustomerSource[]
  ).map((value) => ({ value, label: CRM_SOURCE_LABELS[value] }));
  protected readonly consentOptions = (Object.keys(CRM_CONSENT_LABELS) as CrmConsent[]).map(
    (value) => ({ value, label: CRM_CONSENT_LABELS[value] }),
  );

  protected readonly canUpdate = computed(
    () => this.auth.isOwner() || this.auth.hasPermission('store:customers:update'),
  );
  protected readonly canAssign = computed(() => crmCanSeeAll(this.auth));
  protected readonly canManageTags = computed(
    () => this.auth.isOwner() || this.auth.hasPermission('store:crm_segments:manage'),
  );
  protected readonly canManageTasks = computed(
    () => this.auth.isOwner() || this.auth.hasPermission('store:crm_tasks:manage'),
  );
  protected readonly canReadPipeline = computed(
    () => this.auth.isOwner() || this.auth.hasPermission('store:crm_pipeline:read'),
  );

  protected readonly ownerName = computed(() => personName(this.profile()?.owner));
  protected readonly stageOptions = computed<SelectorOption[]>(() =>
    this.pipelines().flatMap((pipeline) =>
      pipeline.stages
        .filter((stage) => stage.is_active !== false)
        .map((stage) => ({
          value: stage.id,
          label:
            this.pipelines().length > 1 ? `${pipeline.name} · ${stage.name}` : stage.name,
        })),
    ),
  );
  protected readonly availableTagOptions = computed<SelectorOption[]>(() => {
    const assigned = new Set((this.profile()?.tags ?? []).map((tag) => tag.id));
    return this.tagCatalog()
      .filter((tag) => !assigned.has(tag.id))
      .map((tag) => ({ value: tag.id, label: tag.name }));
  });
  protected readonly rfmVariant = computed(() => {
    const segment = this.profile()?.rfm.segment ?? '';
    if (['Campeones', 'Leales'].includes(segment)) return 'success' as const;
    if (['En riesgo', 'No podemos perderlos', 'Perdidos'].includes(segment)) {
      return 'error' as const;
    }
    if (segment === 'Necesitan atención' || segment === 'Hibernando') return 'warning' as const;
    return 'info' as const;
  });

  constructor() {
    effect(() => {
      const id = this.customerId();
      untracked(() => {
        this.profile.set(null);
        this.timeline.set([]);
        this.reload();
      });
      void id;
    });
  }

  protected readonly name = personName;
  protected readonly dateTime = formatDateTime;
  protected meta(type: CrmTimelineType) {
    return CRM_TIMELINE_META[type];
  }

  async reload(): Promise<void> {
    const id = this.customerId();
    this.loading.set(true);
    this.error.set(null);
    try {
      const [profile, notes] = await Promise.all([
        firstValueFrom(this.crm.profile(id)),
        firstValueFrom(this.crm.notes(id)),
      ]);
      this.profile.set(profile);
      this.notes.set(notes);
    } catch (error) {
      this.error.set(parseApiError(error).userMessage);
    } finally {
      this.loading.set(false);
    }
    // Catalogs are best effort: the panel works without them.
    if (this.canReadPipeline() && !this.pipelines().length) {
      firstValueFrom(this.crm.pipelines())
        .then((rows) => this.pipelines.set(rows))
        .catch(() => undefined);
    }
    firstValueFrom(this.crm.tags())
      .then((rows) => this.tagCatalog.set(rows))
      .catch(() => undefined);
    void this.loadTimeline(true);
  }

  /** Latest request wins: a reset (new filter, new note) supersedes a load in flight. */
  private timelineRequest = 0;

  async loadTimeline(reset: boolean): Promise<void> {
    if (!reset && this.timelineLoading()) return;
    const request = ++this.timelineRequest;
    this.timelineLoading.set(true);
    this.timelineError.set(null);
    try {
      const page = await firstValueFrom(
        this.crm.timeline(this.customerId(), {
          types: this.types(),
          before: reset ? null : this.nextBefore(),
          limit: TIMELINE_PAGE,
        }),
      );
      if (request !== this.timelineRequest) return;
      this.timeline.update((rows) => (reset ? page.data : [...rows, ...page.data]));
      this.nextBefore.set(page.meta.has_more ? page.meta.next_before : null);
    } catch (error) {
      if (request === this.timelineRequest) {
        this.timelineError.set(parseApiError(error).userMessage);
      }
    } finally {
      if (request === this.timelineRequest) this.timelineLoading.set(false);
    }
  }

  setTypes(types: CrmTimelineType[]): void {
    this.types.set(types);
    void this.loadTimeline(true);
  }

  toggleType(type: CrmTimelineType): void {
    const current = this.types();
    this.setTypes(
      current.includes(type) ? current.filter((t) => t !== type) : [...current, type],
    );
  }

  setConsent(channel: 'whatsapp' | 'sms' | 'email', value: CrmConsent): void {
    void this.patch({ consents: { [channel]: value } });
  }

  onOwnerChange(ownerId: number | null): void {
    if (ownerId === (this.profile()?.owner?.id ?? null)) return;
    void this.patch({ owner_user_id: ownerId });
  }

  async patch(body: UpdateCustomerCrmProfile): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      this.profile.set(await firstValueFrom(this.crm.updateProfile(this.customerId(), body)));
      this.toast.success('Cliente actualizado');
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
      // Re-read so the controls show the stored value again.
      firstValueFrom(this.crm.profile(this.customerId()))
        .then((profile) => this.profile.set(profile))
        .catch(() => undefined);
    } finally {
      this.saving.set(false);
    }
  }

  addTag(tagId: number): Promise<void> {
    const ids = (this.profile()?.tags ?? []).map((tag) => tag.id);
    return this.saveTags([...ids, tagId]);
  }

  removeTag(tagId: number): Promise<void> {
    const ids = (this.profile()?.tags ?? []).map((tag) => tag.id);
    return this.saveTags(ids.filter((id) => id !== tagId));
  }

  async createTag(): Promise<void> {
    const name = this.newTag().trim();
    if (!name || this.saving()) return;
    this.saving.set(true);
    try {
      const tag = await firstValueFrom(this.crm.createTag({ name }));
      this.tagCatalog.update((rows) => [...rows, tag]);
      this.newTag.set('');
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
      return;
    } finally {
      this.saving.set(false);
    }
    const created = this.tagCatalog().find((tag) => tag.name === name);
    if (created) await this.addTag(created.id);
  }

  private async saveTags(tagIds: number[]): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      const tags = await firstValueFrom(this.crm.setTags(this.customerId(), tagIds));
      this.profile.update((profile) => (profile ? { ...profile, tags } : profile));
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.saving.set(false);
    }
  }

  async addNote(): Promise<void> {
    const body = this.noteDraft().trim();
    if (!body || this.savingNote()) return;
    this.savingNote.set(true);
    try {
      await firstValueFrom(
        this.crm.createNote(this.customerId(), { body, is_pinned: this.notePinned() }),
      );
      this.noteDraft.set('');
      this.notePinned.set(false);
      this.notes.set(await firstValueFrom(this.crm.notes(this.customerId())));
      void this.loadTimeline(true);
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.savingNote.set(false);
    }
  }

  async togglePin(note: CrmNote): Promise<void> {
    try {
      await firstValueFrom(
        this.crm.updateNote(this.customerId(), note.id, { is_pinned: !note.is_pinned }),
      );
      this.notes.set(await firstValueFrom(this.crm.notes(this.customerId())));
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    }
  }

  onTaskSaved(): void {
    firstValueFrom(this.crm.profile(this.customerId()))
      .then((profile) => this.profile.set(profile))
      .catch(() => undefined);
    void this.loadTimeline(true);
  }
}
