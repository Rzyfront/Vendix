import { getPrismaClient, disconnectPrisma } from './shared/client';

const prisma = getPrismaClient();

const categories = [
  { name: 'Primeros Pasos', slug: 'primeros-pasos', description: 'Guías para comenzar a usar Vendix', icon: 'rocket', sort_order: 0 },
  { name: 'Punto de Venta', slug: 'punto-de-venta', description: 'Todo sobre el módulo POS', icon: 'store', sort_order: 1 },
  { name: 'Inventario', slug: 'inventario', description: 'Gestión de inventario y stock', icon: 'warehouse', sort_order: 2 },
  { name: 'Órdenes', slug: 'ordenes', description: 'Gestión de órdenes de venta y compra', icon: 'cart', sort_order: 3 },
  { name: 'E-commerce', slug: 'e-commerce', description: 'Configuración de tu tienda online', icon: 'shopping-bag', sort_order: 4 },
  { name: 'Configuración', slug: 'configuracion', description: 'Ajustes generales y personalización', icon: 'settings', sort_order: 5 },
];

const articles = [
  {
    title: 'Cómo crear tu primera venta en el POS',
    slug: 'como-crear-primera-venta-pos',
    summary: 'Aprende paso a paso cómo realizar tu primera venta usando el Punto de Venta de Vendix.',
    content: `## Realizando tu primera venta

### 1. Accede al Punto de Venta
Desde el menú lateral, haz clic en **Punto de Venta**. Se abrirá la interfaz del POS con tus productos disponibles.

### 2. Agrega productos al carrito
- Busca productos usando la barra de búsqueda o navega por categorías
- Haz clic en un producto para agregarlo al carrito
- Ajusta la cantidad si es necesario

### 3. Selecciona el método de pago
- Haz clic en **Cobrar** cuando el carrito esté listo
- Selecciona el método de pago (efectivo, tarjeta, transferencia)
- Si es en efectivo, ingresa el monto recibido para calcular el cambio

### 4. Confirma la venta
- Revisa el resumen de la venta
- Haz clic en **Confirmar** para completar la transacción
- Se generará automáticamente un recibo

¡Felicidades! Has completado tu primera venta.`,
    type: 'TUTORIAL' as const,
    category_slug: 'punto-de-venta',
    module: 'pos',
    tags: ['pos', 'ventas', 'inicio'],
    is_featured: true,
  },
  {
    title: 'Configurar métodos de pago',
    slug: 'configurar-metodos-de-pago',
    summary: 'Guía para activar y configurar los métodos de pago disponibles en tu tienda.',
    content: `## Métodos de Pago

### Acceder a la configuración
Ve a **Configuración → Métodos de Pago** desde el menú lateral.

### Métodos disponibles
- **Efectivo**: Siempre disponible, permite calcular cambio automáticamente
- **Tarjeta de crédito/débito**: Configura tu procesador de pagos
- **Transferencia bancaria**: Agrega tus datos bancarios para transferencias
- **Nequi / Daviplata**: Billeteras digitales populares en Colombia

### Activar un método
1. Encuentra el método de pago en la lista
2. Activa el toggle correspondiente
3. Completa la información requerida (si aplica)
4. Guarda los cambios

Los métodos activados aparecerán automáticamente en el POS al momento de cobrar.`,
    type: 'GUIDE' as const,
    category_slug: 'configuracion',
    module: 'settings',
    tags: ['pagos', 'configuración'],
    is_featured: false,
  },
  {
    title: '¿Cómo ajustar el inventario manualmente?',
    slug: 'como-ajustar-inventario-manualmente',
    summary: 'Aprende a realizar ajustes de stock cuando hay diferencias entre el inventario físico y el sistema.',
    content: `## Ajustes de Inventario

### ¿Cuándo hacer un ajuste?
- Después de un conteo físico que revela diferencias
- Cuando hay productos dañados o vencidos
- Para corregir errores de entrada

### Pasos para crear un ajuste
1. Ve a **Inventario → Ajustes de Stock**
2. Haz clic en **Nuevo Ajuste**
3. Selecciona el tipo de ajuste (incremento o decremento)
4. Busca y selecciona los productos a ajustar
5. Ingresa la cantidad correcta y una razón del ajuste
6. Revisa y confirma el ajuste

### Importante
- Todos los ajustes quedan registrados con fecha, usuario y razón
- Los ajustes actualizan el stock en tiempo real
- Tu administrador puede ver el historial completo de ajustes`,
    type: 'FAQ' as const,
    category_slug: 'inventario',
    module: 'inventory',
    tags: ['inventario', 'stock', 'ajustes'],
    is_featured: false,
  },
  {
    title: 'Primeros pasos con Vendix',
    slug: 'primeros-pasos-con-vendix',
    summary: 'Todo lo que necesitas saber para comenzar a usar Vendix y gestionar tu negocio.',
    content: `## Bienvenido a Vendix

### ¿Qué es Vendix?
Vendix es una plataforma integral de gestión comercial que te permite administrar tu negocio desde un solo lugar: punto de venta, inventario, órdenes, clientes y más.

### Tu Panel Principal
Al iniciar sesión, verás el **Panel Principal** con un resumen de:
- Ventas del día
- Productos más vendidos
- Estado del inventario
- Últimas órdenes

### Módulos principales
1. **Punto de Venta (POS)**: Realiza ventas rápidamente
2. **Productos**: Gestiona tu catálogo
3. **Inventario**: Controla tu stock
4. **Órdenes**: Administra ventas y compras
5. **Clientes**: Conoce a tus compradores
6. **E-commerce**: Tu tienda online
7. **Analíticas**: Métricas de tu negocio

### Siguiente paso
Te recomendamos comenzar por **agregar tus productos** y luego **realizar tu primera venta** en el POS.`,
    type: 'GUIDE' as const,
    category_slug: 'primeros-pasos',
    module: null,
    tags: ['inicio', 'onboarding', 'guía'],
    is_featured: true,
  },
  {
    title: '¿Cómo crear una orden de compra?',
    slug: 'como-crear-orden-de-compra',
    summary: 'Aprende a generar órdenes de compra para reabastecer tu inventario desde proveedores.',
    content: `## Órdenes de Compra

### ¿Qué es una orden de compra?
Una orden de compra (PO) es un documento que envías a tu proveedor para solicitar productos. En Vendix, puedes crearlas desde el módulo de Inventario.

### Crear una orden de compra
1. Ve a **Inventario → Punto de Compra**
2. Haz clic en **Nueva Orden**
3. Selecciona el proveedor
4. Agrega los productos que deseas comprar con sus cantidades
5. Revisa los precios y totales
6. Confirma la orden

### Estados de una orden
- **Borrador**: Orden en preparación
- **Enviada**: Orden enviada al proveedor
- **Recibida parcial**: Se recibió parte del pedido
- **Completada**: Todo el pedido fue recibido
- **Cancelada**: Orden cancelada

### Al recibir mercancía
Cuando recibes los productos, marca la orden como recibida y el inventario se actualizará automáticamente.`,
    type: 'TUTORIAL' as const,
    category_slug: 'ordenes',
    module: 'orders',
    tags: ['compras', 'proveedores', 'inventario'],
    is_featured: false,
  },
  {
    title: 'Configurar tu tienda E-commerce',
    slug: 'configurar-tienda-ecommerce',
    summary: 'Guía completa para activar y personalizar tu tienda online con Vendix.',
    content: `## Tu Tienda Online

### Activar E-commerce
1. Ve a **Configuración → General**
2. Asegúrate de que tu tipo de tienda sea **Híbrida** u **Online**
3. Configura tu dominio personalizado en **Configuración → Dominios**

### Personalizar apariencia
En **Configuración → Apariencia** puedes:
- Subir tu logo y favicon
- Elegir colores principales
- Configurar el banner de inicio

### Productos en línea
Tus productos del catálogo estarán disponibles automáticamente en la tienda online. Puedes controlar:
- Qué productos se muestran
- Precios diferenciados para online
- Imágenes y descripciones detalladas

### Métodos de envío
Configura las opciones de entrega en **Configuración → Envíos**:
- Envío a domicilio
- Recogida en tienda
- Envío gratis por monto mínimo`,
    type: 'GUIDE' as const,
    category_slug: 'e-commerce',
    module: 'ecommerce',
    tags: ['ecommerce', 'tienda online', 'configuración'],
    is_featured: true,
  },
];

