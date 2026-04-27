import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProductService } from '@/features/store/services';
import { OrderService } from '@/features/store/services';
import { useCartStore } from '@/features/store/pos/store/cart.store';
import { formatCurrency } from '@/shared/utils/currency';
import { colors } from '@/shared/theme/colors';
import { Icon } from '@/shared/components/icon/icon';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { Badge } from '@/shared/components/badge/badge';
import { Spinner } from '@/shared/components/spinner/spinner';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { BottomSheet } from '@/shared/components/bottom-sheet/bottom-sheet';
import { Button } from '@/shared/components/button/button';
import { Input } from '@/shared/components/input/input';
import { ListItem } from '@/shared/components/list-item/list-item';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import type { Product, ProductVariant, PosCustomer } from '@/features/store/types';

const ITEM_WIDTH = '48%';

const ProductCard = ({
  product,
  onPress,
}: {
  product: Product;
  onPress: (product: Product) => void;
}) => {
  const firstLetter = product.name?.charAt(0)?.toUpperCase() || '?';
  const hasVariants = (product.product_variants?.length ?? 0) > 0;
  const isLowStock = product.stock_quantity != null && product.stock_quantity > 0 && product.stock_quantity <= 5;
  const isOutOfStock = product.stock_quantity === 0;

  return (
    <Pressable
      onPress={() => !isOutOfStock && onPress(product)}
      className="bg-white rounded-xl p-3 mb-3 shadow-sm border border-gray-100 active:scale-[0.97]"
      style={{ width: ITEM_WIDTH as any }}
      disabled={isOutOfStock}
    >
      <View
        className="w-full h-24 rounded-lg items-center justify-center mb-2"
        style={{ backgroundColor: isOutOfStock ? '#E5E7EB' : colors.primary + '20' }}
      >
        {product.image_url ? (
          <View className="w-full h-full rounded-lg bg-gray-200 items-center justify-center">
            <Icon name="package" size={28} color={colors.text.secondary} />
          </View>
        ) : (
          <Text
            className="font-bold text-2xl"
            style={{ color: isOutOfStock ? '#9CA3AF' : colors.primary }}
          >
            {firstLetter}
          </Text>
        )}
      </View>

      <Text className="text-sm font-semibold text-gray-900" numberOfLines={2}>
        {product.name}
      </Text>

      <View className="flex-row items-center justify-between mt-1">
        <Text className="text-sm font-bold" style={{ color: colors.primary }}>
          {formatCurrency(product.final_price)}
        </Text>
        {hasVariants && (
          <Badge label="Var." variant="info" size="sm" />
        )}
      </View>

      {isLowStock && (
        <Text className="text-xs mt-1" style={{ color: '#F59E0B' }}>
          Stock: {product.stock_quantity}
        </Text>
      )}
      {isOutOfStock && (
        <Text className="text-xs mt-1 font-medium" style={{ color: colors.error }}>
          Agotado
        </Text>
      )}
    </Pressable>
  );
};

