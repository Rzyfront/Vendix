import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';

@Component({
  selector: 'vendix-purchases-by-supplier',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent, CardComponent],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4">
      <div class="flex items-center gap-2 text-sm text-text-secondary mb-1">
        <a routerLink="/admin/reports" class="hover:text-primary">Reportes</a>
        <app-icon name="chevron-right" [size]="14"></app-icon>
        <span>Compras</span>
      </div>
      <h1 class="text-2xl font-bold text-text-primary">
        Compras por Proveedor
      </h1>
      <app-card
        shadow="none"
        [responsivePadding]="true"
        customClasses="text-center"
      >
        <app-icon
          name="truck"
          [size]="48"
          class="text-text-tertiary mx-auto mb-4"
        ></app-icon>
        <span class="text-sm font-bold text-[var(--color-text-primary)]"
          >Próximamente</span
        >
        <span class="text-xs text-[var(--color-text-secondary)]"
          >El reporte de compras por proveedor estará disponible pronto.</span
        >
      </app-card>
    </div>
  `,
})
export class PurchasesBySupplierComponent {}
