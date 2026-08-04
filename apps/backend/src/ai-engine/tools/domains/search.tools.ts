import { RegisteredTool } from '../interfaces/tool.interface';
import { EmbeddingService } from '../../embeddings/embedding.service';
import { EMBEDDABLE_ENTITY_TYPES } from '../../embeddings/embedding-events.listener';

export interface SearchToolDeps {
  embeddingService: EmbeddingService;
}

export function createSearchTools({
  embeddingService,
}: SearchToolDeps): RegisteredTool[] {
  // Sin embeddings configurados la herramienta no puede funcionar, y ofrecerla
  // es peor que no tenerla: el agente la elige por su descripción antes que
  // find_product, gasta ahí su iteración y contesta "no encontré nada" sobre
  // un producto que sí existe. Registrarla solo cuando puede responder.
  if (!embeddingService.isAvailable()) {
    return [];
  }

  return [
    {
      name: 'semantic_search',
      domain: 'search',
      readOnly: true,
      description:
        'Busca por significado, no por coincidencia exacta de texto: encuentra productos, clientes, órdenes, proveedores o gastos cuando la persona los describe con sus propias palabras ("la bebida de naranja", "el cliente del restaurante de la 80", "el pedido de las tres cajas de gaseosa", "el gasto del arriendo de agosto"). Si conoces el nombre exacto, prefiere find_product o find_customer, que son más baratos y precisos. Para dudas de cómo se usa la aplicación no sirve: eso está en `help-center/articles/search`.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Descripción en lenguaje natural de lo que se busca.',
          },
          entity_types: {
            type: 'array',
            items: {
              type: 'string',
              enum: [...EMBEDDABLE_ENTITY_TYPES],
            },
            description: 'Tipos de entidad a buscar. Por defecto, todos.',
          },
          limit: {
            type: 'number',
            description: 'Máximo de resultados. Por defecto 5.',
          },
        },
        required: ['query'],
      },
      handler: async (args, context) => {
        if (!context.store_id) {
          return JSON.stringify({
            error:
              'Sin tienda en contexto: la búsqueda semántica está acotada por tienda.',
          });
        }

        // La búsqueda semántica depende de embeddings, que no están
        // configurados en todos los entornos. Dejar que el error suba marca la
        // herramienta como fallida y el agente abandona el turno sin decir
        // nada: el usuario ve una respuesta vacía por una dependencia opcional.
        // Devolverlo como resultado con la alternativa concreta mantiene vivo
        // el bucle, que reintenta con find_product o find_customer.
        let results: Awaited<ReturnType<EmbeddingService['searchByText']>>;
        try {
          results = await embeddingService.searchByText(
            context.store_id,
            String(args.query),
            Array.isArray(args.entity_types)
              ? (args.entity_types as string[])
              : undefined,
            typeof args.limit === 'number' ? args.limit : 5,
          );
        } catch {
          return JSON.stringify({
            query: args.query,
            results: [],
            note: 'La búsqueda semántica no está disponible en este entorno. Vuelve a intentarlo con find_product o find_customer usando las palabras del usuario; no le digas que no encontraste nada sin haberlo intentado por nombre.',
          });
        }

        if (!results.length) {
          return JSON.stringify({
            query: args.query,
            results: [],
            note: 'Sin coincidencias por significado. La indexación es incremental: un registro creado hace un momento puede no estar indexado todavía, así que reintenta por nombre con find_product o find_customer antes de decirle que no existe.',
          });
        }

        return JSON.stringify({
          query: args.query,
          count: results.length,
          results,
        });
      },
    },
  ];
}
