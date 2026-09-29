import { GoogleGeocodingProvider } from './google-geocoding.provider';

describe('GoogleGeocodingProvider paid-call cap', () => {
  const originalKey = process.env.GOOGLE_GEOCODING_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GOOGLE_GEOCODING_API_KEY;
    else process.env.GOOGLE_GEOCODING_API_KEY = originalKey;
    jest.restoreAllMocks();
  });

  it('does not call paid Google when Redis cannot enforce the monthly cap', async () => {
    process.env.GOOGLE_GEOCODING_API_KEY = 'test-key';
    const redis = {
      incr: jest.fn().mockRejectedValue(new Error('Redis unavailable')),
      expire: jest.fn(),
    };
    const fetchSpy = jest.spyOn(global, 'fetch');
    const provider = new GoogleGeocodingProvider(redis as never);

    const result = await provider.geocode('Calle 10 # 20-30', 'Bogotá', 'Bogotá', null);

    expect(result).toBeNull();
    expect(redis.incr).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
