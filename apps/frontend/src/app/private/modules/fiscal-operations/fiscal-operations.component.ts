import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { map, switchMap } from 'rxjs/operators';
import { StatsComponent } from '../../../shared/components/stats/stats.component';
import { CurrencyPipe } from '../../../shared/pipes/currency';
import { ToastService } from '../../../shared/components/toast/toast.service';
import { formatDateOnlyUTC } from '../../../shared/utils/date.util';
import {
  FiscalApiScope,
  FiscalCloseSession,
  FiscalEvidence,
  FiscalObligation,
  FiscalOperationEvent,
  FiscalOverview,
  FiscalRuleSet,
  TaxDeclarationDraft,
  TaxDeclarationLine,
} from './interfaces/fiscal-operations.interface';
import { FiscalOperationsService } from './services/fiscal-operations.service';
import { FiscalOperationsHeaderActionsService } from './services/fiscal-operations-header-actions.service';

type FiscalTab =
  | 'dashboard'
  | 'obligations'
  | 'declarations'
  | 'close'
  | 'evidence'
  | 'history'
  | 'rules';

@Component({
  selector: 'app-fiscal-operations',
  standalone: true,
  imports: [
    CommonModule,
    StatsComponent,
    CurrencyPipe,
  ],
  template: `
    <section class="w-full space-y-4 pb-6">
      @if (errorMessage()) {
        <div
          class="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error"
        >
          {{ errorMessage() }}
        </div>
      }

      @if (activeTab() === 'dashboard') {
        <div class="stats-container">
          <app-stats
            title="Próximos vencimientos"
            [value]="overview()?.stats?.upcoming || 0"
            smallText="obligaciones por vencer"
            iconName="calendar-clock"
            iconBgColor="bg-primary/10"
            iconColor="text-primary"
            [loading]="loading()"
          />
          <app-stats
            title="Pendientes críticos"
            [value]="overview()?.stats?.overdue || 0"
            smallText="vencidas"
            iconName="alert-triangle"
            iconBgColor="bg-error/10"
            iconColor="text-error"
            [loading]="loading()"
          />
          <app-stats
            title="Declaraciones listas"
            [value]="overview()?.stats?.declarations_ready || 0"
            smallText="listas para revisar"
            iconName="file-check"
            iconBgColor="bg-success/10"
            iconColor="text-success"
            [loading]="loading()"
          />
          <app-stats
            title="Estimado a pagar"
            [value]="toNumber(overview()?.stats?.estimated_amount) | currency"
            smallText="según obligaciones"
            iconName="calculator"
            iconBgColor="bg-warning/10"
            iconColor="text-warning"
            [loading]="loading()"
          />
        </div>

        <div class="grid gap-4 lg:grid-cols-3">
          <div class="lg:col-span-2 rounded-lg border border-border bg-surface">
            <div class="border-b border-border px-4 py-3">
              <h2 class="text-sm font-semibold text-text-primary">
                Próximas obligaciones
              </h2>
            </div>
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-border text-sm">
                <thead
                  class="bg-muted/40 text-left text-xs uppercase text-text-secondary"
                >
                  <tr>
                    <th class="px-4 py-3">Tipo</th>
                    <th class="px-4 py-3">Periodo</th>
                    <th class="px-4 py-3">Entidad</th>
                    <th class="px-4 py-3">Vence</th>
                    <th class="px-4 py-3">Estado</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-border">
                  @for (
                    item of overview()?.next_obligations || [];
                    track item.id
                  ) {
                    <tr>
                      <td class="px-4 py-3 font-medium text-text-primary">
                        {{ typeLabel(item.type) }}
                      </td>
                      <td class="px-4 py-3 text-text-secondary">
                        {{ periodLabel(item) }}
                      </td>
                      <td class="px-4 py-3 text-text-secondary">
                        {{ entityLabel(item) }}
                      </td>
                      <td class="px-4 py-3 text-text-secondary">
                        {{ formatDate(item.due_date) }}
                      </td>
                      <td class="px-4 py-3">
                        <span [class]="statusClass(item.status)">{{
                          statusLabel(item.status)
                        }}</span>
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td
                        colspan="5"
                        class="px-4 py-8 text-center text-text-secondary"
                      >
                        No hay obligaciones próximas.
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>

          <aside class="rounded-lg border border-border bg-surface p-4">
            <h2 class="text-sm font-semibold text-text-primary">
              Riesgo operativo
            </h2>
            <div class="mt-4 space-y-3 text-sm">
              <div class="flex items-center justify-between gap-3">
                <span class="text-text-secondary">Documentos rechazados</span>
                <strong class="text-error">{{
                  overview()?.stats?.rejected_documents || 0
                }}</strong>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-text-secondary">Cierres abiertos</span>
                <strong class="text-warning">{{
                  overview()?.stats?.open_close_sessions || 0
                }}</strong>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-text-secondary">Valor final aprobado</span>
                <strong class="text-text-primary">
                  {{ toNumber(overview()?.stats?.final_amount) | currency }}
                </strong>
              </div>
            </div>
          </aside>
        </div>
      }

      @if (activeTab() === 'obligations') {
        <div class="rounded-lg border border-border bg-surface">
          <div
            class="flex flex-col gap-3 border-b border-border px-4 py-3 md:flex-row md:items-center md:justify-between"
          >
            <h2 class="text-sm font-semibold text-text-primary">
              Obligaciones fiscales
            </h2>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              (click)="generateCurrentMonthObligations()"
              [disabled]="working()"
            >
              Generar obligaciones
            </button>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-border text-sm">
              <thead
                class="bg-muted/40 text-left text-xs uppercase text-text-secondary"
              >
                <tr>
                  <th class="px-4 py-3">Tipo</th>
                  <th class="px-4 py-3">Periodo</th>
                  <th class="px-4 py-3">Entidad fiscal</th>
                  <th class="px-4 py-3">Vencimiento</th>
                  <th class="px-4 py-3">Monto</th>
                  <th class="px-4 py-3">Estado</th>
                  <th class="px-4 py-3">Acción</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                @for (item of obligations(); track item.id) {
                  <tr>
                    <td class="px-4 py-3 font-medium text-text-primary">
                      {{ typeLabel(item.type) }}
                    </td>
                    <td class="px-4 py-3 text-text-secondary">
                      {{ periodLabel(item) }}
                    </td>
                    <td class="px-4 py-3 text-text-secondary">
                      {{ entityLabel(item) }}
                    </td>
                    <td class="px-4 py-3 text-text-secondary">
                      {{ formatDate(item.due_date) }}
                    </td>
                    <td class="px-4 py-3 text-text-secondary">
                      {{
                        toNumber(item.final_amount || item.estimated_amount)
                          | currency
                      }}
                    </td>
                    <td class="px-4 py-3">
                      <span [class]="statusClass(item.status)">{{
                        statusLabel(item.status)
                      }}</span>
                    </td>
                    <td class="px-4 py-3">
                      <div class="flex flex-wrap gap-2">
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs"
                          (click)="setObligationStatus(item, 'in_progress')"
                          [disabled]="working()"
                        >
                          En progreso
                        </button>
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs"
                          (click)="setObligationStatus(item, 'ready')"
                          [disabled]="working()"
                        >
                          Lista
                        </button>
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs"
                          (click)="attachObligationEvidence(item)"
                          [disabled]="working()"
                        >
                          Evidencia
                        </button>
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs"
                          (click)="setObligationStatus(item, 'approved')"
                          [disabled]="working() || item.status !== 'ready'"
                        >
                          Aprobar
                        </button>
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs"
                          (click)="submitObligation(item)"
                          [disabled]="
                            working() ||
                            (item.status !== 'ready' &&
                              item.status !== 'approved')
                          "
                        >
                          Presentar
                        </button>
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs"
                          (click)="payObligation(item)"
                          [disabled]="working() || item.status !== 'submitted'"
                        >
                          Pagar
                        </button>
                      </div>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td
                      colspan="7"
                      class="px-4 py-8 text-center text-text-secondary"
                    >
                      Genera obligaciones para el periodo actual.
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      @if (activeTab() === 'declarations') {
        <div class="space-y-4">
          <div class="rounded-lg border border-border bg-surface">
            <div
              class="flex flex-col gap-3 border-b border-border px-4 py-3 md:flex-row md:items-center md:justify-between"
            >
              <h2 class="text-sm font-semibold text-text-primary">
                Borradores de declaraciones
              </h2>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  (click)="createDraft('vat')"
                  [disabled]="working()"
                >
                  IVA
                </button>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  (click)="createDraft('withholding')"
                  [disabled]="working()"
                >
                  Retención
                </button>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  (click)="createDraft('ica')"
                  [disabled]="working()"
                >
                  ICA
                </button>
              </div>
            </div>
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-border text-sm">
                <thead
                  class="bg-muted/40 text-left text-xs uppercase text-text-secondary"
                >
                  <tr>
                    <th class="px-4 py-3">Tipo</th>
                    <th class="px-4 py-3">Periodo</th>
                    <th class="px-4 py-3">Entidad</th>
                    <th class="px-4 py-3">Total</th>
                    <th class="px-4 py-3">Estado</th>
                    <th class="px-4 py-3">Acción</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-border">
                  @for (item of declarations(); track item.id) {
                    <tr>
                      <td class="px-4 py-3 font-medium text-text-primary">
                        {{ declarationLabel(item.declaration_type) }}
                      </td>
                      <td class="px-4 py-3 text-text-secondary">
                        {{ periodLabel(item) }}
                      </td>
                      <td class="px-4 py-3 text-text-secondary">
                        {{ entityLabel(item) }}
                      </td>
                      <td class="px-4 py-3 text-text-secondary">
                        {{ toNumber(item.total_payable) | currency }}
                      </td>
                      <td class="px-4 py-3">
                        <span [class]="statusClass(item.status)">{{
                          statusLabel(item.status)
                        }}</span>
                      </td>
                      <td class="px-4 py-3">
                        <div class="flex flex-wrap gap-2">
                          <button
                            type="button"
                            class="btn btn-ghost btn-xs"
                            (click)="loadDeclarationLines(item)"
                            [disabled]="working()"
                          >
                            Líneas
                          </button>
                          <button
                            type="button"
                            class="btn btn-ghost btn-xs"
                            (click)="approveDeclaration(item)"
                            [disabled]="
                              working() ||
                              (item.status !== 'ready' &&
                                item.status !== 'needs_review')
                            "
                          >
                            Aprobar
                          </button>
                          <button
                            type="button"
                            class="btn btn-ghost btn-xs"
                            (click)="attachDeclarationEvidence(item)"
                            [disabled]="working()"
                          >
                            Evidencia
                          </button>
                          <button
                            type="button"
                            class="btn btn-ghost btn-xs"
                            (click)="submitDeclaration(item)"
                            [disabled]="working() || item.status !== 'approved'"
                          >
                            Presentar
                          </button>
                        </div>
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td
                        colspan="6"
                        class="px-4 py-8 text-center text-text-secondary"
                      >
                        No hay borradores creados.
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>

          @if (selectedDeclaration()) {
            <div class="rounded-lg border border-border bg-surface">
              <div class="border-b border-border px-4 py-3">
                <h3 class="text-sm font-semibold text-text-primary">
                  Líneas:
                  {{
                    declarationLabel(selectedDeclaration()!.declaration_type)
                  }}
                </h3>
              </div>
              <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-border text-sm">
                  <thead
                    class="bg-muted/40 text-left text-xs uppercase text-text-secondary"
                  >
                    <tr>
                      <th class="px-4 py-3">Línea</th>
                      <th class="px-4 py-3">Fuente</th>
                      <th class="px-4 py-3">Base</th>
                      <th class="px-4 py-3">Impuesto</th>
                      <th class="px-4 py-3">Retención</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-border">
                    @for (line of declarationLines(); track line.id) {
                      <tr>
                        <td class="px-4 py-3">
                          <div class="font-medium text-text-primary">
                            {{ line.description }}
                          </div>
                          <div class="text-xs text-text-secondary">
                            {{ line.line_type }}
                          </div>
                        </td>
                        <td class="px-4 py-3 text-text-secondary">
                          {{ line.source_type }}
                        </td>
                        <td class="px-4 py-3 text-text-secondary">
                          {{ toNumber(line.base_amount) | currency }}
                        </td>
                        <td class="px-4 py-3 text-text-secondary">
                          {{ toNumber(line.tax_amount) | currency }}
                        </td>
                        <td class="px-4 py-3 text-text-secondary">
                          {{ toNumber(line.withholding_amount) | currency }}
                        </td>
                      </tr>
                    } @empty {
                      <tr>
                        <td
                          colspan="5"
                          class="px-4 py-8 text-center text-text-secondary"
                        >
                          El borrador no tiene líneas explicativas.
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          }
        </div>
      }

      @if (activeTab() === 'close') {
        <div class="rounded-lg border border-border bg-surface">
          <div
            class="flex flex-col gap-3 border-b border-border px-4 py-3 md:flex-row md:items-center md:justify-between"
          >
            <h2 class="text-sm font-semibold text-text-primary">
              Cierre fiscal mensual
            </h2>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              (click)="createCloseSession()"
              [disabled]="working()"
            >
              Crear cierre del mes
            </button>
          </div>
          <div class="divide-y divide-border">
            @for (session of closeSessions(); track session.id) {
              <article class="p-4">
                <div
                  class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"
                >
                  <div>
                    <div class="flex flex-wrap items-center gap-2">
                      <h3 class="font-medium text-text-primary">
                        {{ periodLabel(session) }}
                      </h3>
                      <span [class]="statusClass(session.status)">{{
                        statusLabel(session.status)
                      }}</span>
                    </div>
                    <p class="mt-1 text-sm text-text-secondary">
                      {{ entityLabel(session) }}
                    </p>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      (click)="runCloseChecks(session)"
                      [disabled]="working()"
                    >
                      Ejecutar checks
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      (click)="attachCloseEvidence(session)"
                      [disabled]="working()"
                    >
                      Evidencia
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      (click)="approveClose(session)"
                      [disabled]="working() || session.status !== 'ready'"
                    >
                      Aprobar
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      (click)="closeFiscalSession(session)"
                      [disabled]="
                        working() ||
                        (session.status !== 'approved' &&
                          session.status !== 'ready')
                      "
                    >
                      Cerrar
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      (click)="reopenClose(session)"
                      [disabled]="working() || session.status !== 'closed'"
                    >
                      Reabrir
                    </button>
                  </div>
                </div>
                <div class="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  @for (check of session.checks || []; track check.id) {
                    <div class="rounded-md border border-border p-3">
                      <div class="flex items-center justify-between gap-3">
                        <span class="text-sm font-medium text-text-primary">{{
                          check.title
                        }}</span>
                        <span [class]="statusClass(check.status)">{{
                          statusLabel(check.status)
                        }}</span>
                      </div>
                      <p class="mt-2 text-xs text-text-secondary">
                        {{ check.result_summary || check.description }}
                      </p>
                    </div>
                  } @empty {
                    <div
                      class="rounded-md border border-dashed border-border p-4 text-sm text-text-secondary"
                    >
                      Ejecuta checks para ver el estado del cierre.
                    </div>
                  }
                </div>
              </article>
            } @empty {
              <div class="px-4 py-8 text-center text-text-secondary">
                No hay sesiones de cierre creadas.
              </div>
            }
          </div>
        </div>
      }

      @if (activeTab() === 'evidence') {
        <div class="rounded-lg border border-border bg-surface">
          <div class="border-b border-border px-4 py-3">
            <h2 class="text-sm font-semibold text-text-primary">
              Evidencias fiscales
            </h2>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-border text-sm">
              <thead
                class="bg-muted/40 text-left text-xs uppercase text-text-secondary"
              >
                <tr>
                  <th class="px-4 py-3">Tipo</th>
                  <th class="px-4 py-3">Fuente</th>
                  <th class="px-4 py-3">Hash</th>
                  <th class="px-4 py-3">Fecha</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                @for (item of evidence(); track item.id) {
                  <tr>
                    <td class="px-4 py-3 font-medium text-text-primary">
                      {{ evidenceLabel(item.evidence_type) }}
                    </td>
                    <td class="px-4 py-3 text-text-secondary">
                      {{ item.source_type || 'Soporte manual' }}
                    </td>
                    <td class="px-4 py-3 text-text-secondary">
                      {{ item.content_hash || 'Sin hash' }}
                    </td>
                    <td class="px-4 py-3 text-text-secondary">
                      {{ formatDate(item.created_at) }}
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td
                      colspan="4"
                      class="px-4 py-8 text-center text-text-secondary"
                    >
                      No hay evidencias adjuntas.
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      @if (activeTab() === 'rules') {
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          @for (rule of rules(); track rule.id || rule.rule_type + rule.year) {
            <article class="rounded-lg border border-border bg-surface p-4">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h2 class="text-sm font-semibold text-text-primary">
                    {{ rule.name }}
                  </h2>
                  <p class="mt-1 text-xs text-text-secondary">
                    {{ rule.country_code }} · {{ rule.year }} ·
                    {{ rule.version }}
                  </p>
                </div>
                <span [class]="statusClass(rule.status)">{{
                  statusLabel(rule.status)
                }}</span>
              </div>
              <dl class="mt-4 space-y-2 text-sm">
                <div class="flex items-center justify-between gap-3">
                  <dt class="text-text-secondary">Tipo</dt>
                  <dd class="font-medium text-text-primary">
                    {{ rule.rule_type }}
                  </dd>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <dt class="text-text-secondary">Vigencia</dt>
                  <dd class="font-medium text-text-primary">
                    {{ formatDate(rule.effective_from) }}
                  </dd>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <dt class="text-text-secondary">Origen</dt>
                  <dd class="font-medium text-text-primary">
                    {{ rule.source || 'Configurada' }}
                  </dd>
                </div>
              </dl>
            </article>
          } @empty {
            <div
              class="rounded-lg border border-dashed border-border p-8 text-center text-text-secondary"
            >
              No hay reglas fiscales configuradas.
            </div>
          }
        </div>
      }

      @if (activeTab() === 'history') {
        <div class="rounded-lg border border-border bg-surface">
          <div class="border-b border-border px-4 py-3">
            <h2 class="text-sm font-semibold text-text-primary">
              Historial fiscal
            </h2>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-border text-sm">
              <thead
                class="bg-muted/40 text-left text-xs uppercase text-text-secondary"
              >
                <tr>
                  <th class="px-4 py-3">Evento</th>
                  <th class="px-4 py-3">Recurso</th>
                  <th class="px-4 py-3">Entidad</th>
                  <th class="px-4 py-3">Estado</th>
                  <th class="px-4 py-3">Usuario</th>
                  <th class="px-4 py-3">Fecha</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                @for (item of history(); track item.id) {
                  <tr>
                    <td class="px-4 py-3">
                      <div class="font-medium text-text-primary">
                        {{ eventLabel(item.event_type) }}
                      </div>
                      <div class="text-xs text-text-secondary">
                        {{ item.event_type }}
                      </div>
                    </td>
                    <td class="px-4 py-3 text-text-secondary">
                      {{ resourceLabel(item.resource_type) }} #{{
                        item.resource_id || '-'
                      }}
                    </td>
                    <td class="px-4 py-3 text-text-secondary">
                      {{ historyEntityLabel(item) }}
                    </td>
                    <td class="px-4 py-3">
                      <div class="flex flex-wrap items-center gap-2">
                        @if (item.previous_status) {
                          <span [class]="statusClass(item.previous_status)">
                            {{ statusLabel(item.previous_status) }}
                          </span>
                        }
                        @if (item.new_status) {
                          <span class="text-text-muted">&rarr;</span>
                          <span [class]="statusClass(item.new_status)">
                            {{ statusLabel(item.new_status) }}
                          </span>
                        }
                      </div>
                    </td>
                    <td class="px-4 py-3 text-text-secondary">
                      {{ actorLabel(item) }}
                    </td>
                    <td class="px-4 py-3 text-text-secondary">
                      {{ formatDate(item.created_at) }}
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td
                      colspan="6"
                      class="px-4 py-8 text-center text-text-secondary"
                    >
                      Todavía no hay eventos auditables para esta entidad
                      fiscal.
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </section>
  `,
})
export class FiscalOperationsComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(FiscalOperationsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly headerActions = inject(FiscalOperationsHeaderActionsService);

  private readonly routeData = toSignal(
    this.route.data.pipe(
      map((data) => (data['tab'] || 'dashboard') as FiscalTab),
    ),
    { initialValue: 'dashboard' as FiscalTab },
  );

  readonly activeTab = computed(() => this.routeData());
  readonly overview = signal<FiscalOverview | null>(null);
  readonly obligations = signal<FiscalObligation[]>([]);
  readonly declarations = signal<TaxDeclarationDraft[]>([]);
  readonly selectedDeclaration = signal<TaxDeclarationDraft | null>(null);
  readonly declarationLines = signal<TaxDeclarationLine[]>([]);
  readonly closeSessions = signal<FiscalCloseSession[]>([]);
  readonly evidence = signal<FiscalEvidence[]>([]);
  readonly history = signal<FiscalOperationEvent[]>([]);
  readonly rules = signal<FiscalRuleSet[]>([]);
  readonly loading = signal(false);
  readonly working = signal(false);
  readonly errorMessage = signal<string | null>(null);

  constructor() {
    effect(() => {
      const tab = this.activeTab();
      untracked(() => {
        this.loadOverview();
        this.loadTab(tab);
      });
    });

    // Expose the header actions to the FiscalCoreShell sticky-header.
    // We capture `this` so the calls always hit the current instance.
    this.headerActions.register('refresh', () => this.reloadCurrentTab());
    this.headerActions.register('generate-obligations', () =>
      this.generateCurrentMonthObligations(),
    );

    this.destroyRef.onDestroy(() => {
      this.headerActions.unregister('refresh');
      this.headerActions.unregister('generate-obligations');
    });
  }

  reloadCurrentTab(): void {
    this.loadOverview();
    this.loadTab(this.activeTab());
  }

  generateCurrentMonthObligations(): void {
    const period = this.currentPeriod();
    this.working.set(true);
    this.service
      .generateObligations(this.apiScope(), period)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Obligaciones generadas');
          this.reloadCurrentTab();
        },
        error: () =>
          this.handleError('No se pudieron generar las obligaciones'),
        complete: () => this.working.set(false),
      });
  }

  setObligationStatus(item: FiscalObligation, status: string): void {
    this.working.set(true);
    this.service
      .updateObligationStatus(this.apiScope(), item.id, status)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Obligación actualizada');
          this.loadObligations();
          this.loadOverview();
        },
        error: () => this.handleError('No se pudo actualizar la obligación'),
        complete: () => this.working.set(false),
      });
  }

  attachObligationEvidence(item: FiscalObligation): void {
    this.working.set(true);
    this.service
      .attachObligationEvidence(
        this.apiScope(),
        item.id,
        this.manualEvidencePayload('fiscal_obligation', item.id),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Evidencia adjuntada');
          this.loadObligations();
          this.loadEvidence();
          this.loadHistory();
        },
        error: () => this.handleError('No se pudo adjuntar la evidencia'),
        complete: () => this.working.set(false),
      });
  }

  submitObligation(item: FiscalObligation): void {
    this.working.set(true);
    this.service
      .attachObligationEvidence(
        this.apiScope(),
        item.id,
        this.manualEvidencePayload('fiscal_obligation', item.id),
      )
      .pipe(
        switchMap((response) =>
          this.service.updateObligationStatus(
            this.apiScope(),
            item.id,
            'submitted',
            {
              evidence_id: response.data.id,
              notes: 'Presentada con soporte manual.',
            },
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success('Obligación presentada');
          this.loadObligations();
          this.loadOverview();
          this.loadEvidence();
          this.loadHistory();
        },
        error: () => this.handleError('No se pudo presentar la obligación'),
        complete: () => this.working.set(false),
      });
  }

  payObligation(item: FiscalObligation): void {
    this.working.set(true);
    this.service
      .updateObligationStatus(this.apiScope(), item.id, 'paid', {
        payment_info: { source: 'manual', paid_at: new Date().toISOString() },
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Obligación pagada');
          this.loadObligations();
          this.loadOverview();
          this.loadHistory();
        },
        error: () => this.handleError('No se pudo marcar como pagada'),
        complete: () => this.working.set(false),
      });
  }

  createDraft(declarationType: string): void {
    this.working.set(true);
    this.service
      .createDeclarationDraft(this.apiScope(), {
        declaration_type: declarationType,
        ...this.currentPeriod(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Borrador generado');
          this.loadDeclarations();
          this.loadOverview();
        },
        error: () => this.handleError('No se pudo crear el borrador'),
        complete: () => this.working.set(false),
      });
  }

  approveDeclaration(item: TaxDeclarationDraft): void {
    this.working.set(true);
    this.service
      .approveDeclaration(this.apiScope(), item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Declaración aprobada');
          this.loadDeclarations();
          this.loadOverview();
        },
        error: () => this.handleError('No se pudo aprobar la declaración'),
        complete: () => this.working.set(false),
      });
  }

  attachDeclarationEvidence(item: TaxDeclarationDraft): void {
    this.working.set(true);
    this.service
      .attachDeclarationEvidence(
        this.apiScope(),
        item.id,
        this.manualEvidencePayload('tax_declaration_draft', item.id),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Evidencia adjuntada');
          this.loadDeclarations();
          this.loadEvidence();
          this.loadHistory();
        },
        error: () => this.handleError('No se pudo adjuntar la evidencia'),
        complete: () => this.working.set(false),
      });
  }

  submitDeclaration(item: TaxDeclarationDraft): void {
    this.working.set(true);
    this.service
      .attachDeclarationEvidence(
        this.apiScope(),
        item.id,
        this.manualEvidencePayload('tax_declaration_draft', item.id),
      )
      .pipe(
        switchMap((response) =>
          this.service.markDeclarationSubmitted(this.apiScope(), item.id, {
            submitted_at: new Date().toISOString(),
            evidence_id: response.data.id,
            notes: 'Presentada con soporte manual.',
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success('Declaración presentada');
          this.loadDeclarations();
          this.loadOverview();
          this.loadEvidence();
          this.loadHistory();
        },
        error: () => this.handleError('No se pudo presentar la declaración'),
        complete: () => this.working.set(false),
      });
  }

  loadDeclarationLines(item: TaxDeclarationDraft): void {
    this.selectedDeclaration.set(item);
    this.working.set(true);
    this.service
      .getDeclarationLines(this.apiScope(), item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.declarationLines.set(response.data || []),
        error: () => this.handleError('No se pudieron cargar las líneas'),
        complete: () => this.working.set(false),
      });
  }

  createCloseSession(): void {
    this.working.set(true);
    this.service
      .createCloseSession(this.apiScope(), {
        ...this.currentPeriod(),
        close_type: 'monthly',
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Cierre creado');
          this.loadCloseSessions();
          this.loadOverview();
        },
        error: () => this.handleError('No se pudo crear el cierre'),
        complete: () => this.working.set(false),
      });
  }

  runCloseChecks(session: FiscalCloseSession): void {
    this.working.set(true);
    this.service
      .runCloseChecks(this.apiScope(), session.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Checks actualizados');
          this.loadCloseSessions();
          this.loadOverview();
        },
        error: () => this.handleError('No se pudieron ejecutar los checks'),
        complete: () => this.working.set(false),
      });
  }

  attachCloseEvidence(session: FiscalCloseSession): void {
    this.working.set(true);
    this.service
      .attachCloseEvidence(
        this.apiScope(),
        session.id,
        this.manualEvidencePayload('fiscal_close_session', session.id),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Evidencia adjuntada');
          this.loadEvidence();
          this.loadHistory();
        },
        error: () => this.handleError('No se pudo adjuntar la evidencia'),
        complete: () => this.working.set(false),
      });
  }

  approveClose(session: FiscalCloseSession): void {
    this.working.set(true);
    this.service
      .approveClose(this.apiScope(), session.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Cierre aprobado');
          this.loadCloseSessions();
          this.loadOverview();
          this.loadHistory();
        },
        error: () => this.handleError('No se pudo aprobar el cierre'),
        complete: () => this.working.set(false),
      });
  }

  closeFiscalSession(session: FiscalCloseSession): void {
    this.working.set(true);
    this.service
      .closeSession(this.apiScope(), session.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Cierre completado');
          this.loadCloseSessions();
          this.loadOverview();
          this.loadHistory();
        },
        error: () => this.handleError('No se pudo cerrar el periodo'),
        complete: () => this.working.set(false),
      });
  }

  reopenClose(session: FiscalCloseSession): void {
    const reason =
      window.prompt(
        'Razón de reapertura',
        'Reapertura auditada solicitada por operación fiscal.',
      ) || '';
    if (reason.trim().length < 20) return;

    this.working.set(true);
    this.service
      .reopenCloseSession(this.apiScope(), session.id, reason.trim())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Cierre reabierto');
          this.loadCloseSessions();
          this.loadOverview();
          this.loadHistory();
        },
        error: () => this.handleError('No se pudo reabrir el cierre'),
        complete: () => this.working.set(false),
      });
  }

  formatDate(value?: string | null): string {
    return value ? formatDateOnlyUTC(value) : '-';
  }

  toNumber(value?: string | number | null): number {
    const amount = Number(value ?? 0);
    return Number.isFinite(amount) ? amount : 0;
  }

  periodLabel(item: {
    period_year: number;
    period_month?: number | null;
    period_quarter?: number | null;
  }): string {
    if (item.period_month)
      return `${item.period_year}-${String(item.period_month).padStart(2, '0')}`;
    if (item.period_quarter)
      return `${item.period_year} T${item.period_quarter}`;
    return String(item.period_year);
  }

  entityLabel(item: {
    accounting_entity?: {
      legal_name?: string | null;
      business_name?: string | null;
      tax_id?: string | null;
    } | null;
    store?: { name?: string | null } | null;
  }): string {
    const entity = item.accounting_entity;
    const name = entity?.business_name || entity?.legal_name || entity?.tax_id;
    if (name && item.store?.name) return `${name} · ${item.store.name}`;
    return name || item.store?.name || 'Entidad fiscal';
  }

  typeLabel(type: string): string {
    const labels: Record<string, string> = {
      vat_return: 'IVA',
      withholding_return: 'Retención en la fuente',
      reteiva_return: 'ReteIVA',
      reteica_return: 'ReteICA',
      ica_return: 'ICA',
      exogenous_report: 'Información exógena',
      income_tax_precierre: 'Pre-cierre renta',
      electronic_invoice_review: 'Revisión factura electrónica',
      support_document_review: 'Documento soporte',
      payroll_electronic_review: 'Nómina electrónica',
      bank_reconciliation: 'Conciliación bancaria',
      inventory_valuation: 'Valoración inventario',
      monthly_close: 'Cierre mensual',
      annual_close: 'Cierre anual',
    };
    return labels[type] || type;
  }

  declarationLabel(type: string): string {
    const labels: Record<string, string> = {
      vat: 'IVA',
      withholding: 'Retención',
      reteiva: 'ReteIVA',
      reteica: 'ReteICA',
      ica: 'ICA',
      exogenous: 'Exógena',
      income_tax_precierre: 'Pre-cierre renta',
    };
    return labels[type] || type;
  }

  evidenceLabel(type: string): string {
    return type.replace(/_/g, ' ');
  }

  eventLabel(type: string): string {
    return type
      .replace(/^fiscal\./, '')
      .replace(/\./g, ' ')
      .replace(/_/g, ' ');
  }

  resourceLabel(type: string): string {
    const labels: Record<string, string> = {
      fiscal_obligation: 'Obligación',
      tax_declaration_draft: 'Declaración',
      fiscal_close_session: 'Cierre',
      fiscal_close_check: 'Check de cierre',
      fiscal_evidence: 'Evidencia',
    };
    return labels[type] || type;
  }

  actorLabel(item: FiscalOperationEvent): string {
    const actor = item.actor_user;
    if (!actor) return 'Sistema';
    const fullName = [actor.first_name, actor.last_name]
      .filter(Boolean)
      .join(' ');
    return fullName || actor.email || 'Usuario';
  }

  historyEntityLabel(item: FiscalOperationEvent): string {
    const entity = item.accounting_entity;
    const name = entity?.legal_name || entity?.name || entity?.tax_id;
    if (name && item.store?.name) return `${name} · ${item.store.name}`;
    return name || item.store?.name || 'Entidad fiscal';
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      in_progress: 'En progreso',
      blocked: 'Bloqueada',
      ready: 'Lista',
      approved: 'Aprobada',
      submitted: 'Presentada',
      accepted: 'Aceptada',
      rejected: 'Rechazada',
      paid: 'Pagada',
      overdue: 'Vencida',
      draft: 'Borrador',
      calculating: 'Calculando',
      needs_review: 'Revisión',
      closed: 'Cerrado',
      checking: 'Validando',
      passed: 'OK',
      failed: 'Falla',
      warning: 'Alerta',
      active: 'Activa',
    };
    return labels[status] || status;
  }

  statusClass(status: string): string {
    const base = 'inline-flex rounded-full px-2 py-1 text-xs font-medium';
    if (
      ['accepted', 'approved', 'paid', 'passed', 'active', 'ready'].includes(
        status,
      )
    ) {
      return `${base} bg-success/10 text-success`;
    }
    if (['rejected', 'overdue', 'failed', 'blocked'].includes(status)) {
      return `${base} bg-error/10 text-error`;
    }
    if (['warning', 'needs_review', 'submitted', 'checking'].includes(status)) {
      return `${base} bg-warning/10 text-warning`;
    }
    return `${base} bg-muted text-text-secondary`;
  }

  private loadTab(tab: FiscalTab): void {
    if (tab === 'dashboard') return;
    if (tab === 'obligations') this.loadObligations();
    if (tab === 'declarations') this.loadDeclarations();
    if (tab === 'close') this.loadCloseSessions();
    if (tab === 'evidence') this.loadEvidence();
    if (tab === 'history') this.loadHistory();
    if (tab === 'rules') this.loadRules();
  }

  private loadOverview(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.service
      .getOverview(this.apiScope())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.overview.set(response.data),
        error: () => this.handleError('No se pudo cargar el resumen fiscal'),
        complete: () => this.loading.set(false),
      });
  }

  private loadObligations(): void {
    this.service
      .listObligations(this.apiScope(), { limit: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.obligations.set(response.data || []),
        error: () => this.handleError('No se pudieron cargar las obligaciones'),
      });
  }

  private loadDeclarations(): void {
    this.service
      .listDeclarations(this.apiScope(), { limit: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.declarations.set(response.data || []),
        error: () =>
          this.handleError('No se pudieron cargar las declaraciones'),
      });
  }

  private loadCloseSessions(): void {
    this.service
      .listCloseSessions(this.apiScope())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.closeSessions.set(response.data || []),
        error: () => this.handleError('No se pudieron cargar los cierres'),
      });
  }

  private loadEvidence(): void {
    this.service
      .listEvidence(this.apiScope())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.evidence.set(response.data || []),
        error: () => this.handleError('No se pudieron cargar las evidencias'),
      });
  }

  private loadRules(): void {
    this.service
      .listRules(this.apiScope())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.rules.set(response.data || []),
        error: () => this.handleError('No se pudieron cargar las reglas'),
      });
  }

  private loadHistory(): void {
    this.service
      .listHistory(this.apiScope(), { limit: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.history.set(response.data || []),
        error: () => this.handleError('No se pudo cargar el historial fiscal'),
      });
  }

  private manualEvidencePayload(sourceType: string, sourceId: number) {
    return {
      evidence_type: 'manual_support',
      source_type: sourceType,
      source_id: sourceId,
      metadata: {
        captured_at: new Date().toISOString(),
        capture_mode: 'manual',
      },
    };
  }

  private handleError(message: string): void {
    this.errorMessage.set(message);
    this.toast.error(message);
    this.loading.set(false);
    this.working.set(false);
  }

  private apiScope(): FiscalApiScope {
    const routeScope = this.route.pathFromRoot
      .map((route) => route.snapshot.data['fiscalApiScope'])
      .find((value) => value === 'store' || value === 'organization');
    return (routeScope as FiscalApiScope | undefined) ?? 'store';
  }

  private currentPeriod(): { period_year: number; period_month: number } {
    const now = new Date();
    return {
      period_year: now.getFullYear(),
      period_month: now.getMonth() + 1,
    };
  }
}
