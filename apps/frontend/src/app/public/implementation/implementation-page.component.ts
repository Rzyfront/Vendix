import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { applyMarketingPageMetadata, MARKETING_PAGES } from '../marketing-page-metadata';

/** Una etapa de la puesta en marcha: qué pasa, qué haces tú y qué hace el equipo. */
export interface ImplementationStage {
  title: string;
  text: string;
  you?: string;
  team?: string;
}

/** WhatsApp de ventas y soporte (respuesta 17 del 22-oct). Sin datos personales en el mensaje. */
export const IMPLEMENTATION_WHATSAPP_URL =
  'https://wa.me/573234668500?text=' +
  encodeURIComponent('Hola, quiero contarles cómo trabaja mi negocio para empezar con Vendix.');

/**
 * SEO-OPS-19: página «Cómo empezamos con Vendix» (/implementacion).
 * Texto del 27-oct (entregas/2026-10-27/OPS-19-pagina-implementacion-copy.md), sin promesas
 * sin respaldo: no hay plazo de instalación, migración gratuita, visitas ni horarios garantizados.
 * Ruta detrás de IMPLEMENTATION_PAGE_ENABLED y en noindex hasta la aprobación.
 */
@Component({
  selector: 'app-implementation-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './implementation-page.component.html',
  styleUrls: ['../landing/guides/sector-guide.component.scss', './implementation-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImplementationPageComponent {
  private readonly restoreMarketingMetadata = applyMarketingPageMetadata(
    inject(DOCUMENT),
    inject(Title),
    inject(Meta),
    MARKETING_PAGES.implementation,
  );
  private readonly marketingMetadataCleanup = inject(DestroyRef).onDestroy(
    this.restoreMarketingMetadata,
  );

  readonly whatsappUrl = IMPLEMENTATION_WHATSAPP_URL;

  readonly included: readonly string[] = [
    'Crear tu usuario.',
    'Hacer la configuración inicial de tu tienda.',
    'Crear tu primer producto o cargar tu primera lista de productos.',
  ];

  readonly stages: readonly ImplementationStage[] = [
    {
      title: 'Te escuchamos',
      text: 'Por WhatsApp o correo nos cuentas qué vendes, cuántas tiendas tienes, quiénes van a usar el sistema y dónde está hoy tu lista de productos: Excel, otro programa o papel. Te decimos qué plan te sirve y, con la misma claridad, qué no hace Vendix todavía.',
      you: 'cuentas cómo vendes y qué quieres resolver primero.',
      team: 'te recomendamos el plan y te explicamos el alcance.',
    },
    {
      title: 'Configuramos tu tienda',
      text: 'Te ayudamos a crear tu usuario y a dejar lista la configuración inicial de la tienda.',
      you: 'decides los ajustes de tu negocio y, si vas a facturar electrónicamente, tramitas tu certificado y tu resolución de numeración.',
      team: 'te acompañamos en la configuración y te orientamos con la DIAN.',
    },
    {
      title: 'Cargas tus datos',
      text: 'Te ayudamos con el primer producto o la primera lista. El resto lo pasas tú con nuestras plantillas de importación de productos, servicios, clientes e inventario, en Excel (.xlsx o .xls) o CSV. Así controlas lo que entra y revisas precios y cantidades antes de vender. Las facturas, la contabilidad y los reportes de tu sistema anterior no se trasladan.',
    },
    {
      title: 'Aprendes haciendo',
      text: 'Mientras creas tu primer producto con nuestra ayuda, aprendes a hacerlo solo. Si te quedas en algún paso, nos escribes.',
      you: 'practicas con tu propio negocio y les enseñas a tus empleados.',
      team: 'resolvemos tus dudas por WhatsApp o correo.',
    },
    {
      title: 'Pruebas antes de vender',
      text: 'Tienes 14 días de prueba del plan Empresarial Pro, sin tarjeta. Haz ventas de ensayo, revisa que las cantidades se descuenten como esperas y prueba en tu navegador los equipos que vas a usar, como impresora o lector de código de barras. Para emitir facturas electrónicas necesitas el certificado digital de tu comercio.',
    },
    {
      title: 'Sales a vender',
      text: 'Tú eliges el día. Cuentas tu inventario real, lo dejas igual en Vendix y haces tu primera venta. Contratas tu plan desde la plataforma. Si la prueba termina sin contratar, tu tienda queda en modo de solo consulta hasta que actives un plan.',
    },
    {
      title: 'Seguimos contigo',
      text: 'Después del arranque nos escribes por WhatsApp al +57 323 466 8500 o a soporte@vendix.online.',
    },
  ];

  readonly responsibilities: readonly { you: string; team: string }[] = [
    { you: 'Nos cuentas cómo trabajas', team: 'Te recomendamos el plan y te explicamos el alcance' },
    { you: 'Decides los ajustes de tu tienda', team: 'Te ayudamos a crear tu usuario y con la configuración inicial' },
    { you: 'Tramitas tu certificado y tu resolución ante la DIAN', team: 'Te orientamos en el proceso' },
    { you: 'Llenas las plantillas y cargas tu catálogo', team: 'Te ayudamos con el primer producto o la primera lista' },
    { you: 'Revisas precios y cantidades', team: 'Cotizamos la carga por nuestra cuenta, si la necesitas' },
    { you: 'Pruebas, eliges el día y vendes', team: 'Respondemos tus dudas por WhatsApp y correo' },
  ];

  readonly notPromised: readonly string[] = [
    'Un tiempo fijo de instalación o de puesta en marcha.',
    'Pasar todos tus datos por ti sin costo.',
    'Traer facturas, contabilidad o reportes de tu sistema anterior.',
    'Conexiones con otros programas.',
    'Visitas presenciales o capacitación en sitio.',
    'Horarios o tiempos de respuesta garantizados.',
  ];

  readonly faqs: readonly { question: string; answer: string }[] = [
    {
      question: '¿La implementación tiene costo?',
      answer:
        'La ayuda para crear tu usuario, la configuración inicial y el primer producto o la primera lista vienen con tu plan. Si quieres que el equipo cargue muchos productos por ti, eso es implementación avanzada y se cotiza por horas.',
    },
    {
      question: '¿Cuánto tarda la puesta en marcha?',
      answer:
        'Depende de cuántos productos tengas y de cuánto tiempo le dediques a las plantillas. No te damos un plazo fijo. Si vas a facturar electrónicamente, el tiempo de la DIAN tampoco depende de nosotros.',
    },
    {
      question: '¿Me migran los datos de mi programa anterior?',
      answer:
        'No. Tú pasas tu información a nuestras plantillas e importas el archivo desde el panel. Te ayudamos con la primera lista y resolvemos tus dudas.',
    },
    {
      question: '¿Tienen capacitación?',
      answer:
        'Aprendes haciendo, con nuestro acompañamiento en tus primeros pasos y respuesta a tus dudas por WhatsApp y correo.',
    },
    {
      question: '¿Vienen a mi negocio?',
      answer: 'No. La atención es remota, por WhatsApp y correo, para negocios de toda Colombia.',
    },
    {
      question: '¿Qué pasa si la prueba termina y no he contratado?',
      answer:
        'Tu tienda queda en modo de solo consulta: puedes ver tu información, pero no registrar ventas ni hacer cambios hasta que actives un plan.',
    },
    {
      question: '¿Puedo irme cuando quiera?',
      answer: 'Sí. No hay permanencia: cancelas cuando quieras.',
    },
  ];
}
