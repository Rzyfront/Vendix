import { Component, input, computed, OnInit, OnDestroy } from '@angular/core';

import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-image-carousel',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './image-carousel.component.html',
  styleUrls: ['./image-carousel.component.scss'],
})
export class ImageCarouselComponent implements OnInit, OnDestroy {
  readonly slides = input<any[]>([]);
  readonly effectiveSlides = computed(() => {
    const s = this.slides();
    return s && s.length > 0 ? s : this.defaultSlides;
  });

  defaultSlides = [
    {
      image: '/assets/images/carrusel/1.webp',
      message: 'Transforma tu Negocio con IA',
      subtitle:
        'Inteligencia artificial integrada para predecir ventas, optimizar inventario y automatizar decisiones.',
      buttonText: 'Comenzar Ahora',
      buttonLink: '/auth/register',
      secondaryButtonText: 'Ver Demo',
    },
    {
      image: '/assets/images/carrusel/2.webp',
      message: 'Ventas Omnicanal Sin Límites',
      subtitle:
        'Une tus tiendas físicas, online y móviles en una sola plataforma inteligente y sincronizada.',
      buttonText: 'Explorar Plataforma',
      buttonLink: '/auth/register',
      secondaryButtonText: 'Ver Demo',
    },
    {
      image: '/assets/images/carrusel/3.webp',
      message: 'Gestión Financiera Inteligente',
      subtitle:
        'Controla tu flujo de caja, genera reportes automáticos y toma decisiones basadas en datos.',
      buttonText: 'Comenzar Prueba',
      buttonLink: '/auth/register',
      secondaryButtonText: 'Ver Demo',
    },
  ];

  currentSlide = 0;
  autoplayInterval: any;

  ngOnInit() {
    this.startAutoplay();
  }

  ngOnDestroy() {
    this.stopAutoplay();
  }

  goToSlide(index: number) {
    this.currentSlide = index;
    this.updateSlideVisibility();
  }

  nextSlide() {
    this.currentSlide = (this.currentSlide + 1) % this.effectiveSlides().length;
    this.updateSlideVisibility();
  }

  prevSlide() {
    this.currentSlide =
      (this.currentSlide - 1 + this.effectiveSlides().length) %
      this.effectiveSlides().length;
    this.updateSlideVisibility();
  }

  private startAutoplay() {
    this.autoplayInterval = setInterval(() => {
      this.nextSlide();
    }, 4500);
  }

  private stopAutoplay() {
    if (this.autoplayInterval) {
      clearInterval(this.autoplayInterval);
    }
  }

  private updateSlideVisibility() {
    // This will be handled by CSS classes in the template
  }
}
