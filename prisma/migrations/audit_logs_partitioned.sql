-- Partitioned Audit Logs Table
-- Monthly partitions for 7-year retention
-- Immutable, append-only for compliance

-- Enable required extension for partitioning
CREATE EXTENSION IF NOT EXISTS pg_partman;

-- Main partitioned table
CREATE TABLE audit_logs (
    id              BIGSERIAL,
    event_id        UUID NOT NULL DEFAULT gen_random_uuid(),
    actor_id        UUID REFERENCES users(id),
    actor_ip        INET,
    actor_user_agent TEXT,
    action          VARCHAR(100) NOT NULL,
    resource_type   VARCHAR(50),
    resource_id     UUID,
    old_values      JSONB,
    new_values      JSONB,
    correlation_id  UUID,
    session_id      UUID,
    request_id      UUID,
    metadata        JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Create monthly partitions for 2024-2030 (7 years)
-- 2024
CREATE TABLE audit_logs_2024_01 PARTITION OF audit_logs FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
CREATE TABLE audit_logs_2024_02 PARTITION OF audit_logs FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');
CREATE TABLE audit_logs_2024_03 PARTITION OF audit_logs FOR VALUES FROM ('2024-03-01') TO ('2024-04-01');
CREATE TABLE audit_logs_2024_04 PARTITION OF audit_logs FOR VALUES FROM ('2024-04-01') TO ('2024-05-01');
CREATE TABLE audit_logs_2024_05 PARTITION OF audit_logs FOR VALUES FROM ('2024-05-01') TO ('2024-06-01');
CREATE TABLE audit_logs_2024_06 PARTITION OF audit_logs FOR VALUES FROM ('2024-06-01') TO ('2024-07-01');
CREATE TABLE audit_logs_2024_07 PARTITION OF audit_logs FOR VALUES FROM ('2024-07-01') TO ('2024-08-01');
CREATE TABLE audit_logs_2024_08 PARTITION OF audit_logs FOR VALUES FROM ('2024-08-01') TO ('2024-09-01');
CREATE TABLE audit_logs_2024_09 PARTITION OF audit_logs FOR VALUES FROM ('2024-09-01') TO ('2024-10-01');
CREATE TABLE audit_logs_2024_10 PARTITION OF audit_logs FOR VALUES FROM ('2024-10-01') TO ('2024-11-01');
CREATE TABLE audit_logs_2024_11 PARTITION OF audit_logs FOR VALUES FROM ('2024-11-01') TO ('2024-12-01');
CREATE TABLE audit_logs_2024_12 PARTITION OF audit_logs FOR VALUES FROM ('2024-12-01') TO ('2025-01-01');

-- 2025
CREATE TABLE audit_logs_2025_01 PARTITION OF audit_logs FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE audit_logs_2025_02 PARTITION OF audit_logs FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE audit_logs_2025_03 PARTITION OF audit_logs FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE audit_logs_2025_04 PARTITION OF audit_logs FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE audit_logs_2025_05 PARTITION OF audit_logs FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE audit_logs_2025_06 PARTITION OF audit_logs FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE audit_logs_2025_07 PARTITION OF audit_logs FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE audit_logs_2025_08 PARTITION OF audit_logs FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE audit_logs_2025_09 PARTITION OF audit_logs FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE audit_logs_2025_10 PARTITION OF audit_logs FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE audit_logs_2025_11 PARTITION OF audit_logs FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE audit_logs_2025_12 PARTITION OF audit_logs FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

-- 2026
CREATE TABLE audit_logs_2026_01 PARTITION OF audit_logs FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE audit_logs_2026_02 PARTITION OF audit_logs FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE audit_logs_2026_03 PARTITION OF audit_logs FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE audit_logs_2026_04 PARTITION OF audit_logs FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE audit_logs_2026_05 PARTITION OF audit_logs FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE audit_logs_2026_06 PARTITION OF audit_logs FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE audit_logs_2026_07 PARTITION OF audit_logs FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE audit_logs_2026_08 PARTITION OF audit_logs FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE audit_logs_2026_09 PARTITION OF audit_logs FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE audit_logs_2026_10 PARTITION OF audit_logs FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE audit_logs_2026_11 PARTITION OF audit_logs FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE audit_logs_2026_12 PARTITION OF audit_logs FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- 2027
CREATE TABLE audit_logs_2027_01 PARTITION OF audit_logs FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE audit_logs_2027_02 PARTITION OF audit_logs FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE audit_logs_2027_03 PARTITION OF audit_logs FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE audit_logs_2027_04 PARTITION OF audit_logs FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE audit_logs_2027_05 PARTITION OF audit_logs FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
CREATE TABLE audit_logs_2027_06 PARTITION OF audit_logs FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
CREATE TABLE audit_logs_2027_07 PARTITION OF audit_logs FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');
CREATE TABLE audit_logs_2027_08 PARTITION OF audit_logs FOR VALUES FROM ('2027-08-01') TO ('2027-09-01');
CREATE TABLE audit_logs_2027_09 PARTITION OF audit_logs FOR VALUES FROM ('2027-09-01') TO ('2027-10-01');
CREATE TABLE audit_logs_2027_10 PARTITION OF audit_logs FOR VALUES FROM ('2027-10-01') TO ('2027-11-01');
CREATE TABLE audit_logs_2027_11 PARTITION OF audit_logs FOR VALUES FROM ('2027-11-01') TO ('2027-12-01');
CREATE TABLE audit_logs_2027_12 PARTITION OF audit_logs FOR VALUES FROM ('2027-12-01') TO ('2028-01-01');

-- 2028
CREATE TABLE audit_logs_2028_01 PARTITION OF audit_logs FOR VALUES FROM ('2028-01-01') TO ('2028-02-01');
CREATE TABLE audit_logs_2028_02 PARTITION OF audit_logs FOR VALUES FROM ('2028-02-01') TO ('2028-03-01');
CREATE TABLE audit_logs_2028_03 PARTITION OF audit_logs FOR VALUES FROM ('2028-03-01') TO ('2028-04-01');
CREATE TABLE audit_logs_2028_04 PARTITION OF audit_logs FOR VALUES FROM ('2028-04-01') TO ('2028-05-01');
CREATE TABLE audit_logs_2028_05 PARTITION OF audit_logs FOR VALUES FROM ('2028-05-01') TO ('2028-06-01');
CREATE TABLE audit_logs_2028_06 PARTITION OF audit_logs FOR VALUES FROM ('2028-06-01') TO ('2028-07-01');
CREATE TABLE audit_logs_2028_07 PARTITION OF audit_logs FOR VALUES FROM ('2028-07-01') TO ('2028-08-01');
CREATE TABLE audit_logs_2028_08 PARTITION OF audit_logs FOR VALUES FROM ('2028-08-01') TO ('2028-09-01');
CREATE TABLE audit_logs_2028_09 PARTITION OF audit_logs FOR VALUES FROM ('2028-09-01') TO ('2028-10-01');
CREATE TABLE audit_logs_2028_10 PARTITION OF audit_logs FOR VALUES FROM ('2028-10-01') TO ('2028-11-01');
CREATE TABLE audit_logs_2028_11 PARTITION OF audit_logs FOR VALUES FROM ('2028-11-01') TO ('2028-12-01');
CREATE TABLE audit_logs_2028_12 PARTITION OF audit_logs FOR VALUES FROM ('2028-12-01') TO ('2029-01-01');

-- 2029
CREATE TABLE audit_logs_2029_01 PARTITION OF audit_logs FOR VALUES FROM ('2029-01-01') TO ('2029-02-01');
CREATE TABLE audit_logs_2029_02 PARTITION OF audit_logs FOR VALUES FROM ('2029-02-01') TO ('2029-03-01');
CREATE TABLE audit_logs_2029_03 PARTITION OF audit_logs FOR VALUES FROM ('2029-03-01') TO ('2029-04-01');
CREATE TABLE audit_logs_2029_04 PARTITION OF audit_logs FOR VALUES FROM ('2029-04-01') TO ('2029-05-01');
CREATE TABLE audit_logs_2029_05 PARTITION OF audit_logs FOR VALUES FROM ('2029-05-01') TO ('2029-06-01');
CREATE TABLE audit_logs_2029_06 PARTITION OF audit_logs FOR VALUES FROM ('2029-06-01') TO ('2029-07-01');
CREATE TABLE audit_logs_2029_07 PARTITION OF audit_logs FOR VALUES FROM ('2029-07-01') TO ('2029-08-01');
CREATE TABLE audit_logs_2029_08 PARTITION OF audit_logs FOR VALUES FROM ('2029-08-01') TO ('2029-09-01');
CREATE TABLE audit_logs_2029_09 PARTITION OF audit_logs FOR VALUES FROM ('2029-09-01') TO ('2029-10-01');
CREATE TABLE audit_logs_2029_10 PARTITION OF audit_logs FOR VALUES FROM ('2029-10-01') TO ('2029-11-01');
CREATE TABLE audit_logs_2029_11 PARTITION OF audit_logs FOR VALUES FROM ('2029-11-01') TO ('2029-12-01');
CREATE TABLE audit_logs_2029_12 PARTITION OF audit_logs FOR VALUES FROM ('2029-12-01') TO ('2030-01-01');

-- 2030
CREATE TABLE audit_logs_2030_01 PARTITION OF audit_logs FOR VALUES FROM ('2030-01-01') TO ('2030-02-01');
CREATE TABLE audit_logs_2030_02 PARTITION OF audit_logs FOR VALUES FROM ('2030-02-01') TO ('2030-03-01');
CREATE TABLE audit_logs_2030_03 PARTITION OF audit_logs FOR VALUES FROM ('2030-03-01') TO ('2030-04-01');
CREATE TABLE audit_logs_2030_04 PARTITION OF audit_logs FOR VALUES FROM ('2030-04-01') TO ('2030-05-01');
CREATE TABLE audit_logs_2030_05 PARTITION OF audit_logs FOR VALUES FROM ('2030-05-01') TO ('2030-06-01');
CREATE TABLE audit_logs_2030_06 PARTITION OF audit_logs FOR VALUES FROM ('2030-06-01') TO ('2030-07-01');
CREATE TABLE audit_logs_2030_07 PARTITION OF audit_logs FOR VALUES FROM ('2030-07-01') TO ('2030-08-01');
CREATE TABLE audit_logs_2030_08 PARTITION OF audit_logs FOR VALUES FROM ('2030-08-01') TO ('2030-09-01');
CREATE TABLE audit_logs_2030_09 PARTITION OF audit_logs FOR VALUES FROM ('2030-09-01') TO ('2030-10-01');
CREATE TABLE audit_logs_2030_10 PARTITION OF audit_logs FOR VALUES FROM ('2030-10-01') TO ('2030-11-01');
CREATE TABLE audit_logs_2030_11 PARTITION OF audit_logs FOR VALUES FROM ('2030-11-01') TO ('2030-12-01');
CREATE TABLE audit_logs_2030_12 PARTITION OF audit_logs FOR VALUES FROM ('2030-12-01') TO ('2031-01-01');

-- Default partition for future dates (will be created as needed)
CREATE TABLE audit_logs_future PARTITION OF audit_logs DEFAULT;

-- Indexes (created on each partition automatically)
-- We create them on the parent table, they propagate to partitions
CREATE INDEX idx_audit_actor ON audit_logs(actor_id, created_at DESC);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id, created_at DESC);
CREATE INDEX idx_audit_correlation ON audit_logs(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_audit_action ON audit_logs(action, created_at DESC);
CREATE INDEX idx_audit_session ON audit_logs(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_audit_request ON audit_logs(request_id) WHERE request_id IS NOT NULL;

-- Function to automatically create new monthly partitions
-- Can be called via pg_cron monthly
CREATE OR REPLACE FUNCTION create_audit_log_partition() RETURNS void AS $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    -- Create partition for next month
    start_date := date_trunc('month', NOW() + INTERVAL '1 month');
    end_date := start_date + INTERVAL '1 month';
    partition_name := 'audit_logs_' || to_char(start_date, 'YYYY_MM');

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
        partition_name, start_date, end_date);

    RAISE NOTICE 'Created partition % for % to %', partition_name, start_date, end_date;
END;
$$ LANGUAGE plpgsql;

-- Schedule partition creation (runs on 1st of each month at 00:05)
SELECT cron.schedule('create-audit-partition', '5 0 1 * *', 'SELECT create_audit_log_partition();');

-- Function to detach old partitions (for 7-year retention)
-- Run annually to detach partitions older than 7 years
CREATE OR REPLACE FUNCTION detach_old_audit_partitions() RETURNS void AS $$
DECLARE
    cutoff_date DATE := NOW() - INTERVAL '7 years';
    partition_name TEXT;
BEGIN
    FOR partition_name IN
        SELECT inhrelid::regclass::text
        FROM pg_inherits
        WHERE inhparent = 'audit_logs'::regclass
        AND inhrelid::regclass::text LIKE 'audit_logs_%'
    LOOP
        -- Extract date from partition name
        -- This is a simplified check - in production, query pg_partition
        IF partition_name ~ 'audit_logs_(\d{4})_(\d{2})' THEN
            -- Would need to check actual partition bounds
            -- For now, just log
            RAISE NOTICE 'Would check partition % for retention', partition_name;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Note: For production, use pg_partman for automated partition management
-- CREATE EXTENSION pg_partman;
-- SELECT partman.create_parent('audit_logs', 'created_at', 'native', 'monthly');
-- SELECT partman.run_maintenance();