import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Image } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ProductService } from '@/features/store/services';
import type { ProductState } from '@/features/store/types';
import { formatCurrency } from '@/shared/utils/currency';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { Badge } from '@/shared/components/badge/badge';
import { Button } from '@/shared/components/button/button';
import { Spinner } from '@/shared/components/spinner/spinner';
import { ConfirmDialog } from '@/shared/components/confirm-dialog/confirm-dialog';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { spacing, typography, colorScales, colors } from '@/shared/theme';

const stateVariant = (state: ProductState) =>
  state === 'active' ? 'success' : state === 'inactive' ? 'warning' : 'default';

const stateLabel = (state: ProductState) =>
  state === 'active' ? 'Activo' : state === 'inactive' ? 'Inactivo' : 'Archivado';

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const { data: product, isLoading } = useQuery({
    queryKey: ['product', id],
    queryFn: () => ProductService.getById(Number(id)),
    enabled: !!id,
  });

  const deleteMutation = useMutation({
    mutationFn: () => ProductService.delete(Number(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-stats'] });
      toastSuccess('Producto eliminado');
      router.back();
    },
    onError: () => toastError('Error al eliminar el producto'),
  });

  const toggleStateMutation = useMutation({
    mutationFn: () =>
      ProductService.update(Number(id), {
        state: product?.state === 'active' ? 'inactive' : 'active',
      } as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toastSuccess('Estado actualizado');
    },
    onError: () => toastError('Error al actualizar el estado'),
  });

  if (isLoading || !product) {
    return (
      <View style={styles.loadingContainer}>
        <Spinner />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.imagePlaceholder}>
          {product.image_url ? (
            <Image source={{ uri: product.image_url }} style={styles.productImage} />
          ) : (
            <Icon name="package" size={64} color={colorScales.gray[400]} />
          )}
        </View>

        <View style={styles.content}>
          <View style={styles.titleRow}>
            <Text style={styles.productName} numberOfLines={2}>
              {product.name}
            </Text>
            <Badge label={stateLabel(product.state)} variant={stateVariant(product.state)} />
          </View>

          <Card style={styles.cardPadding}>
            <InfoRow label="Precio" value={formatCurrency(product.final_price)} />
            {product.base_price !== product.final_price && (
              <InfoRow label="Precio base" value={formatCurrency(product.base_price)} />
            )}
            {product.sale_price != null && (
              <InfoRow label="Precio oferta" value={formatCurrency(product.sale_price)} />
            )}
            {product.cost_price != null && (
              <InfoRow label="Precio costo" value={formatCurrency(product.cost_price)} />
            )}
            {product.sku && <InfoRow label="SKU" value={product.sku} />}
            <InfoRow label="Stock" value={String(product.stock_quantity ?? 0)} />
          </Card>

          {product.description && (
            <Card style={styles.cardPadding}>
              <Text style={styles.sectionTitle}>Descripción</Text>
              <Text style={styles.descriptionText}>{product.description}</Text>
            </Card>
          )}

          {product.categories && product.categories.length > 0 && (
            <Card style={styles.cardPadding}>
              <Text style={styles.sectionTitle}>Categorías</Text>
              <View style={styles.wrapRow}>
                {product.categories.map((cat) => (
                  <Badge key={cat.id} label={cat.name} variant="info" size="sm" />
                ))}
              </View>
            </Card>
          )}

          {product.brand && (
            <Card style={styles.cardPadding}>
              <InfoRow label="Marca" value={product.brand.name} />
            </Card>
          )}

          {product.product_variants && product.product_variants.length > 0 && (
            <Card style={styles.cardPadding}>
              <Text style={styles.sectionTitle}>
                Variantes ({product.product_variants.length})
              </Text>
              {product.product_variants.map((variant, idx) => (
                <View key={variant.id ?? idx} style={styles.infoRow}>
                  <Text style={styles.variantName}>
                    {variant.name ?? `Variante ${idx + 1}`}
                  </Text>
                  <Text style={styles.infoValue}>
                    {formatCurrency(variant.price_override ?? product.final_price)}
                  </Text>
                </View>
              ))}
            </Card>
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.footerRow}>
          <Button
            title="Editar"
            onPress={() => router.push({ pathname: '/products/edit', params: { id } } as never)}
            variant="primary"
            fullWidth
          />
          <Button
            title={product.state === 'active' ? 'Desactivar' : 'Activar'}
            onPress={() => toggleStateMutation.mutate()}
            variant="secondary"
            loading={toggleStateMutation.isPending}
            fullWidth
          />
        </View>
        <Button
          title="Eliminar"
          onPress={() => setShowDeleteDialog(true)}
          variant="destructive"
          fullWidth
        />
      </View>

      <ConfirmDialog
        visible={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={() => {
          setShowDeleteDialog(false);
          deleteMutation.mutate();
        }}
        title="Eliminar producto"
        message="¿Estás seguro de que deseas eliminar este producto? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        destructive
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  imagePlaceholder: {
    height: 192,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  productImage: {
    width: '100%',
    height: 192,
  },
  content: {
    padding: spacing[4],
    gap: spacing[4],
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  productName: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
    flex: 1,
  },
  cardPadding: {
    padding: spacing[4],
  },
  sectionTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[700],
    marginBottom: spacing[2],
  },
  descriptionText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[600],
  },
  wrapRow: {
    flexDirection: 'row',
    gap: spacing[2],
    flexWrap: 'wrap',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  infoLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  infoValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[900],
  },
  variantName: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[700],
  },
  footer: {
    padding: spacing[4],
    gap: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    backgroundColor: colors.background,
  },
  footerRow: {
    flexDirection: 'row',
    gap: spacing[3],
  },
});
