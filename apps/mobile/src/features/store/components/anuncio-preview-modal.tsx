/**
 * AnuncioPreviewModal — Modal centered-card para ver detalle de un anuncio.
 *
 * Replica el modal de preview del web
 * (`anuncios.component.ts:251-384`, size `xl`).
 *
 * Anatomía (Web Visual Pattern):
 *  - Backdrop: `rgba(15,23,42,0.45)` con `Pressable` dismiss
 *  - Card: white surface, `borderRadius: 12`, `maxWidth: 1024` (xl size)
 *  - Header: title (anuncio.title) + subtitle (status label)
 *  - Body: grid `image left + sidebar right` (en mobile se stack vertical)
 *  - Footer: outline Copiar/Descargar/Compartir + primary "Abrir tienda"
 *
 * En mobile el footer puede mostrar todos los botones en una sola fila
 * con wrap (RN no soporta grid md+ del web), pero el orden visual
 * coincide con el web (outline primero, primary al final, right-aligned).
 */

import { useEffect, useState } from 'react';
import {
  Modal as RNModal,
  Pressable,
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Linking,
  Image,
} from 'react-native';

import { Button } from '@/shared/components/button/button';
import { Icon } from '@/shared/components/icon/icon';

import { AnunciosService } from '@/features/store/services/anuncios.service';
import { AdCreativeAssetService } from '@/features/store/services/ad-creative-asset.service';
import { ANUNCIO_LABELS, ANUNCIO_FORMAT_LABEL, ANUNCIO_STATE_LABEL } from '@/features/store/constants/anuncio-labels';
import type { MarketingAdCreative, MarketingAdEcommerceDomain } from '@/features/store/types/anuncios.types';

import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

export interface AnuncioPreviewModalProps {
  visible: boolean;
  anuncio: MarketingAdCreative | null;
  onClose: () => void;
  onDeleted?: () => void;
}

