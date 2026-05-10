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
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  AlertBannerComponent,
  ButtonComponent,
  IconComponent,
  ModalComponent,
  SpinnerComponent,
  TextareaComponent,
} from '../../../../../../shared/components';
import {
  FiscalScopeApplyResult,
  FiscalScopeBlocker,
  FiscalScopePreview,
  FiscalScopeValue,
  OperatingScopeValue,
  FiscalScopeWizardService,
} from '../services/fiscal-scope.service';

type WizardStep = 1 | 2 | 3 | 4;
const FORCE_REASON_MIN_LENGTH = 10;

@Component({
  selector: 'app-change-fiscal-scope-wizard',
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
  templateUrl: './change-fiscal-scope-wizard.component.html',
  styleUrl: './change-fiscal-scope-wizard.component.scss',
})
export class ChangeFiscalScopeWizardComponent {
  private readonly service = inject(FiscalScopeWizardService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly currentScope = input.required<FiscalScopeValue>();
  readonly targetScope = input.required<FiscalScopeValue>();
  readonly operatingScope = input.required<OperatingScopeValue>();
  readonly applied = output<FiscalScopeApplyResult>();

  readonly step = signal<WizardStep>(1);
  readonly reason = signal('');
  readonly forceReason = signal('');
  readonly understandsConsequences = signal(false);
  readonly previewLoading = signal(false);
  readonly previewError = signal<string | null>(null);
  readonly preview = signal<FiscalScopePreview | null>(null);
  readonly applyLoading = signal(false);
  readonly applyError = signal<string | null>(null);
  readonly applyResult = signal<FiscalScopeApplyResult | null>(null);

  readonly stepDots = [1, 2, 3, 4] as const;
  readonly directionLabel = computed(
    () => `${this.scopeLabel(this.currentScope())} -> ${this.scopeLabel(this.targetScope())}`,
  );
  readonly canApply = computed(() => {
    const p = this.preview();
    return !!p && p.can_apply && p.blockers.length === 0;
  });
  readonly canShowForceOption = computed(() => {
    const p = this.preview();
    if (!p || p.direction !== 'DOWN' || p.blockers.length === 0) return false;
    return !p.blockers.some(
      (b) => b.code === 'FISCAL_SCOPE_INVALID_COMBINATION',
    );
  });
  readonly canForceApply = computed(
    () =>
      this.understandsConsequences() &&
      this.forceReason().trim().length >= FORCE_REASON_MIN_LENGTH,
  );
  readonly forceReasonRemaining = computed(() =>
    Math.max(0, FORCE_REASON_MIN_LENGTH - this.forceReason().trim().length),
  );

  scopeLabel(value: FiscalScopeValue): string {
    return value === 'ORGANIZATION'
      ? 'Fiscal consolidado'
      : 'Fiscal por tienda';
  }

  operatingLabel(value: OperatingScopeValue): string {
    return value === 'ORGANIZATION'
      ? 'Operación consolidada'
      : 'Operación por tienda';
  }

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

  applyChange(): void {
    if (!this.canApply()) return;
    this.runApply(false);
  }

  goToForceConfirm(): void {
    if (!this.canShowForceOption()) return;
    this.applyError.set(null);
    this.understandsConsequences.set(false);
    this.forceReason.set('');
    this.step.set(3);
  }

  forceApplyChange(): void {
    if (!this.canForceApply()) return;
    this.runApply(true);
  }

  goBackToStep1(): void {
    this.step.set(1);
    this.previewError.set(null);
  }

  goBackToPreview(): void {
    this.applyError.set(null);
    this.step.set(2);
  }

  blockerCount(b: FiscalScopeBlocker): number | null {
    const count = b.details?.['count'];
    return typeof count === 'number' && Number.isFinite(count) ? count : null;
  }

  blockerRemediationLink(b: FiscalScopeBlocker): string | null {
    const link = b.details?.['remediation_link'];
    return typeof link === 'string' && link.trim() ? link : null;
  }

  blockerTitle(b: FiscalScopeBlocker): string {
    switch (b.code) {
      case 'FISCAL_SCOPE_INVALID_COMBINATION':
        return 'Combinación fiscal inválida';
      case 'FISCAL_SCOPE_PENDING_INVOICES':
        return 'Facturas DIAN pendientes';
      case 'FISCAL_SCOPE_PENDING_DIAN_RESPONSE':
        return 'Respuestas DIAN pendientes';
      case 'FISCAL_SCOPE_OPEN_PERIODS':
        return 'Periodos fiscales abiertos';
      case 'FISCAL_SCOPE_NO_ACTIVE_STORES':
        return 'Sin tiendas activas';
      case 'FISCAL_SCOPE_MISSING_DIAN_CONFIG':
        return 'Configuración DIAN faltante';
      case 'FISCAL_SCOPE_MISSING_TAX_ID':
        return 'NIT faltante';
      case 'FISCAL_SCOPE_OPEN_INTERCOMPANY':
        return 'Intercompany abierto';
      default:
        return b.code;
    }
  }

  private runApply(force: boolean): void {
    this.applyLoading.set(true);
    this.applyError.set(null);
    this.applyResult.set(null);

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
          const blockers = this.extractBlockers(err);
          if (err?.status === 409 && blockers.length > 0) {
            const refreshed = this.preview()
              ? {
                  ...this.preview()!,
                  blockers,
                  can_apply: false,
                }
              : null;
            if (refreshed) this.preview.set(refreshed);
            this.step.set(2);
          }
        },
      });
  }

  private businessMessageFor(err: HttpErrorResponse): string {
    const status = err?.status;
    const payload: any = err?.error;
    if (status === 0 || status === undefined) {
      return 'No se pudo conectar con el servidor.';
    }
    if (status === 401 || status === 403) {
      return 'No tienes permisos para cambiar el modo fiscal.';
    }
    const blockers = this.extractBlockers(err);
    if (status === 409 && blockers.length > 0) {
      return `No se pudo aplicar el cambio: ${blockers
        .map((b: any) => b.message || b.code)
        .filter(Boolean)
        .join(' · ')}`;
    }
    const msg = payload?.message;
    if (Array.isArray(msg)) return msg.filter(Boolean).join('. ');
    if (typeof msg === 'string' && msg.trim()) return msg;
    return 'No se pudo aplicar el cambio fiscal.';
  }

  private extractBlockers(err: HttpErrorResponse): FiscalScopeBlocker[] {
    const payload: any = err?.error;
    const blockers =
      payload?.blockers ??
      payload?.message?.blockers ??
      payload?.details?.blockers;
    return Array.isArray(blockers) ? blockers : [];
  }
}
