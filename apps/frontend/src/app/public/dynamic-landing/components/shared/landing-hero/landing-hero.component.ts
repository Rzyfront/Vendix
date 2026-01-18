import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '../../../../../shared/components/index';

@Component({
  selector: 'app-landing-hero',
  standalone: true,
  imports: [CommonModule, ButtonComponent],
  template: `
    <section class="relative py-20 px-4 overflow-hidden">
      <!-- Background Abstract Shape -->
      <div class="absolute inset-0 z-0 bg-gradient-to-br from-[var(--color-primary)] opacity-5"></div>
      
      <div class="container mx-auto max-w-5xl relative z-10 text-center">
        <h1 class="text-4xl md:text-6xl font-extrabold text-[var(--color-text-primary)] mb-6 tracking-tight">
          {{ title }}
        </h1>
        <p class="text-xl text-[var(--color-text-secondary)] mb-10 max-w-2xl mx-auto leading-relaxed">
          {{ description }}
        </p>
        
        <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
          <app-button 
            variant="primary" 
            size="lg" 
            (clicked)="onCtaClick()">
            {{ ctaText }}
          </app-button>
        </div>
      </div>
    </section>
  `,
  styles: []
})
export class LandingHeroComponent {
  @Input() title: string = 'Welcome';
  @Input() description: string = '';
  @Input() ctaText: string = 'Explore Now';

  onCtaClick() {
    window.location.href = '/shop';
  }
}