const VariantPicker = ({
  visible,
  product,
  onSelect,
  onClose,
}: {
  visible: boolean;
  product: Product | null;
  onSelect: (variant: ProductVariant) => void;
  onClose: () => void;
}) => {
  if (!product) return null;

  return (
    <BottomSheet visible={visible} onClose={onClose} snapPoint="partial">
      <View className="px-4 pt-2 pb-4">
        <Text className="text-lg font-bold text-gray-900 mb-1">Seleccionar Variante</Text>
        <Text className="text-sm text-gray-500 mb-4">{product.name}</Text>
        <FlatList
          data={product.product_variants || []}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => {
            const price = item.price_override != null ? item.price_override : product.final_price;
            const isUnavailable = item.stock_quantity === 0;

            return (
              <Pressable
                onPress={() => !isUnavailable && onSelect(item)}
                className="flex-row items-center justify-between py-3 px-2 border-b border-gray-100 active:bg-gray-50"
                disabled={isUnavailable}
              >
                <View className="flex-1">
                  <Text className="text-sm font-medium text-gray-900">
                    {item.name || item.attributes || item.sku}
                  </Text>
                  <Text className="text-xs text-gray-500">SKU: {item.sku}</Text>
                </View>
                <View className="items-end">
                  <Text className="text-sm font-bold" style={{ color: colors.primary }}>
                    {formatCurrency(price)}
                  </Text>
                  {isUnavailable ? (
                    <Text className="text-xs" style={{ color: colors.error }}>Agotado</Text>
                  ) : (
                    <Text className="text-xs text-gray-400">Stock: {item.stock_quantity}</Text>
                  )}
                </View>
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => <View className="h-px bg-gray-100" />}
        />
      </View>
    </BottomSheet>
  );
};

const CartItemRow = ({
  item,
  onIncrease,
  onDecrease,
  onRemove,
}: {
  item: any;
  onIncrease: (id: string) => void;
  onDecrease: (id: string) => void;
  onRemove: (id: string) => void;
}) => (
  <View className="flex-row items-center py-3 border-b border-gray-100">
    <View className="flex-1 mr-3">
      <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>
        {item.product.name}
      </Text>
      {item.variant_display_name && (
        <Text className="text-xs text-gray-500" numberOfLines={1}>
          {item.variant_display_name}
        </Text>
      )}
      <Text className="text-xs text-gray-400 mt-0.5">
        {formatCurrency(item.finalPrice)} c/u
      </Text>
    </View>

    <View className="flex-row items-center mr-3">
      <Pressable
        onPress={() => onDecrease(item.id)}
        className="w-8 h-8 rounded-full bg-gray-100 items-center justify-center active:bg-gray-200"
      >
        <Icon name="minus" size={14} color={colors.text.secondary} />
      </Pressable>
      <Text className="text-sm font-bold mx-3 w-6 text-center">{item.quantity}</Text>
      <Pressable
        onPress={() => onIncrease(item.id)}
        className="w-8 h-8 rounded-full items-center justify-center active:opacity-80"
        style={{ backgroundColor: colors.primary + '20' }}
      >
        <Icon name="plus" size={14} color={colors.primary} />
      </Pressable>
    </View>

    <Text className="text-sm font-bold text-gray-900 w-20 text-right">
      {formatCurrency(item.totalPrice)}
    </Text>

    <Pressable
      onPress={() => onRemove(item.id)}
      className="ml-2 p-1 active:opacity-50"
    >
      <Icon name="trash" size={16} color={colors.error} />
    </Pressable>
  </View>
);

const CartPanel = ({
  visible,
  onClose,
  onCharge,
}: {
  visible: boolean;
  onClose: () => void;
  onCharge: () => void;
}) => {
  const items = useCartStore((s) => s.items);
  const customer = useCartStore((s) => s.customer);
  const summary = useCartStore((s) => s.summary);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const setCustomer = useCartStore((s) => s.setCustomer);

  return (
    <BottomSheet visible={visible} onClose={onClose} snapPoint="full">
      <View className="flex-1 px-4 pt-2">
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-lg font-bold text-gray-900">Carrito</Text>
          <Pressable onPress={onClose}>
            <Icon name="x" size={24} color={colors.text.secondary} />
          </Pressable>
        </View>

        {customer && (
          <Pressable
            onPress={() => setCustomer(null)}
            className="flex-row items-center bg-blue-50 rounded-lg px-3 py-2 mb-3 active:bg-blue-100"
          >
            <Icon name="user" size={16} color="#3B82F6" />
            <Text className="text-sm text-blue-700 font-medium ml-2 flex-1">
              {customer.first_name} {customer.last_name}
            </Text>
            <Icon name="x" size={14} color="#3B82F6" />
          </Pressable>
        )}

        {items.length === 0 ? (
          <EmptyState
            title="Carrito vacío"
            description="Agrega productos desde el catálogo"
            icon="shopping-cart"
          />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <CartItemRow
                item={item}
                onIncrease={(id) => updateQuantity(id, items.find((i) => i.id === id)!.quantity + 1)}
                onDecrease={(id) => updateQuantity(id, items.find((i) => i.id === id)!.quantity - 1)}
                onRemove={removeItem}
              />
            )}
            className="flex-1"
          />
        )}

        {items.length > 0 && (
          <View className="pt-3 border-t border-gray-200">
            <View className="flex-row justify-between mb-1">
              <Text className="text-sm text-gray-500">Subtotal</Text>
              <Text className="text-sm text-gray-700">{formatCurrency(summary.subtotal)}</Text>
            </View>
            <View className="flex-row justify-between mb-1">
              <Text className="text-sm text-gray-500">IVA</Text>
              <Text className="text-sm text-gray-700">{formatCurrency(summary.taxAmount)}</Text>
            </View>
            {summary.discountAmount > 0 && (
              <View className="flex-row justify-between mb-1">
                <Text className="text-sm text-gray-500">Descuento</Text>
                <Text className="text-sm text-green-600">-{formatCurrency(summary.discountAmount)}</Text>
              </View>
            )}
            <View className="flex-row justify-between mt-2 pt-2 border-t border-gray-200">
              <Text className="text-base font-bold text-gray-900">Total</Text>
              <Text className="text-base font-bold" style={{ color: colors.primary }}>
                {formatCurrency(summary.total)}
              </Text>
            </View>

            <Button
              title="COBRAR"
              onPress={onCharge}
              fullWidth
              size="lg"
              className="mt-4"
            />
          </View>
        )}
      </View>
    </BottomSheet>
  );
};

