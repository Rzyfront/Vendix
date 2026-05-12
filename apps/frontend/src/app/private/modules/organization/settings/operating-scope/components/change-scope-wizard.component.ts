import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';

import {
  AlertBannerComponent,
  ButtonComponent,
  IconComponent,
  ModalComponent,
  SpinnerComponent,
  TextareaComponent,
} from '../../../../../../shared/components';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import {
  OperatingScopeApplyResult,
  OperatingScopeBlocker,
  OperatingScopePreview,
  OperatingScopeValue,
  OperatingScopeWizardService,
} from '../services/operating-scope.service';

/**
 * Wizard steps:
 *   1 — Confirm intent (current vs target + optional reason).
 *   2 — Preview (server-authoritative blockers + warnings).
 *   3 — Force-confirm (only when downgrade has blockers and the user opts to
 *       force-apply; double confirmation + mandatory reason ≥10 chars).
 *   4 — Result (success or error after `/apply`).
 */
type WizardStep = 1 | 2 | 3 | 4;

const FORCE_REASON_MIN_LENGTH = 10;

@Component({
  selector: 'app-change-scope-wizard',
  standalone: true,
  imports: [
    AlertBannerComponent,
    ButtonComponent,
    IconComponent,
    ModalComponent,
    RouterLink,
    SpinnerComponent,
    TextareaComponent,
  ],
  templateUrl: './change-scope-wizard.component.html',
  styleUrl: './change-scope-wizard.component.scss',
})
export class ChangeScopeWizardComponent {
  private readonly service = inject(OperatingScopeWizardService);
  private readonly authFacade = inject(AuthFacade);
  private readonly destroyRef = inject(DestroyRef);

  // ---------- inputs / outputs ----------
  readonly isOpen = model<boolean>(false);
  readonly currentScope = input.required<OperatingScopeValue>();
  readonly targetScope = input.required<OperatingScopeValue>();
  readonly applied = output<OperatingScopeApplyResult>();

  // ---------- local state ----------
  readonly step = signal<WizardStep>(1);
  readonly reason = signal<string>('');
  readonly forceReason = signal<string>('');
  readonly understandsConsequences = signal<boolean>(false);

  readonly previewLoading = signal(false);
  readonly previewError = signal<string | null>(null);
  readonly preview = signal<OperatingScopePreview | null>(null);

  readonly applyLoading = signal(false);
  readonly applyError = signal<string | null>(null);
  readonly applyResult = signal<OperatingScopeApplyResult | null>(null);

  // ---------- computed ----------
  readonly directionLabel = computed(() => {
    const from = this.currentScope();
    const to = this.targetScope();
    return `${this.scopeLabel(from)} → ${this.scopeLabel(to)}`;
  });

  /** Direction reported by the preview. UP and DOWN drive different UX. */
  readonly direction = computed(() => this.preview()?.direction ?? 'NOOP');

  /** Whether the user has the underlying write permission. Frontend gate
   *  only — backend re-checks `organization:settings:operating_scope:write`
   *  on the apply endpoint. */
  readonly hasWritePermission = computed(() =>
    this.authFacade.hasPermission(
      'organization:settings:operating_scope:write',
    ),
  );

  /** Force-flow is only offered when:
   *   - direction is DOWN (server ignores `force` on UP migrations),
   *   - blockers come from the server,
   *   - none of the blockers are PARTNER_LOCKED (security rail — never
   *     bypassable),
   *   - the user has the write permission. */
  readonly canShowForceOption = computed(() => {
    const p = this.preview();
    if (!p || p.blockers.length === 0) return false;
    if (p.direction !== 'DOWN') return false;
    if (p.blockers.some((b) => b.code === 'PARTNER_LOCKED')) return false;
    return this.hasWritePermission();
  });

  /** Standard apply (no force) when preview has no blockers. */
  readonly canApply = computed(() => {
    const p = this.preview();
    return !!p && p.can_apply && p.blockers.length === 0;
  });