export async function seedHelpArticles() {
  console.log('🔵 Seeding help article categories...');

  // Upsert categories
  const category_map: Record<string, number> = {};
  for (const cat of categories) {
    const result = await prisma.help_article_categories.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name, description: cat.description, icon: cat.icon, sort_order: cat.sort_order },
      create: cat,
    });
    category_map[cat.slug] = result.id;
  }

  console.log(`   ✅ ${categories.length} categories upserted`);

  console.log('🔵 Seeding help articles...');

  for (const article of articles) {
    const { category_slug, ...article_data } = article;
    const category_id = category_map[category_slug];

    await prisma.help_articles.upsert({
      where: { slug: article_data.slug },
      update: {
        title: article_data.title,
        summary: article_data.summary,
        content: article_data.content,
        type: article_data.type,
        category_id,
        module: article_data.module,
        tags: article_data.tags,
        is_featured: article_data.is_featured,
        status: 'PUBLISHED',
      },
      create: {
        ...article_data,
        category_id,
        status: 'PUBLISHED',
      },
    });
  }

  console.log(`   ✅ ${articles.length} articles upserted`);
}

// Allow running standalone
if (require.main === module) {
  seedHelpArticles()
    .then(async () => {
      console.log('✅ Help articles seed completed');
      await disconnectPrisma();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error('❌ Help articles seed failed:', e);
      await disconnectPrisma();
      process.exit(1);
    });
}