const PaymentSheet = ({
  visible,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  onClose: () => void;
  onSuccess: (orderNumber: string) => void;
}) => {
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');
  const [cashReceived, setCashReceived] = useState('');
  const summary = useCartStore((s) => s.summary);
  const items = useCartStore((s) => s.items);
  const customer = useCartStore((s) => s.customer);
  const discounts = useCartStore((s) => s.discounts);
  const notes = useCartStore((s) => s.notes);
  const clearCart = useCartStore((s) => s.clearCart);
  const queryClient = useQueryClient();

  const received = parseFloat(cashReceived) || 0;
  const change = received - summary.total;

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch('/api/store/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Error al crear la orden');
      return res.json();
    },
    onSuccess: (data) => {
      const orderNumber = data?.order_number || data?.id?.toString() || '---';
      clearCart();
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      onSuccess(orderNumber);
    },
    onError: () => {
      toastError('Error al procesar el pago. Intenta de nuevo.');
    },
  });

  const handleConfirm = () => {
    if (paymentMethod === 'cash' && received < summary.total) {
      toastError('El monto recibido es insuficiente');
      return;
    }

    mutation.mutate({
      items: items.map((i) => ({
        product_id: i.product.id,
        variant_id: i.variant?.id,
        quantity: i.quantity,
        unit_price: i.unitPrice,
        total_price: i.totalPrice,
        tax_amount: i.taxAmount,
      })),
      customer_id: customer?.id,
      discounts: discounts.map((d) => ({
        type: d.type,
        value: d.value,
        amount: d.amount,
        description: d.description,
      })),
      notes,
      payment: {
        method: paymentMethod,
        amount: summary.total,
        cash_received: paymentMethod === 'cash' ? received : undefined,
        change: paymentMethod === 'cash' ? Math.max(0, change) : undefined,
      },
    });
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} snapPoint="partial">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="px-4 pt-2 pb-4"
      >
        <Text className="text-lg font-bold text-gray-900 mb-4">Cobrar</Text>

        <View className="bg-green-50 rounded-xl p-4 items-center mb-4">
          <Text className="text-sm text-gray-500 mb-1">Total a cobrar</Text>
          <Text className="text-3xl font-bold" style={{ color: colors.primary }}>
            {formatCurrency(summary.total)}
          </Text>
        </View>

        <View className="flex-row gap-3 mb-4">
          <Pressable
            onPress={() => setPaymentMethod('cash')}
            className={`flex-1 flex-row items-center justify-center py-3 rounded-xl border-2 ${
              paymentMethod === 'cash' ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white'
            }`}
          >
            <Icon name="dollar-sign" size={18} color={paymentMethod === 'cash' ? colors.primary : colors.text.secondary} />
            <Text className={`ml-2 font-semibold ${
              paymentMethod === 'cash' ? 'text-green-700' : 'text-gray-500'
            }`}>
              Efectivo
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setPaymentMethod('card')}
            className={`flex-1 flex-row items-center justify-center py-3 rounded-xl border-2 ${
              paymentMethod === 'card' ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white'
            }`}
          >
            <Icon name="credit-card" size={18} color={paymentMethod === 'card' ? colors.primary : colors.text.secondary} />
            <Text className={`ml-2 font-semibold ${
              paymentMethod === 'card' ? 'text-green-700' : 'text-gray-500'
            }`}>
              Tarjeta
            </Text>
          </Pressable>
        </View>

        {paymentMethod === 'cash' && (
          <View className="mb-4">
            <Input
              label="Efectivo recibido"
              placeholder="0.00"
              keyboardType="decimal-pad"
              value={cashReceived}
              onChangeText={setCashReceived}
            />
            {received > 0 && received >= summary.total && (
              <View className="mt-2 bg-blue-50 rounded-lg px-3 py-2 flex-row justify-between">
                <Text className="text-sm text-blue-600 font-medium">Cambio</Text>
                <Text className="text-sm text-blue-700 font-bold">{formatCurrency(change)}</Text>
              </View>
            )}
          </View>
        )}

        <Button
          title="Confirmar Pago"
          onPress={handleConfirm}
          fullWidth
          size="lg"
          loading={mutation.isPending}
          disabled={mutation.isPending}
        />
      </KeyboardAvoidingView>
    </BottomSheet>
  );
};

