# Guía de Tests Bruno - Vendix

## 🚀 Cómo Crear Tests Rápidamente con Templates

### Paso 1: Copiar el Template Adecuado

Ve a `TEMPLATES/` y copia el template que necesites:

- **Crear entidad** → `Create Template.bru`
- **Listar entidades** → `Get All Template.bru`
- **Obtener por ID** → `Get By ID Template.bru`
- **Actualizar entidad** → `Update Template.bru`
- **Eliminar entidad** → `Delete Template.bru`
- **Probar errores** → `Error Cases Template.bru`

### Paso 2: Personalizar el Template

Reemplaza los placeholders:

- `[Entity]` → Nombre de tu entidad (User, Product, Order)
- `[endpoint]` → Endpoint del API (/admin/users, /products)
- `field1`, `field2` → Campos reales de tu entidad
- `value1`, `value2` → Valores de prueba

### Paso 3: Ajustar Variables

Cambia las variables post-response:

- `created_[entity]_id` → `created_user_id`, `created_product_id`
- `[entity]_id` → `user_id`, `product_id`

### Ejemplo Práctico: Crear Test de Productos

1. **Copia** `Create Template.bru` → `Create Product.bru`
2. **Edita** el contenido:

```yaml
meta {
  name: Create Product
  type: http
  seq: 1
}

post {
  url: http://{{url}}/products
  body: json
  auth: inherit
}

body:json {
  {
    "name": "Test Product",
    "price": 99.99,
    "description": "Test description"
  }
}

vars:post-response {
  created_product_id: res.body.data.id
}

tests {
  test("Create product successful", function() {
    expect(res.status).to.equal(201);
    expect(res.body).to.have.property('success', true);
    expect(res.body).to.have.property('data');
    expect(res.body.data).to.have.property('id');
  });

  test("Response data is correct", function() {
    expect(res.body.data.name).to.equal('Test Product');
    expect(res.body.data.price).to.equal(99.99);
  });

  test("No sensitive data exposed", function() {
    expect(res.body.data).to.not.have.property('password');
  });
}
```

## 📋 Estructura de Respuesta Estándar (ResponseService)

Todas las respuestas de la API siguen este formato:

```javascript
// Éxito
{ success: true, data: {...}, message: "..." }

// Paginado
{ success: true, data: [...], meta: { total, page, limit, totalPages, hasNextPage, hasPreviousPage } }

// Error
{ success: false, error: "...", statusCode: 400 }
```

## 📁 Templates Disponibles

Templates en la carpeta `TEMPLATES/` listos para usar:

- `Create Template.bru` - Para operaciones POST (crear)
- `Get All Template.bru` - Para operaciones GET con paginación
- `Get By ID Template.bru` - Para operaciones GET por ID
- `Update Template.bru` - Para operaciones PATCH (actualizar)
- `Delete Template.bru` - Para operaciones DELETE
- `Error Cases Template.bru` - Para validar casos de error

## Estructura Estándar de Tests

### Tests de Éxito (Create/Update/Get)

```javascript
tests {
  test("Operation successful", function() {
    expect(res.status).to.equal(200); // o 201 para creates
    expect(res.body).to.have.property('success', true);
    expect(res.body).to.have.property('data');
    expect(res.body.data).to.have.property('id');
  });

  test("Response data is correct", function() {
    expect(res.body.data.field1).to.equal('expected_value');
    expect(res.body.data.field2).to.equal('expected_value');
  });

  test("No sensitive data exposed", function() {
    expect(res.body.data).to.not.have.property('password');
  });
}
```

### Tests de Listado (Get All)

```javascript
tests {
  test("Get all successful", function() {
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('success', true);
    expect(res.body).to.have.property('data');
    expect(res.body).to.have.property('meta');
  });

  test("Pagination meta is valid", function() {
    expect(res.body.meta).to.have.property('total');
    expect(res.body.meta).to.have.property('page', 1);
    expect(res.body.meta).to.have.property('limit', 10);
    expect(res.body.meta).to.have.property('totalPages');
    expect(res.body.meta).to.have.property('hasNextPage');
    expect(res.body.meta).to.have.property('hasPreviousPage');
  });

  test("Data is valid array", function() {
    expect(res.body.data).to.be.an('array');
    if (res.body.data.length > 0) {
      expect(res.body.data[0]).to.have.property('id');
      expect(res.body.data[0]).to.not.have.property('password');
    }
  });
}
```

### Tests de Error

```javascript
tests {
  test("Error response structure", function() {
    expect(res.status).to.equal(400); // o 401, 403, 404, 422
    expect(res.body).to.have.property('success', false);
    expect(res.body).to.have.property('error');
    expect(res.body).to.have.property('statusCode');
  });

  test("Error message is descriptive", function() {
    expect(res.body.error).to.be.a('string');
    expect(res.body.error.length).to.be.greaterThan(0);
  });

  test("Status code matches response", function() {
    expect(res.body.statusCode).to.equal(res.status);
  });
}
```

## Variables Post-Response Estándar

```javascript
// Para entidades creadas
vars:post-response {
  created_[entity]_id: res.body.data.id
}

// Para entidades obtenidas
vars:post-response {
  [entity]_id: res.body.data.id
}

// Para tokens (solo en login)
vars:post-response {
  token: res.body.access_token
}
```

## Autenticación

```yaml
# Usar herencia de token en todos los tests (excepto login)
auth: inherit
```

## Convenciones de Nomenclatura

### Variables

- `created_user_id` - ID de usuario creado
- `organization_id` - ID de organización actual
- `store_id` - ID de tienda actual
- `product_id` - ID de producto
- `token` - Token de autenticación

### Nombres de Tests

- "Create [entity] successful"
- "Get all [entities] successful"
- "Get [entity] by ID successful"
- "Update [entity] successful"
- "Delete [entity] successful"
- "[Error case] [entity]"

## Reglas de Oro

- ✅ **SIEMPRE** validar `res.body.success` primero
- ✅ **SIEMPRE** acceder datos via `res.body.data.field`
- ✅ **SIEMPRE** usar `auth: inherit` (excepto login)
- ✅ **SIEMPRE** validar que no se expongan passwords
- ✅ **SIEMPRE** guardar IDs creados en variables post-response
- ❌ **NUNCA** acceder `res.body.field` directamente
- ❌ **NUNCA** dejar tests sin validación de estructura
- ❌ **NUNCA** hardcodear IDs en URLs (usar variables)

## 🔄 Flujo de Testing Típico

1. **Login** → Guardar token
2. **Create** → Guardar ID creado
3. **Get All** → Validar paginación y datos
4. **Get By ID** → Usar ID guardado
5. **Update** → Modificar datos
6. **Delete** → Eliminar usando ID

## 💡 Tips Adicionales

### Variables Globales Útiles

- `{{url}}` → URL base del API (definida en collection.bru)
- `{{token}}` → Token de autenticación (se guarda automáticamente)
- `{{organization_id}}` → ID de organización actual
- `{{store_id}}` → ID de tienda actual

### Errores Comunes a Evitar

- ❌ Olvidar `auth: inherit` en endpoints protegidos
- ❌ No validar `res.body.success` antes de otros tests
- ❌ Hardcodear IDs en lugar de usar variables
- ❌ Acceder `res.body.field` directamente (usar `res.body.data.field`)

### Buenas Prácticas

- ✅ Usar nombres descriptivos en los tests
- ✅ Validar estructura básica primero (status, success)
- ✅ Guardar IDs creados para usar en tests siguientes
- ✅ Validar que no se expongan datos sensibles
- ✅ Usar los templates como punto de partida
