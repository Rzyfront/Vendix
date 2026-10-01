import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ClientRequest } from 'node:http';
import type { RequestOptions } from 'node:https';
import type { LookupAddress } from 'node:dns';
import { DocumentReceptionHttpService } from './document-reception-http.service';

interface MockResponseOptions {
  statusCode?: number;
  remoteAddress?: string;
  headers?: Record<string, string | string[] | undefined>;
  chunks?: Array<Buffer | string>;
  aborted?: boolean;
  requestError?: boolean;
  delayBody?: boolean;
  closeWithoutEnd?: boolean;
}

class MockIncomingResponse extends EventEmitter {
  readonly socket: { remoteAddress?: string };
  readonly statusCode: number;
  readonly headers: Record<string, string | string[] | undefined>;
  destroyed = false;

  constructor(options: MockResponseOptions, remoteAddress: string) {
    super();
    this.statusCode = options.statusCode ?? 200;
    this.headers = options.headers ?? { 'content-type': 'application/json' };
    this.socket = { remoteAddress };
  }

  destroy(): this {
    this.destroyed = true;
    return this;
  }

  resume(): this { return this; }
}

class MockClientRequest extends EventEmitter {
  destroyed = false;

  constructor(
    private readonly onResponse: (response: IncomingMessage) => void,
    private readonly options: MockResponseOptions,
    private readonly remoteAddress: string,
    private readonly onCreated?: (response: MockIncomingResponse) => void,
  ) { super(); }

