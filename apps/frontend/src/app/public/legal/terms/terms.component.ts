import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../../shared/components/icon/icon.component';

/**
 * G8 — Página pública de Términos y Condiciones.
 *
 * La sección 5 (Pagos y reembolsos) contiene la política oficial de
 * no-reembolso de Vendix. El checkout linkea directamente al anchor
 * `#pagos-y-reembolsos` para que el cliente revise antes de aceptar.
 *
 * Las demás secciones contienen placeholder marcado con TODO; deben
 * completarse antes del lanzamiento productivo (legal review).
 */
@Component({
  selector: 'app-terms',
  standalone: true,
  imports: [RouterLink, IconComponent],
  templateUrl: './terms.component.html',
  styleUrl: './terms.component.scss',
})
export class TermsComponent {}
