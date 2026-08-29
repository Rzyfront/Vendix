import { Component, computed, input, model, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  PrintAnnexValidationRule,
  PrintAnnexValidationSummary,
} from '../../../../../../../core/models/print-formats.model';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';

@Component({
  selector: 'app-print-annex-modal',
  standalone: true,
  imports: [CommonModule, IconComponent, ButtonComponent],
  template: `
    @if (isOpen()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
        <div
          class="relative w-full max-w-2xl max-h-[90vh] flex flex-col bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden animate-scale-in"
          (click)="$event.stopPropagation()"
        >
          <!-- Modal Header -->
          <div class="p-5 border-b border-border bg-surface-secondary/50 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div
                class="p-2 rounded-xl"
                [class.bg-emerald-500/10]="summary()?.isCompliant"
                [class.text-emerald-500]="summary()?.isCompliant"
                [class.bg-amber-500/10]="!summary()?.isCompliant"
                [class.text-amber-500]="!summary()?.isCompliant"
              >
                <app-icon [name]="summary()?.isCompliant ? 'shield-check' : 'shield-alert'" [size]="24"></app-icon>
              </div>
              <div>
                <h3 class="text-base font-bold text-text-primary">
                  Validación Anexo Técnico 1.9 DIAN
                </h3>
                <p class="text-xs text-text-secondary">
                  Estatuto Tributario Art. 617 y Resolución DIAN 000165 de 2023
                </p>
              </div>
            </div>

            <button
              type="button"
              (click)="close()"
              class="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-secondary transition cursor-pointer"
            >
              <app-icon name="x" [size]="18"></app-icon>
            </button>
          </div>

          <!-- Score Banner -->
          <div class="p-4 bg-surface border-b border-border flex items-center justify-between gap-4">
            <div class="flex items-center gap-3">
              <div class="text-2xl font-black font-mono text-text-primary">
                {{ summary()?.score ?? 0 }}%
              </div>
              <div class="text-xs">
                <span class="font-semibold text-text-primary block">
                  {{ summary()?.isCompliant ? '100% Cumplimiento Normativo' : 'Requiere Ajustes Fiscales' }}
                </span>
                <span class="text-[11px] text-text-secondary">
                  {{ summary()?.passedCount }} de {{ summary()?.totalRules }} requisitos aprobados
                </span>
              </div>
            </div>

            <div class="flex items-center gap-2 text-xs font-mono">
              @if ((summary()?.errorCount ?? 0) > 0) {
                <span class="px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 border border-red-500/20">
                  {{ summary()?.errorCount }} Errores
                </span>
              }
              @if ((summary()?.warningCount ?? 0) > 0) {
                <span class="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20">
                  {{ summary()?.warningCount }} Advertencias
                </span>
              }
            </div>
          </div>

          <!-- Rules List -->
          <div class="p-5 overflow-y-auto space-y-3 flex-1">
            @for (rule of summary()?.rules; track rule.id) {
              <div
                class="p-3.5 rounded-xl border transition"
                [class.bg-emerald-500/5]="rule.passed"
                [class.border-emerald-500/20]="rule.passed"
                [class.bg-red-500/5]="!rule.passed && rule.severity === 'error'"
                [class.border-red-500/30]="!rule.passed && rule.severity === 'error'"
                [class.bg-amber-500/5]="!rule.passed && rule.severity === 'warning'"
                [class.border-amber-500/30]="!rule.passed && rule.severity === 'warning'"
                [class.bg-surface-secondary/40]="!rule.passed && rule.severity === 'info'"
                [class.border-border]="!rule.passed && rule.severity === 'info'"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="flex items-start gap-2.5">
                    <app-icon
                      [name]="rule.passed ? 'check-circle' : rule.severity === 'error' ? 'alert-circle' : 'alert-triangle'"
                      [size]="16"
                      [class.text-emerald-500]="rule.passed"
                      [class.text-red-500]="!rule.passed && rule.severity === 'error'"
                      [class.text-amber-500]="!rule.passed && rule.severity === 'warning'"
                      [class.text-blue-400]="!rule.passed && rule.severity === 'info'"
                      class="shrink-0 mt-0.5"
                    ></app-icon>

                    <div class="space-y-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-xs font-bold text-text-primary">{{ rule.name }}</span>
                        <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface border border-border text-text-tertiary">
                          {{ rule.reference }}
                        </span>
                      </div>
                      <p class="text-xs text-text-secondary leading-relaxed">
                        {{ rule.description }}
                      </p>
                    </div>
                  </div>

                  @if (!rule.passed && rule.fixAction) {
                    <button
                      type="button"
                      (click)="onAutoFix(rule)"
                      class="shrink-0 px-2.5 py-1 text-xs font-semibold text-primary-500 hover:text-white bg-primary-500/10 hover:bg-primary-600 border border-primary-500/30 rounded-lg transition cursor-pointer"
                    >
                      {{ rule.fixAction.label }}
                    </button>
                  }
                </div>
              </div>
            }
          </div>

          <!-- Modal Footer -->
          <div class="p-4 border-t border-border bg-surface-secondary/30 flex items-center justify-between">
            <span class="text-[11px] text-text-tertiary">
              Validado en tiempo real según el estándar de facturación electrónica DIAN Colombia.
            </span>
            <app-button variant="outline" size="sm" (clicked)="close()">
              Cerrar
            </app-button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }
    `,
  ],
})
export class PrintAnnexModalComponent {
  readonly isOpen = model<boolean>(false);
  readonly summary = input<PrintAnnexValidationSummary | null>(null);
  readonly autoFixRequested = output<PrintAnnexValidationRule>();

  close(): void {
    this.isOpen.set(false);
  }

  onAutoFix(rule: PrintAnnexValidationRule): void {
    this.autoFixRequested.emit(rule);
    this.close();
  }
}
