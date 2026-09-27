import { GeocodingService } from './geocoding.service';
import { GoogleGeocodingProvider } from './google-geocoding.provider';
import type { GeocodeCandidate } from './colombian-address.util';

/** Minimal fetch Response stand-in — only what the service reads. */
function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** Bogotá municipality bbox candidate, as returned by Nominatim `/search?city=`. */
const BBOX_CANDIDATE: GeocodeCandidate[] = [
  {
    lat: '4.65',
    lon: '-74.08',
    addresstype: 'city',
    address: { city: 'Bogotá' },
    boundingbox: ['4.4', '4.9', '-74.3', '-73.9'],
  },
];

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

/** A house match in another city entirely — must be discarded by the bbox filter. */
const CARTAGENA_EXACT_MATCH: GeocodeCandidate[] = [
  {
    lat: '10.4',
    lon: '-75.5',
    addresstype: 'house',
    address: {
      road: 'Carrera 13',
      house_number: '62-40',
      city: 'Cartagena',
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

/**
 * Same intersection, but the primary way (Carrera 13) carries a SECOND
 * vertex 100m north of the corner — enough geometry for plate interpolation
 * to walk `placa` (40) metres from the corner.
 */
const INTERSECTION_WITH_WAY_LENGTH = {
  elements: [
    {
      tags: { name: 'Carrera 13', highway: 'residential' },
      geometry: [
        { lat: 4.65, lon: -74.05 },
        { lat: 4.65 + 100 / 111320, lon: -74.05 },
      ],
    },
    {
      tags: { name: 'Calle 62', highway: 'residential' },
      geometry: [{ lat: 4.65, lon: -74.05 }],
    },
  ],
};

function isNominatimSearch(url: string): boolean {
  return url.includes('nominatim.openstreetmap.org/search');
}

describe('GeocodingService.forward — cascade + candidate selection (mocked fetch)', () => {
  let redis: {
    get: jest.Mock<Promise<string | null>, unknown[]>;
    set: jest.Mock<Promise<string>, unknown[]>;
  };
  let googleStub: { geocode: jest.Mock };
  let service: GeocodingService;
  let fetchMock: jest.Mock<Promise<Response>, unknown[]>;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    redis = {
      get: jest.fn<Promise<string | null>, unknown[]>().mockResolvedValue(null),
      set: jest.fn<Promise<string>, unknown[]>().mockResolvedValue('OK'),
    };
    // These cascade tests exercise the OSM path only — Google integration has
    // its own describe block below with a real GoogleGeocodingProvider.
    googleStub = { geocode: jest.fn().mockResolvedValue(null) };
    service = new GeocodingService(redis as never, googleStub as never);
    originalFetch = global.fetch;
    fetchMock = jest.fn<Promise<Response>, unknown[]>();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('resolves via the DANE intersection step after resolving the municipality bbox, never touching structured/free-text Nominatim search', async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('overpass'))
        return Promise.resolve(jsonResponse(INTERSECTION_ELEMENTS));
      if (
        isNominatimSearch(u) &&
        u.includes('city=') &&
        !u.includes('street=') &&
        !u.includes('q=')
      ) {
        return Promise.resolve(jsonResponse(BBOX_CANDIDATE));
      }
      return Promise.resolve(jsonResponse([]));
    });

    const result = await service.forward('Cra 13 # 62-40, Bogotá, Colombia');

    expect(result.lat).toBeCloseTo(4.65);
    expect(result.lng).toBeCloseTo(-74.05);
    expect(result.precision).toBe('intersection');
    expect(result.source).toBe('osm');

    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      const isBboxLookup =
        isNominatimSearch(u) &&
        u.includes('city=') &&
        !u.includes('street=') &&
        !u.includes('q=');
      expect(u.includes('overpass') || isBboxLookup).toBe(true);
      expect(u.includes('street=')).toBe(false);
      expect(u.includes('q=')).toBe(false);
    }
  });

  it('interpolates the plate ~40 metres from the DANE corner along the main way', async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('overpass')) {
        return Promise.resolve(jsonResponse(INTERSECTION_WITH_WAY_LENGTH));
      }
      if (
        isNominatimSearch(u) &&
        u.includes('city=') &&
        !u.includes('street=') &&
        !u.includes('q=')
      ) {
        return Promise.resolve(jsonResponse(BBOX_CANDIDATE));
      }
      return Promise.resolve(jsonResponse([]));
    });

    const result = await service.forward('Cra 13 # 62-40, Bogotá, Colombia');

    expect(result.precision).toBe('interpolated');
    expect(result.lat).not.toBeNull();
    // Distance from the corner (4.65, -74.05) back to the resolved point,
    // in metres, using the same flat-earth approximation the service uses.
    const distanceFromCornerMeters = ((result.lat as number) - 4.65) * 111320;
    expect(distanceFromCornerMeters).toBeCloseTo(40, 0);
    expect(result.lng).toBeCloseTo(-74.05, 5);
  });

  it('falls through to structured search when Overpass finds no intersection', async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('overpass'))
        return Promise.resolve(jsonResponse({ elements: [] }));
      if (
        isNominatimSearch(u) &&
        u.includes('city=') &&
        !u.includes('street=') &&
        !u.includes('q=')
      ) {
        return Promise.resolve(jsonResponse(BBOX_CANDIDATE));
      }
      if (isNominatimSearch(u) && u.includes('street=')) {
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
      if (u.includes('overpass'))
        return Promise.reject(new Error('overpass unreachable in test'));
      if (
        isNominatimSearch(u) &&
        u.includes('city=') &&
        !u.includes('street=') &&
        !u.includes('q=')
      ) {
        return Promise.resolve(jsonResponse(BBOX_CANDIDATE));
      }
      if (isNominatimSearch(u) && u.includes('street=')) {
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

  it('discards a structured-search candidate from another city and resolves via free-text instead', async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('overpass'))
        return Promise.resolve(jsonResponse({ elements: [] }));
      if (
        isNominatimSearch(u) &&
        u.includes('city=') &&
        !u.includes('street=') &&
        !u.includes('q=')
      ) {
        return Promise.resolve(jsonResponse(BBOX_CANDIDATE));
      }
      if (isNominatimSearch(u) && u.includes('street=')) {
        return Promise.resolve(jsonResponse(CARTAGENA_EXACT_MATCH));
      }
      return Promise.resolve(jsonResponse(STREET_MATCH));
    });

    const result = await service.forward('Cra 13 # 62-40, Bogotá, Colombia');

    // Must NOT be the Cartagena coordinate — it falls outside Bogotá's bbox.
    expect(result.lat).toBeCloseTo(4.65);
    expect(result.lng).toBeCloseTo(-74.05);
    expect(result.precision).toBe('street');
  });

  it('resolves the municipality bbox for "Bogotá, D.C." via the Overpass name-variant fallback when Nominatim has no boundingbox', async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (
        isNominatimSearch(u) &&
        u.includes('city=') &&
        !u.includes('street=') &&
        !u.includes('q=')
      ) {
        return Promise.resolve(jsonResponse([])); // Nominatim muni lookup comes up empty
      }
      if (u.includes('overpass')) {
        return Promise.resolve(
          jsonResponse({
            elements: [
              {
                tags: { name: 'Bogotá, D.C.' },
                bounds: {
                  minlat: 4.4,
                  minlon: -74.3,
                  maxlat: 4.9,
                  maxlon: -73.9,
                },
              },
            ],
          }),
        );
      }
      // Free-text step (q=) — this address has no via type, so it is the only cascade step.
      return Promise.resolve(jsonResponse(STREET_MATCH));
    });

    const result = await service.forward(
      'Centro Comercial Andino',
      'Bogotá, D.C.',
    );

    expect(result.precision).toBe('street');
    expect(result.lat).toBeCloseTo(4.65);
    expect(result.lng).toBeCloseTo(-74.05);

    const overpassCall = fetchMock.mock.calls.find(([u]) =>
      String(u).includes('overpass'),
    );
    expect(overpassCall).toBeDefined();
  });

  it('never throws when every cascade step fails, degrading to null coordinates', async () => {
    fetchMock.mockImplementation(() =>
      Promise.reject(new Error('network down')),
    );

    const result = await service.forward('Cra 13 # 62-40, Bogotá, Colombia');

    expect(result).toEqual({ lat: null, lng: null });
  });

  it('caps external requests at 5 for a DANE+city query (bbox resolution + intersection + structured, free-text skipped)', async () => {
    fetchMock.mockImplementation(() =>
      Promise.reject(new Error('network down')),
    );

    const result = await service.forward('Cra 13 # 62-40, Bogotá, Colombia');

    expect(result).toEqual({ lat: null, lng: null });
    const nominatimSearchCalls = fetchMock.mock.calls
      .map(([u]) => String(u))
      .filter((u) => isNominatimSearch(u));
    // bbox resolution (1) + structured search's 2 variants (2) = 3. The
    // intersection step spends its 1 unit on Overpass (not Nominatim search),
    // and free-text never runs because the 5-call budget is exhausted first.
    expect(nominatimSearchCalls.length).toBe(3);
    expect(nominatimSearchCalls.some((u) => u.includes('q='))).toBe(false);
  });

  it('goes straight to free-text for a non-DANE query with no city (single Nominatim call, bbox from bias)', async () => {
    let calls = 0;
    fetchMock.mockImplementation(() => {
      calls += 1;
      return Promise.resolve(jsonResponse(STREET_MATCH));
    });

    const result = await service.forward('texto sin formato DANE');

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

  it('caches a resolved result for 7 days and a null result for 6 hours under the v3 prefix', async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('overpass'))
        return Promise.resolve(jsonResponse(INTERSECTION_ELEMENTS));
      if (
        isNominatimSearch(u) &&
        u.includes('city=') &&
        !u.includes('street=') &&
        !u.includes('q=')
      ) {
        return Promise.resolve(jsonResponse(BBOX_CANDIDATE));
      }
      return Promise.resolve(jsonResponse([]));
    });

    await service.forward('Cra 13 # 62-40, Bogotá, Colombia');
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('geocode:fwd:v3:'),
      expect.any(String),
      'EX',
      604800,
    );

    redis.set.mockClear();
    fetchMock.mockImplementation(() => Promise.reject(new Error('down')));
    await service.forward('texto sin formato DANE, Bogotá, Colombia');
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('geocode:fwd:v3:'),
      expect.any(String),
      'EX',
      21600,
    );
  });

  it('same address+city with two different bias values share ONE cache key — single cascade execution', async () => {
    const store = new Map<string, string>();
    redis.get.mockImplementation((key: string) =>
      Promise.resolve(store.get(key) ?? null),
    );
    redis.set.mockImplementation((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    });
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('overpass'))
        return Promise.resolve(jsonResponse({ elements: [] }));
      if (
        isNominatimSearch(u) &&
        u.includes('city=') &&
        !u.includes('street=') &&
        !u.includes('q=')
      ) {
        return Promise.resolve(jsonResponse(BBOX_CANDIDATE));
      }
      return Promise.resolve(jsonResponse(STREET_MATCH));
    });

    const biasA = { lat: 4.6, lng: -74.1 };
    const biasB = { lat: 4.7, lng: -74.2 };

    const first = await service.forward(
      'Centro Comercial Andino',
      'Bogotá',
      undefined,
      {
        bias: biasA,
      },
    );
    const callsAfterFirst = fetchMock.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = await service.forward(
      'Centro Comercial Andino',
      'Bogotá',
      undefined,
      {
        bias: biasB,
      },
    );

    expect(second).toEqual(first);
    // No new external calls — the second call was a pure cache hit.
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);

    const fwdKeys = new Set(
      redis.set.mock.calls
        .map(([key]) => String(key))
        .filter((key) => key.startsWith('geocode:fwd:v3:')),
    );
    expect(fwdKeys.size).toBe(1);
    for (const key of fwdKeys) expect(key).not.toContain('bias:');
  });

  it('with no city known, the bias DOES enter the cache key, rounded to 2 decimals', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse([])));

    await service.forward('texto sin formato DANE', undefined, undefined, {
      bias: { lat: 4.6123, lng: -74.0987 },
    });

    const fwdKey = redis.set.mock.calls
      .map(([key]) => String(key))
      .find((key) => key.startsWith('geocode:fwd:v3:'));
    expect(fwdKey).toBeDefined();
    expect(fwdKey).toContain('bias:4.61,-74.10');
  });
});

