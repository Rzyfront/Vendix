/**
 * AnuncioCard — Item de la lista de anuncios.
 *
 * Réplica EXACTA de la card web (`apps/frontend/src/app/shared/components/item-list/`)
 * consumida via `cardConfig` en `anuncios.component.ts:531-566`:
 *
 *  - Card container: surface bg + border + radius-lg + shadow-sm + press elevation
 *  - Avatar wrapper: 56×56 square con borderRadius 12 (#E5E7EB bg, contiene <img> real
 *    con thumb_url/image_url; fallback → icon `image`)
 *  - Header row: avatar + title (font-medium, ellipsis) + badge pill + RowActionsMenu
 *  - Detail grid (3 cols): Productos + Formato con label uppercase 9px bold + valor
 *  - Footer: border-top separator + label uppercase "Creado" + valor destacado
 *
 * Acciones del menu (ver `anuncios.component.ts:492-529`):
 *  - Ver: siempre, abre preview modal
 *  - Copiar: solo si `image_url`, copia al clipboard
 *  - Descargar: solo si `image_url`, descarga el asset
 *  - Compartir: solo si `image_url`, abre share sheet
 *  - Eliminar: siempre, abre confirm dialog
 *
 * Badge: variant mapea al colorMap custom web
 *  (`apps/frontend/.../anuncios.component.ts:540-547`) →
 *  draft=#6b7280, processing=#f59e0b, completed=#22c55e, failed=#ef4444.
 */

import { useMemo } from 'react';
import {
  Image,
  Pressable,
  View,
  Text,
  StyleSheet,
} from 'react-native';

import { Card } from '@/shared/components/card/card';
import { Badge } from '@/shared/components/badge/badge';
import { Icon } from '@/shared/components/icon/icon';
import {
  RowActionsMenu,
  type RowAction,
} from '@/shared/components/row-actions-menu/row-actions-menu';

import {
  borderRadius,
  colorScales,
  spacing,
  typography,
  colors,
} from '@/shared/theme';

import type { MarketingAdCreative } from '@/features/store/types/anuncios.types';
import {
  ANUNCIO_FORMAT_LABEL,
  ANUNCIO_STATE_LABEL,
} from '@/features/store/constants/anuncio-labels';

// ── Exact colorMap mirror of web badges (anuncios.component.ts:540-547) ──────
// Web los aplica con opacity 0.12 al background + texto hex sólido. Mobile usa
// la misma paleta exacta via styles override del Badge shared.
const ANUNCIO_STATUS_BG: Record<MarketingAdCreative['status'], string> = {
  draft: 'rgba(107, 114, 128, 0.12)',
  processing: 'rgba(245, 158, 11, 0.12)',
  completed: 'rgba(34, 197, 94, 0.12)',
  failed: 'rgba(239, 68, 68, 0.12)',
};

const ANUNCIO_STATUS_TEXT: Record<MarketingAdCreative['status'], string> = {
  draft: '#475569',
  processing: '#B45309',
  completed: '#047857',
  failed: '#B91C1C',
};

const ANUNCIO_STATUS_BORDER: Record<MarketingAdCreative['status'], string> = {
  draft: 'rgba(107, 114, 128, 0.25)',
  processing: 'rgba(245, 158, 11, 0.25)',
  completed: 'rgba(34, 197, 94, 0.25)',
  failed: 'rgba(239, 68, 68, 0.25)',
};

export interface AnuncioCardProps {
  anuncio: MarketingAdCreative;
  onPress: () => void;
  onView: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onShare: () => void;
  onDelete: () => void;
}

function formatDateTime(value?: string | null): string {
  if (!value) return 'Sin fecha';
  try {
    return new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return 'Sin fecha';
  }
}

function productNames(anuncio: MarketingAdCreative): string {
  return (
    anuncio.creative_products
      ?.map((item) => item.product?.name)
      .filter(Boolean)
      .join(', ') ?? ''
  );
}

function previewUrl(anuncio: MarketingAdCreative): string | null {
  return anuncio.thumb_url || anuncio.image_url || null;
}

