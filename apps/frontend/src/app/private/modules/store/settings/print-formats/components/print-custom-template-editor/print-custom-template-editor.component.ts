import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { PrintFormatsFacade } from '../../services/print-formats.facade';
import { PrintTokenDefinition } from '../../../../../../../core/models/print-formats.model';

@Component({
  selector: 'app-print-custom-template-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="space-y-4">
      <div class="flex items-center justify-between pb-2 border-b border-border">
        <div>
          <h3 class="text-sm font-semibold text-text-primary">Editor de Plantilla Avanzada (HTML/CSS)</h3>
          <p class="text-xs text-text-secondary">Personalización libre mediante sintaxis de tokens y HTML compatible.</p>
        </div>
        <div class="flex items-center gap-2">
          @if (customTemplate()) {
            <button
              type="button"
              (click)="clearCustomTemplate()"
              class="text-xs text-red-500 hover:text-red-400 underline transition"
            >
              Volver a Modo Estructurado
            </button>
          }
        </div>
      </div>

      <!-- Token Explorer Chips -->
      <div class="p-3 bg-surface-secondary rounded-xl border border-border space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
            <app-icon name="code" [size]="14" class="text-primary-500"></app-icon>
            Variables y Tokens Disponibles (Haz clic para insertar):
          </span>
          <span class="text-[10px] text-text-secondary">Formateadores: {{ '{{money val}}' }} {{ '{{date val}}' }} {{ '{{#if val}}' }}</span>
        </div>

        <div class="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
          @for (token of availableTokens(); track token.token) {
            <button
              type="button"
              (click)="insertToken(token.token)"
              class="px-2 py-1 bg-surface hover:bg-primary-500/10 border border-border hover:border-primary-500/40 rounded text-[11px] font-mono text-primary-400 transition flex items-center gap-1"
              [title]="token.description + ' (ej: ' + token.example + ')'"
            >
              <span>{{ token.token }}</span>
            </button>
          }
        </div>
      </div>

      <!-- Code Textarea -->
      <div class="space-y-1">
        <textarea
          #codeEditor
          [ngModel]="customTemplate()"
          (ngModelChange)="updateCode($event)"
          rows="18"
          placeholder="Si dejas este campo vacío, se utilizará el diseño estructurado por secciones..."
          class="w-full p-4 font-mono text-xs bg-slate-950 text-emerald-400 border border-slate-800 rounded-xl focus:border-primary-500 focus:outline-none leading-relaxed shadow-inner"
        ></textarea>
      </div>
    </div>
  `,
})
export class PrintCustomTemplateEditorComponent {
  readonly facade = inject(PrintFormatsFacade);

  readonly availableTokens = computed<PrintTokenDefinition[]>(() => {
    return this.facade.selectedFormatDetail()?.available_tokens || [];
  });

  readonly customTemplate = computed(() => {
    const draft = this.facade.draftDefinition();
    return draft?.custom_template || '';
  });

  updateCode(code: string): void {
    this.facade.updateDraftDefinition((def) => {
      def.custom_template = code;
      return def;
    });
  }

  insertToken(tokenStr: string): void {
    const current = this.customTemplate();
    this.updateCode(current ? `${current} ${tokenStr}` : tokenStr);
  }

  clearCustomTemplate(): void {
    this.updateCode('');
  }
}