  /** Force-apply gate: requires double-confirmation checkbox + reason ≥10. */
  readonly canForceApply = computed(() => {
    if (!this.understandsConsequences()) return false;
    return this.forceReason().trim().length >= FORCE_REASON_MIN_LENGTH;
  });

  readonly forceReasonRemaining = computed(() => {
    const trimmed = this.forceReason().trim();
    return Math.max(0, FORCE_REASON_MIN_LENGTH - trimmed.length);
  });

  // ---------- lifecycle helpers ----------
  scopeLabel(value: OperatingScopeValue): string {
    return value === 'ORGANIZATION'
      ? 'Organización (consolidado)'
      : 'Por tienda';
  }

  /** Numeric step indicator (1..4) — kept stable so the dots in the header
   *  always render the same range. The force-confirm step replaces the
   *  numbered dot 3 visually, while step 4 is "Done". */
  readonly stepDots = [1, 2, 3, 4] as const;

  resetState(): void {
    this.step.set(1);
    this.reason.set('');
    this.forceReason.set('');
    this.understandsConsequences.set(false);
    this.previewLoading.set(false);
    this.previewError.set(null);
    this.preview.set(null);
    this.applyLoading.set(false);
    this.applyError.set(null);
    this.applyResult.set(null);
  }

  closeWizard(): void {
    this.isOpen.set(false);
    // Defer reset so the close animation finishes cleanly.
    setTimeout(() => this.resetState(), 250);
  }

  onReasonChange(value: string): void {
    this.reason.set(value || '');
  }

  onForceReasonChange(value: string): void {
    this.forceReason.set(value || '');
  }

  toggleUnderstandsConsequences(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.understandsConsequences.set(target?.checked === true);
  }

