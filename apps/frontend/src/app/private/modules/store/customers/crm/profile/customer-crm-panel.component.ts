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
  InputComponent,
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
import { CrmSegmentsService } from '../shared/crm-segments.service';
import { CrmSegment } from '../shared/crm-segments.interface';
import {
  CrmConsent,
  CrmCustomerSource,
  CrmNote,
  CrmOpportunity,
  CrmPipeline,
  CrmStage,
  CrmTag,
  CrmTask,
  CrmTimelineItem,
  CrmTimelineType,
  CustomerCrmMemberships,
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
import { CustomerSectionComponent, CustomerSectionEmptyComponent } from '../../components/customer-section/customer-section.component';

const TIMELINE_PAGE = 20;
/** Pending follow-ups listed in the profile; the rest live in Tareas. */
const FOLLOW_UPS_SHOWN = 5;
const CONSENT_CHANNELS = [
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'sms', label: 'SMS' },
  { key: 'email', label: 'Correo' },
] as const;

/** Same chip for segments and tags, so the profile and the list match. */
const CHIP =
  'inline-flex h-8 max-w-full items-center gap-1 rounded-full border px-3 text-xs font-semibold';
const SEGMENT_CHIP = `${CHIP} border-primary/25 bg-primary/10 text-primary-on-tint`;
const TAG_CHIP = `${CHIP} border-border bg-surface text-text-secondary`;