describe('GeocodingService.forward — Google fallback integration (real GoogleGeocodingProvider, mocked fetch/Redis)', () => {
  let redis: {
    get: jest.Mock<Promise<string | null>, unknown[]>;
    set: jest.Mock<Promise<string>, unknown[]>;
    incr: jest.Mock<Promise<number>, unknown[]>;
    expire: jest.Mock<Promise<number>, unknown[]>;
  };
  let service: GeocodingService;
  let fetchMock: jest.Mock<Promise<Response>, unknown[]>;
  let originalFetch: typeof fetch;
  let originalKey: string | undefined;
  let originalCap: string | undefined;

  beforeEach(() => {
    originalKey = process.env.GOOGLE_GEOCODING_API_KEY;
    originalCap = process.env.GOOGLE_GEOCODING_MONTHLY_CAP;
    redis = {
      get: jest.fn<Promise<string | null>, unknown[]>().mockResolvedValue(null),
      set: jest.fn<Promise<string>, unknown[]>().mockResolvedValue('OK'),
      incr: jest.fn<Promise<number>, unknown[]>().mockResolvedValue(1),
      expire: jest.fn<Promise<number>, unknown[]>().mockResolvedValue(1),
    };
    const googleProvider = new GoogleGeocodingProvider(redis as never);
    service = new GeocodingService(redis as never, googleProvider);
    originalFetch = global.fetch;
    fetchMock = jest.fn<Promise<Response>, unknown[]>();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.GOOGLE_GEOCODING_API_KEY = originalKey;
    process.env.GOOGLE_GEOCODING_MONTHLY_CAP = originalCap;
    jest.restoreAllMocks();
  });

  /** Common OSM mock: bbox resolves via Nominatim, free-text lands on 'street'. */
  function mockOsmStreetOnly() {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('overpass'))
        return Promise.resolve(jsonResponse({ elements: [] }));
      if (
        isNominatimSearch(u) &&
        u.includes('city=') &&
        !u.includes('street=') &&
        !u.includes('q=')
      ) {
        return Promise.resolve(jsonResponse(BBOX_CANDIDATE));
      }
      if (u.includes('maps.googleapis.com')) {
        throw new Error('unexpected Google call in this mock branch');
      }
      return Promise.resolve(jsonResponse(STREET_MATCH));
    });
  }

  it('uses Google when the OSM result is only "street" and a key is configured, accepting a strictly better in-bbox result', async () => {
    process.env.GOOGLE_GEOCODING_API_KEY = 'test-key';
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('overpass'))
        return Promise.resolve(jsonResponse({ elements: [] }));
      if (
        isNominatimSearch(u) &&
        u.includes('city=') &&
        !u.includes('street=') &&
        !u.includes('q=')
      ) {
        return Promise.resolve(jsonResponse(BBOX_CANDIDATE));
      }
      if (u.includes('maps.googleapis.com')) {
        return Promise.resolve(
          jsonResponse({
            status: 'OK',
            results: [
              {
                formatted_address: 'Centro Comercial Andino, Bogotá',
                geometry: {
                  location: { lat: 4.651, lng: -74.051 },
                  location_type: 'ROOFTOP',
                },
                types: ['premise'],
              },
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse(STREET_MATCH));
    });

    const result = await service.forward('Centro Comercial Andino', 'Bogotá');

    expect(result.source).toBe('google');
    expect(result.precision).toBe('exact');
    expect(result.lat).toBeCloseTo(4.651);
    expect(result.lng).toBeCloseTo(-74.051);
    expect(result.label).toBe('Centro Comercial Andino, Bogotá');
  });

  it('skips Google entirely when no API key is configured', async () => {
    delete process.env.GOOGLE_GEOCODING_API_KEY;
    mockOsmStreetOnly();

    const result = await service.forward('Centro Comercial Andino', 'Bogotá');

    expect(result.source).toBe('osm');
    expect(result.precision).toBe('street');
    expect(
      fetchMock.mock.calls.some(([u]) =>
        String(u).includes('maps.googleapis.com'),
      ),
    ).toBe(false);
  });

  it('skips Google when the monthly cap is already exceeded', async () => {
    process.env.GOOGLE_GEOCODING_API_KEY = 'test-key';
    process.env.GOOGLE_GEOCODING_MONTHLY_CAP = '100';
    redis.incr.mockResolvedValue(101);
    mockOsmStreetOnly();

    const result = await service.forward('Centro Comercial Andino', 'Bogotá');

    expect(result.source).toBe('osm');
    expect(result.precision).toBe('street');
    expect(
      fetchMock.mock.calls.some(([u]) =>
        String(u).includes('maps.googleapis.com'),
      ),
    ).toBe(false);
  });

  it('keeps the OSM result when Google errors or times out', async () => {
    process.env.GOOGLE_GEOCODING_API_KEY = 'test-key';
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('overpass'))
        return Promise.resolve(jsonResponse({ elements: [] }));
      if (
        isNominatimSearch(u) &&
        u.includes('city=') &&
        !u.includes('street=') &&
        !u.includes('q=')
      ) {
        return Promise.resolve(jsonResponse(BBOX_CANDIDATE));
      }
      if (u.includes('maps.googleapis.com')) {
        return Promise.reject(new Error('network down'));
      }
      return Promise.resolve(jsonResponse(STREET_MATCH));
    });

    const result = await service.forward('Centro Comercial Andino', 'Bogotá');

    expect(result.source).toBe('osm');
    expect(result.precision).toBe('street');
  });

  it('never prefers a Google APPROXIMATE result over an OSM "street" result', async () => {
    process.env.GOOGLE_GEOCODING_API_KEY = 'test-key';
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('overpass'))
        return Promise.resolve(jsonResponse({ elements: [] }));
      if (
        isNominatimSearch(u) &&
        u.includes('city=') &&
        !u.includes('street=') &&
        !u.includes('q=')
      ) {
        return Promise.resolve(jsonResponse(BBOX_CANDIDATE));
      }
      if (u.includes('maps.googleapis.com')) {
        return Promise.resolve(
          jsonResponse({
            status: 'OK',
            results: [
              {
                formatted_address: 'Bogotá, Colombia',
                geometry: {
                  location: { lat: 4.6, lng: -74.1 },
                  location_type: 'APPROXIMATE',
                },
                types: ['locality'],
              },
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse(STREET_MATCH));
    });

    const result = await service.forward('Centro Comercial Andino', 'Bogotá');

    expect(result.source).toBe('osm');
    expect(result.precision).toBe('street');
    expect(result.lat).toBeCloseTo(4.65);
  });
});
