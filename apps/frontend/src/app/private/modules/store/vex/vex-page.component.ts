import { Component } from '@angular/core';

/**
 * Vista base del agente Vex. Placeholder: el agente aún no tiene
 * implementación; el header (`app-header`) enlaza aquí desde el botón
 * con `assets/vex/vexicon.png`.
 */
@Component({
  selector: 'vendix-vex-page',
  standalone: true,
  template: `
    <section
      class="flex flex-col items-center justify-center text-center gap-4 min-h-[60vh] px-4"
    >
      <img
        src="assets/vex/vexicon.png"
        alt="Vex"
        class="w-24 h-24 object-contain"
      />
      <h1 class="text-2xl font-semibold text-[var(--color-text-primary)]">
        Vex
      </h1>
      <p class="max-w-md text-sm text-[var(--color-text-secondary)]">
        Tu nuevo agente está en camino. Muy pronto podrás trabajar con Vex
        desde aquí.
      </p>
    </section>
  `,
})
export class VexPageComponent {}
