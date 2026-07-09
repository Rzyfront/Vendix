/**
 * AnuncioGalleryModal — Modal centered-card para elegir recursos
 * (logos, QR, sliders, fotos de productos, uploads).
 *
 * Replica `app-modal size="lg"` del web
 * (`anuncio-create-wizard-page.component.ts:917-1078`).
 *
 * Para el MVP mobile, simplificamos las 4 secciones del web:
 *  1. Logos (tienda, marca, ecommerce) — pre-computados como items
 *  2. QR de tienda — pre-computado
 *  3. Fotos de productos (de selectedProducts) — se hidratan al abrir
 *  4. Recursos subidos por el usuario — slot con `image-source-modal`
 *
 * El backend ya retorna `online_purchase_qr_code` por producto y el
 * `getEcommerceDomain` retorna la config de ecommerce (qr_code_data_url,
 * slider.photos, etc.). En el MVP mobile no hidratamos todas estas
 * fuentes para mantener scope; basta con las fotos de productos
 * seleccionadas + un placeholder para uploads.
 *
 * Anatomía (Web Visual Pattern):
 *  - Centered card `lg` (maxWidth 640)
 *  - Header: "Galeria de recursos disponibles" + subtitle
 *  - Body: counter + grid 2/3/4 cols + "Agregar" outline + "Listo" primary
 *  - Footer: border-top separator + primary "Listo" right-aligned
 */

import { useCallback, useMemo, useState } from 'react';
import {
  Modal as RNModal,
  Pressable,
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
} from 'react-native';

import { Button } from '@/shared/components/button/button';
import { Icon } from '@/shared/components/icon/icon';
import { EmptyState } from '@/shared/components/empty-state/empty-state';

import { ANUNCIO_LABELS } from '@/features/store/constants/anuncio-labels';

import type { AnuncioSelectedProduct } from './anuncio-products-modal';

import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

export interface AnuncioGalleryResource {
  id: string;
  label: string;
  preview_url: string;
  source_type: string;
  kind: 'reference' | 'product_image';
}

export interface AnuncioGallerySelection {
  referenceIds: string[];
  imageIds: number[];
}

export interface AnuncioGalleryModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (selection: AnuncioGallerySelection) => void;
  initialSelection?: AnuncioGallerySelection;
  selectedProducts?: AnuncioSelectedProduct[];
}

function buildProductImageItems(
  products: AnuncioSelectedProduct[],
): AnuncioGalleryResource[] {
  const items: AnuncioGalleryResource[] = [];
  for (const p of products) {
    // Single-image products use the product's image_url directly.
    if (p.image_url) {
      items.push({
        id: `product-image-${p.id}`,
        label: p.name,
        preview_url: p.image_url,
        source_type: 'product',
        kind: 'product_image',
      });
    }
  }
  return items;
}

