import { Injectable } from '@nestjs/common';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { ErrorCodes, VendixHttpException } from '@common/errors';

export interface RemoteImagePreviewResult {
  dataUrl: string;
  fileName: string;
  contentType: string;
  byteLength: number;
}

@Injectable()
export class RemoteImageService {
  private readonly maxBytes = 5 * 1024 * 1024;
  private readonly maxRedirects = 3;
  private readonly timeoutMs = 10_000;
  private readonly allowedContentTypes = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
  ]);

  async fetchPreview(url: string): Promise<RemoteImagePreviewResult> {
    const imageUrl = await this.fetchImageUrl(url);
    const response = await this.fetchWithTimeout(imageUrl);

    if (!response.ok) {
      throw new VendixHttpException(ErrorCodes.UPLOAD_REMOTE_FETCH_001);
    }

    const contentType = this.normalizeContentType(
      response.headers.get('content-type'),
    );
    if (!this.allowedContentTypes.has(contentType)) {
      throw new VendixHttpException(ErrorCodes.UPLOAD_REMOTE_TYPE_001);
    }

    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > this.maxBytes) {
      throw new VendixHttpException(ErrorCodes.UPLOAD_REMOTE_SIZE_001);
    }

    const buffer = await this.readResponseBody(response);
    return {
      dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
      fileName: this.resolveFileName(imageUrl, contentType),
      contentType,
      byteLength: buffer.byteLength,
    };
  }

  private async fetchImageUrl(rawUrl: string): Promise<URL> {
    let currentUrl = this.parseUrl(rawUrl);

    for (let redirectCount = 0; redirectCount <= this.maxRedirects; redirectCount++) {
      await this.assertSafeUrl(currentUrl);
      const response = await this.fetchWithTimeout(currentUrl, 'HEAD');

      if (!this.isRedirect(response.status)) {
        return currentUrl;
      }

      const location = response.headers.get('location');
      if (!location) {
        throw new VendixHttpException(ErrorCodes.UPLOAD_REMOTE_FETCH_001);
      }

      currentUrl = this.parseUrl(new URL(location, currentUrl).toString());
    }

    throw new VendixHttpException(ErrorCodes.UPLOAD_REMOTE_FETCH_001);
  }

  private parseUrl(rawUrl: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new VendixHttpException(ErrorCodes.UPLOAD_REMOTE_URL_001);
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new VendixHttpException(ErrorCodes.UPLOAD_REMOTE_URL_001);
    }

    if (parsed.username || parsed.password) {
      throw new VendixHttpException(ErrorCodes.UPLOAD_REMOTE_FORBIDDEN_001);
    }

    return parsed;
  }

  private async assertSafeUrl(url: URL): Promise<void> {
    const hostname = url.hostname.toLowerCase();

    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '0.0.0.0'
    ) {
      throw new VendixHttpException(ErrorCodes.UPLOAD_REMOTE_FORBIDDEN_001);
    }

    const directIpVersion = isIP(hostname);
    if (directIpVersion && this.isBlockedIp(hostname, directIpVersion)) {
      throw new VendixHttpException(ErrorCodes.UPLOAD_REMOTE_FORBIDDEN_001);
    }

    try {
      const addresses = await lookup(hostname, { all: true, verbatim: true });
      if (
        addresses.length === 0 ||
        addresses.some((address) =>
          this.isBlockedIp(address.address, address.family),
        )
      ) {
        throw new VendixHttpException(ErrorCodes.UPLOAD_REMOTE_FORBIDDEN_001);
      }
    } catch (error) {
      if (error instanceof VendixHttpException) throw error;
      throw new VendixHttpException(ErrorCodes.UPLOAD_REMOTE_FETCH_001);
    }
  }

  private isBlockedIp(ip: string, family: number): boolean {
    if (family === 4) {
      const parts = ip.split('.').map((part) => Number(part));
      if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
        return true;
      }

      const [first, second] = parts;
      return (
        first === 0 ||
        first === 10 ||
        first === 127 ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168) ||
        (first === 100 && second >= 64 && second <= 127) ||
        first >= 224
      );
    }

    const normalized = ip.toLowerCase();
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:') ||
      normalized.startsWith('::ffff:127.') ||
      normalized.startsWith('::ffff:10.') ||
      normalized.startsWith('::ffff:192.168.')
    );
  }

  private async fetchWithTimeout(
    url: URL,
    method: 'GET' | 'HEAD' = 'GET',
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await fetch(url, {
        method,
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
      });
    } catch {
      throw new VendixHttpException(ErrorCodes.UPLOAD_REMOTE_FETCH_001);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readResponseBody(response: Response): Promise<Buffer> {
    const body = response.body;

    if (!body) {
      throw new VendixHttpException(ErrorCodes.UPLOAD_REMOTE_FETCH_001);
    }

    const reader = body.getReader();
    const chunks: Buffer[] = [];
    let received = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        received += value.byteLength;
        if (received > this.maxBytes) {
          throw new VendixHttpException(ErrorCodes.UPLOAD_REMOTE_SIZE_001);
        }

        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }

    if (received === 0) {
      throw new VendixHttpException(ErrorCodes.UPLOAD_REMOTE_FETCH_001);
    }

    return Buffer.concat(chunks, received);
  }

  private normalizeContentType(value: string | null): string {
    return (value ?? '').split(';')[0]?.trim().toLowerCase();
  }

  private isRedirect(status: number): boolean {
    return [301, 302, 303, 307, 308].includes(status);
  }

  private resolveFileName(url: URL, contentType: string): string {
    const fallbackExtension = contentType.split('/')[1] || 'image';
    const rawName = decodeURIComponent(url.pathname.split('/').pop() || '');
    const safeName = rawName
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (safeName) return safeName;
    return `imagen-remota.${fallbackExtension === 'jpeg' ? 'jpg' : fallbackExtension}`;
  }
}
