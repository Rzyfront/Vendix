import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-hero-carousel',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './hero-carousel.component.html',
  styleUrls: ['./hero-carousel.component.scss']
})
export class HeroCarouselComponent implements OnInit, OnDestroy {
  slides = [
    {
      image: 'assets/images/carrusel/1.webp',
      message: 'Transforma tu Negocio Hoy',
      subtitle: 'Con Vendix, tienes el poder de unificar tu inventario, ventas y clientes en una sola plataforma impulsada por IA.',
      buttonText: 'Comenzar Transformación',
      buttonLink: '/auth/register',
      secondaryButtonText: 'Ver Demo en Vivo'
    },
    {
      image: 'assets/images/carrusel/2.webp',
      message: 'Comercio Unificado, Experiencia Inigualable',
      subtitle: 'Ofrece a tus clientes una experiencia de compra fluida y consistente en todos tus canales de venta.',
      buttonText: 'Descubre la Plataforma',
      buttonLink: '/auth/register',
      secondaryButtonText: 'Casos de Éxito'
    },
    {
      image: 'assets/images/carrusel/3.webp',
      message: 'Tu Marca, Tu Imperio Digital',
      subtitle: 'Personaliza cada aspecto de tu tienda online y crea una marca que tus clientes amarán con IA personalizada.',
      buttonText: 'Crea tu Tienda',
      buttonLink: '/auth/register',
      secondaryButtonText: 'Habla con un Experto',
      secondaryButtonLink: 'mailto:quicks.dev@gmail.com?subject=Quiero%20hablar%20con%20un%20experto%20de%20Vendix'
    },
    {
      image: 'assets/images/carrusel/4.webp',
      message: 'Escala Sin Límites',
      subtitle: 'Nuestra arquitectura robusta está diseñada para crecer contigo, desde tu primera venta hasta millones.',
      buttonText: 'Ver Planes',
      buttonLink: '#pricing',
      secondaryButtonText: 'Arquitectura'
    },
    {
      image: 'assets/images/carrusel/5.webp',
      message: 'Inteligencia de Negocio a tu Alcance',
      subtitle: 'Toma decisiones basadas en datos con nuestros reportes y análisis avanzados en tiempo real.',
      buttonText: 'Conoce los Reportes',
      buttonLink: '#features',
      secondaryButtonText: 'Precios'
    },
    {
      image: 'assets/images/carrusel/6.webp',
      message: 'Únete a la Revolución del E-commerce',
      subtitle: 'Miles de emprendedores ya están construyendo el futuro del comercio inteligente con Vendix. ¿Estás listo?',
      buttonText: 'Regístrate Ahora',
      buttonLink: '/auth/register',
      secondaryButtonText: 'Comunidad'
    },
    {
      image: 'assets/images/carrusel/7.webp',
      message: 'Innovación Constante',
      subtitle: 'Nos mantenemos a la vanguardia de la tecnología para que siempre tengas las mejores herramientas IA.',
      buttonText: 'Novedades',
      buttonLink: '/auth/register',
      secondaryButtonText: 'Roadmap'
    }
  ];

  config = {
    spaceBetween: 0,
    slidesPerView: 1,
    pagination: {
      clickable: true,
      dynamicBullets: true,
      dynamicMainBullets: 3
    },
    loop: true,
    autoplay: {
      delay: 5000,
      disableOnInteraction: false,
    },
    effect: 'fade',
    fadeEffect: {
      crossFade: true
    },
    speed: 1000,
    allowTouchMove: true,
    grabCursor: true
  };

  constructor() { }

  ngOnInit() {
    // Component initialization
    this.startAutoplay();
  }

  currentSlideIndex = 0;
  private autoplayInterval: any;

  nextSlide() {
    this.currentSlideIndex = (this.currentSlideIndex + 1) % this.slides.length;
  }

  previousSlide() {
    this.currentSlideIndex = (this.currentSlideIndex - 1 + this.slides.length) % this.slides.length;
  }

  goToSlide(index: number) {
    this.currentSlideIndex = index;
    this.resetAutoplay();
  }

  private startAutoplay() {
    this.autoplayInterval = setInterval(() => {
      this.nextSlide();
    }, 5000);
  }

  private resetAutoplay() {
    if (this.autoplayInterval) {
      clearInterval(this.autoplayInterval);
      this.startAutoplay();
    }
  }

  ngOnDestroy() {
    if (this.autoplayInterval) {
      clearInterval(this.autoplayInterval);
    }
  }
}