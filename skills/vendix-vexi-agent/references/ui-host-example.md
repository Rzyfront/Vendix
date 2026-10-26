# Registering a VexiUiHost (example)

A module enters Vexi's reach by **registering itself**:

```ts
private readonly vexiHostAdapter: VexiUiHost = {
  vexiModuleKey: 'products',
  readScreen: () => ({ module_key: 'products', title: 'Productos', visible_count: … }),
  listActions: () => [{ id: 'nuevo_producto', label: '…' }],
  runAction: async (id) => { … },
  setFilter: async (values) => { this.onSearch(values['search'] as string); … },
  refresh: () => { this.loadProducts(); return { status: 'ok', message: '…' }; },
};

constructor() {
  this.vexiHosts.register(this.vexiHostAdapter);
  this.destroyRef.onDestroy(() => this.vexiHosts.unregister(this.vexiHostAdapter));
}
```

