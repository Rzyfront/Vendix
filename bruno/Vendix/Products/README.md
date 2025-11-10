# Products API Testing Collection

This collection contains comprehensive tests for the Products module in the Vendix backend.

## 🗂️ Collection Structure

### **Core Product Operations**
- `Create Product` - Create a new product with categories, brand, and images
- `Get All Products` - List products with pagination, search, and filters
- `Get Product by ID` - Retrieve a specific product
- `Get Products by Store` - Get all products for a specific store
- `Get Product by Slug` - Find product by URL-friendly slug
- `Update Product` - Modify existing product details
- `Deactivate Product` - Soft delete a product
- `Delete Product` - Hard delete (admin only)

### **Product Variants** `/Variants/`
- `Create Product Variant` - Add product variations (color, size, etc.)
- `Update Product Variant` - Modify variant details
- `Delete Product Variant` - Remove a product variant

### **Product Images** `/Images/`
- `Add Product Image` - Add additional product images
- `Set Main Product Image` - Set the primary product image
- `Remove Product Image` - Delete product images

### **Relations & Categories** `/Relations/`
- `Create Product with Categories and Brand` - Complex product creation
- `Update Product Categories` - Modify product category assignments

### **Error Cases** `/Error Cases/`
- `Create Product with Duplicate SKU` - Test uniqueness validation
- `Create Product with Invalid Store` - Test store validation
- `Get Non-existent Product` - Test 404 handling
- `Unauthorized Access` - Test authentication requirements

## 🔧 Environment Variables

Make sure to configure these variables in your Bruno environment:

- `url` - Base API URL including /api prefix (e.g., `http://localhost:3000/api`)
- `productId` - ID of an existing product for tests
- `variantId` - ID of an existing product variant
- `imageId` - ID of an existing product image
- `storeId` - ID of an existing store
- `productSlug` - Slug of an existing product

## 📝 Test Data Examples

### Basic Product Structure
```json
{
  "store_id": 1,
  "categoria_id": 1,
  "brand_id": 1,
  "name": "Product Name",
  "slug": "product-slug",
  "description": "Product description",
  "base_price": 99.99,
  "sku": "UNIQUE_SKU_001",
  "stock_quantity": 50,
  "state": "active",
  "tax_category_ids": [1],
  "product_category_ids": [1, 2],
  "images": [
    {
      "image_url": "https://example.com/image.jpg",
      "is_main": true
    }
  ]
}
```

### Product Variant Structure
```json
{
  "product_id": 1,
  "sku": "VARIANT_SKU_001",
  "name": "Product Variant Name",
  "base_price": 109.99,
  "stock_quantity": 25,
  "weight": 0.5,
  "attributes": {
    "color": "Blue",
    "size": "Large",
    "material": "Cotton"
  }
}
```

## 🔐 Permissions Required

- `products:create` - Create products and variants
- `products:read` - View products
- `products:update` - Update products and manage images
- `products:delete` - Deactivate products and delete variants
- `products:admin_delete` - Hard delete products (admin only)

## 📋 Test Scenarios

### ✅ Success Cases
1. **Complete Product Creation** - Product with all fields, categories, brand, and images
2. **Product Search** - Search by name, filter by store, pagination
3. **Product Management** - Update, deactivate, delete operations
4. **Variant Management** - Create, update, delete product variants
5. **Image Management** - Add, set main, remove product images
6. **Category Relations** - Assign multiple categories and tax categories

### ❌ Error Cases
1. **Validation Errors** - Missing required fields, invalid data types
2. **Uniqueness Constraints** - Duplicate SKUs, duplicate slugs per store
3. **Permission Errors** - Access without proper permissions
4. **Not Found Errors** - Accessing non-existent products
5. **Relationship Errors** - Invalid store, category, or brand IDs

## 🚀 Quick Start

1. Set up your environment variables
2. Run the `Health Check` test to verify connection
3. Execute tests in sequence (1-8) for basic CRUD operations
4. Test variants (9-11) for product variation features
5. Test images (12-14) for image management
6. Test relations (15-16) for category and brand assignments
7. Test error cases (17-20) for validation and error handling

## 📊 Expected Responses

All endpoints follow the standard Vendix ResponseService format:

### Success Responses
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {...}
}
```

### Created/Updated Responses
```json
{
  "success": true,
  "message": "Resource created successfully",
  "data": {...}
}
```

### Paginated Responses
```json
{
  "success": true,
  "message": "Data retrieved successfully",
  "data": [...],
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 10,
    "totalPages": 10,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

### Error Responses
```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error message",
  "statusCode": 400,
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

### No Content Responses (Delete/Deactivate)
```json
{
  "success": true,
  "message": "Resource deleted successfully",
  "data": null
}
```

## 🔄 Workflow Examples

### Complete Product Lifecycle
1. `Create Product` → `Get Product by ID` → `Update Product` → `Create Product Variant` → `Add Product Image` → `Deactivate Product`

### Product Search and Discovery
1. `Get All Products` (with search/filters) → `Get Product by Slug` → `Get Products by Store`

### Bulk Operations
1. Create multiple products with different categories
2. Test pagination with `Get All Products`
3. Update categories in bulk using `Update Product Categories`

## 🚨 URL Configuration Note

**Important**: The base URL in your Bruno environment should include the `/api` prefix:

- ❌ Incorrect: `http://localhost:3000`
- ✅ Correct: `http://localhost:3000/api`

All test endpoints use relative paths (e.g., `/products`, `/products/{{productId}}/variants`) that will be appended to your base URL.