delete from fiscal_operation_events where id in (401,402) and metadata->>'qa_only'='I5-list-isolation-20260923' returning id;
