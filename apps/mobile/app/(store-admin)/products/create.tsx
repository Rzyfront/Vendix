import { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ProductService } from '@/features/store/services';
import type { ProductState, ProductCategory, Brand, CreateProductDto } from '@/features/store/types';
import { Input } from '@/shared/components/input/input';
import { Button } from '@/shared/components/button/button';
import { Badge } from '@/shared/components/badge/badge';
import { Spinner } from '@/shared/components/spinner/spinner';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';

const STATE_OPTIONS: { label: string; value: ProductState }[] = [
  { label: 'Activo', value: 'active' },
  { label: 'Inactivo', value: 'inactive' },
];

export default function CreateProductScreen() {
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

  const { data: categories = [] } = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => ProductService.getCategories(),
  });

  const { data: brands = [] } = useQuery({
    queryKey: ['product-brands'],
    queryFn: () => ProductService.getBrands(),
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateProductDto) => ProductService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-stats'] });
      toastSuccess('Producto creado exitosamente');
      router.back();
    },
    onError: () => toastError('Error al crear el producto'),
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
    const dto: CreateProductDto = {
      name: name.trim(),
      base_price: Number(basePrice),
      description: description.trim() || undefined,
      sku: sku.trim() || undefined,
      stock_quantity: stockQuantity.trim() ? Number(stockQuantity) : undefined,
      state,
      brand_id: selectedBrand,
      category_ids: selectedCategories.length > 0 ? selectedCategories : undefined,
    };
    createMutation.mutate(dto);
  };

  const toggleCategory = (id: number) => {
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  return (
    <View className="flex-1 bg-white">
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View className="p-4 gap-4">
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

          <View className="gap-2">
            <Text className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Estado</Text>
            <View className="flex-row gap-2">
              {STATE_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => setState(opt.value)}
                  className={`px-4 py-2 rounded-lg ${
                    state === opt.value ? 'bg-primary-600' : 'bg-gray-100'
                  }`}
                >
                  <Text className={`text-sm font-medium ${
                    state === opt.value ? 'text-white' : 'text-gray-700'
                  }`}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {categories.length > 0 && (
            <View className="gap-2">
              <Text className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Categorías</Text>
              <View className="flex-row gap-2 flex-wrap">
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
            <View className="gap-2">
              <Text className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Marca</Text>
              <View className="flex-row gap-2 flex-wrap">
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

      <View className="p-4 border-t border-gray-200">
        <Button
          title="Crear Producto"
          onPress={handleSubmit}
          loading={createMutation.isPending}
          fullWidth
        />
      </View>
    </View>
  );
}