export function AnuncioGalleryModal({
  visible,
  onClose,
  onConfirm,
  initialSelection,
  selectedProducts = [],
}: AnuncioGalleryModalProps) {
  const [referenceIds, setReferenceIds] = useState<string[]>(
    initialSelection?.referenceIds ?? [],
  );
  const [imageIds, setImageIds] = useState<number[]>(
    initialSelection?.imageIds ?? [],
  );

  // Build the gallery grid. In the MVP, only product images are available.
  const items = useMemo(
    () => buildProductImageItems(selectedProducts),
    [selectedProducts],
  );

  const toggleImage = useCallback((id: number) => {
    setImageIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm({ referenceIds, imageIds });
  }, [onConfirm, referenceIds, imageIds]);

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.cardWrapper} onPress={(e) => e.stopPropagation()}>
          <View style={styles.card}>
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={styles.title}>{ANUNCIO_LABELS.modalGalleryTitle}</Text>
                <Text style={styles.subtitle}>{ANUNCIO_LABELS.modalGallerySubtitle}</Text>
              </View>
              <Pressable style={styles.closeButton} onPress={onClose}>
                <Icon name="x" size={18} color={colorScales.gray[700]} />
              </Pressable>
            </View>

            <View style={styles.subheader}>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>
                  {referenceIds.length + imageIds.length} {ANUNCIO_LABELS.selected}
                </Text>
              </View>
              <Button
                variant="outline"
                size="sm"
                onPress={() => {
                  // Upload de imágenes custom se delega al image-source-modal
                  // shared (no conectado en MVP; placeholder).
                }}
                title={ANUNCIO_LABELS.ctaAgregar}
                leftIcon={<Icon name="upload-cloud" size={15} color={colors.primary} />}
              />
            </View>

            <View style={styles.body}>
              {items.length === 0 ? (
                <EmptyState
                  icon="images"
                  title={ANUNCIO_LABELS.emptyNoResources}
                  description={ANUNCIO_LABELS.emptyNoResourcesDesc}
                />
              ) : (
                <FlatList
                  data={items}
                  keyExtractor={(item) => item.id}
                  numColumns={3}
                  columnWrapperStyle={styles.gridRow}
                  contentContainerStyle={styles.gridContent}
                  renderItem={({ item }) => {
                    const isSelected = item.kind === 'product_image'
                      ? imageIds.includes(Number(item.id.replace('product-image-', '')))
                      : referenceIds.includes(item.id);
                    return (
                      <Pressable
                        style={[styles.resourceCard, isSelected && styles.resourceCardSelected]}
                        onPress={() => {
                          if (item.kind === 'product_image') {
                            toggleImage(Number(item.id.replace('product-image-', '')));
                          } else {
                            setReferenceIds((prev) =>
                              prev.includes(item.id)
                                ? prev.filter((x) => x !== item.id)
                                : [...prev, item.id],
                            );
                          }
                        }}
                      >
                        <View style={styles.resourceImageWrap}>
                          <Image
                            source={{ uri: item.preview_url }}
                            style={styles.resourceImage}
                            resizeMode="cover"
                          />
                        </View>
                        <View style={styles.resourceMeta}>
                          <Text style={styles.resourceLabel} numberOfLines={1}>
                            {item.label}
                          </Text>
                          <Text style={styles.resourceSubLabel}>
                            {ANUNCIO_LABELS.productPhoto}
                          </Text>
                        </View>
                        {isSelected ? (
                          <View style={styles.checkBubble}>
                            <Icon name="check" size={14} color={colors.card} />
                          </View>
                        ) : null}
                      </Pressable>
                    );
                  }}
                />
              )}
            </View>

            <View style={styles.footer}>
              <Button
                variant="primary"
                size="md"
                onPress={handleConfirm}
                title={ANUNCIO_LABELS.ctaListo}
              />
            </View>
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
    maxWidth: 640,
    maxHeight: '90%',
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
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
  subheader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.cardBorder,
  },
  countBadge: {
    backgroundColor: colorScales.gray[100],
    borderRadius: 999,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
  },
  countBadgeText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.secondary,
  },
  body: {
    minHeight: 240,
    maxHeight: 420,
    padding: spacing[3],
  },
  gridRow: {
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  gridContent: {
    padding: spacing[1],
  },
  resourceCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing[2],
    position: 'relative',
  },
  resourceCardSelected: {
    borderColor: colors.primary,
  },
  resourceImageWrap: {
    aspectRatio: 1,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    backgroundColor: colorScales.gray[100],
  },
  resourceImage: {
    width: '100%',
    height: '100%',
  },
  resourceMeta: {
    paddingTop: spacing[2],
    paddingHorizontal: spacing[1],
  },
  resourceLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
  },
  resourceSubLabel: {
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
    marginTop: 2,
  },
  checkBubble: {
    position: 'absolute',
    top: spacing[2],
    right: spacing[2],
    width: 24,
    height: 24,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[2],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
});
