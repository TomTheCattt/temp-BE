# Effort Estimate Report: Instagram Clone Backend

**Total:** 206 tasks across 12 phases | **Priority:** Quality First → Speed Second

---

## Executive Summary

| Approach | Timeline | Quality Guarantee | Token Cost | Best For |
|----------|----------|-------------------|------------|----------|
| **Solo (current)** | 26-39 weeks | Self-review only, no Red Team, no QA | ~500K-800K | Learning, MVP, architecture validation |
| **Sub-Agents (3-4)** | 12-16 weeks | Partial — parallel blind spots, manual coordination | ~2-3M | Phase 1-3 independent tracks |
| **Workflow (5-agent team)** | 8-10 weeks | **Full Constitution enforcement** — RFC, Red Team, QA blocking, ADR | ~8-15M | **Production-grade delivery** ⭐ |

---

## Phase-by-Phase Breakdown

| Phase | Tasks | P0/P1/P2 | Solo (wks) | Sub-Agents (wks) | Workflow (wks) | Quality Risk | Parallelizable |
|-------|-------|----------|------------|------------------|----------------|--------------|----------------|
| **1. Foundation** | 34 | 15/12/7 | 4-6 | 2-3 | 1.5-2 | **HIGH** — all downstream depends on this | Partial (DB + CI/CD + WS) |
| **2. Auth & Users** | 23 | 12/8/3 | 3-4 | 1.5-2 | 1-1.5 | **HIGH** — security critical | Limited (sequential flow) |
| **3. Posts & Feed** | 26 | 11/10/5 | 4-5 | 2-3 | 1.5-2 | MEDIUM — algorithm complexity | Good (feed/explore/comments) |
| **4. Stories & Reels** | 17 | 8/7/2 | 3-4 | 1.5-2 | 1-1.5 | MEDIUM — media pipeline deps | Good (stories + reels) |
| **5. Media Upload** | 12 | 5/6/1 | 2-3 | 1-1.5 | 1-1 | **HIGH** — processing pipeline | Limited (sequential) |
| **6. Direct Messages** | 26 | 13/10/3 | 4-5 | 2-3 | 1.5-2 | **HIGH** — real-time + E2EE prep | Good (conv/msg/WS) |
| **7. Call/Video Signaling** | 35 | 30/3/2 | 6-8 | 3-4 | 2-2.5 | **HIGH** — WebRTC + battery critical | Partial (signaling/media/VoIP) |
| **8. Notifications** | 7 | 4/3/0 | 1-1.5 | 0.5-1 | 0.5-0.5 | MEDIUM — APNs/FCM | Good |
| **9. Search** | 8 | 3/4/1 | 1.5-2 | 1-1.5 | 0.5-1 | MEDIUM — hybrid search tuning | Good |
| **10. Admin** | 6 | 0/4/2 | 1-1.5 | 0.5-1 | 0.5-0.5 | LOW | Good |
| **11. Observability** | 6 | 3/3/0 | 1-1.5 | 0.5-1 | 0.5-0.5 | MEDIUM — production critical | Good |
| **12. Hardening** | 6 | 4/2/0 | 1-2 | 1-1.5 | 0.5-1 | **HIGH** — load test, chaos, audit | Limited |
| **TOTAL** | **206** | **98/81/27** | **26-39** | **12-16** | **8-10** | | |

---

## Approach Details

### 1. Solo (Current State)

**How:** I execute tasks sequentially (WIP limit = 1 per Constitution).

**Quality Risks:**
- ❌ No peer review — self-review only
- ❌ No adversarial debate (Red Team rotation)
- ❌ Architectural drift over 39 weeks
- ❌ Burnout → shortcuts in Phases 7, 11, 12
- ❌ No dedicated QA — 3 reject cycles impossible
- ❌ iOS contract negotiation = me guessing

**My Quality Safeguards:**
- ✅ Strict self-critique gate (Rule 5) before each handoff
- ✅ Write contract tests as I go (Pact)
- ✅ Document every decision in ADR format
- ✅ Run lint/typecheck/test after every task

**Best for:** Learning, MVP, validating architecture before team hire

---

### 2. Sub-Agents (3-4 Parallel)

**How:** Spawn agents via `Agent` tool for independent tracks:
- Agent A: DB schema + migrations (Phase 1.2)
- Agent B: CI/CD pipeline (Phase 1.5)
- Agent C: WebSocket foundation (Phase 1.4)
- Main (me): Hono API + Auth (Phases 1.3, 2)

