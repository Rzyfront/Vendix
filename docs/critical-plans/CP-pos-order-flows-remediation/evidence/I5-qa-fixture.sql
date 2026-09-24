-- Local QA only; remove exact inserted IDs after list/isolation checks.
insert into fiscal_operation_events(organization_id,store_id,accounting_entity_id,event_type,resource_type,resource_id,new_status,metadata,created_at)
values (6,10,25,'pos_sale_without_fiscal_document','order',1119,'failed','{"qa_only":"I5-list-isolation-20260923"}'::jsonb,now()),
       (2,3,2,'pos_sale_without_fiscal_document','order',1110,'failed','{"qa_only":"I5-list-isolation-20260923"}'::jsonb,now())
returning id,organization_id,store_id,resource_id;