  end(): this {
    if (this.options.requestError) {
      setImmediate(() => this.emit('error', new Error('secret endpoint socket failure')));
      return this;
    }
    const response = new MockIncomingResponse(this.options, this.options.remoteAddress ?? this.remoteAddress);
    this.onCreated?.(response);
    setImmediate(() => {
      this.onResponse(response as unknown as IncomingMessage);
      if (this.options.delayBody) return;
      setImmediate(() => {
        if (this.options.closeWithoutEnd) response.emit('close');
        else if (this.options.aborted) response.emit('aborted');
        else {
          for (const chunk of this.options.chunks ?? [Buffer.from('{"ok":true}')]) response.emit('data', chunk);
          response.emit('end');
        }
      });
    });
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

class TestDocumentReceptionHttpService extends DocumentReceptionHttpService {
  protected override readonly timeoutMs = 25;
  dnsRecords: LookupAddress[] = [{ address: '93.184.216.34', family: 4 }];
  dnsError: Error | null = null;
  dnsDelay = false;
  responseOptions: MockResponseOptions = {};
  requestOptions: RequestOptions | undefined;
  requestCount = 0;
  dnsCallCount = 0;
  lastResponse: MockIncomingResponse | undefined;
  private selectedAddress = '93.184.216.34';

  protected override resolveDnsRecords(hostname: string): Promise<LookupAddress[]> {
    this.dnsCallCount += 1;
    if (this.dnsDelay) return new Promise<LookupAddress[]>(() => undefined);
    if (this.dnsError) return Promise.reject(this.dnsError);
    return Promise.resolve(this.dnsRecords);
  }

  protected override createHttpsRequest(
    options: RequestOptions,
    onResponse: (response: IncomingMessage) => void,
  ): ClientRequest {
    this.requestCount += 1;
    this.requestOptions = options;
    const selected = this.dnsRecords[0]?.address ?? this.selectedAddress;
    return new MockClientRequest(onResponse, this.responseOptions, selected, (response) => { this.lastResponse = response; }) as unknown as ClientRequest;
  }
}

const ENDPOINT = 'https://documents.supplier.com/api/inbox';
const SECRET = 'secret-token-should-never-leak';

describe('DocumentReceptionHttpService', () => {
  it('validates configured endpoint syntax without performing DNS or HTTP requests', () => {
    const service = new TestDocumentReceptionHttpService();
    expect(() => service.validateEndpoint(ENDPOINT)).not.toThrow();
    expect(() => service.validateEndpoint('https://localhost/feed')).toThrow(BadRequestException);
    expect(service.dnsCallCount).toBe(0);
    expect(service.requestCount).toBe(0);
  });

  it.each([
    ['plain HTTP', 'http://documents.supplier.example/feed', SECRET, undefined],
    ['URL credentials', 'https://user:pass@documents.supplier.example/feed', SECRET, undefined],
    ['URL fragment', 'https://documents.supplier.example/feed#fragment', SECRET, undefined],
    ['custom port', 'https://documents.supplier.example:8443/feed', SECRET, undefined],
    ['IPv4 literal', 'https://93.184.216.34/feed', SECRET, undefined],
    ['IPv6 literal', 'https://[2001:4860:4860::8888]/feed', SECRET, undefined],
    ['localhost', 'https://localhost/feed', SECRET, undefined],
    ['local suffix', 'https://mail.office.local/feed', SECRET, undefined],
    ['internal suffix', 'https://mail.corp.internal/feed', SECRET, undefined],
    ['test suffix', 'https://mail.example.test/feed', SECRET, undefined],
    ['invalid suffix', 'https://mail.example.invalid/feed', SECRET, undefined],
    ['overlong endpoint', `https://documents.supplier.example/${'x'.repeat(2048)}`, SECRET, undefined],
    ['empty bearer secret', ENDPOINT, '', undefined],
    ['oversized bearer secret', ENDPOINT, 's'.repeat(4097), undefined],
    ['CRLF bearer secret', ENDPOINT, 'secret\r\nInjected: true', undefined],
    ['control byte bearer secret', ENDPOINT, 'secret\u0000token', undefined],
    ['oversized cursor', ENDPOINT, SECRET, 'c'.repeat(1001)],
    ['control byte cursor', ENDPOINT, SECRET, 'opaque\nvalue'],
  ])('rejects %s before DNS or network access', async (_label, endpoint, secret, cursor) => {
    const service = new TestDocumentReceptionHttpService();
    await expect(service.fetch(endpoint, secret, cursor)).rejects.toBeInstanceOf(BadRequestException);
    expect(service.dnsCallCount).toBe(0);
    expect(service.requestCount).toBe(0);
  });

  it('adds/replaces only the encoded cursor and pins TLS/SNI to a verified public answer', async () => {
    const service = new TestDocumentReceptionHttpService();
    const bytes = await service.fetch(`${ENDPOINT}?cursor=old&limit=5`, SECRET, 'new cursor/+');
    expect(bytes.toString()).toBe('{"ok":true}');
    const options = service.requestOptions!;
    expect(options).toMatchObject({
      protocol: 'https:', hostname: 'documents.supplier.com', port: 443,
      path: '/api/inbox?cursor=new+cursor%2F%2B&limit=5', method: 'GET',
      servername: 'documents.supplier.com', rejectUnauthorized: true, agent: false,
    });
    expect(options.headers).toEqual({
      Authorization: `Bearer ${SECRET}`,
      Accept: 'application/json, application/*+json',
      'Accept-Encoding': 'identity',
    });
    expect(service.dnsCallCount).toBe(1);
    expect(service.requestCount).toBe(1);

    const lookup = options.lookup as unknown as (hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => void;
    const allCallback = jest.fn();
    lookup('documents.supplier.com', { all: true }, allCallback);
    expect(allCallback).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
    const oneCallback = jest.fn();
    lookup('documents.supplier.com', { all: false }, oneCallback);
    expect(oneCallback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    const mismatchCallback = jest.fn();
    lookup('redirected.attacker.example', { all: false }, mismatchCallback);
    expect(mismatchCallback).toHaveBeenCalledWith(expect.objectContaining({ code: 'ENOTFOUND' }), '', 0);
    expect(service.requestCount).toBe(1); // The callback cannot trigger a second DNS lookup.
  });

  it.each([
    '0.1.2.3', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.10.1', '172.16.0.1',
    '192.0.0.1', '192.0.2.1', '192.168.1.1', '198.18.0.1', '198.51.100.1',
    '203.0.113.1', '224.0.0.1', '240.0.0.1', '::1', 'fe80::1', 'fc00::1',
    '2001:db8::1', '2001::1', '2002::1', '::ffff:192.168.1.1',
  ])('rejects non-global DNS answer %s before network access', async (address) => {
    const service = new TestDocumentReceptionHttpService();
    service.dnsRecords = [{ address, family: address.includes(':') ? 6 : 4 }];
    await expect(service.fetch(ENDPOINT, SECRET)).rejects.toBeInstanceOf(BadGatewayException);
    expect(service.requestCount).toBe(0);
  });

  it('rejects mixed public/private DNS answers and excessive DNS answer sets', async () => {
    const mixed = new TestDocumentReceptionHttpService();
    mixed.dnsRecords = [
      { address: '93.184.216.34', family: 4 },
      { address: '10.1.2.3', family: 4 },
    ];
    await expect(mixed.fetch(ENDPOINT, SECRET)).rejects.toBeInstanceOf(BadGatewayException);
    expect(mixed.requestCount).toBe(0);

    const tooMany = new TestDocumentReceptionHttpService();
    tooMany.dnsRecords = Array.from({ length: 9 }, (_, i) => ({ address: `93.184.216.${i + 1}`, family: 4 }));
    await expect(tooMany.fetch(ENDPOINT, SECRET)).rejects.toBeInstanceOf(BadGatewayException);
    expect(tooMany.requestCount).toBe(0);
  });

  it('pins every socket lookup to the first validated address without a second DNS resolution', async () => {
    const service = new TestDocumentReceptionHttpService();
    service.dnsRecords = [
      { address: '93.184.216.34', family: 4 },
      { address: '8.8.8.8', family: 4 },
    ];
    await service.fetch(ENDPOINT, SECRET);
    expect(service.dnsCallCount).toBe(1);
    const lookup = service.requestOptions!.lookup as unknown as (hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => void;
    const callback = jest.fn();
    lookup('documents.supplier.com', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
    expect(service.dnsCallCount).toBe(1);
  });

  it('rejects a socket whose connected remote address differs from the pinned DNS answer', async () => {
    const service = new TestDocumentReceptionHttpService();
    service.responseOptions = { remoteAddress: '8.8.8.8' };
    await expect(service.fetch(ENDPOINT, SECRET)).rejects.toBeInstanceOf(BadGatewayException);
    expect(service.requestCount).toBe(1);
  });

  it.each([
    ['redirect', { statusCode: 302, headers: { location: 'http://127.0.0.1/admin', 'content-type': 'application/json' } }],
    ['non-JSON content', { headers: { 'content-type': 'text/html' } }],
    ['encoded body', { headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' } }],
    ['advertised oversize', { headers: { 'content-type': 'application/json', 'content-length': String(5 * 1024 * 1024 + 1) } }],
    ['non-200 response', { statusCode: 401, headers: { 'content-type': 'application/json' } }],
  ])('rejects %s without exposing upstream details or following redirects', async (_label, responseOptions) => {
    const service = new TestDocumentReceptionHttpService();
    service.responseOptions = responseOptions;
    const error = await service.fetch(ENDPOINT, SECRET).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BadGatewayException);
    expect((error as Error).message).not.toContain(SECRET);
    expect((error as Error).message).not.toContain('127.0.0.1');
    expect(service.requestCount).toBe(1);
    expect(service.dnsCallCount).toBe(1);
  });

  it('caps streamed bodies and rejects aborted responses', async () => {
    const oversized = new TestDocumentReceptionHttpService();
    oversized.responseOptions = { chunks: [Buffer.alloc(5 * 1024 * 1024), Buffer.from('x')] };
    await expect(oversized.fetch(ENDPOINT, SECRET)).rejects.toBeInstanceOf(BadGatewayException);

    const aborted = new TestDocumentReceptionHttpService();
    aborted.responseOptions = { aborted: true };
    await expect(aborted.fetch(ENDPOINT, SECRET)).rejects.toBeInstanceOf(BadGatewayException);

    const prematureClose = new TestDocumentReceptionHttpService();
    prematureClose.responseOptions = { closeWithoutEnd: true };
    await expect(prematureClose.fetch(ENDPOINT, SECRET)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('maps socket failures to a generic message without endpoint, token, or provider details', async () => {
    const service = new TestDocumentReceptionHttpService();
    service.responseOptions = { requestError: true };
    const error = await service.fetch(ENDPOINT, SECRET).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BadGatewayException);
    expect((error as Error).message).not.toContain(SECRET);
    expect((error as Error).message).not.toContain('secret endpoint socket failure');
    expect((error as Error).message).not.toContain('documents.supplier.com');
  });

  it('uses one overall deadline across DNS and response body', async () => {
    const dnsTimeout = new TestDocumentReceptionHttpService();
    dnsTimeout.dnsDelay = true;
    await expect(dnsTimeout.fetch(ENDPOINT, SECRET)).rejects.toBeInstanceOf(BadGatewayException);
    expect(dnsTimeout.requestCount).toBe(0);

    const bodyTimeout = new TestDocumentReceptionHttpService();
    bodyTimeout.responseOptions = { delayBody: true };
    await expect(bodyTimeout.fetch(ENDPOINT, SECRET)).rejects.toBeInstanceOf(BadGatewayException);
    expect(bodyTimeout.requestOptions?.signal?.aborted).toBe(true);
    expect(bodyTimeout.lastResponse?.destroyed).toBe(true);
  });
});
