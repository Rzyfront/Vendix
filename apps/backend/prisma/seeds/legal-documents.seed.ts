import { PrismaClient, legal_document_type_enum } from '@prisma/client';

export async function seedLegalDocuments(prisma: PrismaClient) {
  console.log('📜 Seeding legal documents...');

  async function systemUpsert(data: {
    document_type: legal_document_type_enum;
    title: string;
    version: string;
    content: string;
    is_active: boolean;
    is_system: boolean;
    description?: string;
    effective_date: Date;
  }) {
    const existing = await prisma.legal_documents.findFirst({
      where: {
        version: data.version,
        document_type: data.document_type,
        store_id: null,
        organization_id: null,
      },
    });

    if (existing) {
      return prisma.legal_documents.update({
        where: { id: existing.id },
        data,
      });
    } else {
      return prisma.legal_documents.create({
        data,
      });
    }
  }

  const termsOfService = await systemUpsert({
    document_type: 'TERMS_OF_SERVICE',
    title: 'Términos y Condiciones de Uso de Vendix',
    version: '1.0',
    content: `
Última actualización: ${new Date().toLocaleDateString('es-CO')}

## Aceptación de los Términos
Al acceder y usar la plataforma Vendix, usted acepta y se obliga a cumplir estos términos. Si no está de acuerdo con estos términos, no debe usar la plataforma.

## Descripción del Servicio
Vendix es una plataforma de gestión comercial que proporciona herramientas para administración de tiendas, ventas, inventario y operaciones empresariales.

## Obligaciones del Usuario
- Mantener la confidencialidad de las credenciales de acceso
- Proporcionar información veraz y actualizada
- Utilizar la plataforma solamente para fines legítimos
- Responsabilizarse por el contenido que publique

## Propiedad Intelectual
Todo el contenido, marcas, logos y materiales de Vendix son propiedad exclusiva de Vendix o de sus licenciantes.

## Limitación de Responsabilidad
Vendix no se hace responsable por:
- Daños indirectos o consecuentes del uso del servicio
- Interrupciones del servicio por causas técnicas
- Contenido generado por usuarios

## Pagos y Reembolsos
El acceso a los planes y funcionalidades de pago de Vendix se factura por adelantado según el ciclo de facturación seleccionado (mensual o anual). Al contratar un plan, usted autoriza a Vendix a cobrar de forma recurrente el valor correspondiente a través del método de pago registrado, hasta que la suscripción sea cancelada.
Las suscripciones a la plataforma Vendix no son reembolsables. La cancelación de una suscripción detiene las renovaciones futuras, pero no genera reembolso total ni parcial por el período ya pagado; el servicio permanecerá activo hasta el final del ciclo de facturación en curso. Esta política de no-reembolso aplica salvo que la ley colombiana disponga lo contrario o exista un acuerdo escrito en sentido distinto.

## Modificaciones
Vendix se reserva el derecho de modificar estos términos en cualquier momento. Los usuarios serán notificados de cambios significativos.

## Terminación
Vendix puede suspender o terminar cuentas que violen estos términos.

## Ley Aplicable
Estos términos se rigen por las leyes de Colombia. Cualquier controversia estará sujeta a los tribunales competentes.

Para más información, contacte a legal@vendix.com
      `,
    effective_date: new Date(),
    is_active: true,
    is_system: true,
    description: 'Términos y condiciones generales de uso de la plataforma Vendix',
  });

  const privacyPolicy = await systemUpsert({
    document_type: 'PRIVACY_POLICY',
    title: 'Política de Privacidad de Vendix',
    version: '1.0-privacy',
    content: `
Última actualización: ${new Date().toLocaleDateString('es-CO')}

## Información que Recopilamos
Vendix recopila la siguiente información personal:
- Datos de registro (nombre, email, teléfono)
- Información de perfil y preferencias
- Datos de uso de la plataforma
- Información de pagos (cuando aplica)

## Cómo Usamos su Información
Utilizamos su información para:
- Proporcionar y mejorar nuestros servicios
- Procesar transacciones y pagos
- Enviar notificaciones y comunicaciones
- Analizar patrones de uso
- Cumplir obligaciones legales

## Compartición de Información
No vendemos su información personal a terceros. Podemos compartir datos con:
- Proveedores de servicios necesarios para operar la plataforma
- Autoridades gubernamentales cuando sea requerido
- Socios de crédito y procesamiento de pagos

## Seguridad de Datos
Implementamos medidas de seguridad incluyendo:
- Encriptación de datos en tránsito y en reposo
- Control de acceso con autenticación requerida
- Monitoreo continuo de actividades sospechosas
- Auditoría de accesos y modificaciones

## Sus Derechos
Usted tiene derecho a:
- Acceder a sus datos personales
- Solicitar corrección o eliminación
- Revocar consentimientos
- Exportar su información
- Oponerse al procesamiento de datos

## Retención de Datos
Mantenemos su información solo el tiempo necesario para:
- Proporcionar los servicios contratados
- Cumplir requisitos legales y contables
- Resolver disputas y defensas legales

## Cookies y Tecnologías Similares
Utilizamos cookies y tecnologías similares para:
- Mantener su sesión activa
- Recordar sus preferencias
- Analizar el uso de la plataforma

## Contacto
Para preguntas sobre privacidad, contacte a: privacy@vendix.com

## Cambios en esta Política
Nos reservamos el derecho de actualizar esta política. Le notificaremos cambios significativos.
      `,
    effective_date: new Date(),
    is_active: true,
    is_system: true,
    description: 'Política de privacidad y protección de datos personales',
  });

  const merchantAgreement = await systemUpsert({
    document_type: 'MERCHANT_AGREEMENT',
    title: 'Acuerdo de Comerciante de Vendix',
    version: '1.0-merchant',
    content: `
        <h1>Acuerdo de Comerciante de Vendix</h1>
        <p>Última actualización: ${new Date().toLocaleDateString('es-CO')}</p>

        <h2>1. Objeto del Acuerdo</h2>
        <p>Este acuerdo rige la relación entre Vendix y los comerciantes que utilizan la plataforma para gestionar sus operaciones comerciales.</p>

        <h2>2. Servicios Contratados</h2>
        <p>Vendix proporciona:</p>
        <ul>
          <li>Plataforma de gestión de inventario</li>
          <li>Sistema de punto de venta (POS)</li>
          <li>Gestión de pedidos y ventas</li>
          <li>Reportes y analíticas</li>
          <li>Integraciones con pasarelas de pago</li>
        </ul>

        <h2>3. Responsabilidades del Comerciante</h2>
        <p>El comerciante se compromete a:</p>
        <ul>
          <li>Mantener actualizada la información de sus productos</li>
          <li>Honorar los precios y promociones publicadas</li>
          <li>Entregar los productos vendidos según lo pactado</li>
          <li>Cumplir con las leyes comerciales aplicables</li>
          <li>Responder a consultas y reclamos en tiempo razonable</li>
        </ul>

        <h2>4. Tarifas y Comisiones</h2>
        <p>El uso de la plataforma está sujeto a tarifas y comisiones establecidas en el contrato de servicio.</p>

        <h2>5. Propiedad Intelectual</h2>
        <p>El comerciante mantiene la propiedad de su información de productos y clientes. Vendix conserva la propiedad de la plataforma y tecnología.</p>

        <h2>6. Confidencialidad</h2>
        <p>Ambas partes acuerdan mantener confidencial la información comercial y técnica intercambiada.</p>

        <h2>7. Duración</h2>
        <p>Este acuerdo tiene vigencia indefinida sujeto a terminación por cualquiera de las partes con 30 días de notificación.</p>

        <h2>8. Jurisdicción</h2>
        <p>Este acuerdo se rige por las leyes de Colombia. Cualquier controversia se resolverá en los tribunales competentes.</p>
      `,
    effective_date: new Date(),
    is_active: true,
    is_system: true,
    description: 'Acuerdo marco para comerciantes que utilizan Vendix',
  });

  const refundPolicy = await systemUpsert({
    document_type: 'REFUND_POLICY',
    title: 'Política de Reembolso - Estándar Vendix',
    version: '1.0-refund',
    content: `
        <h1>Política de Reembolso</h1>
        <p>Última actualización: ${new Date().toLocaleDateString('es-CO')}</p>

        <h2>1. Condiciones Generales</h2>
        <p>Los clientes pueden solicitar reembolso dentro de los siguientes plazos:</p>
        <ul>
          <li>Productos digitales: 7 días calendario desde la compra</li>
          <li>Productos físicos: 15 días calendario desde la recepción</li>
        </ul>

        <h2>2. Requisitos para Reembolso</h2>
        <p>Para ser elegible para reembolso, el producto debe:</p>
        <ul>
          <li>Estar en su condición original (sin uso)</li>
          <li>Incluir todos los accesorios y empaque original</li>
          <li>Tener recibo o comprobante de compra</li>
          <li>No estar excluido por categorías especiales (higiénico, personalizado)</li>
        </ul>

        <h2>3. Productos No Reembolsables</h2>
        <p>No se aceptan reembolsos para:</p>
        <ul>
          <li>Productos sellados con descuento mayor al 50%</li>
          <li>Productos personalizados fabricados bajo pedido</li>
          <li>Productos de categorías higiénicas una vez abiertos</li>
          <li>Productos digitales descargados</li>
        </ul>

        <h2>4. Proceso de Reembolso</h2>
        <ol>
          <li>Solicitar reembolso a través de la plataforma</li>
          <li>Autorizar la devolución del producto</li>
          <li>Enviar el producto a la dirección especificada</li>
          <li>Recibir el reembolso en el método de pago original</li>
        </ol>

        <h2>5. Costos de Envío</h2>
        <p>Los costos de envío de devolución son responsabilidad del cliente, excepto cuando el reembolso se debe a defecto del producto.</p>

        <h2>6. Tiempos de Procesamiento</h2>
        <p>Los reembolsos se procesan dentro de 5-10 días hábiles después de recibir el producto devuelto.</p>

        <h2>7. Métodos de Reembolso</h2>
        <p>Los reembolsos se acreditan al mismo método de pago utilizado en la compra original.</p>
      `,
    effective_date: new Date(),
    is_active: true,
    is_system: true,
    description: 'Política de reembolsos estándar para todas las tiendas',
  });

  const shippingPolicy = await systemUpsert({
    document_type: 'SHIPPING_POLICY',
    title: 'Política de Envíos - Estándar Vendix',
    version: '1.0-shipping',
    content: `
        <h1>Política de Envíos</h1>
        <p>Última actualización: ${new Date().toLocaleDateString('es-CO')}</p>

        <h2>1. Zonas de Cobertura</h2>
        <p>Realizamos envíos a todo el territorio nacional colombiano.</p>

        <h2>2. Tiempos de Entrega</h2>
        <p>Los tiempos de entrega estimados son:</p>
        <ul>
          <li>Principales ciudades: 2-3 días hábiles</li>
          <li>Otras ciudades: 3-5 días hábiles</li>
          <li>Zonas rurales: 5-7 días hábiles</li>
        </ul>

        <h2>3. Costos de Envío</h2>
        <p>Los costos se calculan según:</p>
        <ul>
          <li>Ubicación geográfica</li>
          <li>Peso y dimensiones del paquete</li>
          <li>Método de envío seleccionado</li>
        </ul>

        <h2>4. Métodos de Envío Disponibles</h2>
        <ul>
          <li>Envío estándar (servicios de mensajería)</li>
          <li>Envío exprés (servicios de paquetería)</li>
          <li>Recogida en tienda (cuando está disponible)</li>
        </ul>

        <h2>5. Seguimiento de Pedidos</h2>
        <p>Los clientes pueden seguir el estado de su envío a través de la plataforma con número de guía.</p>

        <h2>6. Pérdidas o Daños</h2>
        <p>El transportista es responsable por:</p>
        <ul>
          <li>Pérdida total del paquete</li>
          <li>Daños visibles al empaque o contenido</li>
        </ul>
        <p>Recomendamos fotografiar el paquete antes del envío.</p>

        <h2>7. Dirección Incompleta</h2>
        <p>Si la dirección proporcionada es incompleta o incorrecta, se contactará al cliente para corregirla. Esto puede generar costos adicionales.</p>
      `,
    effective_date: new Date(),
    is_active: true,
    is_system: true,
    description: 'Política de envíos estándar para todas las tiendas',
  });

  const cookiesPolicy = await systemUpsert({
    document_type: 'COOKIES_POLICY',
    title: 'Política de Cookies de Vendix',
    version: '1.0-cookies',
    content: `
Última actualización: ${new Date().toLocaleDateString('es-CO')}

## ¿Qué son las Cookies?
Las cookies son pequeños archivos de texto que los sitios web almacenan en su dispositivo (computador, teléfono o tableta) cuando los visita. Permiten que la plataforma recuerde información sobre su visita, facilitando su uso y mejorando su experiencia.

## Tipos de Cookies que Usamos
En Vendix utilizamos distintos tipos de cookies según su finalidad:
- **Cookies de sesión:** mantienen su sesión activa mientras navega y se eliminan al cerrar el navegador.
- **Cookies de preferencias:** recuerdan sus configuraciones, como idioma, moneda y preferencias de visualización.
- **Cookies analíticas:** nos ayudan a entender cómo se usa la plataforma de forma agregada y anónima para mejorar nuestros servicios.

## Cookies de Sesión
Estas cookies son esenciales para el funcionamiento de la plataforma. Permiten autenticarlo, mantener su sesión iniciada y proteger su cuenta. Sin ellas, no es posible ofrecer las funcionalidades básicas del servicio.

## Cookies de Preferencias
Estas cookies almacenan las decisiones que usted toma, como el idioma seleccionado o la región, de modo que no tenga que volver a configurarlas en cada visita. Mejoran la comodidad de uso pero no son estrictamente indispensables.

## Cookies Analíticas
Utilizamos cookies analíticas para recopilar información sobre el uso de la plataforma, tales como páginas visitadas y tiempo de navegación. Esta información se trata de forma agregada y nos permite identificar mejoras y detectar problemas técnicos.

## Gestión y Configuración de Cookies
Usted puede gestionar o desactivar las cookies en cualquier momento desde la configuración de su navegador. Tenga en cuenta que deshabilitar ciertas cookies, especialmente las de sesión, puede afectar el funcionamiento de la plataforma e impedir el acceso a algunas funcionalidades.

## Cookies de Terceros
Algunos servicios integrados en Vendix, como proveedores de analítica o pasarelas de pago, pueden establecer sus propias cookies. Estas cookies se rigen por las políticas de privacidad de dichos terceros, sobre las cuales recomendamos informarse.

## Cambios en esta Política
Nos reservamos el derecho de actualizar esta Política de Cookies para reflejar cambios técnicos, legales o en nuestros servicios. Le notificaremos cambios significativos a través de la plataforma.

## Contacto
Para preguntas sobre el uso de cookies, contacte a: privacy@vendix.com
      `,
    effective_date: new Date(),
    is_active: true,
    is_system: true,
    description: 'Política de uso de cookies y tecnologías similares de la plataforma Vendix',
  });

  console.log('✅ Legal documents seeded successfully');
  console.log(`   - ${termsOfService.title} v${termsOfService.version}`);
  console.log(`   - ${privacyPolicy.title} v${privacyPolicy.version}`);
  console.log(`   - ${merchantAgreement.title} v${merchantAgreement.version}`);
  console.log(`   - ${refundPolicy.title} v${refundPolicy.version}`);
  console.log(`   - ${shippingPolicy.title} v${shippingPolicy.version}`);
  console.log(`   - ${cookiesPolicy.title} v${cookiesPolicy.version}`);
}