const SuccessModal = ({
  visible,
  orderNumber,
  onClose,
}: {
  visible: boolean;
  orderNumber: string;
  onClose: () => void;
}) => (
  <View className={`absolute inset-0 items-center justify-center bg-black/50 z-50 ${visible ? '' : 'hidden'}`}>
    <View className="bg-white rounded-2xl p-6 mx-8 items-center shadow-2xl">
      <View className="w-16 h-16 rounded-full items-center justify-center mb-4" style={{ backgroundColor: colors.primary + '20' }}>
        <Icon name="check" size={32} color={colors.primary} />
      </View>
      <Text className="text-lg font-bold text-gray-900 mb-1">¡Venta exitosa!</Text>
      <Text className="text-sm text-gray-500 mb-1">Orden</Text>
      <Text className="text-2xl font-bold mb-4" style={{ color: colors.primary }}>#{orderNumber}</Text>
      <View className="flex-row gap-3 w-full">
        <Pressable
          onPress={() => {}}
          className="flex-1 flex-row items-center justify-center py-2.5 rounded-xl border border-gray-200 active:bg-gray-50"
        >
          <Icon name="share" size={16} color={colors.text.secondary} />
          <Text className="ml-2 text-sm font-medium text-gray-600">Compartir</Text>
        </Pressable>
        <Pressable
          onPress={() => {}}
          className="flex-1 flex-row items-center justify-center py-2.5 rounded-xl border border-gray-200 active:bg-gray-50"
        >
          <Icon name="printer" size={16} color={colors.text.secondary} />
          <Text className="ml-2 text-sm font-medium text-gray-600">Imprimir</Text>
        </Pressable>
      </View>
      <Button title="Nueva venta" onPress={onClose} fullWidth className="mt-4" />
    </View>
  </View>
);

