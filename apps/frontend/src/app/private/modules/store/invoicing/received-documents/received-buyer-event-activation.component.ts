import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin, startWith, Subscription, finalize } from 'rxjs';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { IconComponent, ModalComponent, ToastService } from '../../../../../shared/components/index';
import { describeApiFailure } from '../utils/invoicing-errors.util';
import type { ReceivedDocumentsScope } from './received-documents.interface';
import { ReceivedBuyerEventActivationService } from './received-buyer-event-activation.service';
import type { BuyerEventActivationSnapshot, BuyerEventActivationStatusView, BuyerEventOptionsView, ReceivedBuyerEventCode } from './received-buyer-event-activation.interface';

const CODES: ReceivedBuyerEventCode[] = ['030', '031', '032', '033'];
const CODE_LABELS: Record<ReceivedBuyerEventCode, string> = { '030': 'Acuse de recibo de factura', '031': 'Reclamo de la factura', '032': 'Recibo del bien o servicio', '033': 'Aceptación expresa' };
const BLOCKERS: Record<string, string> = {
  not_configured: 'No hay una solicitud de activación.', not_verified: 'La solicitud aún está pendiente de verificación por el equipo de Vendix.', suspended: 'La activación está suspendida.', event_code_not_approved: 'Este código no está incluido en la aprobación.', configuration_missing: 'Falta la configuración DIAN asociada.', configuration_type_invalid: 'La configuración DIAN no corresponde a facturación.', operation_mode_invalid: 'La configuración no usa software propio.', environment_invalid: 'La configuración no está en ambiente de producción.', dian_not_enabled: 'La configuración aún no está habilitada por la DIAN.', software_id_mismatch: 'El identificador de software cambió desde la verificación.', certificate_fingerprint_mismatch: 'El certificado cambió desde la verificación.', certificate_missing: 'Falta el certificado DIAN.', credentials_missing: 'Faltan credenciales del certificado.', certificate_expired: 'El certificado DIAN está vencido.', accounting_entity_missing: 'La entidad fiscal ya no está activa.', nit_mismatch: 'El NIT de la configuración no coincide con la entidad fiscal.', evidence_missing: 'Falta evidencia válida de la verificación.', evidence_type_invalid: 'El tipo de evidencia no es válido.', verification_source_invalid: 'La fuente de verificación no es válida.', verification_incomplete: 'La verificación está incompleta.',
};
type ActivationForm = FormGroup<{ dian_configuration_id: FormControl<number | null>; evidence_id: FormControl<number | null>; event_codes: FormControl<ReceivedBuyerEventCode[]> }>;