export function AnuncioCard({
  anuncio,
  onPress,
  onView,
  onCopy,
  onDownload,
  onShare,
  onDelete,
}: AnuncioCardProps) {
  const hasImage = Boolean(anuncio.image_url);
  const state = anuncio.status;
  const previewUri = previewUrl(anuncio);
  const products = productNames(anuncio);

  const actions: RowAction[] = useMemo(
    () => [
      {
        key: 'view',
        label: 'Ver',
        icon: 'eye',
        variant: 'info',
        onPress: onView,
      },
      {
        key: 'copy',
        label: 'Copiar',
        icon: 'copy',
        variant: 'primary',
        onPress: onCopy,
        visible: hasImage,
      },
      {
        key: 'download',
        label: 'Descargar',
        icon: 'download',
        variant: 'primary',
        onPress: onDownload,
        visible: hasImage,
      },
      {
        key: 'share',
        label: 'Compartir',
        icon: 'share-2',
        variant: 'primary',
        onPress: onShare,
        visible: hasImage,
      },
      {
        key: 'delete',
        label: 'Eliminar',
        icon: 'trash-2',
        variant: 'danger',
        destructive: true,
        onPress: onDelete,
      },
    ],
    [hasImage, onView, onCopy, onDownload, onShare, onDelete],
  );

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pressableWrapper,
        pressed && styles.pressablePressed,
      ]}
    >
      <Card style={styles.card}>
        {/* ── Header: avatar 56×56 square + title + badge + actions ────────── */}
        <View style={styles.cardBody}>
          <View style={styles.avatar}>
            {previewUri ? (
              <Image
                source={{ uri: previewUri }}
                style={styles.avatarImage}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.avatarFallback}>
                <Icon name="image" size={20} color={colorScales.gray[500]} />
              </View>
            )}
          </View>

          <View style={styles.cardMainContent}>
            <View style={styles.titleRow}>
              <View style={styles.titleGroup}>
                <Text style={styles.title} numberOfLines={1}>
                  {anuncio.title}
                </Text>
                {products ? (
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {products}
                  </Text>
                ) : null}
              </View>
              <Badge
                label={ANUNCIO_STATE_LABEL[state]}
                size="sm"
                style={{
                  backgroundColor: ANUNCIO_STATUS_BG[state],
                  borderColor: ANUNCIO_STATUS_BORDER[state],
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                }}
                labelStyle={{
                  color: ANUNCIO_STATUS_TEXT[state],
                  fontSize: 10,
                  fontWeight: typography.fontWeight.medium as any,
                  letterSpacing: 0,
                  textTransform: 'none',
                }}
              />
              <RowActionsMenu actions={actions} />
            </View>

            {/* ── Detail grid 3-col: Productos + Formato ────────────────── */}
            <View style={styles.detailsGrid}>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>
                  <Icon
                    name="package"
                    size={10}
                    color={colorScales.gray[400]}
                  />{' '}
                  Productos
                </Text>
                <Text
                  style={styles.detailValue}
                  numberOfLines={1}
                >
                  {products || 'Sin productos'}
                </Text>
              </View>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>
                  <Icon
                    name="image"
                    size={10}
                    color={colorScales.gray[400]}
                  />{' '}
                  Formato
                </Text>
                <Text
                  style={styles.detailValue}
                  numberOfLines={1}
                >
                  {ANUNCIO_FORMAT_LABEL[anuncio.format]}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* ── Footer: border-top separator + label uppercase + valor ────── */}
        <View style={styles.cardFooter}>
          <View style={styles.footerContent}>
            <Text style={styles.footerLabel}>Creado</Text>
            <Text
              style={styles.footerValue}
              numberOfLines={1}
            >
              {formatDateTime(anuncio.created_at)}
            </Text>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressableWrapper: {
    marginHorizontal: spacing[4],
    marginVertical: spacing[2],
  },
  pressablePressed: {
    opacity: 0.7,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
  },
  // card-body — replica el `.card-body` web: padding 12 + gap 12 + flex row.
  cardBody: {
    flexDirection: 'row',
    padding: spacing[3],
    gap: spacing[3],
  },
  // Avatar wrapper 56×56 square `border-radius: 12` (web avatar-square).
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#E5E7EB',
    flexShrink: 0,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E5E7EB',
  },
  // card-main-content — flex column con title-row + details-grid.
  cardMainContent: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'space-between',
  },
  // card-title-row — flex row title-group + badge.
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
  },
  titleGroup: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 14,
    fontFamily: typography.fontFamily,
    fontWeight: '600',
    color: colorScales.gray[900],
    lineHeight: 18,
  },
  subtitle: {
    fontSize: 11,
    fontFamily: typography.fontFamily,
    color: '#64748B', // slate-500 — mirror web mobile-optimized subtitle
    marginTop: 2,
  },
  // card-details-grid — replica web 3-col grid con 8px gap.
  detailsGrid: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[2],
  },
  detailItem: {
    flex: 1,
    minWidth: 0,
  },
  detailLabel: {
    fontSize: 9,
    fontWeight: '600',
    fontFamily: typography.fontFamily,
    color: '#94A3B8', // slate-400 — mirror web mobile-optimized detail-label
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  // card-footer — border-top separator + label uppercase + valor.
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingTop: spacing[1],
    paddingBottom: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    marginTop: spacing[1],
    backgroundColor: colors.card,
  },
  footerContent: {
    flexDirection: 'column',
    gap: 2,
  },
  footerLabel: {
    fontSize: 10,
    fontWeight: '600',
    fontFamily: typography.fontFamily,
    color: '#94A3B8', // slate-400 — mirror web footer-label
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  footerValue: {
    fontSize: 14,
    fontFamily: typography.fontFamily,
    fontWeight: '600',
    color: colorScales.gray[900],
  },
});
