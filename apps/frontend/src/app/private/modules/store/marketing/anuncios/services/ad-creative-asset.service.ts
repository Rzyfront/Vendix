import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '../../../../../../shared/components';
import { MarketingAdCreative } from '../anuncios.interface';
import { AnunciosService } from '../anuncios.service';

/**
 * Centralizes download / share / copy of ad-creative images.
 *
 * The binary is always fetched from the backend proxy endpoint
 * (`GET /store/marketing/ad-creatives/:id/image`) via HttpClient so the
 * authenticated interceptors apply and we avoid cross-origin fetches to S3
 * that fail CORS.
 */
@Injectable({ providedIn: 'root' })
export class AdCreativeAssetService {
  private readonly anunciosService = inject(AnunciosService);
  private readonly toastService = inject(ToastService);

  async download(creative: MarketingAdCreative): Promise<void> {
    if (!this.hasImage(creative)) return;

    try {
      const blob = await this.fetchBlob(creative);
      const fileName = this.buildFileName(creative, blob.type);
      const objectUrl = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      this.toastService.success('Imagen descargada.');
    } catch {
      this.toastService.error('No se pudo descargar la imagen.');
    }
  }

  async share(creative: MarketingAdCreative): Promise<void> {
    if (!this.hasImage(creative)) return;

    try {
      const blob = await this.fetchBlob(creative);
      const fileName = this.buildFileName(creative, blob.type);
      const file = new File([blob], fileName, { type: blob.type });
      const text = creative.post_copy ?? creative.title;

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: creative.title,
          text,
        });
        return;
      }

      if (navigator.share) {
        await navigator.share({
          title: creative.title,
          text,
          ...(creative.image_url ? { url: creative.image_url } : {}),
        });
        return;
      }

      await this.copyShareText(creative);
      this.toastService.success('Enlace copiado para compartir.');
    } catch (error) {
      if (this.isAbort(error)) return;
      this.toastService.error('No se pudo compartir la imagen.');
    }
  }

  async copy(creative: MarketingAdCreative): Promise<void> {
    if (!this.hasImage(creative)) return;

    try {
      const clipboardItem = (window as any).ClipboardItem;
      if (clipboardItem && navigator.clipboard?.write) {
        const blob = await this.fetchBlob(creative);
        await navigator.clipboard.write([
          new clipboardItem({ [blob.type || 'image/png']: blob }),
        ]);
        this.toastService.success('Imagen copiada.');
        return;
      }

      await this.copyShareText(creative);
      this.toastService.success('Enlace copiado.');
    } catch {
      try {
        await this.copyShareText(creative);
        this.toastService.success('Enlace copiado.');
      } catch {
        this.toastService.error('No se pudo copiar la imagen.');
      }
    }
  }

  private async fetchBlob(
    creative: MarketingAdCreative,
    variant: 'full' | 'thumb' = 'full',
  ): Promise<Blob> {
    const response = await firstValueFrom(
      this.anunciosService.getImageBlob(creative.id, variant),
    );
    const blob = response.body;
    if (!blob) {
      throw new Error('La respuesta del proxy no contiene la imagen.');
    }
    return blob;
  }

  private async copyShareText(creative: MarketingAdCreative): Promise<void> {
    const text = creative.image_url ?? creative.post_copy ?? creative.title;
    await navigator.clipboard.writeText(text);
  }

  private hasImage(creative: MarketingAdCreative): boolean {
    return Boolean(creative.image_url || creative.image_key);
  }

  private isAbort(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
  }

  private buildFileName(creative: MarketingAdCreative, mime: string): string {
    const slug = this.fileSlug(creative.title) || 'anuncio';
    return `${slug}${this.extensionFromMime(mime)}`;
  }

  private extensionFromMime(mime: string): string {
    switch (mime) {
      case 'image/png':
        return '.png';
      case 'image/jpeg':
        return '.jpg';
      case 'image/webp':
        return '.webp';
      default:
        return '.png';
    }
  }

  private fileSlug(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
  }
}
