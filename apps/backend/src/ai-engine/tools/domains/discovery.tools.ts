import { pageParameters } from '../discovery-pagination';
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
        'Busca herramientas autorizadas omitidas por relevancia, por nombre exacto/alias, intención en español o dominio. Habilita sus definiciones SOLO en la siguiente inferencia. Dos ampliaciones: 12→24→40 operativas. No concede permisos ni sustituye la aprobación de escrituras. Si no aparece una capacidad rara usa list_capabilities y list_endpoints con el bridge autorizado.',
      parameters: {
        type: 'object',
        properties: {
          ...pageParameters,
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
