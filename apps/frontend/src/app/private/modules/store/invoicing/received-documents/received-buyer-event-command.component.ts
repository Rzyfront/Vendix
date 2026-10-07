import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize, startWith, Subscription } from 'rxjs';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { ModalComponent, ToastService } from '../../../../../shared/components/index';
import { describeApiFailure } from '../utils/invoicing-errors.util';
import type { ReceivedDocument, ReceivedDocumentsScope } from './received-documents.interface';
import { ReceivedBuyerEventActivationService } from './received-buyer-event-activation.service';
import { ReceivedBuyerEventCommandService } from './received-buyer-event-command.service';
import type { BuyerClaimConcept, BuyerCommandCode, BuyerEventCommandResult } from './received-buyer-event-command.interface';

const CODES: BuyerCommandCode[] = ['030', '031', '032', '033'];
const LABELS: Record<BuyerCommandCode, string> = { '030': 'Emitir acuse de recibo de factura', '031': 'Presentar reclamo de la factura', '032': 'Emitir recibo del bien o servicio', '033': 'Emitir aceptación expresa' };
const CLAIMS: Record<BuyerClaimConcept, string> = { '01': 'Documento con inconsistencias', '02': 'Mercancía no entregada totalmente', '03': 'Mercancía no entregada parcialmente', '04': 'Servicio no prestado' };
const BLOCKERS: Record<string, string> = { not_configured: 'No hay una solicitud de activación.', not_verified: 'La solicitud aún no está verificada.', suspended: 'La activación está suspendida.', event_code_not_approved: 'Este código no está aprobado.', configuration_missing: 'Falta la configuración DIAN asociada.', configuration_type_invalid: 'La configuración DIAN no corresponde a facturación.', operation_mode_invalid: 'La configuración no usa software propio.', environment_invalid: 'La configuración no está en producción.', dian_not_enabled: 'La configuración aún no está habilitada por la DIAN.', certificate_missing: 'Falta el certificado DIAN.', credentials_missing: 'Faltan credenciales del certificado.', certificate_expired: 'El certificado DIAN está vencido.', accounting_entity_missing: 'La entidad fiscal ya no está activa.', nit_mismatch: 'El NIT no coincide con la entidad fiscal.', evidence_missing: 'Falta evidencia de verificación.' };

