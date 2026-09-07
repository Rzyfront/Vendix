# Database Contract Registry

| Id | Model / table | Columns | R/W | Tenant scoping | Migration | Consumers | Invariant | Verification | Status |
|----|---------------|---------|-----|----------------|-----------|-----------|-----------|--------------|--------|
| DB-01 | quotations | +destination,profile_id?,contract_id? | RW | store scoped client | own migration, default sale | quotations svc | viejas leen sale | select count por destino en sample | [x] |
| DB-02 | quotation_profiles | store,org,name,state,default,version | RW | store_id column + scope | new tables | profiles svc | nombre unico por store | insert duplicado falla | [x] |
| DB-03 | quotation_profile_versions | profile,version,config JSON | W/R | relacional via profile.store | new table | profiles svc | historia append-only | update no toca viejas | [x] |
| DB-04 | contracts | store,quotation unique,number,customer,status,snapshot | RW | store_id column + scope | new table + enum contracted | contracts svc | 1 contrato por quotation | doble insert viola unique | [x] |
| DB-05 | invoices | +contract_id? FK | RW | fiscal-entity scope | own migration nullable | invoicing svc | 1 factura activa por contrato | unique parcial + conteo | [x] |
