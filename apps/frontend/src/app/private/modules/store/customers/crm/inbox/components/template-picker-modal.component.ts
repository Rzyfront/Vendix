import { Component, computed, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
} from '../../../../../../../shared/components';
import { CrmTemplateInput } from '../crm-inbox.interface';

const MAX_VARIABLES = 10;

/**
 * Template to send on WhatsApp: approved name, language and the positional
 * body variables (`{{1}}`, `{{2}}`…).
 *
 * There is no template catalog API yet (`GET /whatsapp/templates` of the plan
 * is pending), so the name is typed as approved in Meta.
 */
@Component({
  selector: 'app-crm-template-picker-modal',
  standalone: true,
  imports: [FormsModule, ButtonComponent, IconComponent, ModalComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      title="Enviar plantilla"
      subtitle="Usa una plantilla aprobada en tu cuenta de WhatsApp Business."
      size="md"
      [fullScreenOnMobile]="true"
    >
      <form class="flex flex-col gap-4" (ngSubmit)="submit()" id="crm-template-form">
        <div class="grid gap-4 sm:grid-cols-3">
          <label class="flex flex-col gap-1 sm:col-span-2">
            <span class="text-xs font-semibold text-[var(--color-text-primary)]">
              Nombre de la plantilla
            </span>
            <input
              class="h-10 rounded-xl border border-[var(--color-border)] bg-surface px-3 text-sm text-[var(--color-text-primary)] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              name="template_name"
              autocomplete="off"
              maxlength="120"
              placeholder="confirmacion_pedido"
              required
              [ngModel]="name()"
              (ngModelChange)="name.set($event)"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-xs font-semibold text-[var(--color-text-primary)]">
              Idioma
            </span>
            <input
              class="h-10 rounded-xl border border-[var(--color-border)] bg-surface px-3 text-sm text-[var(--color-text-primary)] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              name="template_language"
              autocomplete="off"
              maxlength="10"
              placeholder="es"
              required
              [ngModel]="language()"
              (ngModelChange)="language.set($event)"
            />
          </label>
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-[var(--color-text-primary)]">
              Variables del cuerpo
            </span>
            <button
              type="button"
              class="inline-flex h-8 items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-3 text-xs font-semibold text-primary-on-tint hover:bg-primary/15 disabled:opacity-50"
              [disabled]="variables().length >= maxVariables"
              (click)="addVariable()"
            >
              <app-icon name="plus" [size]="12"></app-icon>
              Agregar variable
            </button>
          </div>
          @if (variables().length === 0) {
            <p class="text-xs text-[var(--color-text-secondary)]">
              Sin variables. Agrégalas en el orden de la plantilla.
            </p>
          }
          @for (value of variables(); track $index) {
            <div class="flex items-center gap-2">
              <span
                class="w-12 shrink-0 text-xs font-semibold text-[var(--color-text-secondary)]"
                >{{ placeholder($index) }}</span
              >
              <input
                class="h-10 min-w-0 flex-1 rounded-xl border border-[var(--color-border)] bg-surface px-3 text-sm text-[var(--color-text-primary)] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                [name]="'variable_' + $index"
                maxlength="1024"
                [attr.aria-label]="'Variable ' + ($index + 1)"
                [ngModel]="value"
                (ngModelChange)="setVariable($index, $event)"
              />
              <button
                type="button"
                class="flex h-10 w-10 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-error/10 hover:text-error"
                [attr.aria-label]="'Quitar variable ' + ($index + 1)"
                (click)="removeVariable($index)"
              >
                <app-icon name="trash-2" [size]="16"></app-icon>
              </button>
            </div>
          }
        </div>
      </form>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button variant="outline" size="md" (clicked)="isOpen.set(false)">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          size="md"
          [disabled]="!valid()"
          [loading]="sending()"
          (clicked)="submit()"
        >
          <app-icon slot="icon" name="send" [size]="16"></app-icon>
          Enviar plantilla
        </app-button>
      </div>
    </app-modal>
  `,
})
export class TemplatePickerModalComponent {
  readonly isOpen = model(false);
  readonly sending = input(false);
  readonly picked = output<CrmTemplateInput>();

  protected readonly maxVariables = MAX_VARIABLES;
  protected readonly name = signal('');
  protected readonly language = signal('es');
  protected readonly variables = signal<string[]>([]);

  protected readonly valid = computed(
    () =>
      this.name().trim().length > 0 &&
      this.language().trim().length > 0 &&
      this.variables().every((value) => value.trim().length > 0),
  );

  protected placeholder(index: number): string {
    return `{{${index + 1}}}`;
  }

  protected addVariable(): void {
    this.variables.update((list) =>
      list.length >= MAX_VARIABLES ? list : [...list, ''],
    );
  }

  protected removeVariable(index: number): void {
    this.variables.update((list) => list.filter((_, i) => i !== index));
  }

  protected setVariable(index: number, value: string): void {
    this.variables.update((list) =>
      list.map((current, i) => (i === index ? value : current)),
    );
  }

  protected submit(): void {
    if (!this.valid() || this.sending()) return;
    this.picked.emit({
      name: this.name().trim(),
      language: this.language().trim(),
      variables: this.variables().map((value) => value.trim()),
    });
  }

  /** Called by the parent after a successful send. */
  reset(): void {
    this.name.set('');
    this.language.set('es');
    this.variables.set([]);
  }
}