@Component({
  selector: 'app-received-buyer-event-activation',
  standalone: true,
  imports: [IconComponent, ModalComponent, ReactiveFormsModule, RouterLink],
  templateUrl: './received-buyer-event-activation.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReceivedBuyerEventActivationComponent {
  readonly scope = input.required<ReceivedDocumentsScope>();
  readonly selectedStoreId = input<number | null>(null);
  readonly scopeReady = input(true);
  readonly eventCodes = CODES;
  private readonly api = inject(ReceivedBuyerEventActivationService);
  private readonly auth = inject(AuthFacade);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  readonly status = signal<BuyerEventActivationStatusView | null>(null);
  readonly codeStates = signal<BuyerEventActivationSnapshot['readiness']>([]);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly open = signal(false);
  readonly options = signal<BuyerEventOptionsView | null>(null);
  readonly selectedEvidence = signal<BuyerEventOptionsView['evidence'][number] | null>(null);
  readonly optionsLoading = signal(false);
  readonly optionsError = signal<string | null>(null);
  readonly page = signal(1);
  readonly submitLoading = signal(false);
  readonly submitError = signal<string | null>(null);
  readonly conflict = signal(false);
  readonly configurationsTruncated = computed(() => this.options()?.configurations_truncated ?? false);
  readonly canConfigure = computed(() => this.auth.hasPermission(`${this.scope() === 'store' ? 'invoicing' : 'organization:invoicing'}:received:events:configure`));
  readonly approvedCodes = computed(() => CODES.filter((code) => this.status()?.event_codes.includes(code) ?? false));
  readonly readyCodes = computed(() => this.approvedCodes().filter((code) => this.codeStates().some((item) => item.code === code && item.readiness.ready)).length);
  readonly stateLabel = computed(() => ({ not_started: 'Sin solicitud', testing: 'En revisión', verified: 'Verificada', suspended: 'Suspendida' }[this.status()?.status ?? 'not_started']));
  readonly form: ActivationForm = new FormGroup({
    dian_configuration_id: new FormControl<number | null>(null, Validators.required),
    evidence_id: new FormControl<number | null>(null, Validators.required),
    event_codes: new FormControl<ReceivedBuyerEventCode[]>([], { nonNullable: true, validators: [Validators.required] }),
  });
  private readonly formStatus = toSignal(this.form.statusChanges.pipe(startWith(this.form.status)), { initialValue: this.form.status });
  readonly canSubmit = computed(() => this.formStatus() === 'VALID' && !this.submitLoading() && !this.conflict() && !this.optionsLoading() && this.hasSelectedValidOptions());
  private statusRequest?: Subscription;
  private optionsRequest?: Subscription;
  private submitRequest?: Subscription;
  private contextKey = '';
  private generation = 0;
  readonly canCloseModal = (): boolean => !this.submitLoading();

  constructor() {
    effect(() => {
      const scope = this.scope(); const storeId = this.selectedStoreId(); const ready = this.scopeReady();
      const key = `${scope}:${storeId ?? ''}:${ready}`;
      if (key === this.contextKey) return;
      this.contextKey = key;
      untracked(() => this.resetForContext(ready ? scope : null, storeId));
    });
  }

  openRequest(): void {
    if (!this.canConfigure() || !this.scopeReady() || !this.status()) return;
    this.open.set(true); this.loadOptions(1);
  }
  onModalChange(isOpen: boolean): void {
    if (!isOpen && this.submitLoading()) { this.open.set(true); return; }
    this.open.set(isOpen);
    if (!isOpen) this.resetModal();
  }
  toggleCode(code: ReceivedBuyerEventCode, checked: boolean): void {
    const selected = this.form.controls.event_codes.value.filter((value) => value !== code);
    this.form.controls.event_codes.setValue(checked ? [...selected, code] : selected);
    this.form.controls.event_codes.markAsTouched();
  }
  isCodeSelected(code: ReceivedBuyerEventCode): boolean { return this.form.controls.event_codes.value.includes(code); }
  selectEvidence(evidence: BuyerEventOptionsView['evidence'][number]): void {
    if (!evidence.has_artifact) return;
    this.selectedEvidence.set(evidence);
    this.form.controls.evidence_id.setValue(evidence.id);
  }
  onCodeChange(code: ReceivedBuyerEventCode, event: Event): void { this.toggleCode(code, (event.target as HTMLInputElement).checked); }
  loadOptions(page: number): void {
    if (!this.scopeReady()) return;
    this.optionsRequest?.unsubscribe();
    const generation = this.generation;
    this.optionsLoading.set(true); this.optionsError.set(null); this.page.set(page);
    this.optionsRequest = this.api.getOptions(this.scope(), this.apiStoreId(), page).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => { if (generation === this.generation) this.optionsLoading.set(false); })).subscribe({
      next: (response) => { if (generation === this.generation) this.options.set(response.data); },
      error: (error: unknown) => { if (generation === this.generation) { this.options.set(null); this.optionsError.set(describeApiFailure(error).message || 'No se pudieron cargar las opciones.'); } },
    });
  }
  submit(): void {
    if (!this.canSubmit() || !this.status()) return;
    const raw = this.form.getRawValue();
    if (raw.dian_configuration_id === null || raw.evidence_id === null) return;
    this.submitRequest?.unsubscribe();
    const generation = this.generation;
    this.submitLoading.set(true); this.submitError.set(null); this.conflict.set(false);
    this.submitRequest = this.api.request(this.scope(), this.apiStoreId(), { expected_version: this.status()!.version, dian_configuration_id: raw.dian_configuration_id, evidence_id: raw.evidence_id, event_codes: raw.event_codes }).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => { if (generation === this.generation) this.submitLoading.set(false); })).subscribe({
      next: () => { if (generation !== this.generation) return; this.toast.success('Solicitud enviada para revisión. Esto no implica aprobación de la DIAN ni transmite eventos legales.'); this.resetModal(); this.open.set(false); this.loadStatus(); },
      error: (error: unknown) => {
        if (generation !== this.generation) return;
        if (this.statusCode(error) === 409) { this.conflict.set(true); this.submitError.set('El estado cambió en el servidor. Recarga el estado antes de continuar.'); return; }
        this.submitError.set(describeApiFailure(error).message || 'No se pudo enviar la solicitud.');
      },
    });
  }
  reloadStatus(): void {
    const wasConflict = this.conflict();
    this.submitError.set(null);
    if (wasConflict) { this.resetModal(); this.open.set(false); }
    this.loadStatus();
  }
  pageCount(): number { const data = this.options(); return data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1; }
  statusMessage(): string {
    if (!this.scopeReady()) return 'Selecciona una tienda fiscal para consultar la habilitación.';
    if (!this.status()) return 'No se pudo cargar el estado.';
    const approvedCount = this.approvedCodes().length;
    if (this.status()?.status === 'verified' && approvedCount === 0) return 'La solicitud está verificada, pero no hay códigos aprobados.';
    if (this.status()?.status === 'verified' && this.readyCodes() === approvedCount) return `${this.readyCodes()} de ${approvedCount} códigos aprobados están listos según la validación actual.`;
    if (this.status()?.status === 'verified' && this.readyCodes() > 0) return `${this.readyCodes()} de ${approvedCount} códigos aprobados están listos; verifica los bloqueos de cada código.`;
    if (this.status()?.status === 'verified') return 'La activación fue verificada, pero ningún código está listo actualmente.';
    return 'Los eventos permanecen bloqueados hasta completar la revisión y validar cada código.';
  }
  blockers(code: ReceivedBuyerEventCode): string[] {
    const row = this.codeStates().find((item) => item.code === code);
    return (row?.readiness.blockers ?? []).map((key) => BLOCKERS[key] ?? 'Hay un requisito pendiente de validar.');
  }
  codeLabel(code: ReceivedBuyerEventCode): string { return CODE_LABELS[code]; }
  configWarning(config: BuyerEventOptionsView['dian_configurations'][number]): string | null {
    if (config.environment !== 'production') return 'Ambiente de pruebas: la activación no quedará lista para producción.';
    if (config.enablement_status !== 'enabled' || !config.has_certificate || !config.has_software_id) return 'Esta configuración no cumple todos los requisitos conocidos para producción.';
    return null;
  }
  evidenceLabel(type: string): string { return ({ test_set: 'Set de pruebas', dian_response: 'Respuesta DIAN', manual_support: 'Soporte manual', approval_record: 'Registro de aprobación' }[type] ?? 'Otra evidencia'); }
  hasUsableEvidence(options: BuyerEventOptionsView): boolean { return options.evidence.some((item) => item.has_artifact); }
  evidenceSelected(id: number): boolean { return this.form.controls.evidence_id.value === id; }
  isApproved(code: ReceivedBuyerEventCode): boolean { return this.approvedCodes().includes(code); }
  formatDate(date: string | null): string { return date ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' }).format(new Date(date)) : 'Fecha no disponible'; }
  private resetForContext(scope: ReceivedDocumentsScope | null, storeId: number | null): void {
    this.generation++; this.statusRequest?.unsubscribe(); this.optionsRequest?.unsubscribe(); this.submitRequest?.unsubscribe();
    this.status.set(null); this.codeStates.set([]); this.loading.set(false); this.loadError.set(null); this.options.set(null); this.selectedEvidence.set(null); this.optionsLoading.set(false); this.optionsError.set(null); this.open.set(false); this.submitLoading.set(false); this.submitError.set(null); this.conflict.set(false); this.resetForm();
    if (scope && this.scopeReady()) this.loadStatus(scope, storeId ?? undefined);
  }
  private loadStatus(scope = this.scope(), storeId = this.apiStoreId()): void {
    if (!this.scopeReady()) return;
    this.statusRequest?.unsubscribe();
    const generation = this.generation;
    this.loading.set(true); this.loadError.set(null);
    const requests = [this.api.getStatus(scope, storeId), ...CODES.map((code) => this.api.getReadiness(scope, code, storeId))];
    this.statusRequest = forkJoin(requests).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => { if (generation === this.generation) this.loading.set(false); })).subscribe({
      next: (responses) => {
        if (generation !== this.generation) return;
        const statusResponse = responses[0];
        if (!statusResponse) return;
        this.status.set(statusResponse.data as BuyerEventActivationStatusView);
        this.codeStates.set(CODES.map((code, index) => ({ code, readiness: responses[index + 1]!.data as BuyerEventActivationSnapshot['readiness'][number]['readiness'] })));
        this.conflict.set(false);
      },
      error: (error: unknown) => { if (generation === this.generation) { this.status.set(null); this.codeStates.set([]); this.loadError.set(describeApiFailure(error).message || 'No se pudo consultar la activación.'); } },
    });
  }
  private resetForm(): void { this.form.reset({ dian_configuration_id: null, evidence_id: null, event_codes: [] }); this.form.markAsPristine(); this.form.markAsUntouched(); }
  private resetModal(): void { this.optionsRequest?.unsubscribe(); this.options.set(null); this.selectedEvidence.set(null); this.optionsError.set(null); this.optionsLoading.set(false); this.submitError.set(null); this.conflict.set(false); this.page.set(1); this.resetForm(); }
  private apiStoreId(): number | undefined { return this.scope() === 'organization' ? this.selectedStoreId() ?? undefined : undefined; }
  private hasSelectedValidOptions(): boolean {
    const options = this.options(); const raw = this.form.getRawValue();
    return !!options && options.dian_configurations.some((config) => config.id === raw.dian_configuration_id) && this.selectedEvidence()?.id === raw.evidence_id && this.selectedEvidence()?.has_artifact === true && raw.event_codes.length > 0;
  }
  private statusCode(error: unknown): number { return typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status?: unknown }).status) : 0; }
}
