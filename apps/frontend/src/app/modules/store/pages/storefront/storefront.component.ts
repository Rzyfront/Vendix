import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';

@Component({
  selector: 'app-storefront',
  standalone: true,
  imports: [CommonModule, CardComponent, ButtonComponent],
  template: `
    <div class="min-h-screen bg-background">
      <!-- Hero Section -->
      <section class="bg-primary text-white py-20">
        <div class="container mx-auto px-4 text-center">
          <h1 class="text-4xl md:text-6xl font-bold mb-6">
            Welcome to Our Store
          </h1>
          <p class="text-xl md:text-2xl mb-8 opacity-90">
            Discover amazing products at great prices
          </p>
          <app-button
            variant="secondary"
            size="lg"
            (clicked)="scrollToProducts()"
          >
            Shop Now
          </app-button>
        </div>
      </section>

      <!-- Products Section -->
      <section class="py-16">
        <div class="container mx-auto px-4">
          <h2 class="text-3xl font-bold text-center mb-12 text-text-primary">
            Featured Products
          </h2>

          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <!-- Sample Product Cards -->
            <app-card
              *ngFor="let product of sampleProducts"
              [title]="product.name"
              [subtitle]="'$' + product.price"
              shadow="md"
              class="hover:shadow-lg transition-shadow cursor-pointer"
            >
              <div class="aspect-square bg-gray-200 rounded-lg mb-4 flex items-center justify-center">
                <span class="text-4xl">{{ product.emoji }}</span>
              </div>
              <p class="text-text-secondary mb-4">{{ product.description }}</p>

              <div slot="footer" class="flex gap-2">
                <app-button variant="primary" size="sm" class="flex-1">
                  Add to Cart
                </app-button>
                <app-button variant="outline" size="sm">
                  View Details
                </app-button>
              </div>
            </app-card>
          </div>
        </div>
      </section>

      <!-- Footer -->
      <footer class="bg-gray-800 text-white py-8">
        <div class="container mx-auto px-4 text-center">
          <p>&copy; 2024 Vendix Store. All rights reserved.</p>
          <p class="text-sm text-gray-400 mt-2">
            Powered by Vendix Multi-Store Platform
          </p>
        </div>
      </footer>
    </div>
  `
})
export class StorefrontComponent {

  sampleProducts = [
    {
      name: 'Wireless Headphones',
      price: '99.99',
      description: 'High-quality wireless headphones with noise cancellation.',
      emoji: '🎧'
    },
    {
      name: 'Smart Watch',
      price: '199.99',
      description: 'Feature-rich smartwatch with health tracking.',
      emoji: '⌚'
    },
    {
      name: 'Laptop Stand',
      price: '49.99',
      description: 'Ergonomic laptop stand for better posture.',
      emoji: '💻'
    },
    {
      name: 'Coffee Mug',
      price: '15.99',
      description: 'Insulated coffee mug that keeps drinks hot.',
      emoji: '☕'
    },
    {
      name: 'Backpack',
      price: '79.99',
      description: 'Durable backpack perfect for travel and work.',
      emoji: '🎒'
    },
    {
      name: 'Phone Case',
      price: '25.99',
      description: 'Protective phone case with wireless charging support.',
      emoji: '📱'
    }
  ];
  scrollToProducts(): void {
    window.scrollTo({
      top: 600,
      behavior: 'smooth'
    });
  }
}
