import { GeocodingService } from './geocoding.service';
import type { GeocodeCandidate } from './colombian-address.util';

/** Minimal fetch Response stand-in — only what the service reads. */
function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

const ADMIN_ONLY: GeocodeCandidate[] = [
  {
    lat: '4.6097',
    lon: '-74.0817',
    addresstype: 'city',
    type: 'administrative',
    address: { city: 'Bogotá' },
  },
];

const STREET_MATCH: GeocodeCandidate[] = [
  {
    lat: '4.65',
    lon: '-74.05',
    addresstype: 'road',
    address: { road: 'Carrera 13', city: 'Bogotá' },
  },
];

const EXACT_MATCH: GeocodeCandidate[] = [
  {
    lat: '4.651',
    lon: '-74.051',
    addresstype: 'house',
    address: {
      road: 'Carrera 13',
      house_number: '62-40',
      city: 'Bogotá',
    },
  },
];

/** Overpass `elements` for a Carrera 13 / Calle 62 intersection at one point. */
const INTERSECTION_ELEMENTS = {
  elements: [
    {
      tags: { name: 'Carrera 13', highway: 'residential' },
      geometry: [{ lat: 4.65, lon: -74.05 }],
    },
    {
      tags: { name: 'Calle 62', highway: 'residential' },
      geometry: [{ lat: 4.65, lon: -74.05 }],
    },
  ],
};

describe('GeocodingService.forward — cascade + candidate selection (mocked fetch)', () => {
  let redis: { get: jest.Mock; set: jest.Mock };
  let service: GeocodingService;
  let fetchMock: jest.Mock;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };
    service = new GeocodingService(redis as never);
    originalFetch = global.fetch;
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('resolves via the DANE intersection step and never calls Nominatim', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('overpass') || String(url).includes('mail.ru')) {
        return Promise.resolve(jsonResponse(INTERSECTION_ELEMENTS));
      }
      return Promise.resolve(jsonResponse([]));
    });

    const result = await service.forward('Cra 13 # 62-40, Bogotá, Colombia');

    expect(result.lat).toBeCloseTo(4.65);
    expect(result.lng).toBeCloseTo(-74.05);
    expect(result.precision).toBe('intersection');
    // Every fetch this test made must have targeted an Overpass mirror.
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u.includes('overpass') || u.includes('mail.ru')).toBe(true);
    }
  });

  it('falls through to structured search when Overpass finds no intersection', async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('overpass') || u.includes('mail.ru')) {
        return Promise.resolve(jsonResponse({ elements: [] }));
      }
      if (u.includes('street=')) {
        return Promise.resolve(jsonResponse(EXACT_MATCH));
      }
      return Promise.resolve(jsonResponse([]));
    });

    const result = await service.forward('Cra 13 # 62-40, Bogotá, Colombia');

    expect(result.lat).toBeCloseTo(4.651);
    expect(result.lng).toBeCloseTo(-74.051);
    expect(result.precision).toBe('exact');
  });

  it('discards an admin-only (city-level) structured result and falls through to free-text', async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('overpass') || u.includes('mail.ru')) {
        return Promise.reject(new Error('overpass unreachable in test'));
      }
      if (u.includes('street=')) {
        return Promise.resolve(jsonResponse(ADMIN_ONLY));
      }
      // Free-text step (q=)
      return Promise.resolve(jsonResponse(STREET_MATCH));
    });

    const result = await service.forward('Cra 13 # 62-40, Bogotá, Colombia');

    expect(result.lat).toBeCloseTo(4.65);
    expect(result.lng).toBeCloseTo(-74.05);
    expect(result.precision).toBe('street');
  });

  it('never throws when every cascade step fails, degrading to null coordinates', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('network down')));

    const result = await service.forward('Cra 13 # 62-40, Bogotá, Colombia');

    expect(result).toEqual({ lat: null, lng: null });
  });

  it('caps external requests: at most 3 cascade attempts for a DANE+city query', async () => {
    let nominatimCalls = 0;
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('overpass') || u.includes('mail.ru')) {
        return Promise.resolve(jsonResponse({ elements: [] }));
      }
      nominatimCalls += 1;
      return Promise.resolve(jsonResponse([]));
    });

    const result = await service.forward('Cra 13 # 62-40, Bogotá, Colombia');

    expect(result).toEqual({ lat: null, lng: null });
    // intersection (1 attempt, N mirror requests) + structuredFull (1) +
    // freeText (1) = 3 cascade attempts, so exactly 2 Nominatim calls.
    expect(nominatimCalls).toBe(2);
  });

  it('goes straight to free-text for a non-DANE query (single Nominatim call)', async () => {
    let calls = 0;
    fetchMock.mockImplementation(() => {
      calls += 1;
      return Promise.resolve(jsonResponse(STREET_MATCH));
    });

    const result = await service.forward('texto sin formato DANE, Bogotá, Colombia');

    expect(result.precision).toBe('street');
    expect(calls).toBe(1);
  });

  it('reads a cache hit without calling fetch at all', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({ lat: 4.65, lng: -74.05, precision: 'street' }),
    );

    const result = await service.forward('Cra 13 # 62-40, Bogotá, Colombia');

    expect(result).toEqual({ lat: 4.65, lng: -74.05, precision: 'street' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches a resolved result for 7 days and a null result for 6 hours', async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('overpass') || u.includes('mail.ru')) {
        return Promise.resolve(jsonResponse(INTERSECTION_ELEMENTS));
      }
      return Promise.resolve(jsonResponse([]));
    });

    await service.forward('Cra 13 # 62-40, Bogotá, Colombia');
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('geocode:fwd:v2:'),
      expect.any(String),
      'EX',
      604800,
    );

    redis.set.mockClear();
    fetchMock.mockImplementation(() => Promise.reject(new Error('down')));
    await service.forward('texto sin formato DANE, Bogotá, Colombia');
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('geocode:fwd:v2:'),
      expect.any(String),
      'EX',
      21600,
    );
  });
});