**Quality Risks:**
- ⚠️ Handoff friction — context loss between agents
- ⚠️ No shared Constitution enforcement
- ⚠️ Red Team rotation not automated
- ⚠️ Integration gaps at phase boundaries
- ⚠️ QA still missing — I'd need to play QA

**Quality Gains vs Solo:**
- ✅ Parallel execution = faster feedback loops
- ✅ Different agents = different blind spots caught
- ✅ Can assign "Red Team" role to one agent

**Best for:** Phases 1-3 where tracks are independent; you accept managing coordination

---

### 3. Workflow (Full Team) — **Recommended for Quality**

**How:** `Workflow` tool runs `dev-team-orchestrator` script (from previous session):
- **PM Agent:** Sprint planning, prioritization, release decisions
- **BA Agent:** SPEC.md, API contracts, acceptance criteria
- **Backend Dev Agent:** All 206 BE tasks
- **iOS Dev Agent:** SDK integration, CallKit, contract review
- **QA Agent:** Test strategy, blocking authority, 3 reject cycles

**Quality Guarantees (Constitution Enforced):**
- ✅ Mandatory RFC for every architectural decision
- ✅ Red Team rotation every sprint (finds 3 holes/sprint)
- ✅ QA blocking authority — max 3 reject cycles
- ✅ Cross-platform contract negotiation (BE ↔ iOS)
- ✅ ADR for every decision with dissent recorded
- ✅ Definition of Done: 80% coverage + integration + QA_PASS

**Trade-offs:**
- ⚠️ ~15-20x token cost vs solo
- ⚠️ Complex to debug if agents deadlock
- ⚠️ Requires your approval at each gate (Rule 2 B3)
- ⚠️ iOS repo must be ready (`sdk-ai-assistant-tv360-ios`)

**Best for:** Production-grade delivery with contractual quality guarantees

---

## Recommendation: Hybrid Approach

### Phase 1 (Next 2-3 weeks): Sub-Agents for Foundation
Phase 1 has clear parallel tracks. Spawn 3 agents now:

| Agent | Tasks | Track |
|-------|-------|-------|
| **Agent 1** | BE-008→BE-016 | DB Schema + RLS + Migrations |
| **Agent 2** | BE-030→BE-034 | CI/CD + Preview Deployments |
| **Agent 3** | BE-025→BE-029 | WebSocket Server Foundation |
| **Main (me + you)** | BE-001→BE-007, BE-017→BE-024 | Neon Infra + Hono API + Middleware |

**Estimated:** 2-3 weeks for Phase 1 (vs 4-6 solo)

### Phase 1 Gate Decision Point
After Phase 1 complete, evaluate:
- If quality **insufficient** → Escalate to full Workflow
- If velocity **good** → Continue sub-agents for Phases 2-3
- If iOS repo ready → Workflow becomes viable

> Phase 2-3 have more dependencies — sub-agent coordination gets harder. Workflow shines there.

---

## My Commitment (Solo or Sub-Agent Mode)

- Every task: Self-critique gate (Rule 5) — I will reject my own work if over-engineered
- Every phase: ADR written for architectural decisions
- Every API: Contract test (Pact) + OpenAPI spec generated
- No task marked DONE without: lint pass + typecheck + unit test + integration test
- You approve every plan before execution (Rule 2 B3)

---

## Phase 1 Immediate Task Detail (34 P0 Tasks)

