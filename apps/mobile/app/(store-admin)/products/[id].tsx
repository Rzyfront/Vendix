import { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
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

const stateVariant = (state: ProductState) =>
  state === 'active' ? 'success' : state === 'inactive' ? 'warning' : 'default';

const stateLabel = (state: ProductState) =>
  state === 'active' ? 'Activo' : state === 'inactive' ? 'Inactivo' : 'Archivado';

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-2 border-b border-gray-100">
      <Text className="text-sm text-gray-500">{label}</Text>
      <Text className="text-sm font-medium text-gray-900">{value}</Text>
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
      <View className="flex-1 items-center justify-center bg-white">
        <Spinner />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <ScrollView showsVerticalScrollIndicator={false}>
        <View className="h-48 bg-gray-100 items-center justify-center">
          {product.image_url ? (
            <Icon name="package" size={64} color="#9ca3af" />
          ) : (
            <Icon name="package" size={64} color="#9ca3af" />
          )}
        </View>

        <View className="p-4 gap-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-xl font-bold text-gray-900 flex-1" numberOfLines={2}>
              {product.name}
            </Text>
            <Badge label={stateLabel(product.state)} variant={stateVariant(product.state)} />
          </View>

          <Card className="p-4">
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
            <Card className="p-4">
              <Text className="text-sm font-semibold text-gray-700 mb-2">Descripción</Text>
              <Text className="text-sm text-gray-600">{product.description}</Text>
            </Card>
          )}

          {product.categories && product.categories.length > 0 && (
            <Card className="p-4">
              <Text className="text-sm font-semibold text-gray-700 mb-2">Categorías</Text>
              <View className="flex-row gap-2 flex-wrap">
                {product.categories.map((cat) => (
                  <Badge key={cat.id} label={cat.name} variant="info" size="sm" />
                ))}
              </View>
            </Card>
          )}

          {product.brand && (
            <Card className="p-4">
              <InfoRow label="Marca" value={product.brand.name} />
            </Card>
          )}

          {product.product_variants && product.product_variants.length > 0 && (
            <Card className="p-4">
              <Text className="text-sm font-semibold text-gray-700 mb-2">
                Variantes ({product.product_variants.length})
              </Text>
              {product.product_variants.map((variant, idx) => (
                <View key={variant.id ?? idx} className="flex-row justify-between py-2 border-b border-gray-100">
                  <Text className="text-sm text-gray-700">
                    {variant.name ?? `Variante ${idx + 1}`}
                  </Text>
                  <Text className="text-sm font-medium text-gray-900">
                    {formatCurrency(variant.price_override ?? product.final_price)}
                  </Text>
                </View>
              ))}
            </Card>
          )}
        </View>
      </ScrollView>

      <View className="p-4 gap-3 border-t border-gray-200 bg-white">
        <View className="flex-row gap-3">
          <Button
            title="Editar"
            onPress={() => router.push(`/(store-admin)/products/create` as never)}
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
