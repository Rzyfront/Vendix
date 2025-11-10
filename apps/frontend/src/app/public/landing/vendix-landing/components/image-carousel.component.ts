import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-image-carousel',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './image-carousel.component.html',
  styleUrls: ['./image-carousel.component.scss']
})
export class ImageCarouselComponent implements OnInit, OnDestroy {
  @Input() slides: any[] = [];
  
  defaultSlides = [
    {
      image: '/assets/images/carrusel/1.webp',
      message: 'Transforma tu Negocio con IA',
      subtitle: 'Inteligencia artificial integrada para predecir ventas, optimizar inventario y automatizar decisiones.',
      buttonText: 'Comenzar Ahora',
      buttonLink: '/auth/register',
      secondaryButtonText: 'Ver Demo'
    },
    {
      image: '/assets/images/carrusel/2.webp',
      message: 'Ventas Omnicanal Sin Límites',
      subtitle: 'Une tus tiendas físicas, online y móviles en una sola plataforma inteligente y sincronizada.',
      buttonText: 'Explorar Plataforma',
      secondaryButtonText: 'Casos de Éxito'
    },
    {
      image: '/assets/images/carrusel/3.webp',
      message: 'POS Inteligente con IA',
      subtitle: 'Sistema de punto de venta que aprende de tus clientes y optimiza cada transacción.',
      buttonText: 'Probar POS',
      secondaryButtonText: 'Hablar con Experto'
    },
    {
      image: '/assets/images/carrusel/4.webp',
      message: 'E-commerce Ultra-Personalizado',
      subtitle: 'Tiendas online que se adaptan a cada cliente con recomendaciones IA y experiencias únicas.',
      buttonText: 'Crear Tienda',
      secondaryButtonText: 'Ver Plantillas'
    },
    {
      image: '/assets/images/carrusel/5.webp',
      message: 'Inventario Predictivo',
      subtitle: 'Anticipa la demanda, evita faltantes y maximiza tu rentabilidad con análisis predictivo.',
      buttonText: 'Conocer IA',
      secondaryButtonText: 'Ver Reportes'
    },
    {
      image: '/assets/images/carrusel/6.webp',
      message: 'Análisis en Tiempo Real',
      subtitle: 'Dashboard inteligente con métricas clave y alertas automáticas para decisiones instantáneas.',
      buttonText: 'Ver Dashboard',
      secondaryButtonText: 'Precios'
    },
    {
      image: '/assets/images/carrusel/7.webp',
      message: 'Escala sin Compromisos',
      subtitle: 'Desde una pequeña tienda hasta un imperio retail, nuestra IA crece contigo.',
      buttonText: 'Registrarse Gratis',
      secondaryButtonText: 'Roadmap'
    }
  ];

  currentSlide = 0;
  autoplayInterval: any;

  constructor() {
    // Si no se proporcionan slides, usar las por defecto
    if (!this.slides || this.slides.length === 0) {
      this.slides = this.defaultSlides;
    }
  }

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
    this.currentSlide = (this.currentSlide + 1) % this.slides.length;
    this.updateSlideVisibility();
  }

  prevSlide() {
    this.currentSlide = (this.currentSlide - 1 + this.slides.length) % this.slides.length;
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