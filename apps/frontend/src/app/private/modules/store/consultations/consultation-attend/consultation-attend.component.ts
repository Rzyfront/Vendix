import {
  Component,
  OnInit,
  ChangeDetectionStrategy,
  signal,
  inject,
  computed,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ConsultationsService } from '../services/consultations.service';
import { ConsultationContext } from '../interfaces/consultation.interface';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { CardComponent } from '../../../../../shared/components/card/card.component';
import {
  BadgeComponent,
  BadgeVariant,
} from '../../../../../shared/components/badge/badge.component';
import { TooltipComponent } from '../../../../../shared/components/tooltip/tooltip.component';
import { ExpandableCardComponent } from '../../../../../shared/components/expandable-card/expandable-card.component';
import {
  StickyHeaderComponent,
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
} from '../../../../../shared/components/sticky-header/sticky-header.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { DynamicFieldComponent } from '../../../ecommerce/pages/data-collection-form/components/dynamic-field/dynamic-field.component';
import { getItemWidth, getItemWidthClass, DEFAULT_TEMPLATE_ICON, DEFAULT_SECTION_ICON, DEFAULT_TAB_ICON } from '../../data-collection/utils/item-width.util';

@Component({
  selector: 'app-consultation-attend',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IconComponent,
    CardComponent,
    BadgeComponent,
    TooltipComponent,
    ExpandableCardComponent,
    StickyHeaderComponent,
    DatePipe,
    DynamicFieldComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-screen">
      @if (loading()) {
        <div class="flex items-center justify-center py-24">
          <div
            class="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"
          ></div>
        </div>
      } @else if (ctx(); as c) {
        <!-- Sticky Header -->
        <app-sticky-header
          [title]="headerTitle()"
          [subtitle]="headerSubtitle()"
          icon="stethoscope"
          [showBackButton]="true"
          [backRoute]="['/admin', 'reservations']"
          [badgeText]="getStatusLabel(c.booking.status)"
          [badgeColor]="headerBadgeColor()"
          [metadataContent]="headerMetadata()"
          [actions]="headerActions()"
          (actionClicked)="onHeaderAction($event)"
        ></app-sticky-header>

        <!-- Main Content: Full Width -->
        <div>
          <div class="space-y-8">
            <!-- Pre-loaded Patient Data (Preconsulta) -->
            @if (c.preconsultation_submission?.responses?.length) {
              <app-expandable-card [(expanded)]="showPreconsulta">
                <div slot="header" class="flex items-center gap-2">
                  <app-icon
                    name="clipboard-check"
                    [size]="16"
                    color="var(--color-primary)"
                  ></app-icon>
                  <app-tooltip
                    content="Datos completados por el paciente antes de la consulta"
                    position="top"
                    size="sm"
                  >
                    <span
                      class="text-sm font-semibold"
                      style="color: var(--color-text)"
                      >Datos del Paciente (Preconsulta)</span
                    >
                  </app-tooltip>
                  <app-badge variant="info" size="xs">
                    {{ c.preconsultation_submission.responses.length }}
                    respuestas
                  </app-badge>
                </div>
                <div class="px-5 py-4 space-y-5">
                  @if (preconsultaTabs().length) {
                    <!-- Tabs navigation -->
                    <div
                      class="flex gap-1.5 mb-4 pb-0 overflow-x-auto"
                      style="border-bottom: 2px solid var(--color-border)"
                    >
                      @for (
                        tab of preconsultaTabs();
                        track tab.title;
                        let i = $index
                      ) {
                        <button
                          class="flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors"
                          [style.border-bottom]="
                            activePreconsultaTab() === i
                              ? '2px solid var(--color-primary)'
                              : '2px solid transparent'
                          "
                          [style.margin-bottom]="'-2px'"
                          [style.color]="
                            activePreconsultaTab() === i
                              ? 'var(--color-primary)'
                              : 'var(--color-text-muted)'
                          "
                          (click)="activePreconsultaTab.set(i)"
                        >
                          <app-icon
                            [name]="tab.icon || DEFAULT_TAB_ICON"
                            [size]="13"
                          ></app-icon>
                          {{ tab.title }}
                        </button>
                      }
                    </div>
                    <!-- Active tab sections -->
                    @for (
                      section of preconsultaTabs()[activePreconsultaTab()]
                        ?.sections || [];
                      track section.title
                    ) {
                      <div class="mb-1">
                        <h4
                          class="text-xs font-semibold uppercase tracking-wider mb-3 pb-2 flex items-center gap-1.5"
                          style="color: var(--color-text-muted); border-bottom: 1px solid var(--color-border)"
                        >
                          <app-icon
                            [name]="section.icon || DEFAULT_SECTION_ICON"
                            [size]="13"
                            color="var(--color-primary)"
                          ></app-icon>
                          {{ section.title }}
                        </h4>
                        <div class="flex flex-wrap gap-2.5">
                          @for (
                            resp of section.responses;
                            track resp.field_id
                          ) {
                            <div [ngClass]="getItemWidthClass(resp.width)">
                              <div
                                class="py-2 px-3 rounded-lg h-full"
                                style="background: var(--color-surface-secondary)"
                              >
                                <span
                                  class="text-xs block mb-0.5"
                                  style="color: var(--color-text-muted)"
                                  >{{ resp.field?.label || 'Campo' }}</span
                                >
                                <span
                                  class="text-sm font-medium"
                                  style="color: var(--color-text)"
                                  >{{ getDisplayValue(resp) }}</span
                                >
                              </div>
                            </div>
                          }
                        </div>
                      </div>
                    }
                  } @else {
                    <!-- No tabs: show sections directly (backward compatible) -->
                    @for (
                      section of preconsultaSections();
                      track section.title
                    ) {
                      <div class="mb-1">
                        <h4
                          class="text-xs font-semibold uppercase tracking-wider mb-3 pb-2 flex items-center gap-1.5"
                          style="color: var(--color-text-muted); border-bottom: 1px solid var(--color-border)"
                        >
                          <app-icon
                            [name]="section.icon || DEFAULT_SECTION_ICON"
                            [size]="13"
                            color="var(--color-primary)"
                          ></app-icon>
                          {{ section.title }}
                        </h4>
                        <div class="flex flex-wrap gap-2.5">
                          @for (
                            resp of section.responses;
                            track resp.field_id
                          ) {
                            <div [ngClass]="getItemWidthClass(resp.width)">
                              <div
                                class="py-2 px-3 rounded-lg h-full"
                                style="background: var(--color-surface-secondary)"
                              >
                                <span
                                  class="text-xs block mb-0.5"
                                  style="color: var(--color-text-muted)"
                                  >{{ resp.field?.label || 'Campo' }}</span
                                >
                                <span
                                  class="text-sm font-medium"
                                  style="color: var(--color-text)"
                                  >{{ getDisplayValue(resp) }}</span
                                >
                              </div>
                            </div>
                          }
                        </div>
                      </div>
                    }
                    @if (orphanedResponses().length > 0) {
                      <div class="flex flex-wrap gap-2.5">
                        @for (
                          resp of orphanedResponses();
                          track resp.field_id
                        ) {
                          <div>
                            <div
                              class="py-2 px-3 rounded-lg"
                              style="background: var(--color-surface-secondary)"
                            >
                              <span
                                class="text-xs block mb-0.5"
                                style="color: var(--color-text-muted)"
                                >{{ resp.field?.label || 'Campo' }}</span
                              >
                              <span
                                class="text-sm font-medium"
                                style="color: var(--color-text)"
                                >{{ getDisplayValue(resp) }}</span
                              >
                            </div>
                          </div>
                        }
                      </div>
                    }
                  }
                </div>
              </app-expandable-card>
            }

            <!-- AI Prediagnosis -->
            @if (c.preconsultation_submission?.ai_prediagnosis) {
              <div
                class="rounded-xl overflow-hidden"
                style="border: 1px solid rgba(139, 92, 246, 0.3)"
              >
                <div
                  class="flex items-center gap-2 px-4 py-2.5"
                  style="background: rgba(139, 92, 246, 0.08)"
                >
                  <app-icon
                    name="brain"
                    [size]="16"
                    color="var(--color-gaming)"
                  ></app-icon>
                  <app-tooltip
                    content="Analisis generado por inteligencia artificial basado en los datos del paciente"
                    position="top"
                    size="sm"
                  >
                    <span
                      class="text-sm font-semibold"
                      style="color: var(--color-gaming)"
                      >Pre-diagnostico IA</span
                    >
                  </app-tooltip>
                </div>
                <div
                  class="px-4 py-3 text-sm leading-relaxed prose-sm"
                  style="color: var(--color-text); background: rgba(139, 92, 246, 0.04)"
                  [innerHTML]="c.preconsultation_submission.ai_prediagnosis"
                ></div>
              </div>
            }

            <!-- Consultation Form (Provider fills) -->
            @if (
              c.consultation_template?.sections?.length ||
              c.consultation_template?.tabs?.length
            ) {
              <app-card shadow="sm" [padding]="false">
                <div
                  slot="header"
                  class="flex items-center gap-2 px-4 py-3"
                  style="background: var(--color-surface-secondary)"
                >
                  <app-icon
                    name="stethoscope"
                    [size]="16"
                    color="var(--color-primary)"
                  ></app-icon>
                  <app-tooltip
                    content="Formulario que el proveedor completo durante la consulta"
                    position="top"
                    size="sm"
                  >
                    <span
                      class="text-sm font-semibold"
                      style="color: var(--color-text)"
                      >Consulta</span
                    >
                  </app-tooltip>
                </div>

                @if (consultationTabs().length) {
                  <!-- Tabs navigation for consultation form -->
                  <div
                    class="flex gap-1.5 px-4 pt-3 pb-0 overflow-x-auto"
                    style="border-bottom: 2px solid var(--color-border)"
                  >
                    @for (
                      tab of consultationTabs();
                      track tab.title;
                      let i = $index
                    ) {
                      <button
                        class="flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors"
                        [style.border-bottom]="
                          activeConsultationTab() === i
                            ? '2px solid var(--color-primary)'
                            : '2px solid transparent'
                        "
                        [style.margin-bottom]="'-2px'"
                        [style.color]="
                          activeConsultationTab() === i
                            ? 'var(--color-primary)'
                            : 'var(--color-text-muted)'
                        "
                        (click)="activeConsultationTab.set(i)"
                      >
                        <app-icon
                          [name]="tab.icon || DEFAULT_TAB_ICON"
                          [size]="13"
                        ></app-icon>
                        {{ tab.title }}
                      </button>
                    }
                  </div>
                  <div class="px-5 py-5 space-y-6">
                    @for (
                      section of consultationTabs()[activeConsultationTab()]
                        ?.sections || [];
                      track section.id
                    ) {
                      <ng-container
                        *ngTemplateOutlet="
                          consultationSection;
                          context: { $implicit: section }
                        "
                      ></ng-container>
                    }
                  </div>
                } @else {
                  <!-- No tabs: show sections directly -->
                  <div class="px-5 py-5 space-y-6">
                    @for (
                      section of c.consultation_template.sections;
                      track section.id
                    ) {
                      <ng-container
                        *ngTemplateOutlet="
                          consultationSection;
                          context: { $implicit: section }
                        "
                      ></ng-container>
                    }
                  </div>
                }
              </app-card>
            } @else {
              <!-- Empty State: No consultation template configured -->
              <app-card shadow="sm">
                <div class="text-center py-12">
                  <app-icon
                    name="stethoscope"
                    [size]="48"
                    color="var(--color-text-muted)"
                  ></app-icon>
                  <h3
                    class="text-base font-semibold mt-4 mb-2"
                    style="color: var(--color-text)"
                  >
                    No hay plantilla de consulta configurada
                  </h3>
                  <p
                    class="text-sm mb-6"
                    style="color: var(--color-text-muted)"
                  >
                    Este servicio necesita una plantilla de consulta para
                    registrar los datos de la atencion.
                  </p>
                  <div class="flex items-center justify-center gap-3">
                    <button
                      class="px-4 py-2 rounded-lg text-sm font-medium"
                      style="color: var(--color-text); border: 1px solid var(--color-border)"
                      (click)="goToProductConfig()"
                    >
                      Configurar Producto
                    </button>
                    <button
                      class="px-4 py-2 rounded-lg text-sm font-medium text-white"
                      style="background: var(--color-primary)"
                      (click)="goToTemplates()"
                    >
                      Crear Plantilla
                    </button>
                  </div>
                </div>
              </app-card>
            }
          </div>
        </div>

        <!-- Section template -->
        <ng-template #consultationSection let-section>
          <div
            class="pl-4 py-3 rounded-lg"
            style="border-left: 2px solid var(--color-primary)"
          >
            <h4
              class="text-sm font-semibold mb-3 flex items-center gap-2"
              style="color: var(--color-text)"
            >
              <app-icon
                [name]="section.icon || DEFAULT_SECTION_ICON"
                [size]="16"
                color="var(--color-primary)"
              ></app-icon>
              {{ section.title }}
            </h4>
            <div class="flex flex-wrap gap-3">
              @for (
                item of sortedItems(section);
                track item.metadata_field_id
              ) {
                <div [class]="getItemWidthClass(item.width)">
                  <app-dynamic-field
                    [field]="item.metadata_field"
                    [value]="getResponseValue(item.metadata_field_id)"
                    [required]="item.is_required"
                    [icon]="item.icon || ''"
                    (valueChange)="
                      setResponseValue(item.metadata_field_id, $event)
                    "
                  />
                </div>
              }
            </div>
            <!-- Child sections -->
            @for (child of section.child_sections || []; track child.id) {
              <div
                class="mt-5 pl-4"
                style="border-left: 2px solid var(--color-border)"
              >
                <h5
                  class="text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-2"
                  style="color: var(--color-text-muted)"
                >
                  <app-icon
                    [name]="child.icon || DEFAULT_SECTION_ICON"
                    [size]="14"
                    color="var(--color-text-muted)"
                  ></app-icon>
                  {{ child.title }}
                </h5>
                <div class="flex flex-wrap gap-3">
                  @for (
                    item of sortedItems(child);
                    track item.metadata_field_id
                  ) {
                    <div [class]="getItemWidthClass(item.width)">
                      <app-dynamic-field
                        [field]="item.metadata_field"
                        [value]="getResponseValue(item.metadata_field_id)"
                        [required]="item.is_required"
                        [icon]="item.icon || ''"
                        (valueChange)="
                          setResponseValue(item.metadata_field_id, $event)
                        "
                      />
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        </ng-template>

        <!-- Slide-over Overlay -->
        @if (showClientInfo() || showHistory()) {
          <div
            class="fixed inset-0 z-[37] transition-opacity duration-300"
            style="background: rgba(0, 0, 0, 0.3); backdrop-filter: blur(2px)"
            (click)="closeAllPanels()"
          ></div>
        }

        <!-- Client Info Slide-over Panel -->
        <div
          class="fixed inset-y-0 right-0 w-80 z-[38] shadow-xl overflow-y-auto transition-transform duration-300 ease-in-out"
          [class.translate-x-0]="showClientInfo()"
          [class.translate-x-full]="!showClientInfo()"
          style="background: var(--color-surface); border-left: 1px solid var(--color-border)"
        >
          <div class="p-4">
            <div class="flex justify-between items-center mb-4">
              <div class="flex items-center gap-2">
                <app-icon
                  name="user"
                  [size]="16"
                  color="var(--color-primary)"
                ></app-icon>
                <h3
                  class="text-sm font-semibold"
                  style="color: var(--color-text)"
                >
                  Informacion del Paciente
                </h3>
              </div>
              <button
                class="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                style="color: var(--color-text-muted)"
                (click)="showClientInfo.set(false)"
              >
                <app-icon name="x" [size]="16"></app-icon>
              </button>
            </div>
            <!-- Patient avatar + name -->
            <div
              class="flex items-center gap-3 mb-4 pb-4"
              style="border-bottom: 1px solid var(--color-border)"
            >
              <div
                class="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
                style="background: var(--color-primary)"
              >
                {{ c.customer?.first_name?.charAt(0)
                }}{{ c.customer?.last_name?.charAt(0) }}
              </div>
              <div>
                <p
                  class="text-sm font-semibold"
                  style="color: var(--color-text)"
                >
                  {{ c.customer?.first_name }} {{ c.customer?.last_name }}
                </p>
                @if (c.customer?.document_type || c.customer?.document_number) {
                  <div class="flex items-center gap-1.5 mt-0.5">
                    <app-icon
                      name="credit-card"
                      [size]="12"
                      color="var(--color-text-muted)"
                    ></app-icon>
                    <span
                      class="text-xs"
                      style="color: var(--color-text-muted)"
                      >{{ c.customer?.document_number }}</span
                    >
                  </div>
                }
              </div>
            </div>
            <!-- Booking details with icons -->
            <div class="space-y-3 text-xs">
              <div class="flex items-start gap-2.5">
                <app-icon
                  name="hash"
                  [size]="14"
                  color="var(--color-text-muted)"
                  class="mt-0.5 shrink-0"
                ></app-icon>
                <div>
                  <span
                    class="font-semibold block mb-0.5"
                    style="color: var(--color-text-muted)"
                    >Reserva</span
                  >
                  <span style="color: var(--color-text)"
                    >#{{ c.booking.booking_number }}</span
                  >
                </div>
              </div>
              <div class="flex items-start gap-2.5">
                <app-icon
                  name="stethoscope"
                  [size]="14"
                  color="var(--color-text-muted)"
                  class="mt-0.5 shrink-0"
                ></app-icon>
                <div>
                  <span
                    class="font-semibold block mb-0.5"
                    style="color: var(--color-text-muted)"
                    >Servicio</span
                  >
                  <span style="color: var(--color-text)">{{
                    c.product?.name
                  }}</span>
                  @if (c.product?.service_duration_minutes) {
                    <span style="color: var(--color-text-muted)">
                      ({{ c.product.service_duration_minutes }} min)</span
                    >
                  }
                </div>
              </div>
              <div class="flex items-start gap-2.5">
                <app-icon
                  name="calendar"
                  [size]="14"
                  color="var(--color-text-muted)"
                  class="mt-0.5 shrink-0"
                ></app-icon>
                <div>
                  <span
                    class="font-semibold block mb-0.5"
                    style="color: var(--color-text-muted)"
                    >Fecha y Hora</span
                  >
                  <span style="color: var(--color-text)">{{
                    c.booking.date | date: 'fullDate'
                  }}</span>
                  <br />
                  <div class="flex items-center gap-1.5 mt-0.5">
                    <app-icon
                      name="clock"
                      [size]="12"
                      color="var(--color-text-muted)"
                    ></app-icon>
                    <span style="color: var(--color-text)"
                      >{{ c.booking.start_time?.slice(0, 5) }} -
                      {{ c.booking.end_time?.slice(0, 5) }}</span
                    >
                  </div>
                </div>
              </div>
              @if (c.provider) {
                <div class="flex items-start gap-2.5">
                  <app-icon
                    name="user-check"
                    [size]="14"
                    color="var(--color-text-muted)"
                    class="mt-0.5 shrink-0"
                  ></app-icon>
                  <div>
                    <span
                      class="font-semibold block mb-0.5"
                      style="color: var(--color-text-muted)"
                      >Profesional</span
                    >
                    <span style="color: var(--color-text)">{{
                      c.provider.display_name
                    }}</span>
                  </div>
                </div>
              }
              <div class="flex items-start gap-2.5">
                <app-icon
                  name="check-circle"
                  [size]="14"
                  color="var(--color-text-muted)"
                  class="mt-0.5 shrink-0"
                ></app-icon>
                <div>
                  <span
                    class="font-semibold block mb-0.5"
                    style="color: var(--color-text-muted)"
                    >Estado de la Reserva</span
                  >
                  <app-badge
                    [variant]="getStatusBadgeVariant(c.booking.status)"
                    size="xs"
                  >
                    {{ getStatusLabel(c.booking.status) }}
                  </app-badge>
                </div>
              </div>
              @if (c.booking.notes) {
                <div class="flex items-start gap-2.5">
                  <app-icon
                    name="file-text"
                    [size]="14"
                    color="var(--color-text-muted)"
                    class="mt-0.5 shrink-0"
                  ></app-icon>
                  <div>
                    <span
                      class="font-semibold block mb-0.5"
                      style="color: var(--color-text-muted)"
                      >Notas</span
                    >
                    <span style="color: var(--color-text)">{{
                      c.booking.notes
                    }}</span>
                  </div>
                </div>
              }
              @if (c.product?.service_instructions) {
                <div
                  class="mt-2 p-2.5 rounded-lg"
                  style="background: var(--color-surface-secondary)"
                >
                  <div class="flex items-center gap-1.5 mb-1">
                    <app-icon
                      name="info"
                      [size]="12"
                      color="var(--color-primary)"
                    ></app-icon>
                    <span
                      class="font-semibold text-xs"
                      style="color: var(--color-text)"
                      >Instrucciones del servicio</span
                    >
                  </div>
                  <span
                    class="text-xs"
                    style="color: var(--color-text-muted)"
                    >{{ c.product.service_instructions }}</span
                  >
                </div>
              }
            </div>
          </div>
        </div>

        <!-- History Slide-over Panel -->
        <div
          class="fixed inset-y-0 right-0 w-80 z-[38] shadow-xl overflow-y-auto transition-transform duration-300 ease-in-out"
          [class.translate-x-0]="showHistory()"
          [class.translate-x-full]="!showHistory()"
          style="background: var(--color-surface); border-left: 1px solid var(--color-border)"
        >
          <div class="p-4">
            <div class="flex justify-between items-center mb-4">
              <div class="flex items-center gap-2">
                <app-icon
                  name="history"
                  [size]="16"
                  color="var(--color-primary)"
                ></app-icon>
                <h3
                  class="text-sm font-semibold"
                  style="color: var(--color-text)"
                >
                  Historial del Paciente
                </h3>
              </div>
              <button
                class="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                style="color: var(--color-text-muted)"
                (click)="showHistory.set(false)"
              >
                <app-icon name="x" [size]="16"></app-icon>
              </button>
            </div>
            @if (c.customer_history; as history) {
              @if (!history.previous_bookings.length) {
                <div class="flex flex-col items-center py-6 text-center">
                  <app-icon
                    name="calendar-check"
                    [size]="32"
                    color="var(--color-text-muted)"
                  ></app-icon>
                  <p
                    class="text-sm mt-2"
                    style="color: var(--color-text-muted)"
                  >
                    Primera visita del paciente
                  </p>
                </div>
              } @else {
                <div class="space-y-1">
                  @for (b of history.previous_bookings; track b.id) {
                    <div
                      class="flex items-center gap-2.5 text-xs py-2 px-2 rounded-lg hover:bg-gray-50 transition-colors"
                      style="border-bottom: 1px solid var(--color-border)"
                    >
                      <app-icon
                        name="calendar"
                        [size]="13"
                        color="var(--color-text-muted)"
                        class="shrink-0"
                      ></app-icon>
                      <span
                        class="shrink-0"
                        style="color: var(--color-text-muted)"
                        >{{ b.date | date: 'shortDate' }}</span
                      >
                      <span
                        class="truncate font-medium"
                        style="color: var(--color-text)"
                        >{{ b.product?.name || 'Servicio' }}</span
                      >
                    </div>
                  }
                </div>
              }
              @if (history.important_notes.length) {
                <div
                  class="mt-4 pt-4"
                  style="border-top: 1px solid var(--color-border)"
                >
                  <div class="flex items-center gap-1.5 mb-2">
                    <app-icon
                      name="alert-circle"
                      [size]="13"
                      color="var(--color-warning)"
                    ></app-icon>
                    <p
                      class="text-xs font-semibold"
                      style="color: var(--color-text)"
                    >
                      Notas importantes
                    </p>
                  </div>
                  <div class="space-y-1.5">
                    @for (n of history.important_notes; track n.id) {
                      <div
                        class="text-xs p-2.5 rounded-lg"
                        style="background: var(--color-surface-secondary)"
                      >
                        <span
                          class="font-medium"
                          style="color: var(--color-text)"
                          >{{ n.note_key }}:</span
                        >
                        <span style="color: var(--color-text-muted)">
                          {{ n.note_value }}</span
                        >
                      </div>
                    }
                  </div>
                </div>
              }
            } @else {
              <div class="flex flex-col items-center py-6 text-center">
                <app-icon
                  name="calendar-check"
                  [size]="32"
                  color="var(--color-text-muted)"
                ></app-icon>
                <p class="text-sm mt-2" style="color: var(--color-text-muted)">
                  Primera visita del paciente
                </p>
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class ConsultationAttendComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private consultationsService = inject(ConsultationsService);
  private toastService = inject(ToastService);

  ctx = signal<ConsultationContext | null>(null);
  loading = signal(true);
  saving = signal(false);
  showPreconsulta = signal(true);
  showHistory = signal(false);
  showClientInfo = signal(false);
  activePreconsultaTab = signal(0);
  activeConsultationTab = signal(0);

  // Sticky header computed properties
  headerTitle = computed(() => {
    const c = this.ctx();
    if (!c) return '';
    return `${c.customer?.first_name || ''} ${c.customer?.last_name || ''}`.trim();
  });

  headerSubtitle = computed(() => {
    const c = this.ctx();
    if (!c) return '';
    const parts = [c.product?.name];
    if (c.booking.date) {
      const d = new Date(c.booking.date);
      parts.push(
        d.toLocaleDateString('es-CO', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
      );
    }
    if (c.booking.start_time)
      parts.push(
        `${c.booking.start_time.slice(0, 5)} - ${c.booking.end_time?.slice(0, 5) || ''}`,
      );
    return parts.filter(Boolean).join(' · ');
  });

  headerMetadata = computed(() => '');

  headerBadgeColor = computed((): StickyHeaderBadgeColor => {
    const status = this.ctx()?.booking?.status;
    const map: Record<string, StickyHeaderBadgeColor> = {
      pending: 'yellow',
      confirmed: 'blue',
      in_progress: 'green',
      completed: 'green',
      cancelled: 'red',
      no_show: 'gray',
    };
    return map[status || ''] || 'gray';
  });

  headerActions = computed((): StickyHeaderActionButton[] => {
    const c = this.ctx();
    if (!c) return [];
    const actions: StickyHeaderActionButton[] = [
      { id: 'client-info', label: 'Info', variant: 'ghost', icon: 'user' },
      { id: 'history', label: 'Historial', variant: 'ghost', icon: 'history' },
    ];
    if (c.booking.status === 'confirmed') {
      actions.push({
        id: 'start',
        label: 'Iniciar Consulta',
        variant: 'primary',
        icon: 'play',
      });
    }
    if (c.booking.status === 'in_progress') {
      actions.push({
        id: 'save',
        label: this.saving() ? 'Guardando...' : 'Guardar',
        variant: 'outline',
        icon: 'save',
        loading: this.saving(),
        disabled: this.saving(),
      });
      actions.push({
        id: 'complete',
        label: 'Completar',
        variant: 'primary',
        icon: 'check-circle',
      });
    }
    return actions;
  });

  // Provider responses: Map<field_id, value>
  responseValues = signal<Map<number, any>>(new Map());

  // Preconsulta sections (grouped responses from patient)
  preconsultaSections = computed(() => {
    const c = this.ctx();
    if (
      !c?.preconsultation_template?.sections?.length ||
      !c?.preconsultation_submission?.responses?.length
    )
      return [];
    const responseMap = new Map<number, any>(
      c.preconsultation_submission.responses.map((r: any) => [r.field_id, r]),
    );
    const sections: { title: string; icon?: string; responses: any[] }[] = [];

    for (const section of [...c.preconsultation_template.sections].sort(
      (a: any, b: any) => a.sort_order - b.sort_order,
    )) {
      const items = [...(section.items || [])].sort(
        (a: any, b: any) => a.sort_order - b.sort_order,
      );
      const responses: any[] = [];
      for (const item of items) {
        const resp = responseMap.get(item.metadata_field_id);
        if (resp) {
          responses.push({ ...resp, width: item.width, icon: item.icon });
        }
      }
      if (responses.length > 0) {
        sections.push({ title: section.title, icon: section.icon, responses });
      }
    }
    return sections;
  });

  orphanedResponses = computed(() => {
    const c = this.ctx();
    if (!c?.preconsultation_submission?.responses?.length) return [];
    const usedIds = new Set<number>();
    for (const s of this.preconsultaSections()) {
      for (const r of s.responses) usedIds.add(r.field_id);
    }
    return c.preconsultation_submission.responses.filter(
      (r: any) => !usedIds.has(r.field_id),
    );
  });

  preconsultaTabs = computed(() => {
    const c = this.ctx();
    if (!c?.preconsultation_template?.tabs?.length) return [];
    const responseMap = new Map<number, any>(
      c.preconsultation_submission?.responses?.map((r: any) => [
        r.field_id,
        r,
      ]) || [],
    );
    return c.preconsultation_template.tabs.map((tab: any) => ({
      title: tab.title,
      icon: tab.icon,
      sections: (tab.sections || [])
        .sort((a: any, b: any) => a.sort_order - b.sort_order)
        .map((section: any) => ({
          title: section.title,
          icon: section.icon,
          responses: [...(section.items || [])]
            .sort((a: any, b: any) => a.sort_order - b.sort_order)
            .map((item: any) => {
              const resp = responseMap.get(item.metadata_field_id);
              return resp ? { ...resp, width: item.width } : null;
            })
            .filter(Boolean),
        }))
        .filter((s: any) => s.responses.length > 0),
    }));
  });

  consultationTabs = computed(() => {
    const c = this.ctx();
    if (!c?.consultation_template?.tabs?.length) return [];
    return c.consultation_template.tabs.sort(
      (a: any, b: any) => a.sort_order - b.sort_order,
    );
  });

  isReadOnly = computed(() => {
    const status = this.ctx()?.booking?.status;
    return status === 'completed' || status === 'cancelled';
  });

  ngOnInit() {
    const bookingId = +this.route.snapshot.params['bookingId'];
    this.loadContext(bookingId);
  }

  loadContext(bookingId: number) {
    this.loading.set(true);
    this.consultationsService.getContext(bookingId).subscribe({
      next: (data) => {
        this.ctx.set(data);
        this.initFormState(data);
        this.loading.set(false);
      },
      error: (err) => {
        this.toastService.error(extractApiErrorMessage(err));
        this.loading.set(false);
      },
    });
  }

  private initFormState(data: ConsultationContext) {
    // Pre-populate provider response values from existing preconsultation submission
    const map = new Map<number, any>();
    if (data.preconsultation_submission?.responses) {
      for (const r of data.preconsultation_submission.responses) {
        const val =
          r.value_text ??
          r.value_number ??
          r.value_bool ??
          r.value_date ??
          r.value_json ??
          '';
        map.set(r.field_id, val);
      }
    }
    this.responseValues.set(map);
  }

  sortedItems(section: any): any[] {
    return [...(section.items || [])].sort(
      (a: any, b: any) => a.sort_order - b.sort_order,
    );
  }

  getItemWidth = getItemWidth;
  getItemWidthClass = getItemWidthClass;
  DEFAULT_TEMPLATE_ICON = DEFAULT_TEMPLATE_ICON;
  DEFAULT_SECTION_ICON = DEFAULT_SECTION_ICON;
  DEFAULT_TAB_ICON = DEFAULT_TAB_ICON;

  getResponseValue(fieldId: number): any {
    return this.responseValues().get(fieldId) ?? '';
  }

  setResponseValue(fieldId: number, value: any) {
    const map = new Map(this.responseValues());
    map.set(fieldId, value);
    this.responseValues.set(map);
  }

  save() {
    const c = this.ctx();
    if (!c) return;
    this.saving.set(true);

    const responses = Array.from(this.responseValues().entries())
      .filter(([_, v]) => v !== '' && v !== null && v !== undefined)
      .map(([field_id, value]) => {
        const resp: any = { field_id };
        if (typeof value === 'boolean') resp.value_bool = value;
        else if (typeof value === 'number') resp.value_number = value;
        else resp.value_text = String(value);
        return resp;
      });

    if (responses.length === 0) {
      this.saving.set(false);
      this.toastService.success('Sin cambios para guardar');
      return;
    }

    this.consultationsService.saveResponses(c.booking.id, responses).subscribe({
      next: () => {
        this.saving.set(false);
        this.toastService.success('Consulta guardada');
      },
      error: (err) => {
        this.saving.set(false);
        this.toastService.error(extractApiErrorMessage(err));
      },
    });
  }

  startConsultation() {
    const c = this.ctx();
    if (!c) return;
    this.consultationsService.start(c.booking.id).subscribe({
      next: () => {
        this.toastService.success('Consulta iniciada');
        this.loadContext(c.booking.id);
      },
      error: (err) => this.toastService.error(extractApiErrorMessage(err)),
    });
  }

  completeConsultation() {
    this.save();
    const c = this.ctx();
    if (!c) return;
    this.consultationsService.complete(c.booking.id).subscribe({
      next: () => {
        this.toastService.success('Consulta completada');
        this.router.navigate(['/admin/reservations']);
      },
      error: (err) => this.toastService.error(extractApiErrorMessage(err)),
    });
  }

  goBack() {
    this.router.navigate(['/admin/reservations']);
  }

  closeAllPanels() {
    this.showClientInfo.set(false);
    this.showHistory.set(false);
  }

  onHeaderAction(actionId: string) {
    switch (actionId) {
      case 'client-info':
        this.showClientInfo.set(!this.showClientInfo());
        this.showHistory.set(false);
        break;
      case 'history':
        this.showHistory.set(!this.showHistory());
        this.showClientInfo.set(false);
        break;
      case 'start':
        this.startConsultation();
        break;
      case 'save':
        this.save();
        break;
      case 'complete':
        this.completeConsultation();
        break;
    }
  }

  goToProductConfig() {
    const productId = this.ctx()?.product?.id;
    if (productId) this.router.navigate(['/admin/products', productId, 'edit']);
  }

  goToTemplates() {
    this.router.navigate(['/admin/data-collection/templates']);
  }

  getDisplayValue(response: any): string {
    if (response.value_text) return response.value_text;
    if (response.value_number !== null && response.value_number !== undefined)
      return String(response.value_number);
    if (response.value_bool !== null && response.value_bool !== undefined)
      return response.value_bool ? 'Si' : 'No';
    if (response.value_date)
      return new Date(response.value_date).toLocaleDateString('es-CO');
    if (response.value_json) return JSON.stringify(response.value_json);
    return '\u2014';
  }

  getStatusColor(status: string): { bg: string; text: string } {
    const colors: Record<string, { bg: string; text: string }> = {
      pending: {
        bg: 'var(--color-warning-light)',
        text: 'var(--color-warning)',
      },
      confirmed: {
        bg: 'var(--color-info-light, var(--color-primary-light))',
        text: 'var(--color-info, var(--color-primary))',
      },
      in_progress: {
        bg: 'var(--color-primary-light)',
        text: 'var(--color-primary)',
      },
      completed: {
        bg: 'var(--color-success-light)',
        text: 'var(--color-success)',
      },
      cancelled: { bg: 'var(--color-error-light)', text: 'var(--color-error)' },
    };
    return (
      colors[status] || {
        bg: 'var(--color-surface-secondary)',
        text: 'var(--color-text-secondary)',
      }
    );
  }

  getStatusBadgeVariant(status: string): BadgeVariant {
    const variants: Record<string, BadgeVariant> = {
      pending: 'warning',
      confirmed: 'info',
      in_progress: 'primary',
      completed: 'success',
      cancelled: 'error',
    };
    return variants[status] || 'neutral';
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      confirmed: 'Confirmada',
      in_progress: 'En progreso',
      completed: 'Completada',
      cancelled: 'Cancelada',
    };
    return labels[status] || status;
  }
}
