# Manual Production Indexes

These indexes use GIN (trigram) and must be created with `CREATE INDEX CONCURRENTLY`
to avoid locking writes on large tables. They cannot run inside a Prisma migration
transaction — execute them manually via `psql` before deploying the release that
activates identifier-based search.

## Prerequisites

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

## Indexes

Run each statement separately. `CONCURRENTLY` cannot run inside a transaction block.

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "users_name_trgm_idx"
  ON "users" USING gin ("name" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "users_email_trgm_idx"
  ON "users" USING gin ("email" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_logs_action_trgm_idx"
  ON "audit_logs" USING gin ("action" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_logs_resource_trgm_idx"
  ON "audit_logs" USING gin ("resource" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_logs_userEmail_trgm_idx"
  ON "audit_logs" USING gin ("userEmail" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_logs_userName_trgm_idx"
  ON "audit_logs" USING gin ("userName" gin_trgm_ops);
```

## Validation

After each `CREATE INDEX CONCURRENTLY`, confirm the index is valid:

```sql
SELECT indexname, indisvalid
FROM pg_indexes
JOIN pg_class ON pg_class.relname = indexname
JOIN pg_index ON pg_index.indexrelid = pg_class.oid
WHERE schemaname = 'public'
  AND indexname LIKE '%trgm%';
```

If any row shows `indisvalid = false`, drop and recreate:

```sql
DROP INDEX CONCURRENTLY "index_name_here";
-- then rerun the CREATE INDEX CONCURRENTLY statement above
```

## Deploy order

1. Run `prisma migrate deploy` (applies B-tree indexes from `20260429120000_admin_query_indexes`).
2. Run the CONCURRENTLY statements above via psql (one at a time, outside a transaction).
3. Validate all trigram indexes show `indisvalid = true`.
4. Deploy application code.

The application falls back to `OR contains insensitive` (seq scan) for free-text search
when trigram indexes are absent — exact identifier search (email, UUID, CPF) is fast
immediately after step 1 regardless.
