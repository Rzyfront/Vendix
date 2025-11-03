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

## Template Básico de Test

```javascript
tests {
  test("Request successful", function() {
    expect(res.status).to.equal(200); // o 201
    expect(res.body).to.have.property('success', true);
  });
  
  test("Response has data", function() {
    expect(res.body.data).to.have.property('id');
    expect(res.body.data.name).to.equal('Expected Name');
  });
}
```

## Autenticación

```yaml
# Usar herencia de token en todos los tests
auth: inherit

# Solo Login guarda el token
vars:post-response {
  token: res.body.access_token
}
```

## Validación de Arrays Paginados

```javascript
tests {
  test("Pagination meta", function() {
    expect(res.body.meta).to.have.property('total');
    expect(res.body.meta).to.have.property('hasNextPage');
    expect(res.body.meta).to.have.property('hasPreviousPage');
  });
  
  test("Data is array", function() {
    expect(res.body.data).to.be.an('array');
    if (res.body.data.length > 0) {
      expect(res.body.data[0]).to.have.property('id');
    }
  });
}
```

## Variables Post-Response

```javascript
// Guardar ID para usar en otros tests
vars:post-response {
  created_id: res.body.data.id
}
```

## Reglas

- ✅ Acceder datos: `res.body.data.field`
- ✅ Validar success: `res.body.success`
- ✅ Usar: `auth: inherit`
- ❌ NO acceder: `res.body.field` directamente (excepto success, data, meta)
