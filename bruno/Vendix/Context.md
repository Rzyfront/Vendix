# Guía de Tests Bruno - Vendix

## Estructura de Respuesta Estándar (ResponseService)

Todas las respuestas de la API siguen este formato:

```javascript
// Éxito
{ success: true, data: {...}, message: "..." }

// Paginado
{ success: true, data: [...], meta: { total, page, limit, totalPages, hasNextPage, hasPreviousPage } }

// Error
{ success: false, error: "...", statusCode: 400 }
```

## Templates Estándar

Se han creado templates en la carpeta `TEMPLATES/` para cada tipo de operación:

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

## Flujo de Testing Típico

1. **Login** → Guardar token
2. **Create** → Guardar ID creado
3. **Get All** → Validar paginación y datos
4. **Get By ID** → Usar ID guardado
5. **Update** → Modificar datos
6. **Delete** → Eliminar usando ID