/**
 * Pestaña CRM de la ficha del cliente (PLAN-CRM §7, H2): relación comercial,
 * tablero (pipeline y etapa), seguimientos, segmentos, etiquetas, RFM, notas
 * y la línea de tiempo unificada. Todo se opera desde aquí con los mismos
 * endpoints que usan Pipeline, Tareas y Segmentos.
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
    InputComponent,
    SelectorComponent,
    SpinnerComponent,
    StoreUserSelectComponent,
    TextareaComponent,
    TaskFormModalComponent,
    CustomerSectionComponent,
    CustomerSectionEmptyComponent,
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
        <app-customer-section title="Relación comercial" icon="user-check">
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
              <span class="text-sm font-medium text-text-primary">Responsable</span>
              @if (canAssign()) {
                <app-store-user-select
                  placeholder="Sin asignar"
                  lookupMode="staff"
                  [disabled]="saving()"
                  [value]="p.owner?.id ?? null"
                  [valueLabel]="ownerName() || null"
                  (valueChange)="onOwnerChange($event)"
                ></app-store-user-select>
              } @else {
                <span class="text-sm text-text-secondary">{{ ownerName() || 'Sin asignar' }}</span>
              }
            </div>
          </div>

          <dl class="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 sm:grid-cols-3">
            <div class="flex flex-col gap-1">
              <dt class="text-xs font-semibold text-text-secondary">Tareas abiertas</dt>
              <dd class="text-sm font-bold text-text-primary">
                {{ p.open_tasks }}
                @if (p.overdue_tasks) {
                  <span class="ml-1 text-xs font-semibold text-error">
                    · {{ p.overdue_tasks }} vencida{{ p.overdue_tasks === 1 ? '' : 's' }}
                  </span>
                }
              </dd>
            </div>
            <div class="flex flex-col gap-1">
              <dt class="text-xs font-semibold text-text-secondary">Oportunidades abiertas</dt>
              <dd class="text-sm font-bold text-text-primary">
                {{ p.open_opportunities.count }} · {{ +p.open_opportunities.amount | currency }}
              </dd>
            </div>
            <div class="flex flex-col gap-1">
              <dt class="text-xs font-semibold text-text-secondary">Último contacto</dt>
              <dd class="text-sm font-bold text-text-primary">
                {{ p.last_contact_at ? dateTime(p.last_contact_at) : '—' }}
              </dd>
            </div>
          </dl>

          <div class="mt-4 flex flex-col gap-2 border-t border-border pt-4">
            <span class="text-xs font-semibold text-text-secondary">Consentimientos</span>
            <div class="flex flex-wrap gap-2">
              @for (channel of consentChannels; track channel.key) {
                <select
                  class="h-8 rounded-xl border border-border bg-surface px-2 text-xs text-text-primary"
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
        </app-customer-section>

        <div class="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
          <!-- Board -->
          @if (canReadPipeline()) {
            <app-customer-section title="Tablero" icon="trending-up" hint="Pipeline y etapa en que va el cliente.">
              <a
                slot="actions"
                routerLink="/admin/customers/pipeline"
                class="inline-flex h-8 items-center gap-1 rounded-xl border border-border px-3 text-xs font-semibold text-text-primary hover:bg-primary/5"
              >
                <app-icon name="external-link" [size]="14"></app-icon>
                Ver pipeline
              </a>

              @if (boardLoading() && !opportunities().length) {
                <div class="flex justify-center py-4"><app-spinner size="sm"></app-spinner></div>
              } @else {
                <ul class="flex flex-col gap-2" role="list">
                  @for (opportunity of opportunities(); track opportunity.id) {
                    <li class="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div class="min-w-0">
                        <p class="truncate text-sm font-semibold text-text-primary">{{ opportunity.title }}</p>
                        <p class="text-xs text-text-secondary">
                          {{ pipelineName(opportunity.pipeline_id) }}
                          @if (opportunity.amount !== null) {
                            · {{ +opportunity.amount | currency }}
                          }
                        </p>
                      </div>
                      @if (canManagePipeline()) {
                        <select
                          class="h-8 rounded-xl border border-border bg-surface px-2 text-xs font-semibold text-text-primary"
                          [attr.aria-label]="'Etapa de ' + opportunity.title"
                          [disabled]="boardSaving()"
                          [ngModel]="opportunity.stage_id"
                          (ngModelChange)="moveOpportunity(opportunity, +$event)"
                        >
                          @for (stage of placeableStages(opportunity.pipeline_id, opportunity.stage_id); track stage.id) {
                            <option [ngValue]="stage.id">{{ stage.name }}</option>
                          }
                        </select>
                      } @else {
                        <app-badge variant="primary" size="xs">{{ opportunity.stage?.name }}</app-badge>
                      }
                    </li>
                  } @empty {
                    <app-customer-section-empty
                      icon="trending-up"
                      text="El cliente aún no está en ningún tablero."
                    ></app-customer-section-empty>
                  }
                </ul>
              }

              @if (canManagePipeline() && pipelines().length) {
                <div class="mt-4 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-end">
                  @if (pipelines().length > 1) {
                    <app-selector
                      class="flex-1"
                      label="Pipeline"
                      [options]="pipelineOptions()"
                      [disabled]="boardSaving()"
                      [ngModel]="placePipelineId()"
                      (ngModelChange)="onPlacePipeline($event)"
                    ></app-selector>
                  }
                  <app-selector
                    class="flex-1"
                    label="Ubicar en la etapa"
                    placeholder="Elige una etapa"
                    [options]="placeStageOptions()"
                    [disabled]="boardSaving()"
                    [ngModel]="placeStageId() ?? ''"
                    (ngModelChange)="placeStageId.set($event ? +$event : null)"
                  ></app-selector>
                  <app-button
                    variant="outline"
                    size="md"
                    [disabled]="!placeStageId()"
                    [loading]="boardSaving()"
                    (clicked)="placeOnBoard()"
                  >
                    Agregar al tablero
                  </app-button>
                </div>
              }
            </app-customer-section>
          }

          <!-- Follow-ups -->
          @if (canManageTasks()) {
            <app-customer-section title="Seguimientos" icon="check-square" hint="Tareas pendientes con este cliente.">
              <app-button slot="actions" variant="outline" size="sm" (clicked)="taskModalOpen.set(true)">
                <app-icon slot="icon" name="plus" [size]="14"></app-icon>
                Nuevo seguimiento
              </app-button>

              @if (tasksLoading() && !tasks().length) {
                <div class="flex justify-center py-4"><app-spinner size="sm"></app-spinner></div>
              } @else {
                <ul class="flex flex-col gap-2" role="list">
                  @for (task of tasks(); track task.id) {
                    <li class="flex items-start gap-3 rounded-xl border border-border p-3">
                      <button
                        type="button"
                        class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border text-primary hover:bg-primary/10"
                        [attr.aria-label]="'Completar ' + task.title"
                        [disabled]="completingId() === task.id"
                        (click)="completeTask(task)"
                      >
                        <app-icon name="check" [size]="14"></app-icon>
                      </button>
                      <div class="min-w-0 flex-1">
                        <p class="text-sm font-semibold text-text-primary">{{ task.title }}</p>
                        <p class="flex flex-wrap items-center gap-x-2 text-xs text-text-secondary">
                          @if (task.due_at) {
                            <span class="inline-flex items-center gap-1">
                              <app-icon name="calendar" [size]="12"></app-icon>
                              {{ dateTime(task.due_at) }}
                            </span>
                          }
                          <span>{{ name(task.assigned_user) || 'Sin responsable' }}</span>
                          @if (task.is_overdue) {
                            <app-badge variant="error" size="xs">Vencida</app-badge>
                          }
                        </p>
                        @if (task.description) {
                          <p class="mt-1 whitespace-pre-line text-xs text-text-secondary">{{ task.description }}</p>
                        }
                      </div>
                    </li>
                  } @empty {
                    <app-customer-section-empty
                      icon="check-square"
                      text="Sin seguimientos pendientes."
                    ></app-customer-section-empty>
                  }
                </ul>
                @if (tasksTotal() > tasks().length) {
                  <a
                    routerLink="/admin/customers/tasks"
                    class="mt-3 inline-flex text-xs font-semibold text-primary hover:underline"
                  >
                    Ver los {{ tasksTotal() }} en Tareas
                  </a>
                }
              }
            </app-customer-section>
          }

          <!-- Segments -->
          <app-customer-section title="Segmentos" icon="users" hint="Los segmentos por regla se actualizan solos.">
            <div class="flex flex-wrap gap-2">
              @for (segment of memberships()?.segments ?? []; track segment.id) {
                <span [class]="segmentChip" [attr.title]="segmentVia(segment.via)">
                  <app-icon [name]="segment.via === 'manual' ? 'users' : 'sparkles'" [size]="12"></app-icon>
                  <span class="truncate">{{ segment.name }}</span>
                  @if (canUpdate() && segment.via === 'manual') {
                    <button
                      type="button"
                      class="rounded-full p-0.5 hover:bg-primary/15"
                      [attr.aria-label]="'Quitar del segmento ' + segment.name"
                      [disabled]="segmentSaving()"
                      (click)="removeFromSegment(segment.id)"
                    >
                      <app-icon name="x" [size]="12"></app-icon>
                    </button>
                  }
                </span>
              } @empty {
                <app-customer-section-empty class="w-full" icon="users" text="No está en ningún segmento."></app-customer-section-empty>
              }
            </div>
            @if (canUpdate()) {
              <div class="mt-4 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-end">
                <app-selector
                  class="flex-1"
                  label="Agregar a un segmento"
                  placeholder="Elige un segmento"
                  [options]="availableSegmentOptions()"
                  [disabled]="segmentSaving() || !availableSegmentOptions().length"
                  [ngModel]="segmentPick() ?? ''"
                  (ngModelChange)="segmentPick.set($event ? +$event : null)"
                ></app-selector>
                <app-button
                  variant="outline"
                  size="md"
                  [disabled]="!segmentPick()"
                  [loading]="segmentSaving()"
                  (clicked)="addPickedSegment()"
                >
                  Agregar
                </app-button>
              </div>
              @if (canManageSegments()) {
                <div class="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
                  <app-input
                    class="flex-1"
                    label="Crear segmento"
                    placeholder="Nombre del segmento nuevo"
                    [maxlength]="120"
                    [ngModel]="newSegment()"
                    (ngModelChange)="newSegment.set($event)"
                    (keydown.enter)="createSegment()"
                  ></app-input>
                  <app-button
                    variant="outline"
                    size="md"
                    [disabled]="!newSegment().trim()"
                    [loading]="segmentSaving()"
                    (clicked)="createSegment()"
                  >
                    Crear y agregar
                  </app-button>
                </div>
              }
            }
          </app-customer-section>

          <!-- Tags -->
          <app-customer-section title="Etiquetas" icon="tag" hint="Marcas manuales para agrupar y filtrar.">
            <div class="flex flex-wrap gap-2">
              @for (tag of p.tags; track tag.id) {
                <span [class]="tagChip">
                  <app-icon name="tag" [size]="12"></app-icon>
                  <span class="truncate">{{ tag.name }}</span>
                  @if (canUpdate()) {
                    <button
                      type="button"
                      class="rounded-full p-0.5 hover:bg-primary/10"
                      [attr.aria-label]="'Quitar etiqueta ' + tag.name"
                      [disabled]="saving()"
                      (click)="removeTag(tag.id)"
                    >
                      <app-icon name="x" [size]="12"></app-icon>
                    </button>
                  }
                </span>
              } @empty {
                <app-customer-section-empty class="w-full" icon="tag" text="Sin etiquetas."></app-customer-section-empty>
              }
            </div>
            @if (canUpdate()) {
              <div class="mt-4 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-end">
                <app-selector
                  class="flex-1"
                  label="Agregar etiqueta"
                  placeholder="Elige una etiqueta"
                  [options]="availableTagOptions()"
                  [disabled]="saving() || !availableTagOptions().length"
                  [ngModel]="tagPick() ?? ''"
                  (ngModelChange)="tagPick.set($event ? +$event : null)"
                ></app-selector>
                <app-button
                  variant="outline"
                  size="md"
                  [disabled]="!tagPick()"
                  [loading]="saving()"
                  (clicked)="addPickedTag()"
                >
                  Agregar
                </app-button>
              </div>
              @if (canManageSegments()) {
                <div class="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
                  <app-input
                    class="flex-1"
                    label="Crear etiqueta"
                    placeholder="Nombre de la etiqueta nueva"
                    [maxlength]="60"
                    [ngModel]="newTag()"
                    (ngModelChange)="newTag.set($event)"
                    (keydown.enter)="createTag()"
                  ></app-input>
                  <app-button
                    variant="outline"
                    size="md"
                    [disabled]="!newTag().trim()"
                    [loading]="saving()"
                    (clicked)="createTag()"
                  >
                    Crear y agregar
                  </app-button>
                </div>
              }
            }
          </app-customer-section>

          <!-- RFM -->
          <app-customer-section title="Valor del cliente (RFM)" icon="award">
            @if (p.rfm.segment) {
              <div class="flex flex-col gap-3">
                <div class="flex flex-wrap items-center gap-2">
                  <app-badge [variant]="rfmVariant()" size="md">{{ p.rfm.segment }}</app-badge>
                  @if (p.rfm.scores; as s) {
                    <span class="text-xs text-text-secondary">R {{ s.r }} · F {{ s.f }} · M {{ s.m }} (de 5)</span>
                  }
                </div>
                <p class="text-sm text-text-secondary">{{ p.rfm.description }}</p>
                <div class="grid grid-cols-3 gap-2 text-center">
                  <div class="rounded-xl bg-background p-2">
                    <div class="text-xs font-semibold text-text-secondary">Última compra</div>
                    <div class="text-sm font-bold text-text-primary">hace {{ p.rfm.recency_days }} d</div>
                  </div>
                  <div class="rounded-xl bg-background p-2">
                    <div class="text-xs font-semibold text-text-secondary">Compras</div>
                    <div class="text-sm font-bold text-text-primary">{{ p.rfm.frequency }}</div>
                  </div>
                  <div class="rounded-xl bg-background p-2">
                    <div class="text-xs font-semibold text-text-secondary">Gastado</div>
                    <div class="text-sm font-bold text-text-primary">{{ +p.rfm.monetary | currency }}</div>
                  </div>
                </div>
                <p class="text-xs text-text-secondary">
                  Comparado con los clientes que compraron en los últimos {{ p.rfm.period_days }} días.
                </p>
              </div>
            } @else {
              <app-customer-section-empty
                icon="award"
                [text]="'Sin compras finalizadas en los últimos ' + p.rfm.period_days + ' días: aún no hay segmento.'"
              ></app-customer-section-empty>
            }
          </app-customer-section>

          <!-- Notes -->
          <app-customer-section title="Notas" icon="sticky-note">
            @if (canUpdate()) {
              <div class="flex flex-col gap-2">
                <app-textarea
                  placeholder="Escribe una nota sobre el cliente..."
                  [ngModel]="noteDraft()"
                  (ngModelChange)="noteDraft.set($event)"
                ></app-textarea>
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <label class="flex items-center gap-2 text-sm text-text-secondary">
                    <input type="checkbox" [ngModel]="notePinned()" (ngModelChange)="notePinned.set($event)" />
                    Fijar arriba
                  </label>
                  <app-button
                    variant="outline"
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
            <ul class="mt-4 flex flex-col gap-2" role="list">
              @for (note of notes(); track note.id) {
                <li [class]="note.is_pinned ? pinnedNote : plainNote">
                  <div class="mb-1 flex items-center justify-between gap-2 text-xs text-text-secondary">
                    <span class="inline-flex items-center gap-1">
                      @if (note.is_pinned) {
                        <app-icon name="pin" [size]="12"></app-icon>
                      }
                      {{ name(note.created_by) || 'Alguien del equipo' }} · {{ dateTime(note.created_at) }}
                    </span>
                    @if (canUpdate()) {
                      <button type="button" class="text-xs font-semibold text-primary hover:underline" (click)="togglePin(note)">
                        {{ note.is_pinned ? 'Desfijar' : 'Fijar' }}
                      </button>
                    }
                  </div>
                  <p class="whitespace-pre-line text-sm text-text-primary">{{ note.body }}</p>
                </li>
              } @empty {
                <app-customer-section-empty icon="sticky-note" text="Aún no hay notas."></app-customer-section-empty>
              }
            </ul>
          </app-customer-section>
        </div>

        <!-- Timeline -->
        <app-customer-section title="Línea de tiempo" icon="history">
          <div class="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtrar línea de tiempo">
            <button
              type="button"
              [class]="filterChip(!types().length)"
              [attr.aria-pressed]="!types().length"
              (click)="setTypes([])"
            >
              Todo
            </button>
            @for (type of timelineTypes; track type) {
              <button
                type="button"
                [class]="filterChip(types().includes(type))"
                [attr.aria-pressed]="types().includes(type)"
                (click)="toggleType(type)"
              >
                <app-icon [name]="meta(type).icon" [size]="12"></app-icon>
                {{ meta(type).label }}
              </button>
            }
          </div>

          @if (timelineError()) {
            <p class="text-sm text-error">{{ timelineError() }}</p>
          }
          <ol class="flex flex-col gap-3">
            @for (item of timeline(); track item.type + '-' + item.ref.id + '-' + item.at) {
              <li class="flex gap-3">
                <span
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
                  aria-hidden="true"
                >
                  <app-icon [name]="meta(item.type).icon" [size]="14"></app-icon>
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-baseline justify-between gap-2">
                    <span class="text-sm font-semibold text-text-primary">
                      @if (item.type === 'message') {
                        <a class="hover:underline" routerLink="/admin/customers/inbox" [queryParams]="{ c: item.ref.id }">{{ item.title }}</a>
                      } @else {
                        {{ item.title }}
                      }
                    </span>
                    <span class="text-xs text-text-secondary">{{ dateTime(item.at) }}</span>
                  </div>
                  <div class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                    @if (item.status) {
                      <app-badge variant="neutral" size="xs">{{ item.status }}</app-badge>
                    }
                    @if (item.amount !== null) {
                      <span class="font-bold">{{ +item.amount | currency }}</span>
                    }
                    @if (item.actor) {
                      <span>· {{ name(item.actor) }}</span>
                    }
                  </div>
                  @if (item.summary) {
                    <p class="mt-1 whitespace-pre-line text-sm text-text-secondary">{{ item.summary }}</p>
                  }
                </div>
              </li>
            } @empty {
              @if (!timelineLoading()) {
                <app-customer-section-empty icon="history" text="Sin actividad todavía."></app-customer-section-empty>
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
        </app-customer-section>
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
  private readonly segmentsApi = inject(CrmSegmentsService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthFacade);

  readonly customerId = input.required<number>();

  protected readonly profile = signal<CustomerCrmProfile | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly pipelines = signal<CrmPipeline[]>([]);
  /** Every active stage, so the profile stage can be set (or cleared) without an opportunity. */
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
  protected readonly tagCatalog = signal<CrmTag[]>([]);
  protected readonly tagPick = signal<number | null>(null);
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

  // Board
  protected readonly opportunities = signal<CrmOpportunity[]>([]);
  protected readonly boardLoading = signal(false);
  protected readonly boardSaving = signal(false);
  protected readonly placePipelineId = signal<number | null>(null);
  protected readonly placeStageId = signal<number | null>(null);

  // Follow-ups
  protected readonly tasks = signal<CrmTask[]>([]);
  protected readonly tasksTotal = signal(0);
  protected readonly tasksLoading = signal(false);
  protected readonly completingId = signal<number | null>(null);

  // Segments
  protected readonly memberships = signal<CustomerCrmMemberships | null>(null);
  protected readonly segmentCatalog = signal<CrmSegment[]>([]);
  protected readonly segmentPick = signal<number | null>(null);
  protected readonly newSegment = signal('');
  protected readonly segmentSaving = signal(false);

  protected readonly segmentChip = SEGMENT_CHIP;
  protected readonly plainNote = 'rounded-xl border border-border p-3';
  protected readonly pinnedNote = 'rounded-xl border border-primary/25 bg-primary/5 p-3';
  protected readonly tagChip = TAG_CHIP;
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
  protected readonly canManageSegments = computed(
    () => this.auth.isOwner() || this.auth.hasPermission('store:crm_segments:manage'),
  );
  protected readonly canManageTasks = computed(
    () => this.auth.isOwner() || this.auth.hasPermission('store:crm_tasks:manage'),
  );
  protected readonly canReadPipeline = computed(
    () => this.auth.isOwner() || this.auth.hasPermission('store:crm_pipeline:read'),
  );
  protected readonly canManagePipeline = computed(
    () => this.auth.isOwner() || this.auth.hasPermission('store:crm_pipeline:manage'),
  );

  protected readonly ownerName = computed(() => personName(this.profile()?.owner));
  protected readonly pipelineOptions = computed<SelectorOption[]>(() =>
    this.pipelines().map((pipeline) => ({ value: pipeline.id, label: pipeline.name })),
  );
  protected readonly placeStageOptions = computed<SelectorOption[]>(() => {
    const pipelineId = this.placePipelineId();
    return pipelineId === null
      ? []
      : this.placeableStages(pipelineId).map((stage) => ({ value: stage.id, label: stage.name }));
  });
  protected readonly availableTagOptions = computed<SelectorOption[]>(() => {
    const assigned = new Set((this.profile()?.tags ?? []).map((tag) => tag.id));
    return this.tagCatalog()
      .filter((tag) => !assigned.has(tag.id))
      .map((tag) => ({ value: tag.id, label: tag.name }));
  });
  /** Segments the customer is not in yet; adding to a rule segment pins them by hand too. */
  protected readonly availableSegmentOptions = computed<SelectorOption[]>(() => {
    const current = new Set((this.memberships()?.segments ?? []).map((segment) => segment.id));
    return this.segmentCatalog()
      .filter((segment) => !current.has(segment.id))
      .map((segment) => ({
        value: segment.id,
        label: segment.is_dynamic ? segment.name : `${segment.name} (manual)`,
      }));
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
        this.opportunities.set([]);
        this.tasks.set([]);
        this.memberships.set(null);
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

  protected filterChip(active: boolean): string {
    return `${CHIP} ${
      active
        ? 'border-primary/25 bg-primary/10 text-primary-on-tint'
        : 'border-border text-text-secondary hover:bg-primary/5'
    }`;
  }

  protected segmentVia(via: CustomerCrmMemberships['segments'][number]['via']): string {
    if (via === 'manual') return 'Agregado a mano';
    if (via === 'rule') return 'Cumple las reglas del segmento';
    return 'Cumple las reglas y fue agregado a mano';
  }

  protected pipelineName(pipelineId: number): string {
    return this.pipelines().find((pipeline) => pipeline.id === pipelineId)?.name ?? 'Pipeline';
  }

  /**
   * Stages an opportunity can be moved to from here: active, not lost (losing
   * asks for a reason, which the Pipeline screen collects). The current stage
   * stays listed so the selector shows it.
   */
  protected placeableStages(pipelineId: number, currentStageId?: number): CrmStage[] {
    const pipeline = this.pipelines().find((row) => row.id === pipelineId);
    return (pipeline?.stages ?? []).filter(
      (stage) =>
        stage.id === currentStageId || (stage.is_active !== false && stage.kind !== 'lost'),
    );
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
    // Catalogs and side blocks are best effort: the panel works without them.
    firstValueFrom(this.crm.tags())
      .then((rows) => this.tagCatalog.set(rows))
      .catch(() => undefined);
    firstValueFrom(this.segmentsApi.segments())
      .then((rows) => this.segmentCatalog.set(rows))
      .catch(() => undefined);
    void this.loadMemberships();
    void this.loadTasks();
    void this.loadBoard();
    void this.loadTimeline(true);
  }

  private refreshProfile(): void {
    firstValueFrom(this.crm.profile(this.customerId()))
      .then((profile) => this.profile.set(profile))
      .catch(() => undefined);
  }

  // ── Board ───────────────────────────────────────────────
  private async loadBoard(): Promise<void> {
    if (!this.canReadPipeline()) return;
    this.boardLoading.set(true);
    try {
      if (!this.pipelines().length) {
        this.pipelines.set(await firstValueFrom(this.crm.pipelines()));
      }
      if (this.placePipelineId() === null) {
        const fallback = this.pipelines().find((row) => row.is_default) ?? this.pipelines()[0];
        this.placePipelineId.set(fallback?.id ?? null);
      }
      const customerId = this.customerId();
      const boards = await Promise.all(
        this.pipelines().map((pipeline) =>
          firstValueFrom(this.crm.board({ pipeline_id: pipeline.id, customer_id: customerId })),
        ),
      );
      if (customerId !== this.customerId()) return;
      this.opportunities.set(
        boards
          .flatMap((board) => board.stages.flatMap((stage) => stage.opportunities))
          .filter((opportunity) => opportunity.status !== 'lost'),
      );
    } catch {
      this.opportunities.set([]);
    } finally {
      this.boardLoading.set(false);
    }
  }

  onPlacePipeline(value: string | number | null): void {
    this.placePipelineId.set(value ? +value : null);
    this.placeStageId.set(null);
  }

  /** Same request the Pipeline screen sends to create a card. */
  async placeOnBoard(): Promise<void> {
    const pipelineId = this.placePipelineId();
    const stageId = this.placeStageId();
    if (!pipelineId || !stageId || this.boardSaving()) return;
    this.boardSaving.set(true);
    try {
      await firstValueFrom(
        this.crm.createOpportunity({
          customer_id: this.customerId(),
          title: personName(this.profile()?.customer) || 'Cliente',
          pipeline_id: pipelineId,
          stage_id: stageId,
        }),
      );
      this.placeStageId.set(null);
      this.toast.success('Cliente agregado al tablero');
      this.afterBoardChange();
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.boardSaving.set(false);
    }
  }

  /** Same request the Pipeline screen sends when a card is dragged. */
  async moveOpportunity(opportunity: CrmOpportunity, stageId: number): Promise<void> {
    if (!stageId || stageId === opportunity.stage_id || this.boardSaving()) return;
    this.boardSaving.set(true);
    try {
      await firstValueFrom(this.crm.moveOpportunity(opportunity.id, { stage_id: stageId }));
      this.toast.success('Etapa actualizada');
      this.afterBoardChange();
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
      void this.loadBoard();
    } finally {
      this.boardSaving.set(false);
    }
  }

  private afterBoardChange(): void {
    void this.loadBoard();
    this.refreshProfile();
    void this.loadMemberships();
    void this.loadTimeline(true);
  }

  // ── Follow-ups ──────────────────────────────────────────
  private async loadTasks(): Promise<void> {
    if (!this.canManageTasks()) return;
    const customerId = this.customerId();
    this.tasksLoading.set(true);
    try {
      const page = await firstValueFrom(
        this.crm.tasks({
          customer_id: customerId,
          status: 'pending',
          assigned: crmCanSeeAll(this.auth) ? 'all' : 'me',
          limit: FOLLOW_UPS_SHOWN,
        }),
      );
      if (customerId !== this.customerId()) return;
      this.tasks.set(page.data);
      this.tasksTotal.set(page.total);
    } catch {
      this.tasks.set([]);
      this.tasksTotal.set(0);
    } finally {
      this.tasksLoading.set(false);
    }
  }

  async completeTask(task: CrmTask): Promise<void> {
    if (this.completingId()) return;
    this.completingId.set(task.id);
    try {
      await firstValueFrom(this.crm.completeTask(task.id));
      this.toast.success('Seguimiento completado');
      void this.loadTasks();
      this.refreshProfile();
      void this.loadTimeline(true);
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.completingId.set(null);
    }
  }

  onTaskSaved(): void {
    this.refreshProfile();
    void this.loadTasks();
    void this.loadTimeline(true);
  }

  // ── Segments ────────────────────────────────────────────
  private async loadMemberships(): Promise<void> {
    const customerId = this.customerId();
    try {
      const row = await firstValueFrom(this.crm.customerSegments(customerId));
      if (customerId === this.customerId()) this.memberships.set(row);
    } catch {
      // The block keeps its last state; the rest of the panel still works.
    }
  }

  addPickedSegment(): Promise<void> {
    const segmentId = this.segmentPick();
    return segmentId ? this.addToSegment(segmentId) : Promise.resolve();
  }

  private async addToSegment(segmentId: number): Promise<void> {
    if (this.segmentSaving()) return;
    this.segmentSaving.set(true);
    try {
      this.memberships.set(
        await firstValueFrom(this.crm.addToSegment(this.customerId(), segmentId)),
      );
      this.segmentPick.set(null);
      this.toast.success('Cliente agregado al segmento');
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.segmentSaving.set(false);
    }
  }

  async removeFromSegment(segmentId: number): Promise<void> {
    if (this.segmentSaving()) return;
    this.segmentSaving.set(true);
    try {
      this.memberships.set(
        await firstValueFrom(this.crm.removeFromSegment(this.customerId(), segmentId)),
      );
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.segmentSaving.set(false);
    }
  }

  /** A segment created here is manual: it holds the customers added by hand. */
  async createSegment(): Promise<void> {
    const name = this.newSegment().trim();
    if (!name || this.segmentSaving()) return;
    this.segmentSaving.set(true);
    let created: CrmSegment;
    try {
      created = await firstValueFrom(this.segmentsApi.createSegment({ name, is_dynamic: false }));
      this.segmentCatalog.update((rows) => [...rows, created]);
      this.newSegment.set('');
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
      return;
    } finally {
      this.segmentSaving.set(false);
    }
    await this.addToSegment(created.id);
  }

  // ── Profile ─────────────────────────────────────────────
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
      this.refreshProfile();
    } finally {
      this.saving.set(false);
    }
  }

  addPickedTag(): Promise<void> {
    const tagId = this.tagPick();
    return tagId ? this.addTag(tagId) : Promise.resolve();
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
    let created: CrmTag;
    try {
      created = await firstValueFrom(this.crm.createTag({ name }));
      this.tagCatalog.update((rows) => [...rows, created]);
      this.newTag.set('');
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
      return;
    } finally {
      this.saving.set(false);
    }
    await this.addTag(created.id);
  }

  private async saveTags(tagIds: number[]): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      const tags = await firstValueFrom(this.crm.setTags(this.customerId(), tagIds));
      this.profile.update((profile) => (profile ? { ...profile, tags } : profile));
      this.tagPick.set(null);
      // A tag can make the customer match a rule segment.
      void this.loadMemberships();
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.saving.set(false);
    }
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
}
