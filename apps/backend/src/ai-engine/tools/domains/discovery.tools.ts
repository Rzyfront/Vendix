import { RegisteredTool } from '../interfaces/tool.interface';

/** Loop-local state only. No mutable per-user catalog on this global factory. */
export function createDiscoveryTools(): RegisteredTool[] {
  return [
    {
      name: 'search_tools',
      version: '1',
      domain: 'discovery',
      readOnly: true,
      description:
        'Busca herramientas del índice del taller por intención en español, nombre o dominio, y CARGA las encontradas para tu siguiente respuesta (5 por defecto, máximo 10). Úsala cuando necesites algo que no tienes cargado o cuando cambie el tema. También puedes llamar directamente una herramienta del índice por su nombre exacto. No concede permisos ni sustituye la aprobación de escrituras.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Nombre canónico, alias o intención concreta (máximo 500 caracteres).',
          },
          domain: {
            type: 'string',
            description: 'Dominio opcional, tal como figura en el catálogo.',
          },
          intent: {
            type: 'string',
            description:
              'Contexto sintético adicional de la búsqueda, máximo 200 caracteres.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 10,
            description: 'Cuántas herramientas cargar (1 a 10, por defecto 5).',
          },
        },
        required: ['query'],
      },
      handler: async () =>
        JSON.stringify({
          error:
            'search_tools solo está disponible dentro de un turno con routing activo.',
          next_step:
            'Consulta list_capabilities o list_endpoints con tus permisos actuales.',
        }),
    },
  ];
}
