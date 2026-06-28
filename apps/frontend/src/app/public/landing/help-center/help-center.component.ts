import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../shared/components/icon/icon.component';

interface FaqItem {
  id: string;
  question: string;
  answer: string;
  category: 'getting-started' | 'billing' | 'features' | 'support';
}

/**
 * Public Help Center — entry point for unauthenticated visitors
 * who need help. Mirrors the structure the user described:
 *  - Hero "¿Necesitas ayuda?" with a search input
 *  - FAQ list (placeholder content for now, ready to be hydrated
 *    from a backend endpoint when one exists)
 *  - "No encontraste una respuesta?" CTA that navigates to /pqr
 *    which opens the public PQR submission form
 */
@Component({
  selector: 'app-help-center',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, IconComponent],
  templateUrl: './help-center.component.html',
  styleUrls: ['./help-center.component.scss'],
})
export class HelpCenterComponent {
  /** Search input bound to the search box in the hero. */
  readonly searchQuery = signal('');

  /** FAQ items — static for now, will move to a backend fetch once
   *  there's a public knowledge-base endpoint. */
  readonly faqs = signal<FaqItem[]>([
    {
      id: 'pricing-1',
      category: 'billing',
      question: '¿Cuánto cuesta Vendix?',
      answer:
        'Durante el periodo de acceso anticipado, todas las funcionalidades están incluidas sin costo. Cuando lancemos los planes pagos, publicaremos los precios en esta misma página y por correo a todos los usuarios activos.',
    },
    {
      id: 'getting-started-1',
      category: 'getting-started',
      question: '¿Cómo creo mi tienda?',
      answer:
        'Haz clic en "Comenzar Gratis" en la parte superior, completa el formulario de registro con tu correo y sigue los pasos del wizard. En menos de 5 minutos tendrás tu tienda lista para recibir clientes.',
    },
    {
      id: 'features-1',
      category: 'features',
      question: '¿Puedo conectar Vendix con mi tienda física?',
      answer:
        'Sí. Vendix incluye un módulo POS (Punto de Venta) que sincroniza el inventario entre la tienda física y el e-commerce en tiempo real. Una misma bodega, dos canales de venta.',
    },
    {
      id: 'support-1',
      category: 'support',
      question: '¿Qué pasa si tengo un problema urgente con una venta?',
      answer:
        'Crea una solicitud desde el botón "Crear una solicitud" más abajo. Las solicitudes se atienden en orden de llegada, pero las marcadas como urgentes tienen prioridad.',
    },
  ]);

  /** FAQs filtered by the search query. Empty query → show everything. */
  readonly filteredFaqs = computed<FaqItem[]>(() => {
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return this.faqs();
    return this.faqs().filter(
      (f) =>
        f.question.toLowerCase().includes(q) ||
        f.answer.toLowerCase().includes(q),
    );
  });
}
