import { Component } from '@angular/core';

import { RouterModule } from '@angular/router';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';

@Component({
  selector: 'vendix-abandoned-carts',
  standalone: true,
  imports: [RouterModule, IconComponent, CardComponent],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4">
      <div class="flex items-center gap-2 text-sm text-text-secondary mb-1">
        <a routerLink="/admin/reports" class="hover:text-primary">Reportes</a>
        <app-icon name="chevron-right" [size]="14"></app-icon>
        <span>Clientes</span>
      </div>
      <h1 class="text-2xl font-bold text-text-primary">Carritos Abandonados</h1>
      <app-card
        shadow="none"
        [responsivePadding]="true"
        customClasses="text-center"
      >
        <app-icon
          name="shopping-cart"
          [size]="48"
          class="text-text-tertiary mx-auto mb-4"
        ></app-icon>
        <span class="text-sm font-bold text-[var(--color-text-primary)]"
          >Próximamente</span
        >
        <span class="text-xs text-[var(--color-text-secondary)]"
          >El reporte de carritos abandonados estará disponible pronto.</span
        >
      </app-card>
    </div>
  `,
})
export class AbandonedCartsComponent {}
