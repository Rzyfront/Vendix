import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { optionalControl } from './invoice-section-controls';
import type { InvoiceSectionContext } from './invoice-section-context';
import { isInvoiceContext, isProfileContext } from './invoice-section-context';

/**
 * Dónde vive cada campo. En contexto `profile` las dos rutas existen; en
 * `invoice` son `null` porque `CreateInvoiceDto` NO declara `internal_note` ni
 * `description` — añadirlos es la decisión de contrato que la reclasificación
 * de B.7 dejó reservada al humano, y mientras no exista, un control que
 * escribara donde el servidor no lee sería el fallo mudo de este módulo.
 */
export interface NotasSectionPaths {
  description: string | null;
  internal_note: string | null;
}

/**
 * Sección «Notas internas»: B.7 del plan CP-INVOICE-PROFILE-MIRROR-AIU.
 *
 * ## Por qué las notas de cabecera NO están aquí
 *
 * `notes` —las que viajan al XML como «cbc:Note» y las lee el adquiriente— es
 * OTRO dato y vive en la sección Documento (`InvoiceSectionDocumentoComponent`,
 * vía `notesControl()`). Confundir las dos publica en una factura electrónica
 * el motivo interno de un descuento: es el error que este componente existe
 * para no repetir (ver el docblock de `invoice-section-field-map.ts`).
 */
@Component({
  selector: 'vendix-invoice-section-notas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [ReactiveFormsModule, TextareaComponent],
  template: `
    @if (isProfile()) {
      <div class="space-y-2">
        @if (descriptionControl(); as descriptionControl) {
          <app-textarea
            label="Descripción"
            [formControl]="descriptionControl"
            [rows]="2"
            helperText="Para el operador. No viaja al XML."
          ></app-textarea>
        }
        @if (internalNoteControl(); as internalNoteControl) {
          <app-textarea
            label="Nota interna"
            [formControl]="internalNoteControl"
            [rows]="3"
            helperText="Por qué existe este perfil. Queda en el historial de versiones."
          ></app-textarea>
        }
      </div>
    } @else {
      <!--
        La factura no lleva nota interna POR CONTRATO, no por olvido: el DTO de
        creación no declara el campo y el backend corre con
        «forbidNonWhitelisted», así que mandarlo devolvería 400. Lo que sí
        viaja al XML son las notas de cabecera, y esas se capturan en
        «Documento».
      -->
      <p class="text-xs leading-relaxed text-text-secondary">
        Las notas que ve el adquiriente se capturan en
        <strong>Documento</strong> y viajan al XML como «cbc:Note». La nota
        interna por documento no existe todavía: sólo los perfiles la guardan.
      </p>
    }
  `,
})
export class InvoiceSectionNotasComponent {
  readonly context = input.required<InvoiceSectionContext>();
  readonly isInvoice = computed(() => isInvoiceContext(this.context()));
  readonly isProfile = computed(() => isProfileContext(this.context()));

  readonly form = input.required<FormGroup>();
  readonly paths = input.required<NotasSectionPaths>();

  readonly descriptionControl = computed(
    () => optionalControl(this.form(), this.paths().description) as FormControl | null,
  );
  readonly internalNoteControl = computed(
    () => optionalControl(this.form(), this.paths().internal_note) as FormControl | null,
  );
}
