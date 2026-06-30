import { useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
  StyleSheet,
  Dimensions,
  type ViewStyle,
} from 'react-native';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { Badge } from '@/shared/components/badge/badge';

export interface CarouselImage {
  url: string;
  alt?: string;
  isMain?: boolean;
  id?: string | number;
}

interface ImageCarouselProps {
  images: CarouselImage[];
  onSetMain?: (index: number) => void;
  onDelete?: (index: number) => void;
  onAdd?: () => void;
  max?: number;
  editable?: boolean;
  height?: number;
  style?: ViewStyle;
}

const DEFAULT_HEIGHT = 220;

export function ImageCarousel({
  images,
  onSetMain,
  onDelete,
  onAdd,
  max = 5,
  editable = false,
  height = DEFAULT_HEIGHT,
  style,
}: ImageCarouselProps) {
  const [active, setActive] = useState(0);
  const screenWidth = Dimensions.get('window').width;

  function handleScroll(event: any) {
    const x = event.nativeEvent.contentOffset.x;
    const idx = Math.round(x / screenWidth);
    if (idx !== active) setActive(idx);
  }

  const canAdd = editable && images.length < max;

  return (
    <View style={[styles.wrapper, { height }, style]}>
      {images.length === 0 && editable ? (
        <Pressable onPress={onAdd} style={styles.emptyState}>
          <Icon name="image-plus" size={40} color={colors.text.muted} />
          <Text style={styles.emptyText}>Agregar imagen</Text>
          <Text style={styles.emptyHint}>
            Toca para subir. Máximo {max} imágenes.
          </Text>
        </Pressable>
      ) : (
        <>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={handleScroll}
            scrollEventThrottle={16}
          >
            {images.map((img, index) => (
              <View
                key={img.id ?? img.url ?? index}
                style={[styles.slide, { width: screenWidth - spacing[4] * 2 }]}
              >
                <Image
                  source={{ uri: img.url }}
                  style={styles.image}
                  resizeMode="cover"
                />
                {img.isMain && (
                  <View style={styles.mainBadge}>
                    <Badge label="Principal" variant="primary" size="xs" />
                  </View>
                )}
                {editable && (
                  <View style={styles.actions}>
                    {!img.isMain && onSetMain && (
                      <Pressable
                        onPress={() => onSetMain(index)}
                        hitSlop={8}
                        style={[styles.actionButton, styles.actionSetMain]}
                      >
                        <Icon name="star" size={16} color={colors.background} />
                      </Pressable>
                    )}
                    {onDelete && (
                      <Pressable
                        onPress={() => onDelete(index)}
                        hitSlop={8}
                        style={[styles.actionButton, styles.actionDelete]}
                      >
                        <Icon name="trash-2" size={16} color={colors.background} />
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            ))}
          </ScrollView>

          {images.length > 1 && (
            <View style={styles.dots}>
              {images.map((_, i) => (
                <View
                  key={i}
                  style={[styles.dot, i === active && styles.dotActive]}
                />
              ))}
            </View>
          )}
        </>
      )}

      {canAdd && (
        <Pressable onPress={onAdd} style={styles.addFab}>
          <Icon name="plus" size={20} color={colors.background} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    backgroundColor: colorScales.gray[100],
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderStyle: 'dashed',
    borderRadius: borderRadius.lg,
  },
  emptyText: {
    fontSize: typography.fontSize.base,
    fontWeight: '500',
    color: colors.text.secondary,
    marginTop: spacing[2],
  },
  emptyHint: {
    fontSize: typography.fontSize.sm,
    color: colors.text.muted,
    textAlign: 'center',
  },
  slide: {
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  mainBadge: {
    position: 'absolute',
    top: spacing[2],
    left: spacing[2],
  },
  actions: {
    position: 'absolute',
    top: spacing[2],
    right: spacing[2],
    flexDirection: 'row',
    gap: spacing[1],
  },
  actionButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionSetMain: {
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  actionDelete: {
    backgroundColor: 'rgba(220,38,38,0.85)',
  },
  dots: {
    position: 'absolute',
    bottom: spacing[2],
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing[1],
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  dotActive: {
    backgroundColor: colors.background,
    width: 16,
  },
  addFab: {
    position: 'absolute',
    bottom: spacing[3],
    right: spacing[3],
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
});

export type { ImageCarouselProps };