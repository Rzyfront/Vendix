/**
 * AnuncioCard — Item de la lista de anuncios.
 *
 * Replica la `cardConfig` del web `anuncios.component.ts:531-566`:
 *  - Header: title + status badge (colorMap custom) + RowActionsMenu
 *  - Detail rows: products (icon `package`) + format (icon `image`)
 *  - Footer: created_at formateado con `Intl.DateTimeFormat('es-CO')`
 *  - Avatar: preview_url (square shape, fallback icon `image`)
 *
 * Acciones del RowActionsMenu (ver `anuncios.component.ts:492-529`):
 *  - Ver: siempre, abre preview modal
 *  - Copiar: solo si `image_url`, copia al clipboard
 *  - Descargar: solo si `image_url`, abre share sheet
 *  - Compartir: solo si `image_url`, abre share sheet
 *  - Eliminar: siempre, abre confirm dialog
 */

import { useMemo } from 'react';
import { Pressable, View, StyleSheet } from 'react-native';

import { Card } from '@/shared/components/card/card';
import { Badge } from '@/shared/components/badge/badge';
import { ListItem } from '@/shared/components/list-item/list-item';
import { Icon } from '@/shared/components/icon/icon';
import { RowActionsMenu, type RowAction } from '@/shared/components/row-actions-menu/row-actions-menu';

import { spacing, colorScales } from '@/shared/theme';

import type { MarketingAdCreative } from '@/features/store/types/anuncios.types';
import type { BadgeVariant } from '@/shared/components/badge/badge';
import {
  ANUNCIO_FORMAT_LABEL,
  ANUNCIO_LABELS,
  ANUNCIO_STATE_LABEL,
} from '@/features/store/constants/anuncio-labels';

const ANUNCIO_STATE_BADGE_VARIANT: Record<
  MarketingAdCreative['status'],
  BadgeVariant
> = {
  draft: 'neutral',
  processing: 'warning',
  completed: 'success',
  failed: 'error',
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

  const subtitle = anuncio.description || anuncio.prompt || ANUNCIO_LABELS.emptyTitle;
  const previewUri = previewUrl(anuncio);
  const products = productNames(anuncio);

  return (
    <Pressable onPress={onPress}>
      <Card style={styles.cardMargin}>
        <View style={styles.cardHeader}>
          <View style={styles.avatar}>
            {previewUri ? (
              <View style={styles.avatarImage}>
                <Icon name="image" size={20} color={colorScales.gray[500]} />
              </View>
            ) : (
              <View style={styles.avatarFallback}>
                <Icon name="image" size={20} color={colorScales.gray[500]} />
              </View>
            )}
          </View>
          <View style={styles.flex1}>
            <ListItem
              title={anuncio.title}
              subtitle={products || subtitle}
            />
          </View>
          <Badge
            label={ANUNCIO_STATE_LABEL[state]}
            variant={ANUNCIO_STATE_BADGE_VARIANT[state]}
            size="sm"
          />
          <RowActionsMenu actions={actions} />
        </View>
        <View style={styles.cardMetaRow}>
          <View style={styles.metaItem}>
            <Icon name="image" size={12} color={colorScales.gray[500]} />
            <ListItem title={ANUNCIO_FORMAT_LABEL[anuncio.format]} />
          </View>
          {products ? (
            <View style={styles.metaItem}>
              <Icon name="package" size={12} color={colorScales.gray[500]} />
              <ListItem title={products} />
            </View>
          ) : null}
        </View>
        <View style={styles.cardFooter}>
          <View style={styles.footerLeft}>
            <ListItem title={`${ANUNCIO_LABELS.sectionIdentidad}: ${formatDateTime(anuncio.created_at)}`} />
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cardMargin: {
    marginHorizontal: spacing[4],
    marginVertical: spacing[2],
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  avatar: {
    width: 40,
    height: 40,
  },
  avatarImage: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    paddingVertical: spacing[2],
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    marginTop: spacing[2],
  },
  footerLeft: {
    flexDirection: 'row',
    gap: spacing[4],
  },
  flex1: {
    flex: 1,
  },
});
