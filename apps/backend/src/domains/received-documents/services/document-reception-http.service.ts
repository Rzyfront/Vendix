import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import type { IncomingMessage, ClientRequest } from 'node:http';
import type { RequestOptions } from 'node:https';
import { request as httpsRequest } from 'node:https';
import type { LookupAddress, LookupOptions } from 'node:dns';

const MAX_ENDPOINT_LENGTH = 2048;
const MAX_SECRET_LENGTH = 4096;
const MAX_CURSOR_LENGTH = 1000;
const MAX_DNS_RECORDS = 8;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const SAFE_UPSTREAM_ERROR = 'No fue posible consultar de forma segura la conexión configurada.';

/** Narrow, pinned HTTPS transport for configured document-reception endpoints. */
@Injectable()
export class DocumentReceptionHttpService {
  protected readonly timeoutMs: number = DEFAULT_TIMEOUT_MS;

  private static readonly BLOCKED_IPV4 = (() => {
    const list = new BlockList();
    for (const [address, prefix] of [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
      ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
      ['224.0.0.0', 4], ['240.0.0.0', 4],
    ] as const) list.addSubnet(address, prefix, 'ipv4');
    return list;
  })();

  private static readonly PUBLIC_IPV6 = (() => {
    const list = new BlockList();
    list.addSubnet('2000::', 3, 'ipv6');
    return list;
  })();

  private static readonly BLOCKED_IPV6 = (() => {
    const list = new BlockList();
    list.addSubnet('2001:db8::', 32, 'ipv6');
    list.addSubnet('2001::', 32, 'ipv6'); // Teredo
    list.addSubnet('2002::', 16, 'ipv6'); // 6to4
    list.addSubnet('::ffff:0:0', 96, 'ipv6'); // IPv4-mapped IPv6
    return list;
  })();

