# Superbet Legacy Links Cleanup Design

## Objective

Remove every user-facing and calculation-active artifact from the inactive
Superbet deal while preserving the active `Superbet Diário` deal, its assigned
links, pending requests, financial metrics, withdrawals, users, and referral
topology.

## Production baseline

The read-only inventory captured on 2026-08-25 found:

- inactive deal `7cbda5dd-52bc-4631-9879-6de88e6c0ab9` (`Superbet`);
- active deal `3a11aa0d-d9cf-467c-bc1a-1fd62f7a7429` (`Superbet Diário`);
- 207 campaigns assigned through fulfilled requests of the active deal;
- 27 pending requests of the active deal;
- 4,171 active affiliate links outside the active-deal campaign set;
- 3,105 users with at least one legacy Superbet link;
- 104 users with both legacy and active-deal links;
- 45 referral heads with both link generations and therefore an ambiguous CPA
  lookup;
- 2,973 Superbet link requests outside the active deal;
- 1,338 webhook deliveries attached to those requests;
- 185 affiliate-API request logs outside the active deal;
- 2,945 notifications explicitly referencing legacy Superbet link requests;
- zero `affiliate_data` rows for legacy Superbet campaigns.

These counts are a baseline only. The operational script must rebuild the
preview immediately before apply and reject any changed snapshot.

## Considered approaches

1. **Full legacy cleanup (selected).** Soft-delete legacy `affiliate_links`,
   hard-delete legacy link-request artifacts and the inactive deal, and retain a
   hashed recovery snapshot plus audit event. This satisfies the request and
   respects the application's prohibition on hard-deleting affiliate links.
2. **Affiliate links only.** Soft-delete only `affiliate_links`. This fixes CPA
   selection but leaves old URLs in request, notification, webhook, and API-log
   history, so it does not satisfy “apagar tudo do link antigo”.
3. **Runtime filtering only.** Change balance queries to ignore inactive deals
   without deleting data. This prevents the calculation bug but does not remove
   legacy link artifacts and leaves the same ambiguity in other readers.

## Protected set

The source of truth is the single active Superbet deal. Its protected campaign
set is parsed from every fulfilled request URL as `siteid-c`. The operation must
preserve exactly:

- the active deal row;
- all fulfilled and pending requests whose `dealId` is the active deal ID;
- every active `affiliate_link` whose campaign belongs to that protected set;
- every notification, webhook delivery, and affiliate-API log associated with
  the active deal;
- all `affiliate_data`, `affiliate_data_change_logs`, withdrawals, gateway
  events, fraud data, balance adjustments, commission logs, and sync logs;
- all users and every `referredById` edge;
- every link from betting houses other than `superbet`.

## Deletion set

Within one serializable transaction, the operation will:

1. set `deletedAt` on active Superbet `affiliate_links` whose `campaignId` is
   not in the protected campaign set;
2. delete notifications whose metadata references a legacy Superbet request;
3. delete webhook deliveries whose `linkRequestId` references a legacy
   Superbet request;
4. delete affiliate-API request logs for Superbet whose `dealId` is null or not
   the active deal;
5. delete Superbet link requests whose `dealId` is null or not the active deal;
6. delete every inactive Superbet deal.

Audit logs and commission logs remain because they are administrative evidence,
not usable affiliate links. Affiliate links use soft-delete because the Prisma
audit layer explicitly prohibits hard deletion.

## Safety and recovery

The script defaults to preview mode and produces an immutable JSON backup under
`output/superbet-legacy-links-cleanup/<timestamp>/`. The backup contains every
row to be changed or removed, the protected identifiers, integrity fingerprints,
counts, and a SHA-256 digest. Apply requires the exact digest printed by the
fresh preview.

Apply obtains a PostgreSQL advisory lock, locks target rows, recomputes the
snapshot inside a serializable transaction, and rolls back if any count or
fingerprint differs. It writes one `AuditLog` containing the operation ID,
backup digest, and affected counts.

Soft-deleted links can be restored directly. Hard-deleted request artifacts can
only be restored from the generated backup or an external PostgreSQL backup.

## Verification

After commit, a fresh connection must prove:

- zero active legacy Superbet affiliate links;
- zero Superbet requests outside the active deal;
- zero legacy-request notifications, webhook deliveries, and API request logs;
- zero inactive Superbet deals;
- unchanged protected campaign set, active links, active requests, financial
  rows, withdrawals, users, and referral edges;
- `network@gmail.com` uses CPA 120 from campaign `5565-MJM14` and earns R$60
  from the six reconciled network CPAs for 2026-08-23 through 2026-08-25;
- no webhook or notification is emitted by the cleanup.

## Error handling

Any missing active deal, multiple active Superbet deals, invalid protected URL,
duplicate protected campaign, changed snapshot, partial row count, transaction
error, or failed post-write verification aborts the operation. The script must
never broaden its predicates to another betting house.
