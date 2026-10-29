import { Component, input, output } from '@angular/core';
import { EmptyStateComponent } from '../../../../../shared/components/index';

/**
 * Failed load of a Hospitality screen (ui-ux-rules R-FB-02): "No pudimos
 * cargar …" with the reason and "Reintentar", never an empty list or zeros.
 */
@Component({
  selector: 'app-hospitality-load-error',
  standalone: true,
  imports: [EmptyStateComponent],
  template: `
    <div role="alert">
      <app-empty-state
        icon="alert-triangle"
        iconColor="error"
        [title]="'No pudimos cargar ' + what()"
        [description]="message() || 'Revisa tu conexión e inténtalo de nuevo.'"
        actionButtonText="Reintentar"
        actionButtonIcon="refresh-cw"
        (actionClick)="retry.emit()"
      />
    </div>
  `,
})
export class HospitalityLoadErrorComponent {
  /** What failed, lower case: "las reservas", "la recepción". */
  readonly what = input.required<string>();
  readonly message = input<string | null>(null);
  readonly retry = output<void>();
}
