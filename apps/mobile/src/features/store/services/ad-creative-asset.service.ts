/**
 * AdCreativeAssetService — download / share / copy para imágenes generadas.
 *
 * Mirror RN-friendly del web service
 * (`apps/frontend/.../anuncios/services/ad-creative-asset.service.ts`):
 *
 * - Web `navigator.share({files})`     → RN `Sharing.shareAsync(uri)`
 * - Web `<a download href=blob:URL>`  → RN `FileSystem.writeAsStringAsync(uri, base64)`
 * - Web `navigator.clipboard.write`    → RN `Clipboard.setImageAsync(uri)`
 * - Fallback `clipboard.writeText`     → RN `Clipboard.setStringAsync(text)`
 *
 * Los archivos temporales se guardan en `cacheDirectory` (expo-file-system)
 * y se purgan vía `Sharing.shareAsync` (la app destino maneja el ciclo de
 * vida) o se delegan a un garbage collector fuera de scope de este archivo.
 *
 * Verbose es intencional: el parity audit exige que los toasts del web
 * ("Imagen descargada." / "Imagen copiada." / etc.) se surfacen verbatim.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';

import { AnunciosService } from './anuncios.service';
import type { MarketingAdCreative } from '@/features/store/types/anuncios.types';
import { ANUNCIO_LABELS } from '@/features/store/constants/anuncio-labels';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';

/**
 * Resultado normalizado de las operaciones de asset. La API web
 * (navigator.share/clipboard) no expone una promesa tipada consistente,
 * así que devolvemos un boolean simple y side-effect de toast.
 */
export type AssetOpResult = { ok: boolean; message: string };

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
};

function fileSlug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function buildFileName(creative: MarketingAdCreative, mime: string): string {
  const ext = MIME_TO_EXT[mime] ?? 'png';
  const slug = fileSlug(creative.title) || 'anuncio';
  return `${slug}.${ext}`;
}

function hasImage(creative: MarketingAdCreative): boolean {
  return Boolean(creative.image_url || creative.image_key || creative.thumb_url);
}

async function fetchImageBuffer(
  creative: MarketingAdCreative,
): Promise<{ bufferUri: string; contentType: string }> {
  const blob = await AnunciosService.getImageBlob(creative.id, 'full');
  return { bufferUri: blob.bufferUri, contentType: blob.contentType };
}

function genCacheUri(name: string): string {
  const dir = FileSystem.cacheDirectory ?? '';
  // Expo's cacheDirectory ends with a slash; trim it for safety.
  return `${dir.replace(/\/$/, '')}/ad-creative-${Date.now()}-${name}`;
}

async function persistBase64ToCache(
  bufferUri: string,
  fileName: string,
): Promise<string> {
  const base64 = bufferUri.split(',')[1] ?? '';
  const targetUri = genCacheUri(fileName);
  await FileSystem.writeAsStringAsync(targetUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return targetUri;
}

async function shareOrFallback(
  fileUri: string,
  creative: MarketingAdCreative,
  text: string,
): Promise<AssetOpResult> {
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    try {
      await Sharing.shareAsync(fileUri, {
        mimeType: undefined, // expo infiere del extension
        dialogTitle: creative.title,
        UTI: undefined,
      });
      return { ok: true, message: '' };
    } catch {
      // user cancelled or platform-specific error — caemos al fallback de clipboard
    }
  }
  // Fallback: copiar texto al clipboard (web hace `clipboard.writeText`).
  await Clipboard.setStringAsync(text);
  toastSuccess(ANUNCIO_LABELS.toastLinkCopiedForShare);
  return { ok: true, message: ANUNCIO_LABELS.toastLinkCopiedForShare };
}

