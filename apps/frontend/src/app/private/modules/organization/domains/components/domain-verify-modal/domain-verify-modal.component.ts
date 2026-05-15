// fix(domains): edge host must come from backend (getDnsInstructions.target),
// not be hardcoded. Parent must pass `edgeHost` from the DNS instructions
// response so this modal stays env-agnostic (vendix.online / vendix.com / dev).
import {
  Component,
  OnChanges,
  SimpleChanges,
  input,
  output,
  signal,
} from '@angular/core';

import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

import {
  Domain,
  VerifyDomainResult,
  DomainOwnership,
  DnsInstructions,
} from '../../interfaces/domain.interface';

@Component({
  selector: 'app-domain-verify-modal',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Verificar Dominio"
      [subtitle]="domain()?.hostname || ''"
    >
      <div class="space-y-6">
        <!-- Instructions Section -->
        @if (!verificationResult()) {
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div class="flex items-start gap-3">
              <app-icon
                name="info"
                [size]="20"
                class="text-blue-600 mt-0.5"
              ></app-icon>
              <div>
                <h4 class="font-medium text-blue-900 mb-2">
                  Instrucciones de Configuración DNS
                </h4>
                <p class="text-sm text-blue-800 mb-3">
                  Para verificar tu dominio, necesitas agregar los siguientes
                  registros DNS en tu proveedor de dominios:
                </p>
              </div>
            </div>
          </div>
        }

        <!-- DNS Records -->
        @if (!verificationResult()) {
          <div class="space-y-4">
            <div
              class="rounded-lg border p-4"
              [class.border-green-200]="isOwnershipStepComplete"
              [class.bg-green-50]="isOwnershipStepComplete"
              [class.border-yellow-200]="!isOwnershipStepComplete"
              [class.bg-yellow-50]="!isOwnershipStepComplete"
            >
              <button
                type="button"
                class="flex w-full items-center justify-between gap-3 text-left"
                (click)="ownershipExpanded.set(!ownershipExpanded())"
              >
                <span>
                  <span
                    class="font-medium"
                    [class.text-green-900]="isOwnershipStepComplete"
                    [class.text-yellow-900]="!isOwnershipStepComplete"
                  >
                    Verificación Vendix
                  </span>
                  <span
                    class="block text-sm"
                    [class.text-green-700]="isOwnershipStepComplete"
                    [class.text-yellow-700]="!isOwnershipStepComplete"
                  >
                    @if (isInheritedDomain) {
                      Cubierto por {{ coveredByParentHostname }}.
                    } @else if (isOwnershipStepComplete) {
                      La propiedad del dominio ya fue verificada.
                    } @else {
                      Agrega el TXT de propiedad en tu proveedor DNS.
                    }
                  </span>
                </span>
                <span class="flex items-center gap-2">
                  <span
                    class="rounded-full px-2 py-0.5 text-xs font-semibold"
                    [class.bg-green-100]="isOwnershipStepComplete"
                    [class.text-green-700]="isOwnershipStepComplete"
                    [class.bg-yellow-100]="!isOwnershipStepComplete"
                    [class.text-yellow-700]="!isOwnershipStepComplete"
                  >
                    {{ statusLabel(dnsInstructions()?.ownership_status) }}
                  </span>
                  <app-icon
                    [name]="ownershipExpanded() ? 'chevron-up' : 'chevron-down'"
                    [size]="16"
                  ></app-icon>
                </span>
              </button>

              @if (ownershipExpanded() && ownershipRecords.length > 0) {
                <div class="mt-4 space-y-3">
                  @for (record of ownershipRecords; track record.record_type + record.name + record.value) {
                    <div class="grid grid-cols-1 gap-3 rounded border border-black/10 bg-white/80 p-3 md:grid-cols-2">
                      <div>
                        <label class="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                          Nombre/Host
                        </label>
                        <button type="button" class="flex w-full items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2 text-left" (click)="copyToClipboard(record.name)">
                          <code class="text-sm flex-1 truncate">{{ record.name }}</code>
                          <app-icon name="copy" [size]="14"></app-icon>
                        </button>
                      </div>
                      <div>
                        <label class="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                          Valor
                        </label>
                        <button type="button" class="flex w-full items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2 text-left" (click)="copyToClipboard(record.value)">
                          <code class="text-sm flex-1 truncate">{{ record.value }}</code>
                          <app-icon name="copy" [size]="14"></app-icon>
                        </button>
                      </div>
                    </div>
                  }
                </div>
              }
            </div>

            <div class="rounded-lg border border-sky-200 bg-sky-50 p-4">
              <div class="mb-3">
                <h5 class="font-medium text-sky-950">Certificado AWS</h5>
                <p class="text-sm text-sky-700">
                  @if (isInheritedDomain) {
                    El SSL se hereda del certificado wildcard de {{ coveredByParentHostname }}.
                  } @else if (certificateRecords.length > 0) {
                    Agrega estos CNAME de ACM para emitir y renovar SSL.
                  } @else {
                    Cuando AWS genere los CNAME del certificado aparecerán aquí.
                  }
                </p>
              </div>
              @for (record of certificateRecords; track record.record_type + record.name + record.value) {
                <div class="mb-3 grid grid-cols-1 gap-3 rounded border border-sky-200 bg-white/80 p-3 last:mb-0 md:grid-cols-2">
                  <div>
                    <label class="block text-xs font-medium text-sky-700 mb-1">
                      Nombre/Host
                    </label>
                    <button type="button" class="flex w-full items-center gap-2 rounded border border-sky-200 bg-sky-100 px-3 py-2 text-left" (click)="copyToClipboard(record.name)">
                      <code class="text-sm flex-1 truncate">{{ record.name }}</code>
                      <app-icon name="copy" [size]="14"></app-icon>
                    </button>
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-sky-700 mb-1">
                      Valor/Destino
                    </label>
                    <button type="button" class="flex w-full items-center gap-2 rounded border border-sky-200 bg-sky-100 px-3 py-2 text-left" (click)="copyToClipboard(record.value)">
                      <code class="text-sm flex-1 truncate">{{ record.value }}</code>
                      <app-icon name="copy" [size]="14"></app-icon>
                    </button>
                  </div>
                </div>
              }
            </div>

            <div class="rounded-lg border border-[var(--color-border)] p-4">
              <div class="mb-3">
                <h5 class="font-medium text-[var(--color-text-primary)]">
                  Enrutamiento
                </h5>
                <p class="text-sm text-[var(--color-text-secondary)]">
                  Apunta el dominio al edge de Vendix. Los dominios raíz incluyen también el wildcard.
                </p>
              </div>
              @for (record of routingRecords; track record.record_type + record.name + record.value) {
                <div class="mb-3 grid grid-cols-1 gap-3 rounded border border-[var(--color-border)] bg-[var(--color-muted)]/50 p-3 last:mb-0 md:grid-cols-2">
                  <div>
                    <label class="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                      Nombre/Host
                    </label>
                    <button type="button" class="flex w-full items-center gap-2 rounded bg-white px-3 py-2 text-left" (click)="copyToClipboard(record.name)">
                      <code class="text-sm flex-1 truncate">{{ record.name }}</code>
                      <app-icon name="copy" [size]="14"></app-icon>
                    </button>
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                      Valor/Destino
                    </label>
                    <button type="button" class="flex w-full items-center gap-2 rounded bg-white px-3 py-2 text-left" (click)="copyToClipboard(record.value)">
                      <code class="text-sm flex-1 truncate">{{ record.value }}</code>
                      <app-icon name="copy" [size]="14"></app-icon>
                    </button>
                  </div>
                </div>
              }
            </div>
          </div>
        }

        <!-- Verification Result -->
        @if (verificationResult()) {
          <div class="space-y-4">
            <!-- Status Banner -->
            <div
              [class]="
                verificationResult()?.verified
                  ? 'bg-green-50 border-green-200'
                  : 'bg-red-50 border-red-200'
              "
              class="border rounded-lg p-4"
            >
              <div class="flex items-center gap-3">
                <app-icon
                  [name]="
                    verificationResult()?.verified ? 'check-circle' : 'x-circle'
                  "
                  [size]="24"
                  [class]="
                    verificationResult()?.verified
                      ? 'text-green-600'
                      : 'text-red-600'
                  "
                ></app-icon>
                <div>
                  <h4
                    [class]="
                      verificationResult()?.verified
                        ? 'text-green-900'
                        : 'text-red-900'
                    "
                    class="font-medium"
                  >
                    {{
                      verificationResult()?.verified
                        ? 'Propiedad Verificada'
                        : 'Verificación Fallida'
                    }}
                  </h4>
                  <p
                    [class]="
                      verificationResult()?.verified
                        ? 'text-green-700'
                        : 'text-red-700'
                    "
                    class="text-sm"
                  >
                    {{
                      verificationResult()?.verified
                        ? 'Tu propiedad del dominio fue verificada. El certificado SSL queda pendiente de emisión.'
                        : 'No se pudo verificar tu dominio. Revisa la configuración DNS.'
                    }}
                  </p>
                </div>
              </div>
            </div>
            <!-- Check Results -->
            <div class="border border-[var(--color-border)] rounded-lg p-4">
              <h5 class="font-medium text-[var(--color-text-primary)] mb-3">
                Resultados de Verificación
              </h5>
              <div class="space-y-2">
                @for (check of getCheckResults(); track check) {
                  <div
                    class="flex items-center justify-between py-2 border-b border-[var(--color-border)] last:border-0"
                  >
                    <div class="flex items-center gap-2">
                      <app-icon
                        [name]="check.valid ? 'check' : 'x'"
                        [size]="16"
                        [class]="
                          check.valid ? 'text-green-600' : 'text-red-600'
                        "
                      ></app-icon>
                      <span class="text-sm text-[var(--color-text-primary)]">{{
                        check.name
                      }}</span>
                    </div>
                    @if (check.reason) {
                      <span class="text-xs text-[var(--color-text-secondary)]">
                        {{ check.reason }}
                      </span>
                    }
                  </div>
                }
              </div>
            </div>
            <!-- Suggested Fixes -->
            @if (
              verificationResult()?.suggested_fixes &&
              (verificationResult()?.suggested_fixes?.length ?? 0) > 0
            ) {
              <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <h5 class="font-medium text-yellow-900 mb-2">Sugerencias</h5>
                <ul class="list-disc list-inside space-y-1">
                  @for (
                    fix of verificationResult()?.suggested_fixes ?? [];
                    track fix
                  ) {
                    <li class="text-sm text-yellow-800">
                      {{ fix }}
                    </li>
                  }
                </ul>
              </div>
            }
          </div>
        }

        <!-- Propagation Notice -->
        @if (!verificationResult()) {
          <div
            class="text-sm text-[var(--color-text-secondary)] bg-[var(--color-muted)] rounded-lg p-3"
          >
            <strong>Nota:</strong> Los cambios de DNS pueden tardar hasta 48
            horas en propagarse. Si acabas de hacer los cambios, espera unos
            minutos antes de verificar.
          </div>
        }
      </div>

      <div slot="footer" class="flex justify-between items-center">
        @if (copiedText()) {
          <div class="text-sm text-green-600">
            <app-icon name="check" [size]="14" class="inline mr-1"></app-icon>
            Copiado al portapapeles
          </div>
        }
        @if (!copiedText()) {
          <div></div>
        }
        <div class="flex gap-3">
          <app-button variant="outline" (clicked)="onCancel()">
            {{ verificationResult() ? 'Cerrar' : 'Cancelar' }}
          </app-button>
          @if (!verificationResult() || !verificationResult()?.verified) {
            <app-button
              variant="primary"
              (clicked)="onVerify()"
              [loading]="isVerifying()"
              [disabled]="isVerifying()"
            >
              <app-icon name="refresh" [size]="16" slot="icon"></app-icon>
              {{ verificationResult() ? 'Reintentar' : 'Verificar Ahora' }}
            </app-button>
          }
        </div>
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class DomainVerifyModalComponent implements OnChanges {
  readonly isOpen = input(false);
  readonly isVerifying = input(false);
  readonly domain = input<Domain | null>(null);
  readonly verificationResult = input<VerifyDomainResult | null>(null);
  readonly dnsInstructions = input<DnsInstructions | null>(null);
  // Edge host (CloudFront target) provided by backend `getDnsInstructions().target`.
  // Required so the modal does not hardcode the platform domain.
  readonly edgeHost = input.required<string>();

  readonly isOpenChange = output<boolean>();
  readonly verify = output<string>();
  readonly cancel = output<void>();

  copiedText = signal(false);
  ownershipExpanded = signal(true);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && !this.isOpen()) {
      this.copiedText.set(false);
    }
    if (changes['domain'] || changes['dnsInstructions']) {
      this.ownershipExpanded.set(!this.isOwnershipStepComplete);
    }
  }

  get cnameHost(): string {
    const domain = this.domain();
    if (!domain) return '';

    // Extract subdomain from hostname
    const parts = domain.hostname.split('.');
    if (parts.length > 2) {
      return parts[0];
    }
    return '@';
  }

  get isCustomDomain(): boolean {
    const domain = this.domain();
    return (
      domain?.ownership === DomainOwnership.CUSTOM_DOMAIN ||
      domain?.ownership === DomainOwnership.CUSTOM_SUBDOMAIN
    );
  }

  get certificateRecords() {
    return (
      this.dnsInstructions()?.instructions.filter(
        (record) => record.purpose === 'certificate',
      ) ?? []
    );
  }

  get ownershipRecords() {
    return this.recordsFor('ownership');
  }

  get routingRecords() {
    return this.recordsFor('routing');
  }

  get isOwnershipStepComplete(): boolean {
    const dns = this.dnsInstructions();
    const domain = this.domain();
    return (
      dns?.ownership_status === 'complete' ||
      dns?.ownership_status === 'covered_by_parent' ||
      !!domain?.last_verified_at ||
      (domain?.status !== undefined && domain.status !== 'pending_ownership')
    );
  }

  get isInheritedDomain(): boolean {
    return !!(
      this.dnsInstructions()?.covered_by_parent_hostname ||
      this.domain()?.ssl_inherited_from_hostname ||
      this.domain()?.config?.ssl?.inherited_from_hostname
    );
  }

  get coveredByParentHostname(): string | null {
    return (
      this.dnsInstructions()?.covered_by_parent_hostname ||
      this.domain()?.ssl_inherited_from_hostname ||
      this.domain()?.config?.ssl?.inherited_from_hostname ||
      null
    );
  }

  statusLabel(status?: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      complete: 'Completado',
      not_required: 'No requerido',
      covered_by_parent: 'Cubierto por dominio padre',
    };
    return labels[status || ''] || status || 'Pendiente';
  }

  purposeLabel(purpose?: string): string {
    const labels: Record<string, string> = {
      ownership: 'propiedad',
      certificate: 'certificado AWS',
      routing: 'enrutamiento',
    };
    return labels[purpose || ''] || purpose || 'registro';
  }

  private recordsFor(group: 'ownership' | 'certificate' | 'routing') {
    return (
      this.dnsInstructions()?.instructions.filter(
        (record) => (record.group || record.purpose) === group,
      ) ?? []
    );
  }

  getCheckResults(): Array<{ name: string; valid: boolean; reason?: string }> {
    const result = this.verificationResult();
    if (!result?.checks) return [];

    const checkNameMap: Record<string, string> = {
      cname: 'Registro CNAME',
      a: 'Registro A',
      txt: 'Registro TXT',
      aaaa: 'Registro AAAA',
    };

    return Object.entries(result.checks).map(([key, value]) => ({
      name: checkNameMap[key] || key.toUpperCase(),
      valid: (value as any).valid,
      reason: (value as any).reason,
    }));
  }

  copyToClipboard(text: string): void {
    if (!text) return;

    navigator.clipboard.writeText(text).then(() => {
      this.copiedText.set(true);
      setTimeout(() => {
        this.copiedText.set(false);
      }, 2000);
    });
  }

  onVerify(): void {
    const domain = this.domain();
    if (domain) {
      this.verify.emit(domain.hostname);
    }
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
    this.cancel.emit();
  }

  onOpenChange(isOpen: boolean): void {
    this.isOpenChange.emit(isOpen);
  }
}
