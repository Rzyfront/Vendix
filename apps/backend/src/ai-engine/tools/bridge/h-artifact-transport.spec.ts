import { RequestContextService } from '../../../common/context/request-context.service';
import { readArtifactPage } from '../../context/tool-result-compaction';
import { ApiCatalogService } from './api-catalog.service';
import { createApiBridgeTools } from './api-bridge.tools';

describe('H bridge preserves full data before persistence and bounded artifact readers', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {});
  afterEach(() => {
    global.fetch = originalFetch;
  });
  async function bridge(body: string, readAllowed = true) {
    const catalog = new ApiCatalogService(
      {} as never,
      {} as never,
      {} as never,
    );
    const path = 'store/vexi/objectives/:id/results/:resultId';
    Object.assign(catalog, {
      entries: [
        {
          path,
          method: 'GET',
          area: 'store',
          domain: 'vexi',
          controller: 'Vexi',
          handler: 'artifact',
          requiredPermissions: ['read'],
        },
      ],
    });
    const fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, text: async () => body });
    global.fetch = fetch;
    const tools = createApiBridgeTools({ catalog, attachments: {} as never });
    const result = await RequestContextService.runIsolated(
      {
        user_id: 1,
        organization_id: 2,
        store_id: 3,
        permissions: readAllowed ? ['read'] : [],
        roles: [],
        is_owner: false,
        is_super_admin: false,
        access_token: 'synthetic-test-only',
      },
      () =>
        tools.find((tool) => tool.name === 'call_endpoint')!.handler!(
          { path: 'store/vexi/objectives/abc/results/def' },
          {},
        ),
    );
    return { result, fetch };
  }
  it.each(['true', 'false'])(
    'preserves full escaped JSON over6000 chars with routing=%s',
    async (routing) => {
      const body = JSON.stringify({
        data: Array.from({ length: 300 }, (_, id) => ({
          id,
          note: '\0"\\'.repeat(40),
        })),
      });
      const response = await bridge(body);
      expect(body.length).toBeGreaterThan(6000);
      expect(response.result).toBe(body);
      expect(response.fetch).toHaveBeenCalledTimes(1);
    },
  );
  it('does not paginate the D1 reader again and lose its artifact_cursor/units', async () => {
    const page = readArtifactPage(
      Array.from({ length: 90 }, (_, id) => ({ id })),
      { limit: 20 },
    );
    const body = JSON.stringify({
      success: true,
      data: { ...page, next_query: { artifact_cursor: page.cursor } },
    });
    expect((await bridge(body)).result).toBe(body);
    expect(
      JSON.parse((await bridge(body)).result).data.next_query.artifact_cursor,
    ).toBe(page.cursor);
  });
  it('never skips catalog permissions to retrieve an artifact', async () => {
    const response = await bridge('{"secret":"foreign"}', false);
    expect(response.fetch).not.toHaveBeenCalled();
    expect(response.result).not.toContain('foreign');
  });
});