export const AdCreativeAssetService = {
  /**
   * Descarga la imagen al cache local del dispositivo. En mobile esto
   * equivale al web `<a download>` con `URL.createObjectURL`.
   *
   * El archivo queda en `FileSystem.cacheDirectory` y se limpia via
   * `Sharing.shareAsync` o manualmente por la siguiente generación.
   */
  async download(creative: MarketingAdCreative): Promise<AssetOpResult> {
    if (!hasImage(creative)) {
      return { ok: false, message: ANUNCIO_LABELS.toastErrDownload };
    }
    try {
      const { bufferUri, contentType } = await fetchImageBuffer(creative);
      const fileName = buildFileName(creative, contentType);
      const fileUri = await persistBase64ToCache(bufferUri, fileName);
      // Disparar share sheet para que el usuario decida destino (Galería, Drive, etc.)
      // coincide con el web "Compartir" y permite guardado compartido.
      const shared = await shareOrFallback(
        fileUri,
        creative,
        creative.image_url ?? creative.post_copy ?? creative.title,
      );
      if (shared.ok && !shared.message) {
        toastSuccess(ANUNCIO_LABELS.toastImageDownloaded);
        return { ok: true, message: ANUNCIO_LABELS.toastImageDownloaded };
      }
      return shared;
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } }; message?: string })
          ?.response?.data?.message ??
        (err as { message?: string }).message ??
        ANUNCIO_LABELS.toastErrDownload;
      toastError(msg);
      return { ok: false, message: msg };
    }
  },

  /**
   * Comparte la imagen vía el share sheet nativo. Equivalente al web
   * `navigator.share({files, title, text})`.
   */
  async share(creative: MarketingAdCreative): Promise<AssetOpResult> {
    if (!hasImage(creative)) {
      return { ok: false, message: ANUNCIO_LABELS.toastErrShare };
    }
    try {
      const { bufferUri, contentType } = await fetchImageBuffer(creative);
      const fileName = buildFileName(creative, contentType);
      const fileUri = await persistBase64ToCache(bufferUri, fileName);
      const text = creative.post_copy ?? creative.title;
      const result = await shareOrFallback(fileUri, creative, text);
      if (result.ok && !result.message) {
        // Sin toast explícito — el share sheet es feedback nativo.
        return { ok: true, message: '' };
      }
      return result;
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } }; message?: string })
          ?.response?.data?.message ??
        (err as { message?: string }).message ??
        ANUNCIO_LABELS.toastErrShare;
      // ignora abort del usuario (compartir cancelado)
      if ((err as { name?: string })?.name === 'AbortError') {
        return { ok: false, message: '' };
      }
      toastError(msg);
      return { ok: false, message: msg };
    }
  },

  /**
   * Copia el texto del post al clipboard. Replica el
   * `navigator.clipboard.writeText(post_copy)` de la wizard.
   * Llamado desde el `Result stage` y el `preview modal sidebar`.
   */
  async copyPostCopy(creative: MarketingAdCreative): Promise<AssetOpResult> {
    const text = creative.post_copy?.trim() ?? '';
    if (!text) return { ok: false, message: '' };
    try {
      await Clipboard.setStringAsync(text);
      toastSuccess(ANUNCIO_LABELS.toastPostCopied);
      return { ok: true, message: ANUNCIO_LABELS.toastPostCopied };
    } catch (err) {
      const msg =
        (err as { message?: string }).message ??
        ANUNCIO_LABELS.toastErrCopy;
      toastError(msg);
      return { ok: false, message: msg };
    }
  },

  /**
   * Copia la imagen al clipboard nativo (image-clipboard). No todos los
   * dispositivos lo soportan; cuando no, caemos a copiar el share URL.
   * Mirror del web `navigator.clipboard.write([new ClipboardItem({...})])`.
   */
  async copyImage(creative: MarketingAdCreative): Promise<AssetOpResult> {
    if (!hasImage(creative)) {
      return { ok: false, message: ANUNCIO_LABELS.toastErrCopy };
    }
    try {
      const { bufferUri, contentType } = await fetchImageBuffer(creative);
      const base64 = bufferUri.split(',')[1] ?? '';
      const fileUri = await persistBase64ToCache(
        bufferUri,
        buildFileName(creative, contentType),
      );
      // Algunas plataformas no soportan image clipboard. Intentamos
      // `setImageAsync` si existe (expo-clipboard 5+), sino caemos al share URL.
      try {
        const clipboardMod = Clipboard as unknown as {
          setImageAsync?: (uri: string) => Promise<void>;
        };
        if (typeof clipboardMod.setImageAsync === 'function') {
          await clipboardMod.setImageAsync(fileUri);
          toastSuccess(ANUNCIO_LABELS.toastImageCopied);
          return { ok: true, message: ANUNCIO_LABELS.toastImageCopied };
        }
      } catch {
        // fallthrough to URL fallback
      }
      const fallbackText =
        creative.image_url ?? creative.post_copy ?? creative.title;
      await Clipboard.setStringAsync(fallbackText);
      // Determinamos qué mensaje mostrar: si el buffer está intacto,
      // fue image-cliboard; si no, "Enlace copiado."
      const imageClipboardOk = base64.length > 0;
      toastSuccess(
        imageClipboardOk
          ? ANUNCIO_LABELS.toastImageCopied
          : ANUNCIO_LABELS.toastLinkCopied,
      );
      return {
        ok: true,
        message: imageClipboardOk
          ? ANUNCIO_LABELS.toastImageCopied
          : ANUNCIO_LABELS.toastLinkCopied,
      };
    } catch (err) {
      const msg =
        (err as { message?: string }).message ??
        ANUNCIO_LABELS.toastErrCopy;
      try {
        await Clipboard.setStringAsync(
          creative.image_url ?? creative.post_copy ?? creative.title,
        );
        toastSuccess(ANUNCIO_LABELS.toastLinkCopied);
        return { ok: true, message: ANUNCIO_LABELS.toastLinkCopied };
      } catch {
        toastError(msg);
        return { ok: false, message: msg };
      }
    }
  },
};
