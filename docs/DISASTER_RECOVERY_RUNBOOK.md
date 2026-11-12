# Disaster Recovery Runbook
## Instagram Clone Backend - Phase 12 Production Hardening (BE-188)

**Version**: 1.0  
**Last Updated**: 2026-11-12  
**Classification**: INTERNAL - Operations Team  
**Owner**: Platform Engineering / SRE  

---

## Table of Contents

1. [Overview](#overview)
2. [Recovery Objectives](#recovery-objectives)
3. [Architecture Summary](#architecture-summary)
4. [Incident Response Process](#incident-response-process)
5. [Disaster Scenarios & Recovery Procedures](#disaster-scenarios--recovery-procedures)
6. [Neon Instant Restore](#neon-instant-restore)
7. [Communication Plan](#communication-plan)
8. [Post-Incident Process](#post-incident-process)
9. [Testing & Validation](#testing--validation)
10. [Appendices](#appendices)

---

## Overview

This runbook defines the disaster recovery procedures for the Instagram Clone Backend. It covers recovery from various failure scenarios using Neon's branching and instant restore capabilities, along with application-level recovery procedures.

### Scope
- **In Scope**: Neon PostgreSQL database, Neon Functions, Neon Auth, Neon Object Storage, Application APIs, WebSocket servers
- **Out of Scope**: Client applications (iOS app), CDN, DNS, Third-party services (Apple/Google OAuth)

### Assumptions
- Neon project is in `us-east-1` (primary) with read replicas
- Application deployed via Neon Functions (serverless)
- CI/CD pipeline can deploy to any Neon branch
- Monitoring and alerting via Grafana/Prometheus/Loki

---

## Recovery Objectives

| Metric | Target | Measurement |
|--------|--------|-------------|
| **RPO (Recovery Point Objective)** | < 1 minute | Neon PITR + WAL streaming |
| **RTO (Recovery Time Objective)** | < 15 minutes | Neon instant restore + app deploy |
| **Maximum Data Loss** | < 1 second | Synchronous replication to replica |
| **Availability Target** | 99.99% | Monthly uptime |

### Service Level Objectives (SLOs)

| Service | Availability | Latency (p99) | Error Rate |
|---------|--------------|---------------|------------|
| API | 99.99% | < 500ms | < 0.1% |
| WebSocket | 99.95% | < 200ms | < 0.5% |
| Media Upload | 99.9% | < 5s | < 1% |
| Auth | 99.99% | < 300ms | < 0.1% |

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                        PRODUCTION                                │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Neon DB    │◄───│  Read Replica │    │  Neon Auth   │      │
│  │  (Primary)   │    │  (Async)     │    │  (Managed)   │      │
│  └──────┬───────┘    └──────────────┘    └──────────────┘      │
│         │                                                     │
│  ┌──────▼───────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ Neon Functions│    │Neon Realtime │    │Neon Storage  │      │
│  │  (API + WS)  │    │  (Live Q)    │    │  (S3 Comp.)  │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components
- **Database**: Neon PostgreSQL with autoscaling (1-10 CU), PITR 7 days
- **Compute**: Neon Functions (Node.js, serverless, long-running)
- **Auth**: Neon Auth (Managed Better Auth)
- **Storage**: Neon Object Storage (S3-compatible, branches with DB)
- **Realtime**: Neon Realtime for live queries
- **Branching**: Main branch + preview branches per PR

---

## Incident Response Process

### 1. Detection
- **Automated**: Prometheus alerts → PagerDuty → On-call
- **Manual**: Customer reports, status page, social media

### 2. Triage (First 5 minutes)
```
┌────────────────────────────────────────────────────────────┐
│  INCIDENT TRIAGE CHECKLIST                                 │
├────────────────────────────────────────────────────────────┤
│  ☐ Acknowledge alert in PagerDuty                          │
│  ☐ Check Grafana dashboards: API Health, DB Health, WS     │
│  ☐ Determine severity (SEV-1/2/3)                          │
│  ☐ Check Neon Console for branch status                    │
│  ☐ Check Cloudflare WAF/DDoS status                        │
│  ☐ Notify team in #incidents Slack channel                 │
│  ☐ Start incident timeline document                        │
└────────────────────────────────────────────────────────────┘
```

### 3. Severity Classification

| Severity | Criteria | Response Time | Escalation |
|----------|----------|---------------|------------|
| **SEV-1** | Complete outage, data loss risk | Immediate | CTO, VP Eng |
| **SEV-2** | Partial outage, major feature down | 15 min | Engineering Lead |
| **SEV-3** | Degraded performance, minor issues | 1 hour | On-call engineer |

### 4. Communication
- **Internal**: #incidents Slack, PagerDuty, Zoom war room (SEV-1)
- **External**: Status page (status.instagram-clone.com), Twitter @InstaCloneStatus
- **Stakeholders**: Product, Support, Management (SEV-1/2)

---

## Disaster Scenarios & Recovery Procedures

### Scenario 1: Primary Database Corruption / Data Loss
**Severity**: SEV-1  
**Detection**: Alerts - HighErrorRate, DBConnectionFailed, DataIntegrityCheckFailed  
**RTO Target**: 10 minutes  

#### Recovery Steps:

```bash
# 1. CONFIRM ISSUE (2 min)
# Check Neon Console > Branches > main > Health
# Verify: "Database is unhealthy" or "Connection failed"

# 2. INITIATE INSTANT RESTORE (3 min)
# Option A: Neon CLI (preferred)
neon branches restore main --restore-timestamp="2026-11-12T10:30:00Z" --project-id=$NEON_PROJECT_ID

# Option B: Neon Console
# Go to Branches > main > Restore > Point in Time > Select timestamp > Restore

# Option C: Create new branch from restore point
neon branches create restore-main --parent=main --restore-timestamp="2026-11-12T10:30:00Z"

# 3. VERIFY RESTORE (2 min)
# Check new branch health in Neon Console
# Run smoke tests against restored branch
k6 run tests/load/smoke-test.js -e API_BASE_URL=https://restore-main-api.instagram-clone.com

# 4. SWITCH TRAFFIC (2 min)
# Update DNS / Load Balancer to point to restored branch
# Or: Neon Functions auto-detect branch via NEON_BRANCH env var

# 5. VALIDATE (1 min)
# Run contract tests
npm run test:contract -- --env STAGING_API_URL=https://restored-api.instagram-clone.com
```

#### Rollback if Restore Fails:
```bash
# Create branch from last known good backup
neon branches create recovery-main --parent=main --restore-timestamp="2026-11-11T23:00:00Z"
# Deploy to recovery branch
```

---

### Scenario 2: Database Performance Degradation (Pool Exhaustion)
**Severity**: SEV-2  
**Detection**: HighLatency alert, DBConnectionPoolUsage > 90%, QueryTimeout errors  
**RTO Target**: 5 minutes  

#### Recovery Steps:

```bash
# 1. IDENTIFY ROOT CAUSE (2 min)
# Check: pg_stat_activity for long-running queries
# Check: pg_locks for blocking
# Check: Application logs for query patterns

# 2. IMMEDIATE MITIGATION (1 min)
# Scale up compute
neon computes update main --min-cu=4 --max-cu=10 --project-id=$NEON_PROJECT_ID

# 3. KILL BLOCKING QUERIES (1 min)
# In Neon Console > Query Editor:
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE state = 'active' AND query_start < now() - interval '5 minutes';

# 4. APPLY FIX (1 min)
# If specific query: add index, rewrite query
# If connection leak: restart Neon Functions (auto on deploy)

# 5. MONITOR (ongoing)
# Watch pool usage return to < 50%
```

---

### Scenario 3: Neon Functions / API Outage
**Severity**: SEV-1 (total) / SEV-2 (partial)  
**Detection**: HighErrorRate, FunctionTimeout, ColdStartSpike  
**RTO Target**: 5 minutes  

#### Recovery Steps:

```bash
# 1. CHECK FUNCTION STATUS (1 min)
# Neon Console > Functions > Check logs, invocations, errors

# 2. ROLLBACK DEPLOYMENT (2 min)
# If recent deploy caused issue:
# GitHub Actions > Re-run previous successful workflow
# Or: neon deploy --branch=main --version=previous

# 3. SCALE COMPUTE (1 min)
# Neon Console > Functions > Increase min instances

# 4. CHECK DEPENDENCIES (1 min)
# Verify: DB connectivity, Auth service, S3 access
```

---

### Scenario 4: WebSocket Server Failure
**Severity**: SEV-2 (messaging down)  
**Detection**: WSDrop alert, ConnectionCount drop, MessageQueueBackup  
**RTO Target**: 5 minutes  

#### Recovery Steps:

```bash
# 1. CHECK FUNCTION LOGS (1 min)
# Neon Console > Functions > websocket > Logs
# Look for: OOM kills, unhandled exceptions, connection limits

# 2. RESTART FUNCTION (1 min)
# Neon Functions auto-restart on crash
# Force: neon functions restart websocket --branch=main

# 3. CHECK CONNECTION MANAGER (1 min)
# Verify: Redis/Upstash for connection state
# Flush stale connections if needed

# 4. VERIFY CLIENT RECONNECT (2 min)
# Monitor: ConnectionCount recovery, MessageDeliveryRate
```

---

### Scenario 5: Neon Auth / Better Auth Failure
**Severity**: SEV-1 (no login) / SEV-2 (partial)  
**Detection**: AuthErrorRate spike, LoginFailed, TokenValidationFailed  
**RTO Target**: 10 minutes  

#### Recovery Steps:

```bash
# 1. CHECK NEON AUTH STATUS (1 min)
# Neon Console > Auth > Health, Logs

# 2. VERIFY JWT CONFIG (1 min)
# Check: JWKS endpoint accessible
curl https://auth.instagram-clone.com/.well-known/jwks.json

# 3. CHECK SECRET ROTATION (1 min)
# If keys rotated: ensure app has new keys
# Neon Functions auto-fetch on cold start

# 4. FALLBACK: STATIC JWT VALIDATION (2 min)
# If Auth service down: valid JWTs still work (stateless)
# Only token refresh fails - acceptable for short outage

# 5. CONTACT NEON SUPPORT (if persistent)
# Support ticket with project ID, error logs
```

---

### Scenario 6: Object Storage (S3) Failure
**Severity**: SEV-2 (uploads fail)  
**Detection**: UploadErrorRate, PresignedURLGenerationFailed, MediaProcessingFailed  
**RTO Target**: 10 minutes  

#### Recovery Steps:

```bash
# 1. CHECK STORAGE STATUS (1 min)
# Neon Console > Storage > Buckets > Health
# AWS S3 Console (if using external) > Bucket health

# 2. VERIFY CREDENTIALS (1 min)
# Check: IAM roles, bucket policies, CORS config

# 3. SWITCH TO BACKUP BUCKET (2 min)
# If multi-region: update bucket env var
# NEON_STORAGE_BUCKET=instagram-clone-backup-us-west-2

# 4. QUEUE FAILED UPLOADS (2 min)
# BullMQ/Queue: retry failed jobs
# API: return 503 with Retry-After for new uploads

# 5. PROCESS BACKLOG (ongoing)
# Once storage restored: process queued uploads
```

---

### Scenario 7: Regional Outage (us-east-1)
**Severity**: SEV-1  
**Detection**: Multiple service alerts, AWS status page  
**RTO Target**: 30 minutes  

#### Recovery Steps:

```bash
# 1. CONFIRM REGIONAL OUTAGE (2 min)
# AWS Health Dashboard, Neon Status Page

# 2. FAILOVER TO READ REPLICA (5 min)
# Neon: Promote read replica to primary
neon computes promote-replica --replica-id=$REPLICA_ID --project-id=$NEON_PROJECT_ID

# 3. UPDATE DNS (2 min)
# Route53: Failover to secondary region endpoints
# Or: Neon Functions auto-failover if configured

# 4. VERIFY DATA CONSISTENCY (5 min)
# Check: Replication lag = 0
# Run: Data integrity checks

# 5. FULL FAILOVER (10 min)
# Deploy to secondary region Neon project
# Update all service endpoints
# Notify users of potential latency increase

# 6. FAILBACK (when region restored)
# Reverse process, verify data sync
```

---

### Scenario 8: Security Breach / Data Exfiltration
**Severity**: SEV-1  
**Detection**: Unusual access patterns, AuditLogAlert, SecurityTeam report  
**RTO Target**: Immediate containment  

#### Recovery Steps:

```bash
# 1. CONTAIN (Immediate)
# Revoke compromised credentials
# Neon Console: Rotate all API keys, DB passwords
# Block suspicious IPs in Neon IP Allowlist

# 2. ASSESS (30 min)
# Check: Audit logs for data access
# Neon Console > Branches > Audit Log
# Determine scope: users, data types, time range

# 3. RECOVER (Ongoing)
# If data modified: Point-in-time restore to pre-breach
neon branches restore main --restore-timestamp="PRE_BREACH_TIMESTAMP"

# 4. NOTIFY (Legal requirement)
# GDPR: 72 hours to authorities
# Users: If personal data exposed

# 5. POST-INCIDENT
# Rotate ALL secrets
# Security audit
# Update threat model
```

---

## Neon Instant Restore

### How It Works
Neon's instant restore uses copy-on-write branching to create a new branch from any point in time within the PITR window (7 days). The restore is nearly instantaneous regardless of database size.

### Restore Options

| Method | Use Case | Time |
|--------|----------|------|
| **Restore in Place** | Production recovery, overwrite main | ~30 seconds |
| **New Branch** | Testing, validation, parallel recovery | ~30 seconds |
| **Schema Only** | Schema corruption, data intact | ~10 seconds |

### CLI Commands

```bash
# List restore points
neon branches list --project-id=$NEON_PROJECT_ID --show-restore-points

# Restore main branch to specific timestamp
neon branches restore main \
  --restore-timestamp="2026-11-12T10:30:00Z" \
  --project-id=$NEON_PROJECT_ID

# Create restore branch for validation
neon branches create restore-validation \
  --parent=main \
  --restore-timestamp="2026-11-12T10:30:00Z" \
  --project-id=$NEON_PROJECT_ID

# Restore schema only
neon branches restore main \
  --schema-only \
  --restore-timestamp="2026-11-12T10:30:00Z" \
  --project-id=$NEON_PROJECT_ID
```

### Restore Validation Checklist

```bash
# After restore, verify:
☐ Database accepts connections
☐ Tables exist with correct row counts
☐ Indexes valid
☐ RLS policies active
☐ Functions/Triggers work
☐ Application connects successfully
☐ Health endpoint returns 200
☐ Contract tests pass
☐ Smoke load test passes
☐ WebSocket connections work
☐ Auth token validation works
☐ Media upload/download works
```

### Automation: Auto-Restore on Corruption Detection

```yaml
# .github/workflows/auto-restore.yml
name: Auto Restore on Corruption
on:
  schedule:
    - cron: '*/5 * * * *'  # Every 5 minutes
  workflow_dispatch:

jobs:
  check-and-restore:
    runs-on: ubuntu-latest
    steps:
      - name: Check DB Health
        run: |
          HEALTH=$(curl -s https://api.instagram-clone.com/health)
          if echo "$HEALTH" | grep -q '"status":"degraded"'; then
            echo "Corruption detected, initiating restore..."
            neon branches restore main --restore-timestamp="$(date -d '5 minutes ago' -u +%Y-%m-%dT%H:%M:%SZ)"
          fi
```

---

## Communication Plan

### Internal Communication

| Channel | Purpose | Audience |
|---------|---------|----------|
| `#incidents` Slack | Real-time coordination | Engineering, SRE |
| `incident-<ID>` Zoom | War room (SEV-1) | On-call, Leads, Management |
| PagerDuty | Alerting, escalation | On-call rotation |
| Confluence/Notion | Incident timeline | All stakeholders |

### External Communication

| Channel | Trigger | Template |
|---------|---------|----------|
| Status Page | SEV-1/2 within 5 min | "Investigating - We're aware of issues affecting..." |
| Status Page | Resolution | "Resolved - The issue has been fixed..." |
| Twitter | SEV-1 | "We're experiencing issues with... Team is investigating" |
| Email | SEV-1 + data loss | Direct to affected users (if identifiable) |

### Status Page Templates

```markdown
# Investigating
We're currently investigating reports of [issue]. 
Affected: [API / WebSocket / Uploads / Auth]
Started: [timestamp]
Updates every 15 minutes.

# Identified
Root cause: [cause]
Fix in progress. ETA: [time]

# Monitoring
Fix deployed. Monitoring for stability.

# Resolved
Issue resolved at [timestamp]. Root cause: [cause]. 
Post-mortem will be published within 48 hours.
```

---

## Post-Incident Process

### 1. Incident Review (Within 24 hours)
- Complete timeline in incident document
- Root cause analysis (5 Whys)
- Impact assessment (users, data, revenue)
- Action items with owners and due dates

### 2. Post-Mortem Document (Within 48 hours)
```markdown
# Post-Mortem: INC-YYYYMMDD-XXX

## Summary
- **Date**: YYYY-MM-DD
- **Duration**: XX minutes
- **Severity**: SEV-X
- **Impact**: X users affected, X% error rate

## Timeline
- HH:MM - Alert triggered
- HH:MM - On-call acknowledged
- HH:MM - Root cause identified
- HH:MM - Fix deployed
- HH:MM - Service restored

## Root Cause
[Technical explanation]

## Contributing Factors
- [Factor 1]
- [Factor 2]

## Action Items
| ID | Action | Owner | Due Date | Status |
|----|--------|-------|----------|--------|
| 1 | Add index to prevent query timeout | @engineer | YYYY-MM-DD | Open |
| 2 | Increase connection pool max | @sre | YYYY-MM-DD | Open |

## Lessons Learned
- What went well
- What didn't go well
- What to improve
```

### 3. Action Item Tracking
- Create GitHub issues for each action item
- Label: `incident-followup`, `INC-YYYYMMDD-XXX`
- Review in weekly ops meeting
- Close only after verification

---

## Testing & Validation

### Disaster Recovery Drills

| Drill | Frequency | Scenario | Participants |
|-------|-----------|----------|--------------|
| **Tabletop** | Monthly | Regional outage | Leads, SRE |
| **Instant Restore** | Quarterly | DB corruption | On-call, SRE |
| **Full Failover** | Semi-annually | Region loss | All engineering |
| **Chaos Engineering** | Weekly (automated) | Various | Automated |

### Restore Test Procedure (Quarterly)

```bash
# 1. Schedule maintenance window
# 2. Create test branch from production
neon branches create dr-test-$(date +%Y%m%d) --parent=main

# 3. Run restore on test branch
neon branches restore dr-test-$(date +%Y%m%d) \
  --restore-timestamp="$(date -d '1 hour ago' -u +%Y-%m-%dT%H:%M:%SZ)"

# 4. Deploy test environment
# GitHub Actions: Deploy to dr-test branch

# 5. Run validation suite
npm run test:contract -- --env STAGING_API_URL=https://dr-test-api.instagram-clone.com
k6 run tests/load/smoke-test.js -e API_BASE_URL=https://dr-test-api.instagram-clone.com

# 6. Verify data integrity
# Row counts, checksums, foreign keys

# 7. Document results
# Restore time, validation time, any issues

# 8. Cleanup
neon branches delete dr-test-$(date +%Y%m%d)
```

### Success Criteria for DR Tests
- ✅ Restore completes in < 60 seconds
- ✅ Application deploys and starts in < 5 minutes
- ✅ All contract tests pass
- ✅ Smoke load test: p95 < 200ms, error rate < 0.1%
- ✅ Data integrity: row counts match, no FK violations
- ✅ Total RTO < 15 minutes

---

## Appendices

### Appendix A: Key Contacts

| Role | Name | Contact | Backup |
|------|------|---------|--------|
| Primary On-Call | [Name] | PagerDuty | [Name] |
| Secondary On-Call | [Name] | PagerDuty | [Name] |
| Engineering Lead | [Name] | Slack/Phone | [Name] |
| Database Admin | [Name] | Slack/Phone | [Name] |
| Neon Support | - | support@neon.tech | Enterprise Slack |
| AWS Support | - | AWS Console | - |

### Appendix B: Useful Commands

```bash
# Neon CLI
neon --version
neon auth
neon projects list
neon branches list --project-id=$NEON_PROJECT_ID
neon branches create <name> --parent=main
neon branches delete <name>
neon branches restore <branch> --restore-timestamp=<ISO_TIMESTAMP>
neon computes list --project-id=$NEON_PROJECT_ID
neon computes update <id> --min-cu=2 --max-cu=10
neon functions list --project-id=$NEON_PROJECT_ID
neon functions logs <function> --branch=main
neon storage buckets list --project-id=$NEON_PROJECT_ID

# Database
psql $DATABASE_URL -c "SELECT * FROM pg_stat_activity;"
psql $DATABASE_URL -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state='active' AND query_start < now() - interval '5 minutes';"

# Kubernetes (if applicable)
kubectl get pods -n instagram-clone
kubectl logs -n instagram-clone -l app=api
kubectl rollout restart deployment/api -n instagram-clone

# Monitoring
curl -s https://api.instagram-clone.com/health | jq
curl -s https://api.instagram-clone.com/metrics | head -50
```

### Appendix C: Environment Variables for Recovery

```bash
# Required for manual recovery operations
export NEON_PROJECT_ID="your-project-id"
export NEON_API_KEY="your-api-key"  # From Neon Console > Settings > API Keys
export DATABASE_URL="postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech/dbname"
export BETTER_AUTH_SECRET="your-auth-secret"
export BETTER_AUTH_URL="https://auth.instagram-clone.com"
export AWS_REGION="us-east-1"
export S3_BUCKET="instagram-clone-uploads"
```

### Appendix D: Runbook Maintenance

| Task | Frequency | Owner |
|------|-----------|-------|
| Review contact list | Monthly | SRE Lead |
| Update Neon CLI version | Monthly | SRE |
| Validate restore procedures | Quarterly | On-call rotation |
| Update architecture diagram | Per major change | Platform Eng |
| Test communication templates | Quarterly | SRE Lead |
| Review action items from post-mortems | Weekly | Engineering Lead |

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-11-12 | Platform Engineering | Initial version |

**Next Review**: 2027-02-12  
**Approved By**: [CTO Name], [VP Engineering Name]  
**Distribution**: Engineering Team, SRE, Management, Compliance