import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
    selector: 'app-product-detail',
    standalone: true,
    imports: [CommonModule, RouterModule],
    template: `
    <div class="product-detail-page">
      <p>Página de detalle del producto - En desarrollo</p>
      <a routerLink="/catalog">← Volver al catálogo</a>
    </div>
  `,
    styles: [`
    .product-detail-page {
      padding: 2rem;
      text-align: center;
      
      a {
        color: var(--color-primary);
        text-decoration: none;
        &:hover { text-decoration: underline; }
      }
    }
  `],
})
export class ProductDetailComponent { }