@Component({
  selector: 'app-received-buyer-event-command', standalone: true,
  imports: [ModalComponent, ReactiveFormsModule, RouterLink], changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './received-buyer-event-command.component.html',
})
export class ReceivedBuyerEventCommandComponent {
  readonly document = input.required<ReceivedDocument>();
  readonly scope = input.required<ReceivedDocumentsScope>();
  readonly storeId = input<number | null>(null);
  readonly changed = output<void>();
  private readonly activation = inject(ReceivedBuyerEventActivationService);
  private readonly api = inject(ReceivedBuyerEventCommandService);
  private readonly auth = inject(AuthFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  readonly codes = CODES;
  readonly labels = LABELS;
  readonly selectedTitle = computed(() => { const code = this.selected(); return code ? LABELS[code] : 'Evento del adquirente'; });
  readonly claims = CLAIMS;
  readonly claimCodes: BuyerClaimConcept[] = ['01', '02', '03', '04'];
  readonly open = signal(false);
  readonly selected = signal<BuyerCommandCode | null>(null);
  readonly readiness = signal<{ ready: boolean; blockers: string[] } | null>(null);
  readonly checking = signal(false);
  readonly pending = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<BuyerEventCommandResult | null>(null);
  readonly uncertain = signal(false);
  readonly key = signal<string | null>(null);
  readonly uncertainCode = signal<BuyerCommandCode | null>(null);
  readonly permission = computed(() => this.auth.hasPermission(`${this.scope() === 'store' ? 'invoicing' : 'organization:invoicing'}:received:events:emit`));
  readonly listQueryParams = computed(() => this.scope() === 'organization' && this.storeId() ? { store_id: this.storeId() } : undefined);
  readonly form = new FormGroup({ concept: new FormControl<BuyerClaimConcept | ''>('', Validators.required), reason: new FormControl('', [Validators.required, Validators.maxLength(500), (control) => typeof control.value === 'string' && control.value.trim().length > 0 ? null : { required: true }]) });
  readonly formStatus = toSignal(this.form.statusChanges.pipe(startWith(this.form.status)), { initialValue: this.form.status });
  readonly canEmit = computed(() => this.permission() && !this.pending() && !this.checking() && !!this.readiness()?.ready && (!this.uncertain() || !!this.key()) && (this.selected() !== '031' || this.formStatus() === 'VALID'));
  readonly globallyLocked = computed(() => !!this.uncertainCode() || (this.document().events ?? []).some((event) => event.event_type === 'BUYER_DIAN_EVENT' && ['preparing', 'prepared', 'sending', 'unknown'].includes(event.status)));
  readonly canClose = (): boolean => !this.pending();
  private request?: Subscription;
  private readinessRequest?: Subscription;

  openFor(code: BuyerCommandCode): void {
    if (!this.permission() || (this.globallyLocked() && (this.uncertainCode() !== code || this.hasServerPendingEvent()))) return;
    if (this.isAccepted(code)) return;
    const retryingUncertain = this.uncertainCode() === code;
    this.selected.set(code); this.error.set(null); this.result.set(null); this.uncertain.set(retryingUncertain); if (!retryingUncertain) this.key.set(this.createKey());
    this.form.reset({ concept: '', reason: '' });
    this.open.set(true); this.checking.set(true); this.readiness.set(null);
    this.readinessRequest?.unsubscribe();
    this.readinessRequest = this.activation.getReadiness(this.scope(), code, this.storeId() ?? undefined).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.checking.set(false))).subscribe({
      next: (response) => this.readiness.set(response.data),
      error: (error: unknown) => this.error.set(describeApiFailure(error).message || 'No se pudo verificar la habilitación actual.'),
    });
  }
  emit(): void {
    const code = this.selected(); const idempotencyKey = this.key();
    if (!code || !idempotencyKey || !this.canEmit()) return;
    this.pending.set(true); this.error.set(null); this.uncertain.set(false);
    const input = { event_code: code, idempotency_key: idempotencyKey, ...(code === '031' ? { claim_concept_code: this.form.controls.concept.value as BuyerClaimConcept, description: (this.form.controls.reason.value ?? '').trim() } : {}) };
    this.request?.unsubscribe();
    this.request = this.api.emit(this.scope(), this.document().id, input, this.storeId() ?? undefined).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.pending.set(false))).subscribe({
      next: ({ data }) => {
        this.result.set(data);
        if (['accepted', 'rejected', 'unknown'].includes(data.status)) {
          const msg = data.status === 'accepted' ? 'Evento aceptado por la DIAN.' : data.status === 'rejected' ? 'La DIAN rechazó el evento.' : 'El resultado del envío es desconocido; consulta el historial antes de tomar otra acción.';
          this.toast[data.status === 'accepted' ? 'success' : 'error'](msg);
          this.changed.emit();
        }
        if (data.status === 'unknown') { this.uncertain.set(true); this.uncertainCode.set(code); this.error.set('No se confirmó el resultado. Consulta el historial antes de reintentar; si lo haces, se usará la misma clave.'); }
        else {
          this.uncertainCode.set(null); this.key.set(null);
          if (data.status === 'preparation_failed') {
            this.error.set('El evento no pudo prepararse y no fue transmitido a la DIAN.');
            this.toast.error('El evento no fue transmitido.');
            this.changed.emit();
          }
        }
      },
      error: (error: unknown) => { this.uncertain.set(true); this.uncertainCode.set(code); this.error.set(`No se pudo confirmar la respuesta. No se creará otra solicitud automáticamente. Si reintentas, se usará la misma clave. ${describeApiFailure(error).message || ''}`.trim()); },
    });
  }
  blockers(): string[] { return (this.readiness()?.blockers ?? []).map((b) => BLOCKERS[b] ?? 'Hay un requisito pendiente de validar.'); }
  codeDisabled(code: BuyerCommandCode): boolean { return this.globallyLocked() && (this.uncertainCode() !== code || this.hasServerPendingEvent()); }
  isAccepted(code: BuyerCommandCode): boolean { return (this.document().events ?? []).some((event) => event.event_type === 'BUYER_DIAN_EVENT' && event.event_code === code && event.status === 'accepted'); }
  private hasServerPendingEvent(): boolean { return (this.document().events ?? []).some((event) => event.event_type === 'BUYER_DIAN_EVENT' && ['preparing', 'prepared', 'sending', 'unknown'].includes(event.status)); }
  onClose(value: boolean): void { if (!value && !this.pending()) { this.open.set(false); this.selected.set(null); if (!this.uncertainCode()) this.key.set(null); this.result.set(null); this.error.set(null); this.uncertain.set(!!this.uncertainCode()); } }
  private createKey(): string { return `buyer-event-${this.document().id}-${crypto.randomUUID()}`; }
}