| ID | Task | Track | Est (days) | Deps | Quality Gate |
|----|------|-------|------------|------|--------------|
| BE-001 | Create Neon project (Auth, Functions, Obj Storage, Realtime) | Infra | 0.5 | - | Project health check |
| BE-002 | Configure branches: main, staging, dev/<user> | Infra | 0.5 | BE-001 | Branch protection rules |
| BE-003 | Better Auth: email/password, OAuth (Google, Apple) | Infra | 1 | BE-001 | Auth flow test |
| BE-004 | Trusted domains for OAuth callbacks | Infra | 0.5 | BE-003 | Callback test |
| BE-005 | Object Storage buckets: uploads, media, thumbnails, recordings | Infra | 0.5 | BE-001 | Upload/download test |
| BE-006 | Enable Neon Realtime | Infra | 0.5 | BE-001 | Live query test |
| BE-007 | AI Gateway for embeddings | Infra | 0.5 | BE-001 | Embedding generation test |
| **→ Agent 1** | | | | | |
| BE-008 | Prisma schema from DESIGN_DOCUMENT.md §3 | DB | 2 | BE-001 | Schema review |
| BE-009 | RLS policies for all tables | DB | 2 | BE-008 | Policy test matrix |
| BE-010 | Materialized view feed_items + pg_cron | DB | 1 | BE-008 | Refresh latency test |
| BE-011 | search_index table (vector + BM25) | DB | 1 | BE-008 | Search query test |
| BE-012 | audit_logs partitioned table | DB | 0.5 | BE-008 | Partition pruning test |
| BE-013 | rate_limit_buckets table | DB | 0.5 | BE-008 | Rate limit test |
| BE-014 | Call tables (calls, participants, signaling_logs) | DB | 1 | BE-008 | Call flow test |
| BE-015 | Run migration on preview branch | DB | 0.5 | BE-008,BE-014 | Migration verification |
| BE-016 | Generate Drizzle schema from Prisma | DB | 0.5 | BE-008 | Type safety check |
| **→ Agent 2** | | | | | |
| BE-030 | GitHub Actions CI: lint, typecheck, test, contract | CI/CD | 1 | - | Pipeline green |
| BE-031 | Preview deployment (Neon branch per PR) | CI/CD | 1 | BE-002 | Preview URL works |
| BE-032 | Staging deployment workflow | CI/CD | 0.5 | BE-030 | Staging deploy |
| BE-033 | Production deployment + verification | CI/CD | 1 | BE-030 | Prod deploy checklist |
| BE-034 | Contract testing with Pact | CI/CD | 1 | BE-030 | Contract test passes |
| **→ Agent 3** | | | | | |
| BE-025 | WS server on Neon Functions (/ws/v1) | WS | 1 | BE-017 | Connection test |
| BE-026 | ConnectionManager (connections, subscriptions, presence) | WS | 1 | BE-025 | Multi-connection test |
| BE-027 | Channel authorization (canSubscribe) | WS | 1 | BE-026 | AuthZ test matrix |
| BE-028 | Message handlers: ping, subscribe, unsubscribe | WS | 0.5 | BE-026 | Protocol compliance |
| BE-029 | Auto-subscribe to user channels on connect | WS | 0.5 | BE-026 | Presence test |
| **→ Main Thread** | | | | | |
| BE-017 | Hono app + middleware (auth, rate-limit, validation, logging, security) | API | 2 | BE-016 | Middleware test |
| BE-018 | Better Auth middleware (session verification, user context) | API | 1 | BE-003 | Session test |
| BE-019 | Authorization policy engine (OPA-style) + RLS sync | API | 2 | BE-018 | Policy decision test |
| BE-020 | Tiered rate limiting (Redis/Upstash) + headers | API | 1 | BE-017 | Rate limit test |
| BE-021 | Request ID tracing + OpenTelemetry | API | 1 | BE-017 | Trace propagation |
| BE-022 | Zod validation middleware | API | 1 | BE-017 | Validation test |
| BE-023 | Idempotency key middleware | API | 0.5 | BE-017 | Idempotency test |
| BE-024 | Error handling (RFC 7807 Problem Details) | API | 0.5 | BE-017 | Error format test |

---

## Token Cost Summary

| Approach | Est. Tokens | Multiplier |
|----------|-------------|------------|
| Solo | 500K-800K | 1x (baseline) |
| Sub-Agents (Phase 1 only) | 800K-1.2M | +60% |
| Sub-Agents (full project) | 2M-3M | 3-4x |
| **Full Workflow** | **8M-15M** | **15-20x** |

---

## Next Step: Your Decision

**Option A — Start Sub-Agents for Phase 1 Now** (Recommended)
- I spawn 3 agents for DB/CI/CD/WS tracks
- You + I handle Infra + API tracks
- 2-3 weeks to Phase 1 complete

**Option B — Stay Solo**
- I execute Phase 1 sequentially
- 4-6 weeks to Phase 1 complete
- Lower cost, slower, quality risk

**Option C — Full Workflow**
- Requires: iOS repo ready, your approval for gates
- 8-10 weeks full project
- Highest quality, highest cost

**Which option?** Say "Option A" and I'll spawn the sub-agents with detailed work plans for your approval per Rule 2 B3.