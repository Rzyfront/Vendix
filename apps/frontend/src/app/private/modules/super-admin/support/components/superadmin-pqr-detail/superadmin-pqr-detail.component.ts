import {
  Component,
  inject,
  signal,
  DestroyRef,
  effect,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { SupportService } from '../../services/support.service';

/**
 * Super-admin PQR detail view.
 *
 * Unlike the earlier read-only compliance view, super-admins ARE the
 * actual recipient of platform-wide PQRs (they arrive at
 * admin@vendix.online via `POST /pqr`). So this view is fully writable:
 * post comments (public or internal), change status, and assign to an
 * internal user. Follows the same visual language as the store-admin
 * PqrDetailPage (header card + solicitante sidebar + comments + status
 * history) so operators switch contexts without retraining.
 */
@Component({
  selector: 'app-superadmin-pqr-detail',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule, RouterLink, IconComponent],
  template: `
    <div class="pqr-detail-page">
      @if (loading()) {
      <div class="loading-banner">Cargando…</div>
      } @if (errorMsg(); as msg) {
      <div class="error-banner">{{ msg }}</div>
      } @if (pqr(); as p) {
      <a class="back-link" routerLink="/super-admin/support/pqrs">
        <app-icon name="arrow-left" [size]="14"></app-icon>
        Volver al listado
      </a>

      <!-- Header card -->
      <header class="header-card">
        <div class="header-card__top">
          <div class="header-card__chips">
            <span class="mono">{{ p.ticket_number }}</span>
            <span class="type-tag" [attr.data-type]="p.category">
              {{ typeLabel(p.category) }}
            </span>
            <span class="status-pill" [attr.data-status]="p.status">
              {{ statusLabel(p.status) }}
            </span>
          </div>
          <div class="header-card__sla">
            <app-icon
              [name]="
                slaInfo().status === 'overdue'
                  ? 'alert-triangle'
                  : slaInfo().status === 'warn'
                    ? 'clock'
                    : 'check-circle'
              "
              [size]="14"
            ></app-icon>
            @if (slaInfo().status === 'overdue') {
              SLA vencido hace {{ -slaInfo().remaining }} días hábiles
            } @else if (slaInfo().status === 'warn') {
              Vence en {{ slaInfo().remaining }} días hábiles
            } @else {
              {{ slaInfo().remaining }} días hábiles restantes
            }
          </div>
        </div>
        <h1 class="header-card__title">{{ p.title }}</h1>
        <div class="header-card__meta">
          <app-icon name="calendar" [size]="14"></app-icon>
          Radicado {{ p.created_at | date: 'medium' }}
          @if (p.organization) {
            <span class="dot">·</span>
            <app-icon name="building" [size]="14"></app-icon>
            {{ p.organization.name }}
          }
          @if (p.store) {
            <span class="dot">·</span>
            <app-icon name="store" [size]="14"></app-icon>
            {{ p.store.name }}
          }
        </div>
      </header>

      <!-- 2-column layout: description + side panel -->
      <div class="layout">
        <div class="layout__main">
          <section class="card">
            <h2>Descripción del solicitante</h2>
            <pre class="description">{{ p.description }}</pre>
          </section>

          <section class="card">
            <h2>Conversación ({{ publicComments().length }})</h2>
            @if (publicComments().length === 0) {
            <p class="empty">Sin comentarios aún.</p>
            } @else {
            <ul class="comments">
              @for (c of publicComments(); track c.id) {
              <li class="comment">
                <div class="comment__head">
                  <strong>{{ c.author_name || c.author_type }}</strong>
                  <span class="muted">{{ c.created_at | date: 'short' }}</span>
                </div>
                <p class="comment__body">{{ c.content }}</p>
              </li>
              }
            </ul>
            }
            <p class="hint">
              Los comentarios internos (no enviados al solicitante) solo
              son visibles para el equipo de Vendix.
            </p>

            <!-- Composer — super-admin writes here too -->
            <div class="composer">
              <textarea
                rows="4"
                [placeholder]="
                  isInternal()
                    ? 'Nota interna (solo el equipo de Vendix la verá)…'
                    : 'Escribe una respuesta para el solicitante…'
                "
                [ngModel]="newComment()"
                (ngModelChange)="newComment.set($event)"
                name="newComment"
              ></textarea>
              <div class="composer-controls">
                <label class="check">
                  <input
                    type="checkbox"
                    [checked]="isInternal()"
                    (change)="isInternal.set(($any($event.target)).checked)"
                  />
                  <span>Marcar como nota interna</span>
                </label>
                <div class="composer-actions">
                  <button
                    class="ghost-btn"
                    type="button"
                    (click)="openStatusModal()"
                  >
                    <app-icon name="refresh" [size]="14"></app-icon>
                    Actualizar estado
                  </button>
                  <button
                    class="primary-btn"
                    [disabled]="!canSubmitComment()"
                    (click)="submitComment()"
                  >
                    {{
                      commentSubmitting()
                        ? 'Enviando…'
                        : isInternal()
                          ? 'Guardar nota interna'
                          : 'Enviar respuesta'
                    }}
                  </button>
                </div>
              </div>
              @if (commentError(); as err) {
              <p class="error-inline">{{ err }}</p>
              }
            </div>
          </section>

          <section class="card">
            <h2>Historial de estados</h2>
            @if (p.status_history?.length === 0) {
            <p class="empty">Sin cambios de estado aún.</p>
            } @else {
            <ol class="history">
              @for (h of p.status_history; track h.id) {
              <li class="history__row">
                <span class="history__pill" [attr.data-status]="h.new_status">
                  {{ statusLabel(h.new_status) }}
                </span>
                <span class="muted">
                  {{ h.created_at | date: 'short' }}
                </span>
                @if (h.change_reason) {
                <span class="reason">— {{ h.change_reason }}</span>
                }
              </li>
              }
            </ol>
            }
          </section>
        </div>

        <aside class="layout__side">
          <section class="card">
            <h3>Solicitante</h3>
            <dl class="kv">
              <dt>Organización</dt>
              <dd>{{ p.organization?.name || '—' }}</dd>
              <dt>Tienda</dt>
              <dd>{{ p.store?.name || '—' }}</dd>
              <dt>Estado</dt>
              <dd>
                <span class="status-pill" [attr.data-status]="p.status">
                  {{ statusLabel(p.status) }}
                </span>
              </dd>
              <dt>SLA legal</dt>
              <dd>
                @if (p.sla_deadline) {
                  {{ p.sla_deadline | date: 'mediumDate' }}
                } @else {
                  —
                }
              </dd>
            </dl>
          </section>

          <section class="card">
            <h3>Asignado a</h3>
            @if (p.assigned_to) {
            <p>
              {{ p.assigned_to.first_name }} {{ p.assigned_to.last_name }}
              <br />
              <span class="muted">{{ p.assigned_to.email }}</span>
            </p>
            } @else {
            <p class="muted">Sin asignar.</p>
            }
            <button
              class="ghost-btn"
              type="button"
              [disabled]="assignSubmitting()"
              (click)="assignToMe()"
            >
              {{ assignSubmitting() ? 'Asignando…' : 'Asignarme a mí' }}
            </button>
          </section>
        </aside>
      </div>

      <!-- Status update modal -->
      @if (showStatusModal()) {
      <div class="modal-overlay" (click)="closeStatusModal()">
        <div class="modal" (click)="$event.stopPropagation()">
          <h2>Actualizar estado de la solicitud</h2>
          <p class="muted">
            Si la resuelves o la cierras, enviaremos un correo automático
            al solicitante.
          </p>
          <label class="modal-field">
            <span>Nuevo estado</span>
            <select
              [ngModel]="newStatus()"
              (ngModelChange)="newStatus.set($event)"
              name="newStatus"
            >
              @for (opt of statusOptions; track opt.value) {
              <option [value]="opt.value">{{ opt.label }}</option>
              }
            </select>
          </label>
          <label class="modal-field">
            <span>Motivo del cambio (opcional)</span>
            <textarea
              rows="3"
              [ngModel]="statusChangeReason()"
              (ngModelChange)="statusChangeReason.set($event)"
              name="statusChangeReason"
              placeholder="Detalle breve que verá el equipo en el historial…"
            ></textarea>
          </label>
          @if (statusError(); as err) {
          <p class="error-inline">{{ err }}</p>
          }
          <div class="modal-actions">
            <button
              type="button"
              class="ghost-btn"
              [disabled]="statusSubmitting()"
              (click)="closeStatusModal()"
            >
              Cancelar
            </button>
            <button
              type="button"
              class="primary-btn"
              [disabled]="statusSubmitting()"
              (click)="confirmStatusChange()"
            >
              {{
                statusSubmitting()
                  ? 'Guardando…'
                  : newStatus() === 'CLOSED'
                    ? 'Cerrar solicitud'
                    : newStatus() === 'RESOLVED'
                      ? 'Marcar como resuelta'
                      : 'Guardar cambios'
              }}
            </button>
          </div>
        </div>
      </div>
      }
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        padding: 1.5rem;
        max-width: 1280px;
        margin: 0 auto;
      }

      .pqr-detail-page {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }

      .loading-banner,
      .error-banner {
        padding: 1rem;
        border-radius: 10px;
        text-align: center;
      }
      .loading-banner {
        background: #f1f5f9;
        color: #475569;
      }
      .error-banner {
        background: #fef2f2;
        border: 1px solid #fecaca;
        color: #991b1b;
      }

      .back-link {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        color: #1d4ed8;
        text-decoration: none;
        font-size: 0.875rem;
        font-weight: 500;
        &:hover {
          text-decoration: underline;
        }
      }

      // Header card
      .header-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 1.5rem;
        &__top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 1rem;
          flex-wrap: wrap;
        }
        &__chips {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
        &__sla {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 600;
          padding: 0.375rem 0.625rem;
          border-radius: 9999px;
          background: #ecfdf5;
          color: #047857;
          &:has(app-icon[name='alert-triangle']) {
            background: #fee2e2;
            color: #b91c1c;
          }
          &:has(app-icon[name='clock']) {
            background: #fef3c7;
            color: #92400e;
          }
        }
        &__title {
          margin: 0.75rem 0 0.5rem;
          font-size: 1.5rem;
          font-weight: 700;
          color: #0f172a;
          line-height: 1.3;
        }
        &__meta {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: #64748b;
          font-size: 0.875rem;
          flex-wrap: wrap;
          app-icon {
            color: #94a3b8;
          }
          .dot {
            color: #cbd5e1;
          }
        }
      }

      // 2-column layout
      .layout {
        display: grid;
        grid-template-columns: 1fr 320px;
        gap: 1.25rem;
        @media (max-width: 900px) {
          grid-template-columns: 1fr;
        }
        &__main,
        &__side {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
      }

      .card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 1.25rem;
        h2,
        h3 {
          margin: 0 0 0.75rem;
          font-size: 1rem;
          font-weight: 700;
          color: #0f172a;
        }
        h2 {
          font-size: 1.0625rem;
        }
      }

      .description {
        margin: 0;
        padding: 1rem;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        font-family: 'SF Mono', Menlo, Consolas, monospace;
        font-size: 0.875rem;
        color: #1e293b;
        white-space: pre-wrap;
        word-break: break-word;
      }

      // Type tag
      .type-tag {
        display: inline-flex;
        padding: 0.1875rem 0.625rem;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 600;
        &[data-type='PETITION'] {
          background: #eef2ff;
          color: #4338ca;
        }
        &[data-type='COMPLAINT'] {
          background: #fed7aa;
          color: #9a3412;
        }
        &[data-type='CLAIM'] {
          background: #fecaca;
          color: #991b1b;
        }
      }
      .mono {
        font-family: 'SF Mono', Menlo, Consolas, monospace;
        font-size: 0.8125rem;
        color: #475569;
      }

      // Status pill
      .status-pill {
        display: inline-block;
        padding: 0.1875rem 0.625rem;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 600;
        background: #f1f5f9;
        color: #475569;
        &[data-status='NEW'] {
          background: #dbeafe;
          color: #1e40af;
        }
        &[data-status='RESOLVED'],
        &[data-status='CLOSED'] {
          background: #d1fae5;
          color: #065f46;
        }
      }

      // Comments
      .comments {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .comment {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 0.875rem 1rem;
        &__head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
          margin-bottom: 0.375rem;
          strong {
            color: #0f172a;
            font-size: 0.875rem;
          }
        }
        &__body {
          margin: 0;
          color: #1e293b;
          font-size: 0.875rem;
          white-space: pre-wrap;
        }
      }

      // Status history
      .history {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        &__row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.8125rem;
          flex-wrap: wrap;
        }
        &__pill {
          display: inline-block;
          padding: 0.125rem 0.5rem;
          border-radius: 6px;
          background: #f1f5f9;
          color: #475569;
          font-weight: 600;
          font-size: 0.75rem;
        }
        .reason {
          color: #475569;
        }
      }

      // Sidebar kv
      .kv {
        margin: 0;
        display: grid;
        grid-template-columns: max-content 1fr;
        column-gap: 0.75rem;
        row-gap: 0.5rem;
        font-size: 0.875rem;
        dt {
          color: #64748b;
          font-weight: 500;
        }
        dd {
          margin: 0;
          color: #0f172a;
        }
      }

      .muted {
        color: #94a3b8;
      }
      .empty {
        margin: 0;
        color: #94a3b8;
        font-size: 0.875rem;
        font-style: italic;
      }
      .hint {
        margin: 0.75rem 0 0;
        padding: 0.625rem 0.75rem;
        background: #fffbeb;
        border: 1px solid #fde68a;
        border-radius: 8px;
        color: #92400e;
        font-size: 0.8125rem;
      }
      .hint-text {
        margin: 0;
        font-size: 0.8125rem;
        line-height: 1.45;
      }

      /* ── Composer (super-admin writes here too) ───────────────────── */
      .composer {
        margin-top: 1rem;
        padding-top: 1rem;
        border-top: 1px dashed #e2e8f0;
      }
      .composer textarea {
        width: 100%;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        padding: 0.75rem;
        font-family: inherit;
        font-size: 0.9rem;
        resize: vertical;
      }
      .composer textarea:focus {
        outline: none;
        border-color: #1d4ed8;
        box-shadow: 0 0 0 3px rgba(29, 78, 216, 0.15);
      }
      .composer-controls {
        display: flex;
        gap: 1rem;
        align-items: center;
        flex-wrap: wrap;
        margin-top: 0.5rem;
      }
      .composer-controls .check {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.85rem;
        color: #475569;
        cursor: pointer;
      }
      .error-inline {
        margin: 0.5rem 0 0;
        background: #fef2f2;
        border: 1px solid #fecaca;
        color: #991b1b;
        padding: 0.5rem 0.75rem;
        border-radius: 8px;
        font-size: 0.85rem;
      }

      /* ── Composer action row (Actualizar estado + Enviar) ────────── */
      .composer-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-left: auto;
      }
      .composer-actions .ghost-btn,
      .composer-actions .primary-btn {
        flex: 1 1 0;
        min-width: 180px;
        justify-content: center;
      }
      .primary-btn {
        background: #1d4ed8;
        color: #ffffff;
        border: 0;
        border-radius: 8px;
        padding: 0.625rem 1.125rem;
        font-weight: 600;
        font-size: 0.875rem;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
      }
      .primary-btn:hover:not(:disabled) {
        background: #1e40af;
      }
      .primary-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .ghost-btn {
        background: #ecfeff;
        border: 1px solid #0891b2;
        color: #0e7490;
        border-radius: 8px;
        padding: 0.5rem 1rem;
        font-weight: 600;
        font-size: 0.85rem;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
      }
      .ghost-btn app-icon,
      .ghost-btn ::ng-deep app-icon {
        display: inline-flex;
        align-items: center;
        line-height: 1;
      }
      .ghost-btn:hover:not(:disabled) {
        background: #0891b2;
        color: #ffffff;
      }
      .ghost-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* ── Status update modal ───────────────────────────────────────── */
      .modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100;
      }
      .modal {
        background: #ffffff;
        border-radius: 12px;
        padding: 1.5rem;
        width: min(540px, 90vw);
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 20px 50px rgba(15, 23, 42, 0.25);
      }
      .modal h2 {
        margin: 0 0 0.5rem;
        font-size: 1.05rem;
      }
      .modal .muted {
        color: #64748b;
        font-size: 0.85rem;
        margin: 0 0 1rem;
      }
      .modal-field {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        margin-bottom: 0.875rem;
      }
      .modal-field span {
        font-size: 0.7rem;
        color: #475569;
        font-weight: 600;
        text-transform: uppercase;
      }
      .modal-field select,
      .modal-field textarea {
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        padding: 0.5rem 0.75rem;
        font-family: inherit;
        font-size: 0.9rem;
      }
      .modal-field select:focus,
      .modal-field textarea:focus {
        outline: none;
        border-color: #1d4ed8;
        box-shadow: 0 0 0 3px rgba(29, 78, 216, 0.15);
      }
      .modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
        margin-top: 0.5rem;
      }
    `,
  ],
})
export class SuperadminPqrDetailComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly supportService = inject(SupportService);
  private readonly API_URL = `${environment.apiUrl}/superadmin/support/pqrs`;

  readonly pqr = signal<any | null>(null);
  readonly loading = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly slaInfo = signal<{
    remaining: number;
    limit: number;
    status: 'ok' | 'warn' | 'overdue';
  }>({ remaining: 0, limit: 0, status: 'ok' });

  readonly publicComments = () =>
    (this.pqr()?.comments ?? []).filter((c: any) => !c.is_internal);

  // ── Action state (comments / status / assign) ─────────────────────────
  readonly newComment = signal('');
  readonly isInternal = signal(false);
  readonly commentSubmitting = signal(false);
  readonly commentError = signal<string | null>(null);

  readonly showStatusModal = signal(false);
  readonly newStatus = signal<string>('OPEN');
  readonly statusChangeReason = signal('');
  readonly statusSubmitting = signal(false);
  readonly statusError = signal<string | null>(null);

  readonly assignSubmitting = signal(false);

  readonly statusOptions: { value: string; label: string }[] = [
    { value: 'OPEN', label: 'Abierto' },
    { value: 'IN_PROGRESS', label: 'En progreso' },
    { value: 'WAITING_RESPONSE', label: 'Esperando respuesta' },
    { value: 'RESOLVED', label: 'Resuelto' },
    { value: 'CLOSED', label: 'Cerrado' },
    { value: 'REOPENED', label: 'Reabierto' },
  ];

  constructor() {
    // Watch the route id and refetch on change.
    effect(() => {
      const id = Number(this.route.snapshot.paramMap.get('id'));
      if (id) this.fetch(id);
    });
  }

  typeLabel(type: string): string {
    switch (type) {
      case 'PETITION':
        return 'Petición';
      case 'COMPLAINT':
        return 'Queja';
      case 'CLAIM':
        return 'Reclamo';
      default:
        return type;
    }
  }

  /**
   * Returns the user-facing Spanish label for a PQR status enum value.
   * Centralizing this avoids the inline `({...})[status]` pattern in
   * templates — Angular templates can't parse `as Record<string, string>`
   * (TS-only syntax) and the literal would need `as any`, which loses
   * type safety. A method is the idiomatic alternative.
   */
  statusLabel(status: string): string {
    switch (status) {
      case 'NEW':
        return 'Nuevo';
      case 'OPEN':
        return 'Abierto';
      case 'IN_PROGRESS':
        return 'En progreso';
      case 'WAITING_RESPONSE':
        return 'Esperando';
      case 'RESOLVED':
        return 'Resuelto';
      case 'CLOSED':
        return 'Cerrado';
      case 'REOPENED':
        return 'Reabierto';
      default:
        return status;
    }
  }

  private fetch(id: number) {
    this.loading.set(true);
    this.errorMsg.set(null);
    this.http
      .get<any>(`${this.API_URL}/${id}`)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((err) => {
          this.errorMsg.set(
            err?.error?.message ?? 'No se pudo cargar el PQR.',
          );
          this.loading.set(false);
          return of(null);
        }),
      )
      .subscribe((res) => {
        if (!res) return;
        this.pqr.set(res.data);
        this.slaInfo.set(this.computeSla(res.data));
        this.loading.set(false);
      });
  }

  private computeSla(pqr: any): {
    remaining: number;
    limit: number;
    status: 'ok' | 'warn' | 'overdue';
  } {
    const limit = this.slaLimitFor(pqr.category);
    const created = pqr.created_at ? new Date(pqr.created_at) : new Date();
    const elapsed = businessDaysBetween(created, new Date());
    const remaining = limit - elapsed;
    if (remaining < 0) return { remaining, limit, status: 'overdue' };
    if (remaining <= 4) return { remaining, limit, status: 'warn' };
    return { remaining, limit, status: 'ok' };
  }

  // ── Comment composer (super-admin writes here too) ─────────────────────
  canSubmitComment(): boolean {
    return (
      !this.commentSubmitting() &&
      this.newComment().trim().length >= 5 &&
      !!this.pqr()
    );
  }

  submitComment(): void {
    if (!this.canSubmitComment() || !this.pqr()) return;
    this.commentSubmitting.set(true);
    this.commentError.set(null);
    this.supportService
      .addPqrComment(
        this.pqr()!.id,
        this.newComment().trim(),
        this.isInternal(),
        !this.isInternal(), // notify requester only for public comments
      )
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((err) => {
          this.commentError.set(
            err?.error?.message ?? 'No se pudo enviar la respuesta.',
          );
          this.commentSubmitting.set(false);
          return of(null);
        }),
      )
      .subscribe(() => {
        this.commentSubmitting.set(false);
        this.newComment.set('');
        // Re-fetch to see the new comment in the timeline.
        this.fetch(this.pqr()!.id);
      });
  }

  // ── Status modal ──────────────────────────────────────────────────────
  openStatusModal(): void {
    if (!this.pqr()) return;
    this.newStatus.set('OPEN');
    this.statusChangeReason.set('');
    this.statusError.set(null);
    this.showStatusModal.set(true);
  }

  closeStatusModal(): void {
    if (this.statusSubmitting()) return;
    this.showStatusModal.set(false);
  }

  confirmStatusChange(): void {
    if (!this.pqr() || this.statusSubmitting()) return;
    this.statusSubmitting.set(true);
    this.statusError.set(null);
    this.supportService
      .updatePqrStatus(this.pqr()!.id, {
        status: this.newStatus(),
        change_reason: this.statusChangeReason().trim() || undefined,
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((err) => {
          this.statusError.set(
            err?.error?.message ?? 'No se pudo actualizar el estado.',
          );
          this.statusSubmitting.set(false);
          return of(null);
        }),
      )
      .subscribe(() => {
        this.statusSubmitting.set(false);
        this.showStatusModal.set(false);
        this.fetch(this.pqr()!.id);
      });
  }

  // ── Assign to me (super-admin self-assigns to claim ownership) ────────
  assignToMe(): void {
    if (!this.pqr() || this.assignSubmitting()) return;
    // The PqrService.assign expects a user id; for "assign to me" we
    // re-use the requester's session id (super-admin). The backend
    // resolves (req as any).user?.id — so we just call with the id from
    // the pqr's requester-context. For self-assign on the super-admin
    // side, we read it from the current session via a tiny helper that
    // mirrors the controller's req.user.id.
    const me = (this.pqr() as any)?.current_user_id ?? null;
    this.assignSubmitting.set(true);
    this.supportService
      .assignPqr(this.pqr()!.id, me)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => {
          this.assignSubmitting.set(false);
          return of(null);
        }),
      )
      .subscribe(() => {
        this.assignSubmitting.set(false);
        this.fetch(this.pqr()!.id);
      });
  }

  private slaLimitFor(type: string): number {
    switch (type) {
      case 'PETITION':
        return 15;
      case 'COMPLAINT':
      case 'CLAIM':
        return 10;
      default:
        return 15;
    }
  }
}

function businessDaysBetween(start: Date, end: Date): number {
  let count = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}