import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ProductService } from '@/features/store/services';
import type { ProductState, ProductCategory, Brand, UpdateProductDto } from '@/features/store/types';
import { Input } from '@/shared/components/input/input';
import { Button } from '@/shared/components/button/button';
import { Badge } from '@/shared/components/badge/badge';
import { Spinner } from '@/shared/components/spinner/spinner';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { spacing, borderRadius, typography, colorScales, colors } from '@/shared/theme';

const STATE_OPTIONS: { label: string; value: ProductState }[] = [
  { label: 'Activo', value: 'active' },
  { label: 'Inactivo', value: 'inactive' },
];

export default function EditProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [sku, setSku] = useState('');
  const [stockQuantity, setStockQuantity] = useState('');
  const [state, setState] = useState<ProductState>('active');
  const [selectedCategories, setSelectedCategories] = useState<number[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<number | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: product, isLoading: productLoading } = useQuery({
    queryKey: ['product', id],
    queryFn: () => ProductService.getById(Number(id)),
    enabled: !!id,
  });

  useEffect(() => {
    if (product) {
      setName(product.name);
      setDescription(product.description ?? '');
      setBasePrice(String(product.base_price));
      setSku(product.sku ?? '');
      setStockQuantity(String(product.stock_quantity ?? 0));
      setState(product.state);
      setSelectedCategories(product.categories?.map((c) => c.id) ?? []);
      setSelectedBrand(product.brand_id ?? undefined);
    }
  }, [product]);

  const { data: categories = [] } = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => ProductService.getCategories(),
  });

  const { data: brands = [] } = useQuery({
    queryKey: ['product-brands'],
    queryFn: () => ProductService.getBrands(),
  });

  const updateMutation = useMutation({
    mutationFn: (data: UpdateProductDto) => ProductService.update(Number(id), data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product', id] });
      queryClient.invalidateQueries({ queryKey: ['product-stats'] });
      toastSuccess('Producto actualizado exitosamente');
      router.back();
    },
    onError: () => toastError('Error al actualizar el producto'),
  });

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'El nombre es requerido';
    if (!basePrice.trim() || isNaN(Number(basePrice)) || Number(basePrice) <= 0)
      newErrors.basePrice = 'Ingresa un precio válido';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    const dto: UpdateProductDto = {
      name: name.trim(),
      base_price: Number(basePrice),
      description: description.trim() || undefined,
      sku: sku.trim() || undefined,
      stock_quantity: stockQuantity.trim() ? Number(stockQuantity) : undefined,
      state,
      brand_id: selectedBrand,
      category_ids: selectedCategories.length > 0 ? selectedCategories : undefined,
    };
    updateMutation.mutate(dto);
  };

  const toggleCategory = (id: number) => {
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  if (productLoading || !product) {
    return (
      <View style={styles.loader}>
        <Spinner />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.formContent}>
          <Input
            label="Nombre *"
            value={name}
            onChangeText={setName}
            error={errors.name}
            placeholder="Nombre del producto"
          />

          <Input
            label="Descripción"
            value={description}
            onChangeText={setDescription}
            placeholder="Descripción del producto"
            multiline
          />

          <Input
            label="Precio base *"
            value={basePrice}
            onChangeText={setBasePrice}
            error={errors.basePrice}
            placeholder="0.00"
            keyboardType="decimal-pad"
          />

          <Input
            label="SKU"
            value={sku}
            onChangeText={setSku}
            placeholder="Código SKU"
          />

          <Input
            label="Cantidad en stock"
            value={stockQuantity}
            onChangeText={setStockQuantity}
            placeholder="0"
            keyboardType="number-pad"
          />

          <View style={styles.sectionGap}>
            <Text style={styles.sectionLabel}>Estado</Text>
            <View style={styles.rowGap2}>
              {STATE_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => setState(opt.value)}
                  style={[
                    styles.stateButton,
                    state === opt.value ? styles.stateButtonActive : styles.stateButtonInactive,
                  ]}
                >
                  <Text style={[
                    styles.stateButtonText,
                    state === opt.value ? styles.stateTextActive : styles.stateTextInactive,
                  ]}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {categories.length > 0 && (
            <View style={styles.sectionGap}>
              <Text style={styles.sectionLabel}>Categorías</Text>
              <View style={styles.wrapRow}>
                {categories.map((cat: ProductCategory) => (
                  <Pressable key={cat.id} onPress={() => toggleCategory(cat.id)}>
                    <Badge
                      label={cat.name}
                      variant={selectedCategories.includes(cat.id) ? 'success' : 'default'}
                      size="md"
                    />
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {brands.length > 0 && (
            <View style={styles.sectionGap}>
              <Text style={styles.sectionLabel}>Marca</Text>
              <View style={styles.wrapRow}>
                <Pressable onPress={() => setSelectedBrand(undefined)}>
                  <Badge
                    label="Sin marca"
                    variant={selectedBrand === undefined ? 'success' : 'default'}
                    size="md"
                  />
                </Pressable>
                {brands.map((brand: Brand) => (
                  <Pressable key={brand.id} onPress={() => setSelectedBrand(brand.id)}>
                    <Badge
                      label={brand.name}
                      variant={selectedBrand === brand.id ? 'success' : 'default'}
                      size="md"
                    />
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title="Guardar Cambios"
          onPress={handleSubmit}
          loading={updateMutation.isPending}
          fullWidth
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  formContent: {
    padding: spacing[4],
    gap: spacing[4],
  },
  sectionGap: {
    gap: spacing[2],
  },
  sectionLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  rowGap2: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  wrapRow: {
    flexDirection: 'row',
    gap: spacing[2],
    flexWrap: 'wrap',
  },
  stateButton: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
  },
  stateButtonActive: {
    backgroundColor: colors.primary,
  },
  stateButtonInactive: {
    backgroundColor: colorScales.gray[100],
  },
  stateButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
  },
  stateTextActive: {
    color: colors.background,
  },
  stateTextInactive: {
    color: colorScales.gray[700],
  },
  footer: {
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
});
