import { AI_USAGE_GROUPS, USAGE_GROUP_QUOTA } from './ai-usage-groups.contract';

describe('USAGE_GROUP_QUOTA', () => {
  it('la búsqueda semántica no muestra cupo: los embeddings no se cobran ni se topan', () => {
    expect(AI_USAGE_GROUPS).toContain('semantic_search');
    expect(USAGE_GROUP_QUOTA.semantic_search).toBeNull();
  });

  it('las demás features conservan su barra de cupo', () => {
    expect(USAGE_GROUP_QUOTA.assistant).toEqual({
      feature: 'streaming_chat',
      unit: 'messages',
    });
    expect(USAGE_GROUP_QUOTA.jobs).toEqual({ feature: 'async_queue', unit: 'jobs' });
    expect(USAGE_GROUP_QUOTA.voice).toEqual({ feature: 'realtime_voice', unit: 'seconds' });
  });
});
