import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

import {
  Domain,
  VerifyDomainResult,
  DomainOwnership,
} from '../../interfaces/domain.interface';

@Component({
  selector: 'app-domain-verify-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="onOpenChange($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Verificar Dominio"
      [subtitle]="domain?.hostname || ''"
    >
      <div class="space-y-6">
        <!-- Instructions Section -->
        <div
          *ngIf="!verificationResult"
          class="bg-blue-50 border border-blue-200 rounded-lg p-4"
        >
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

        <!-- DNS Records -->
        <div *ngIf="!verificationResult" class="space-y-4">
          <!-- CNAME Record -->
          <div class="border border-[var(--color-border)] rounded-lg p-4">
            <div class="flex items-center justify-between mb-3">
              <h5 class="font-medium text-[var(--color-text-primary)]">
                Registro CNAME
              </h5>
              <span
                class="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded"
              >
                Recomendado
              </span>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label
                  class="block text-xs font-medium text-[var(--color-text-secondary)] mb-1"
                >
                  Nombre/Host
                </label>
                <div
                  class="flex items-center gap-2 px-3 py-2 bg-[var(--color-muted)] rounded border border-[var(--color-border)]"
                >
                  <code class="text-sm flex-1">{{ cnameHost }}</code>
                  <button
                    (click)="copyToClipboard(cnameHost)"
                    class="text-[var(--color-primary)] hover:text-[var(--color-primary-hover)]"
                    title="Copiar"
                  >
                    <app-icon name="copy" [size]="14"></app-icon>
                  </button>
                </div>
              </div>
              <div>
                <label
                  class="block text-xs font-medium text-[var(--color-text-secondary)] mb-1"
                >
                  Valor/Destino
                </label>
                <div
                  class="flex items-center gap-2 px-3 py-2 bg-[var(--color-muted)] rounded border border-[var(--color-border)]"
                >
                  <code class="text-sm flex-1">edge.vendix.com</code>
                  <button
                    (click)="copyToClipboard('edge.vendix.com')"
                    class="text-[var(--color-primary)] hover:text-[var(--color-primary-hover)]"
                    title="Copiar"
                  >
                    <app-icon name="copy" [size]="14"></app-icon>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- TXT Verification Record -->
          <div class="border border-[var(--color-border)] rounded-lg p-4">
            <div class="flex items-center justify-between mb-3">
              <h5 class="font-medium text-[var(--color-text-primary)]">
                Registro TXT (Verificación)
              </h5>
              <span
                class="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded"
              >
                Opcional
              </span>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label
                  class="block text-xs font-medium text-[var(--color-text-secondary)] mb-1"
                >
                  Nombre/Host
                </label>
                <div
                  class="flex items-center gap-2 px-3 py-2 bg-[var(--color-muted)] rounded border border-[var(--color-border)]"
                >
                  <code class="text-sm flex-1">_vendix-verify</code>
                  <button
                    (click)="copyToClipboard('_vendix-verify')"
                    class="text-[var(--color-primary)] hover:text-[var(--color-primary-hover)]"
                    title="Copiar"
                  >
                    <app-icon name="copy" [size]="14"></app-icon>
                  </button>
                </div>
              </div>
              <div>
                <label
                  class="block text-xs font-medium text-[var(--color-text-secondary)] mb-1"
                >
                  Valor
                </label>
                <div
                  class="flex items-center gap-2 px-3 py-2 bg-[var(--color-muted)] rounded border border-[var(--color-border)]"
                >
                  <code class="text-sm flex-1 truncate">{{
                    domain?.verification_token || 'Token no disponible'
                  }}</code>
                  <button
                    (click)="copyToClipboard(domain?.verification_token || '')"
                    class="text-[var(--color-primary)] hover:text-[var(--color-primary-hover)]"
                    title="Copiar"
                  >
                    <app-icon name="copy" [size]="14"></app-icon>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Verification Result -->
        <div *ngIf="verificationResult" class="space-y-4">
          <!-- Status Banner -->
          <div
            [class]="
              verificationResult.verified
                ? 'bg-green-50 border-green-200'
                : 'bg-red-50 border-red-200'
            "
            class="border rounded-lg p-4"
          >
            <div class="flex items-center gap-3">
              <app-icon
                [name]="verificationResult.verified ? 'check-circle' : 'x-circle'"
                [size]="24"
                [class]="
                  verificationResult.verified ? 'text-green-600' : 'text-red-600'
                "
              ></app-icon>
              <div>
                <h4
                  [class]="
                    verificationResult.verified
                      ? 'text-green-900'
                      : 'text-red-900'
                  "
                  class="font-medium"
                >
                  {{
                    verificationResult.verified
                      ? 'Dominio Verificado'
                      : 'Verificación Fallida'
                  }}
                </h4>
                <p
                  [class]="
                    verificationResult.verified
                      ? 'text-green-700'
                      : 'text-red-700'
                  "
                  class="text-sm"
                >
                  {{
                    verificationResult.verified
                      ? 'Tu dominio ha sido verificado correctamente y está activo.'
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
              <div
                *ngFor="let check of getCheckResults()"
                class="flex items-center justify-between py-2 border-b border-[var(--color-border)] last:border-0"
              >
                <div class="flex items-center gap-2">
                  <app-icon
                    [name]="check.valid ? 'check' : 'x'"
                    [size]="16"
                    [class]="check.valid ? 'text-green-600' : 'text-red-600'"
                  ></app-icon>
                  <span class="text-sm text-[var(--color-text-primary)]">{{
                    check.name
                  }}</span>
                </div>
                <span
                  *ngIf="check.reason"
                  class="text-xs text-[var(--color-text-secondary)]"
                >
                  {{ check.reason }}
                </span>
              </div>
            </div>
          </div>

          <!-- Suggested Fixes -->
          <div
            *ngIf="
              verificationResult.suggested_fixes &&
              verificationResult.suggested_fixes.length > 0
            "
            class="bg-yellow-50 border border-yellow-200 rounded-lg p-4"
          >
            <h5 class="font-medium text-yellow-900 mb-2">Sugerencias</h5>
            <ul class="list-disc list-inside space-y-1">
              <li
                *ngFor="let fix of verificationResult.suggested_fixes"
                class="text-sm text-yellow-800"
              >
                {{ fix }}
              </li>
            </ul>
          </div>
        </div>

        <!-- Propagation Notice -->
        <div
          *ngIf="!verificationResult"
          class="text-sm text-[var(--color-text-secondary)] bg-[var(--color-muted)] rounded-lg p-3"
        >
          <strong>Nota:</strong> Los cambios de DNS pueden tardar hasta 48 horas
          en propagarse. Si acabas de hacer los cambios, espera unos minutos
          antes de verificar.
        </div>
      </div>

      <div slot="footer" class="flex justify-between items-center">
        <div *ngIf="copiedText" class="text-sm text-green-600">
          <app-icon name="check" [size]="14" class="inline mr-1"></app-icon>
          Copiado al portapapeles
        </div>
        <div *ngIf="!copiedText"></div>
        <div class="flex gap-3">
          <app-button variant="outline" (clicked)="onCancel()">
            {{ verificationResult ? 'Cerrar' : 'Cancelar' }}
          </app-button>
          <app-button
            *ngIf="!verificationResult || !verificationResult.verified"
            variant="primary"
            (clicked)="onVerify()"
            [loading]="isVerifying"
            [disabled]="isVerifying"
          >
            <app-icon name="refresh" [size]="16" slot="icon"></app-icon>
            {{ verificationResult ? 'Reintentar' : 'Verificar Ahora' }}
          </app-button>
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
  @Input() isOpen = false;
  @Input() isVerifying = false;
  @Input() domain: Domain | null = null;
  @Input() verificationResult: VerifyDomainResult | null = null;

  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() verify = new EventEmitter<string>();
  @Output() cancel = new EventEmitter<void>();

  copiedText = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && !this.isOpen) {
      this.copiedText = false;
    }
  }

  get cnameHost(): string {
    if (!this.domain) return '';

    // Extract subdomain from hostname
    const parts = this.domain.hostname.split('.');
    if (parts.length > 2) {
      return parts[0];
    }
    return '@';
  }

  get isCustomDomain(): boolean {
    return (
      this.domain?.ownership === DomainOwnership.CUSTOM_DOMAIN ||
      this.domain?.ownership === DomainOwnership.CUSTOM_SUBDOMAIN
    );
  }

  getCheckResults(): Array<{ name: string; valid: boolean; reason?: string }> {
    if (!this.verificationResult?.checks) return [];

    const checkNameMap: Record<string, string> = {
      cname: 'Registro CNAME',
      a: 'Registro A',
      txt: 'Registro TXT',
      aaaa: 'Registro AAAA',
    };

    return Object.entries(this.verificationResult.checks).map(([key, value]) => ({
      name: checkNameMap[key] || key.toUpperCase(),
      valid: value.valid,
      reason: value.reason,
    }));
  }

  copyToClipboard(text: string): void {
    if (!text) return;

    navigator.clipboard.writeText(text).then(() => {
      this.copiedText = true;
      setTimeout(() => {
        this.copiedText = false;
      }, 2000);
    });
  }

  onVerify(): void {
    if (this.domain) {
      this.verify.emit(this.domain.hostname);
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