export function AnuncioPreviewModal({
  visible,
  anuncio,
  onClose,
  onDeleted,
}: AnuncioPreviewModalProps) {
  const [ecommerceUrl, setEcommerceUrl] = useState<string | null>(null);
  const [ecommerceError, setEcommerceError] = useState<string | null>(null);
  const [copyingPost, setCopyingPost] = useState(false);

  // Cargar ecommerce domain on open
  useEffect(() => {
    if (!visible) {
      setEcommerceUrl(null);
      setEcommerceError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const domain = await AnunciosService.getEcommerceDomain();
        if (cancelled) return;
        if (domain?.url || domain?.hostname) {
          setEcommerceUrl(
            domain.url || `https://${domain.hostname.replace(/^https?:\/\//, '').replace(/\/$/, '')}`,
          );
        } else {
          setEcommerceError(ANUNCIO_LABELS.toastErrEcommerce);
        }
      } catch {
        if (!cancelled) setEcommerceError(ANUNCIO_LABELS.toastErrEcommerce);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  if (!anuncio) return null;

  const hasImage = Boolean(anuncio.image_url);
  const hasPost = Boolean(anuncio.post_copy?.trim());
  const description = anuncio.description || anuncio.prompt || 'Sin descripcion.';
  const products =
    anuncio.creative_products
      ?.map((item) => item.product?.name)
      .filter(Boolean)
      .join(', ') || '';

  const handleCopyImage = () => {
    if (!anuncio) return;
    void AdCreativeAssetService.copyImage(anuncio);
  };
  const handleDownload = () => {
    if (!anuncio) return;
    void AdCreativeAssetService.download(anuncio);
  };
  const handleShare = () => {
    if (!anuncio) return;
    void AdCreativeAssetService.share(anuncio);
  };
  const handleCopyPost = async () => {
    if (!anuncio || !anuncio.post_copy) return;
    setCopyingPost(true);
    await AdCreativeAssetService.copyPostCopy(anuncio);
    setCopyingPost(false);
  };
  const handleOpenStore = () => {
    if (!ecommerceUrl) return;
    Linking.openURL(ecommerceUrl).catch(() => {
      // user cancelled
    });
  };

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Cerrar modal"
      >
        <Pressable
          style={styles.cardWrapper}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.card}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={styles.title} numberOfLines={2}>
                  {anuncio.title || ANUNCIO_LABELS.modalPreviewTitleFallback}
                </Text>
                <Text style={styles.subtitle}>
                  {ANUNCIO_STATE_LABEL[anuncio.status]} · {ANUNCIO_FORMAT_LABEL[anuncio.format]}
                </Text>
              </View>
              <Pressable
                style={styles.closeButton}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Cerrar"
              >
                <Icon name="x" size={18} color={colorScales.gray[700]} />
              </Pressable>
            </View>

            {/* Body */}
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
            >
              <View style={styles.bodyGrid}>
                {/* Image stage */}
                <View style={styles.imageStage}>
                  {hasImage && anuncio.image_url ? (
                    <Image
                      source={{ uri: anuncio.image_url }}
                      style={styles.previewImage}
                      resizeMode="contain"
                    />
                  ) : (
                    <View style={styles.noImage}>
                      <Icon name="image-off" size={36} color={colorScales.gray[400]} />
                      <Text style={styles.noImageText}>
                        {ANUNCIO_LABELS.emptyImagenNo}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Sidebar */}
                <View style={styles.sidebar}>
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{anuncio.title}</Text>
                    <Text style={styles.sectionBody}>{description}</Text>
                  </View>

                  {products ? (
                    <View style={styles.section}>
                      <Text style={styles.sectionLabel}>{ANUNCIO_LABELS.sectionProductos}</Text>
                      <Text style={styles.sectionBody}>{products}</Text>
                    </View>
                  ) : null}

                  {hasPost ? (
                    <View style={styles.postCard}>
                      <View style={styles.postCardHeader}>
                        <View style={styles.postCardTitleRow}>
                          <Icon name="message-square" size={16} color={colors.primary} />
                          <Text style={styles.postCardTitle}>{ANUNCIO_LABELS.postSuggested}</Text>
                        </View>
                        <Button
                          variant="ghost"
                          size="sm"
                          onPress={handleCopyPost}
                          loading={copyingPost}
                          title={ANUNCIO_LABELS.ctaCopy}
                          leftIcon={<Icon name="copy" size={14} color={colorScales.gray[700]} />}
                        />
                      </View>
                      <Text style={styles.postCardText}>{anuncio.post_copy}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </ScrollView>

            {/* Footer */}
            <View style={styles.footer}>
              {hasImage ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onPress={handleCopyImage}
                    title={ANUNCIO_LABELS.ctaCopy}
                    leftIcon={<Icon name="copy" size={15} color={colorScales.gray[700]} />}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onPress={handleDownload}
                    title={ANUNCIO_LABELS.ctaDownload}
                    leftIcon={<Icon name="download" size={15} color={colorScales.gray[700]} />}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onPress={handleShare}
                    title={ANUNCIO_LABELS.ctaShare}
                    leftIcon={<Icon name="share-2" size={15} color={colorScales.gray[700]} />}
                  />
                </>
              ) : null}
              {ecommerceUrl ? (
                <Button
                  variant="primary"
                  size="sm"
                  onPress={handleOpenStore}
                  title={ANUNCIO_LABELS.ctaOpenStore}
                  leftIcon={<Icon name="external-link" size={15} color={colors.card} />}
                />
              ) : null}
            </View>

            {ecommerceError ? (
              <Text style={styles.errorHint}>{ecommerceError}</Text>
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  cardWrapper: {
    width: '100%',
    maxWidth: 1024,
    maxHeight: '90%',
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
  },
  headerText: {
    flex: 1,
    gap: spacing[1],
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.full,
  },
  body: {
    maxHeight: '70%',
  },
  bodyContent: {
    padding: spacing[4],
  },
  bodyGrid: {
    gap: spacing[4],
  },
  imageStage: {
    minHeight: 220,
    backgroundColor: colorScales.gray[100],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[4],
  },
  previewImage: {
    width: '100%',
    height: 280,
    borderRadius: borderRadius.md,
  },
  noImage: {
    alignItems: 'center',
    gap: spacing[3],
  },
  noImageText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[600],
    textAlign: 'center',
  },
  sidebar: {
    gap: spacing[4],
  },
  section: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    padding: spacing[3],
  },
  sectionLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold as any,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: colorScales.gray[500],
    marginBottom: spacing[1],
  },
  sectionTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
  },
  sectionBody: {
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
    lineHeight: 20,
  },
  postCard: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    padding: spacing[4],
  },
  postCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[3],
  },
  postCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  postCardTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
  },
  postCardText: {
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
    lineHeight: 22,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing[2],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  errorHint: {
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[3],
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
});
