<claude-mem-context>
# Memory Context

# [mjmcompany] recent context, 2026-08-11 6:06pm GMT-3

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (17,836t read) | 711,379t work | 97% savings

### Jul 16, 2026
S5085 mjmcompany — Sync Architecture Exploration Launched (Pre-Smartico Implementation) (Jul 16 at 5:25 PM)
### Jul 22, 2026
S5087 Pinbet/Smartico — New provider + pool implementation for daily and monthly deals (Jul 22 at 12:13 PM)
S5113 Pinbet + Smartico — New sync provider + dual-deal pool modules (diário/mensal) with strict data separation (Jul 22 at 12:14 PM)
8225 1:15p 🟣 AppModule — Pinbet Diário + Mensal Pool Modules Registered at Root Application Level
8226 1:17p 🟣 Pinbet DB Seed Script — Three-House Architecture Seeded with Idempotent Upserts
8228 " 🟣 Pinbet Smartico ProviderAccount Seed Script with AES-256-GCM Token Encryption
8229 " 🔵 TypeScript Build — Pinbet Code Clean, Pre-existing Errors in Support-Chat Only
8230 1:18p 🔵 Pinbet/Smartico Files — 9 Lint Errors Across 7 Files Pending Fix
8232 1:20p ⚖️ Pinbet + Smartico — Three-House DB Architecture for Dual-Deal Sync
8233 " 🔵 Smartico API Contract — Field Mapping for Pinbet Integration
8234 " 🟣 SmarticoExtractor — New Sync Provider for Pinbet
8235 " 🟣 Pinbet Diário + Mensal Link Pool Modules — Full NestJS Wiring
8236 " ⚖️ Pinbet Deal Terms — Diário and Mensal CPA/Conditions
8238 1:21p 🔴 Pinbet/Smartico ESLint Fixes — require-await and no-unused-vars Resolved
8239 " 🔵 link-request.service.ts — 66 Pre-existing Lint Errors Unrelated to Pinbet
8240 1:22p 🔵 SmarticoExtractor Field Mapping — All Assertions Pass Against Sample API Response
8241 " ✅ Pinbet + Smartico — Canonical Architecture Memory File Written
8242 1:23p 🔵 Pinbet + Smartico — Complete Changeset Inventory Before Commit
S5119 Pinbet Memory File Updated — Activation Steps Replaced with DONE Status (Jul 22 at 1:23 PM)
8244 1:30p ⚖️ Link CPA Rule — Inviter Discount Logic Added to Pinbet Pool
8246 1:31p 🔴 Pinbet Seed — HouseLinkRule Corrected to Use Inviter CPA Discount
8247 " 🔵 .env Structure — Pinbet Vars Not Yet Added, Pattern Confirmed
8248 " ✅ Pinbet Env Vars Added to .env
8249 " 🟣 Pinbet Houses + Deals + Rules Seeded to Production DB
8250 " 🟣 Smartico ProviderAccount + ProviderAccountHouse Seeded to Production DB
8251 1:32p 🔵 Smartico Live Test Fails — @prisma/client Not Found Outside Project Dir
8252 " 🔵 Smartico API Live Verified — Token OK, HTTP 200, Real Data Returned
8253 " ✅ Pinbet Memory File Updated — Activation Steps Replaced with DONE Status
S5120 Pinbet/Smartico — Add inviter CPA discount rule, add .env vars, run remaining seed scripts (Jul 22 at 1:32 PM)
S5125 Smartico Token Fix — Lint/TSC Clean + Seed Re-Run Confirmed (Jul 22 at 1:33 PM)
8254 1:37p 🔐 Smartico Token — Hardcoded Secret Must Move to .env
8256 " 🔴 Smartico Token Externalized to .env — Removed Hardcode Risk
8257 1:38p 🔴 SmarticoExtractor — ConfigService Injected, PINBET_SMARTICO_TOKEN Wired as Token Source
8258 " ✅ Smartico Token Fix — Lint/TSC Clean + Seed Re-Run Confirmed
S5133 seed-pinbet-provider.mjs Created — Secure ProviderAccount Seed Reads Token from .env (Jul 22 at 1:38 PM)
8259 1:47p 🔵 HouseLinkRule Validation Architecture — 3 Rule Types + Cycle Detection
8260 1:48p 🔵 HouseLinkRule Merge + Prisma Data Transform — Sparse Update Pattern
8262 1:49p 🔵 Seed File — seed-pinbet.mjs Not Found in Scripts Directory
8263 " 🔵 Pinbet/Smartico Codebase State — No Seed Scripts, Modules + Extractor Present
8265 1:50p 🔵 Git State — Clean Working Tree, Token Fix Uncommitted, Seed Never Tracked
8266 " 🟣 seed-pinbet.mjs Created — Full Pinbet House + Deal + LinkRule Seed
8267 1:51p 🟣 seed-pinbet.mjs Executed — DB Confirmed with Correct INVITER_DISCOUNT Rules
8269 " 🟣 seed-pinbet-provider.mjs Created — Secure ProviderAccount Seed Reads Token from .env
S5135 Pinbet INVITER_DISCOUNT rule 400 error — inviterCpaThreshold null rejected by validation + Smartico token hardcode fix (Jul 22 at 1:51 PM)
S5151 Project Memory Doc Updated — pinbet-smartico-sync.md Documents Hold-When-Inviter-No-CPA Feature (Jul 22 at 1:52 PM)
8271 1:56p ⚖️ Link Request — PENDING Hold When Inviter Lacks House CPA
8272 " 🔵 Link Request — Inviter CPA Hold: Architecture Investigation
8273 1:59p 🟣 CpaResolution — hold Field Added for Inviter-CPA Hold State
8275 " 🟣 HOLD_WHEN_INVITER_NO_CPA_HOUSES — Allowlist + Helper for Inviter-CPA Hold
8276 2:00p 🟣 CpaResolutionService — Hold Logic Implemented for Inviter-CPA Absence
8277 " 🟣 link-request.service.ts — resolveAndAssign Respects hold=true, Writes resolvedCpa=null
8279 " 🟣 resolveAndAssign — Pool Assignment Bypassed for Hold, Outcome = WAITING_SNAPSHOT
8280 2:02p 🟣 link-request.service.ts — Assignment Log Message Fixed for Hold Path
8282 2:03p 🟣 link-backfill.service.ts — Hold Propagation Complete: resolveOrPreserve + wrapResolution + snapshotOne + processCandidate
8283 " 🟣 Inviter-CPA Hold Feature — Full Implementation Complete (backend-vexxa)
8284 " ✅ seed-pinbet.mjs — processOldRequests: true Added to HouseLinkRule Upsert
8285 2:04p 🔵 DB Confirmed — processOldRequests=true Live on pinbet-diario and pinbet-mensal
8287 " ✅ Project Memory Doc Updated — pinbet-smartico-sync.md Documents Hold-When-Inviter-No-CPA Feature
S5153 Link Request Hold — pedido em espera quando convidante não tem CPA da casa (pinbet-diario/mensal) (Jul 22 at 2:05 PM)
8288 2:15p 🔵 Pinbet — 3 Houses Exist Beyond pinbet-diario and pinbet-mensal

Access 711k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>