  async fetch(endpoint: string, bearerSecret: string, cursor?: string): Promise<Buffer> {
    const url = this.validatedUrl(endpoint, bearerSecret, cursor);
    const abortController = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timeoutReject: ((error: Error) => void) | undefined;
    const deadline = new Promise<never>((_resolve, reject) => { timeoutReject = reject; });
    timeout = setTimeout(() => {
      abortController.abort();
      timeoutReject?.(new Error('deadline'));
    }, this.timeoutMs);

    try {
      const addresses = await Promise.race([this.resolveDnsRecords(url.hostname), deadline]);
      if (abortController.signal.aborted) throw new Error('deadline');
      const selected = this.validateDnsRecords(addresses);
      const lookupFunction = this.pinnedLookup(url.hostname, selected);
      const options: RequestOptions = {
        protocol: 'https:',
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${bearerSecret}`,
          Accept: 'application/json, application/*+json',
          'Accept-Encoding': 'identity',
        },
        servername: url.hostname,
        rejectUnauthorized: true,
        agent: false,
        lookup: lookupFunction,
        signal: abortController.signal,
      };
      const response = await Promise.race([this.requestBytes(options, selected), deadline]);
      if (abortController.signal.aborted) throw new Error('deadline');
      return response;
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof BadGatewayException) throw error;
      throw new BadGatewayException(SAFE_UPSTREAM_ERROR);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  protected resolveDnsRecords(hostname: string): Promise<LookupAddress[]> {
    return lookup(hostname, { all: true, verbatim: true });
  }

  protected createHttpsRequest(
    options: RequestOptions,
    onResponse: (response: IncomingMessage) => void,
  ): ClientRequest {
    return httpsRequest(options, onResponse);
  }

  private validatedUrl(endpoint: string, bearerSecret: string, cursor?: string): URL {
    if (typeof endpoint !== 'string' || endpoint.length < 1 || endpoint.length > MAX_ENDPOINT_LENGTH || endpoint !== endpoint.trim()) {
      throw new BadRequestException('La URL de conexión no es válida.');
    }
    if (
      typeof bearerSecret !== 'string' || bearerSecret.length < 1 || bearerSecret.length > MAX_SECRET_LENGTH ||
      /[\x00-\x1f\x7f]/.test(bearerSecret)
    ) throw new BadRequestException('El secreto de conexión no es válido.');
    if (cursor != null && (typeof cursor !== 'string' || cursor.length > MAX_CURSOR_LENGTH || /[\x00-\x1f\x7f]/.test(cursor))) {
      throw new BadRequestException('El cursor de conexión no es válido.');
    }

    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new BadRequestException('La URL de conexión no es válida.');
    }
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    if (
      url.protocol !== 'https:' || (url.port !== '' && url.port !== '443') ||
      !!url.username || !!url.password || !!url.hash ||
      !this.isPublicDnsName(hostname) || isIP(hostname) !== 0
    ) throw new BadRequestException('La URL de conexión no es válida.');
    url.hostname = hostname;
    if (cursor !== undefined) url.searchParams.set('cursor', cursor);
    if (url.href.length > MAX_ENDPOINT_LENGTH + MAX_CURSOR_LENGTH + 16) {
      throw new BadRequestException('La URL de conexión no es válida.');
    }
    return url;
  }

  private isPublicDnsName(hostname: string): boolean {
    if (!hostname || hostname.length > 253 || !hostname.includes('.')) return false;
    const lower = hostname.toLowerCase();
    if (
      lower === 'localhost' ||
      ['.localhost', '.local', '.internal', '.test', '.invalid', '.example'].some((suffix) => lower.endsWith(suffix))
    ) return false;
    const labels = lower.split('.');
    if (labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return false;
    return /[a-z]/.test(labels[labels.length - 1]);
  }

  private validateDnsRecords(records: LookupAddress[]): LookupAddress {
    if (!Array.isArray(records) || records.length === 0 || records.length > MAX_DNS_RECORDS) {
      throw new BadGatewayException(SAFE_UPSTREAM_ERROR);
    }
    for (const record of records) {
      const family = isIP(record.address);
      if (!family || family !== record.family || this.isBlockedAddress(record.address, family)) {
        throw new BadGatewayException(SAFE_UPSTREAM_ERROR);
      }
    }
    return records[0];
  }

  private isBlockedAddress(address: string, family: number): boolean {
    if (family === 4) return DocumentReceptionHttpService.BLOCKED_IPV4.check(address, 'ipv4');
    if (address.includes('.')) return true;
    return !DocumentReceptionHttpService.PUBLIC_IPV6.check(address, 'ipv6') ||
      DocumentReceptionHttpService.BLOCKED_IPV6.check(address, 'ipv6');
  }

  private pinnedLookup(expectedHostname: string, address: LookupAddress): NonNullable<RequestOptions['lookup']> {
    const pinnedAddress = address.address;
    const pinnedFamily = address.family;
    return (hostname: string, options: LookupOptions, callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) => {
      if (hostname.toLowerCase().replace(/\.$/, '') !== expectedHostname.toLowerCase().replace(/\.$/, '')) {
        callback(Object.assign(new Error('lookup hostname mismatch'), { code: 'ENOTFOUND' }), '', 0);
        return;
      }
      if (options.all) callback(null, [{ address: pinnedAddress, family: pinnedFamily }]);
      else callback(null, pinnedAddress, pinnedFamily);
    };
  }

  private requestBytes(options: RequestOptions, selected: LookupAddress): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let activeResponse: IncomingMessage | undefined;
      let request: ClientRequest | undefined;
      const fail = () => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener('abort', fail);
        activeResponse?.destroy();
        request?.destroy();
        reject(new BadGatewayException(SAFE_UPSTREAM_ERROR));
      };
      try {
        request = this.createHttpsRequest(options, (response) => {
          activeResponse = response;
          if (response.statusCode !== 200 || !this.isJsonContentType(response.headers['content-type']) || !this.isIdentityEncoding(response.headers['content-encoding'])) {
            fail();
            return;
          }
          const remoteAddress = response.socket?.remoteAddress;
          if (remoteAddress && this.normalizeIp(remoteAddress) !== this.normalizeIp(selected.address)) {
            fail();
            return;
          }
          const advertisedLength = response.headers['content-length'];
          if (advertisedLength != null) {
            if (Array.isArray(advertisedLength) || !/^\d+$/.test(advertisedLength) || Number(advertisedLength) > MAX_RESPONSE_BYTES) {
              fail();
              return;
            }
          }
          const chunks: Buffer[] = [];
          let received = 0;
          let responseEnded = false;
          response.on('data', (chunk: Buffer | string) => {
            if (settled) return;
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            received += buffer.length;
            if (received > MAX_RESPONSE_BYTES) {
              fail();
              return;
            }
            chunks.push(buffer);
          });
          response.once('aborted', fail);
          response.once('error', fail);
          response.once('close', () => {
            if (!responseEnded) fail();
          });
          response.once('end', () => {
            if (settled) return;
            responseEnded = true;
            settled = true;
            options.signal?.removeEventListener('abort', fail);
            activeResponse = undefined;
            resolve(Buffer.concat(chunks, received));
          });
        });
        options.signal?.addEventListener('abort', fail, { once: true });
        request.once('error', fail);
        request.end();
      } catch {
        fail();
      }
    });
  }

  private isJsonContentType(value: string | string[] | undefined): boolean {
    if (typeof value !== 'string') return false;
    const mime = value.split(';', 1)[0].trim().toLowerCase();
    return mime === 'application/json' || /^application\/[a-z0-9.+-]+\+json$/.test(mime);
  }

  private isIdentityEncoding(value: string | string[] | undefined): boolean {
    return value == null || (typeof value === 'string' && value.trim().toLowerCase() === 'identity');
  }

  private normalizeIp(address: string): string {
    const unwrapped = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
    const noScope = unwrapped.split('%', 1)[0].toLowerCase();
    if (isIP(noScope) === 4) return noScope.split('.').map((part) => String(Number(part))).join('.');
    const mapped = this.ipv4MappedAddress(noScope);
    if (mapped) return mapped;
    const parts = noScope.split('::');
    const left = parts[0] ? parts[0].split(':') : [];
    const right = parts.length > 1 && parts[1] ? parts[1].split(':') : [];
    const zeroes = Math.max(0, 8 - left.length - right.length);
    const expanded = [...left, ...Array(zeroes).fill('0'), ...right].map((part) => Number.parseInt(part || '0', 16).toString(16));
    return expanded.join(':');
  }

  private ipv4MappedAddress(address: string): string | null {
    if (!address.startsWith('::ffff:')) return null;
    const suffix = address.slice('::ffff:'.length);
    if (isIP(suffix) === 4) return suffix.split('.').map((part) => String(Number(part))).join('.');
    const words = suffix.split(':');
    if (words.length !== 2 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return null;
    const value = (Number.parseInt(words[0], 16) << 16) | Number.parseInt(words[1], 16);
    return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
  }
}