const PosScreen = () => {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [showVariants, setShowVariants] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [orderNumber, setOrderNumber] = useState('');

  const summary = useCartStore((s) => s.summary);
  const addItem = useCartStore((s) => s.addItem);

  const { data: products, isLoading } = useQuery({
    queryKey: ['pos-products', search],
    queryFn: () =>
      search
        ? ProductService.search(search)
        : ProductService.list({ pos_optimized: true, limit: 50, state: 'active' }),
  });

  const productList = useMemo(() => {
    if (!products) return [];
    return Array.isArray(products) ? products : (products as any).data || [];
  }, [products]);

  const handleProductPress = useCallback(
    (product: Product) => {
      if (product.product_variants && product.product_variants.length > 0) {
        setSelectedProduct(product);
        setShowVariants(true);
      } else {
        addItem(product, null, 1);
        toastSuccess(`${product.name} agregado`);
      }
    },
    [addItem],
  );

  const handleVariantSelect = useCallback(
    (variant: ProductVariant) => {
      if (selectedProduct) {
        addItem(selectedProduct, variant, 1);
        toastSuccess(`${selectedProduct.name} agregado`);
      }
      setShowVariants(false);
      setSelectedProduct(null);
    },
    [selectedProduct, addItem],
  );

  const handleChargeSuccess = useCallback((num: string) => {
    setOrderNumber(num);
    setShowPayment(false);
    setShowSuccess(true);
  }, []);

  const handleCloseSuccess = useCallback(() => {
    setShowSuccess(false);
    setOrderNumber('');
  }, []);

  return (
    <View className="flex-1 bg-gray-50" style={{ paddingTop: insets.top }}>
      <View className="px-4 pt-3 pb-2">
        <SearchBar
          placeholder="Buscar productos..."
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <Spinner />
        </View>
      ) : productList.length === 0 ? (
        <EmptyState
          title="Sin productos"
          description={search ? 'No se encontraron resultados' : 'No hay productos disponibles'}
          icon="package"
        />
      ) : (
        <FlatList
          data={productList}
          keyExtractor={(item) => item.id.toString()}
          numColumns={2}
          columnWrapperClassName="justify-between px-4"
          contentContainerClassName="pb-24"
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <ProductCard product={item} onPress={handleProductPress} />
          )}
        />
      )}

      {summary.itemCount > 0 && (
        <Pressable
          onPress={() => setShowCart(true)}
          className="absolute bottom-0 left-0 right-0 flex-row items-center justify-between px-5 py-3.5 shadow-lg"
          style={{
            backgroundColor: colors.primary,
            paddingBottom: insets.bottom + 12,
          }}
        >
          <View className="flex-row items-center">
            <View className="w-7 h-7 rounded-full bg-white/20 items-center justify-center mr-2">
              <Text className="text-xs font-bold text-white">{summary.totalItems}</Text>
            </View>
            <Text className="text-white text-sm">
              {summary.itemCount} {summary.itemCount === 1 ? 'producto' : 'productos'}
            </Text>
          </View>
          <View className="flex-row items-center">
            <Text className="text-white font-bold text-lg mr-2">
              {formatCurrency(summary.total)}
            </Text>
            <View className="flex-row items-center bg-white/20 rounded-lg px-3 py-1.5">
              <Text className="text-white text-sm font-semibold mr-1">Ver Carrito</Text>
              <Icon name="shopping-cart" size={14} color="#fff" />
            </View>
          </View>
        </Pressable>
      )}

      <VariantPicker
        visible={showVariants}
        product={selectedProduct}
        onSelect={handleVariantSelect}
        onClose={() => {
          setShowVariants(false);
          setSelectedProduct(null);
        }}
      />

      <CartPanel
        visible={showCart}
        onClose={() => setShowCart(false)}
        onCharge={() => {
          setShowCart(false);
          setShowPayment(true);
        }}
      />

      <PaymentSheet
        visible={showPayment}
        onClose={() => setShowPayment(false)}
        onSuccess={handleChargeSuccess}
      />

      <SuccessModal
        visible={showSuccess}
        orderNumber={orderNumber}
        onClose={handleCloseSuccess}
      />
    </View>
  );
};

export default PosScreen;
