-- B-tree indexes for admin list endpoints.
-- GIN trigram indexes (users, audit_logs) are documented in MANUAL_INDEXES.md
-- and must be run manually with CREATE INDEX CONCURRENTLY outside prisma migrate.

-- Withdrawals: admin list paginated by createdAt DESC with optional status filter
CREATE INDEX "withdrawal_requests_status_createdAt_idx"
  ON "withdrawal_requests" ("status", "createdAt" DESC);

-- Withdrawals: admin list without status filter
CREATE INDEX "withdrawal_requests_createdAt_idx"
  ON "withdrawal_requests" ("createdAt" DESC);

-- FK approvedById was unindexed — used in JOIN when resolving approvedBy user
CREATE INDEX "withdrawal_requests_approvedById_idx"
  ON "withdrawal_requests" ("approvedById");

-- AuditLog: admin list filters by method and orders by createdAt DESC
CREATE INDEX "audit_logs_method_createdAt_idx"
  ON "audit_logs" ("method", "createdAt" DESC);