  // ---------- step 1 → step 2 ----------
  goToPreview(): void {
    this.previewLoading.set(true);
    this.previewError.set(null);
    this.preview.set(null);

    this.service
      .preview(this.targetScope(), this.reason())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (preview) => {
          this.preview.set(preview);
          this.previewLoading.set(false);
          this.step.set(2);
        },
        error: (err: HttpErrorResponse) => {
          this.previewLoading.set(false);
          this.previewError.set(this.businessMessageFor(err));
        },
      });
  }

  // ---------- step 2 → apply (no blockers) ----------
  applyChange(): void {
    if (!this.canApply()) return;
    this.runApply(false);
  }

  // ---------- step 2 → step 3 (force flow opt-in) ----------
  goToForceConfirm(): void {
    if (!this.canShowForceOption()) return;
    this.applyError.set(null);
    this.understandsConsequences.set(false);
    this.forceReason.set('');
    this.step.set(3);
  }

  // ---------- step 3 → apply (force=true) ----------
  forceApplyChange(): void {
    if (!this.canForceApply()) return;
    this.runApply(true);
  }

  // ---------- helpers ----------
  goBackToStep1(): void {
    this.step.set(1);
    this.previewError.set(null);
  }

  goBackToPreview(): void {
    this.applyError.set(null);
    this.step.set(2);
  }

  /**
   * Friendly remediation label. Falls back to the explicit count when the
   * backend exposes one in `details.count`.
   */
  blockerCount(b: OperatingScopeBlocker): number | null {
    const c = b.details?.count;
    if (typeof c === 'number' && Number.isFinite(c)) return c;
    return null;
  }

  blockerRemediationLink(b: OperatingScopeBlocker): string | null {
    const link = b.details?.remediation_link;
    return typeof link === 'string' && link.trim() ? link : null;
  }

  /**
   * Map blocker code → short human label for the wizard list. Mirrors the
   * server messages but stays explicit for translation later.
   */
  blockerTitle(b: OperatingScopeBlocker): string {
    switch (b.code) {
      case 'OPEN_POS_TO_CENTRAL':
        return 'Órdenes de compra abiertas hacia bodega central';
      case 'OPEN_PURCHASE_ORDERS':
        return 'Órdenes de compra consolidadas abiertas';
      case 'OPEN_CROSS_STORE_TRANSFERS':
        return 'Transferencias inter-tienda abiertas';
      case 'STOCK_AT_CENTRAL':
        return 'Stock en bodega central';
      case 'ACTIVE_RESERVATIONS_AT_CENTRAL':
        return 'Reservas activas en bodega central';
      case 'PARTNER_LOCKED':
        return 'Organización partner bloqueada';
      case 'NOT_ENOUGH_STORES':
        return 'Tiendas activas insuficientes';
      case 'NO_ACTIVE_STORES':
        return 'No hay tiendas activas';
      default:
        return b.code;
    }
  }

  // ---------- private ----------
  private runApply(force: boolean): void {
    this.applyLoading.set(true);
    this.applyError.set(null);
    this.applyResult.set(null);

    // Force-apply uses the dedicated forceReason; non-forced uses the
    // optional informational reason captured on step 1.
    const reasonToSend = force ? this.forceReason().trim() : this.reason();

    this.service
      .apply(this.targetScope(), reasonToSend, force)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.applyLoading.set(false);
          this.applyResult.set(result);
          this.step.set(4);
          this.applied.emit(result);
        },
        error: (err: HttpErrorResponse) => {
          this.applyLoading.set(false);
          this.applyError.set(this.businessMessageFor(err));

          // 409 with fresh blockers means the server-side state changed
          // (e.g. another user closed/created a PO). Refresh the preview
          // so the user can re-evaluate before retrying.
          if (err?.status === 409 && Array.isArray(err?.error?.blockers)) {
            const refreshed: OperatingScopePreview | null = this.preview()
              ? {
                  ...this.preview()!,
                  blockers: err.error.blockers,
                  can_apply: false,
                }
              : null;
            if (refreshed) this.preview.set(refreshed);
            this.step.set(2);
          }
        },
      });
  }

  private extractMessage(err: HttpErrorResponse, fallback: string): string {
    if (!err) return fallback;
    const payload: any = err.error;
    if (typeof payload === 'string' && payload.trim()) return payload;
    const msg = payload?.message;
    if (Array.isArray(msg)) {
      const joined = msg.filter(Boolean).map((m) => String(m)).join('. ');
      if (joined) return joined;
    }
    if (typeof msg === 'string' && msg.trim()) return msg;
    if (
      typeof payload?.error === 'string' &&
      payload.error.trim() &&
      !['Bad Request', 'Forbidden', 'Conflict', 'Internal Server Error'].includes(
        payload.error,
      )
    ) {
      return payload.error;
    }
    if (err.statusText && err.statusText !== 'OK') return err.statusText;
    return err.message || fallback;
  }

  private businessMessageFor(err: HttpErrorResponse): string {
    const status = err?.status;
    const code: string | undefined = err?.error?.error_code;

    if (status === 0 || status === undefined) {
      return 'No se pudo conectar con el servidor. Revisa tu conexión.';
    }

    // Permission denied. Frequent cause: the user is on an old token that
    // does not yet carry the operating_scope permissions seeded later.
    if (code === 'AUTH_PERM_001' || status === 401) {
      return 'No tienes permisos para esta acción. Si los permisos se actualizaron recientemente, cierra sesión y vuelve a iniciar para refrescarlos.';
    }

    if (status === 403) {
      const partnerHint =
        'Esta organización es partner de Vendix y no puede cambiar el modo operativo.';
      const msg = this.extractMessage(err, partnerHint);
      return /partner/i.test(msg) ? msg : partnerHint;
    }

    if (status === 409) {
      const blockers = err?.error?.blockers as
        | Array<{ message: string; code?: string }>
        | undefined;
      if (blockers?.length) {
        return `No se pudo aplicar el cambio: ${blockers
          .map((b) => b.message || b.code)
          .filter(Boolean)
          .join(' • ')}`;
      }
      return this.extractMessage(
        err,
        'Hay condiciones que bloquean el cambio operativo.',
      );
    }

    if (status === 400) {
      return this.extractMessage(err, 'Datos inválidos para el cambio.');
    }

    if (status >= 500) {
      return 'Error en el servidor al aplicar el cambio. Intenta de nuevo o contacta soporte.';
    }

    return this.extractMessage(err, 'No se pudo aplicar el cambio operativo.');
  }
}
