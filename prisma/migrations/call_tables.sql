-- Call Tables for WebRTC Signaling
-- Includes: calls, call_participants, call_signaling_logs

-- ============================================================
-- CALLS (1:1 and group video/audio calls)
-- ============================================================
CREATE TABLE calls (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type                VARCHAR(20) NOT NULL CHECK (type IN ('audio', 'video', 'group_audio', 'group_video')),
    status              VARCHAR(20) DEFAULT 'initiated' CHECK (status IN (
        'initiated', 'ringing', 'connecting', 'active', 'ended', 'missed', 'declined', 'failed'
    )),
    initiator_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- For group calls
    conversation_id     UUID REFERENCES conversations(id) ON DELETE SET NULL,
    -- Call settings
    max_participants    INT DEFAULT 2,
    is_recording        BOOLEAN DEFAULT FALSE,
    recording_url       TEXT,
    -- Timing
    started_at          TIMESTAMPTZ,
    ended_at            TIMESTAMPTZ,
    duration_seconds    INT DEFAULT 0,
    -- Media server
    media_server_id     UUID,
    room_id             VARCHAR(100),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_calls_initiator ON calls(initiator_id, created_at DESC);
CREATE INDEX idx_calls_conversation ON calls(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX idx_calls_status ON calls(status) WHERE status IN ('initiated', 'ringing', 'connecting', 'active');
CREATE INDEX idx_calls_room ON calls(room_id) WHERE room_id IS NOT NULL;

-- ============================================================
-- CALL PARTICIPANTS
-- ============================================================
CREATE TABLE call_participants (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id             UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status              VARCHAR(20) DEFAULT 'invited' CHECK (status IN (
        'invited', 'ringing', 'joining', 'connected', 'reconnecting', 'left', 'declined', 'failed'
    )),
    -- Media state
    is_muted            BOOLEAN DEFAULT FALSE,
    is_video_off        BOOLEAN DEFAULT FALSE,
    is_screen_share     BOOLEAN DEFAULT FALSE,
    -- Connection quality
    connection_quality  VARCHAR(20) CHECK (connection_quality IN ('excellent', 'good', 'poor', 'disconnected')),
    -- Device info
    device_type         VARCHAR(20),
    app_version         VARCHAR(20),
    joined_at           TIMESTAMPTZ,
    left_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (call_id, user_id)
);

CREATE INDEX idx_call_participants_call ON call_participants(call_id);
CREATE INDEX idx_call_participants_user ON call_participants(user_id, created_at DESC);
CREATE INDEX idx_call_participants_status ON call_participants(status) WHERE status IN ('invited', 'ringing', 'joining', 'connected', 'reconnecting');

-- ============================================================
-- CALL SIGNALING LOGS (for debugging/recovery)
-- ============================================================
CREATE TABLE call_signaling_logs (
    id                  BIGSERIAL PRIMARY KEY,
    call_id             UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    participant_id      UUID REFERENCES call_participants(id) ON DELETE SET NULL,
    direction           VARCHAR(10) NOT NULL CHECK (direction IN ('sent', 'received')),
    message_type        VARCHAR(50) NOT NULL,
    payload             JSONB NOT NULL,
    sequence_id         BIGINT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_call_signaling_call ON call_signaling_logs(call_id, created_at);
CREATE INDEX idx_call_signaling_sequence ON call_signaling_logs(call_id, sequence_id);
CREATE INDEX idx_call_signaling_participant ON call_signaling_logs(participant_id, created_at) WHERE participant_id IS NOT NULL;

-- ============================================================
-- FUNCTIONS FOR CALL MANAGEMENT
-- ============================================================

-- Function to create a new call
CREATE OR REPLACE FUNCTION create_call(
    p_type VARCHAR,
    p_initiator_id UUID,
    p_conversation_id UUID DEFAULT NULL,
    p_max_participants INT DEFAULT 2,
    p_is_recording BOOLEAN DEFAULT FALSE
) RETURNS TABLE (call_id UUID, room_id VARCHAR, ice_servers JSONB) AS $$
DECLARE
    v_call_id UUID;
    v_room_id VARCHAR;
    v_ice_servers JSONB;
BEGIN
    v_call_id := gen_random_uuid();
    v_room_id := 'call_' || v_call_id::TEXT;
    v_ice_servers := '[
        {"urls": "stun:stun.l.google.com:19302"},
        {"urls": "turn:turn.example.com:3478", "username": "user", "credential": "pass"}
    ]'::JSONB;

    INSERT INTO calls (id, type, initiator_id, conversation_id, max_participants, is_recording, room_id)
    VALUES (v_call_id, p_type, p_initiator_id, p_conversation_id, p_max_participants, p_is_recording, v_room_id);

    -- Add initiator as participant
    INSERT INTO call_participants (call_id, user_id, status)
    VALUES (v_call_id, p_initiator_id, 'connected');

    RETURN QUERY SELECT v_call_id, v_room_id, v_ice_servers;
END;
$$ LANGUAGE plpgsql;

-- Function to join a call
CREATE OR REPLACE FUNCTION join_call(
    p_call_id UUID,
    p_user_id UUID
) RETURNS TABLE (
    call_id UUID,
    room_id VARCHAR,
    ice_servers JSONB,
    participants JSONB
) AS $$
DECLARE
    v_call calls%ROWTYPE;
    v_participants JSONB;
BEGIN
    -- Get call details
    SELECT * INTO v_call FROM calls WHERE id = p_call_id;

    IF v_call IS NULL THEN
        RAISE EXCEPTION 'Call not found';
    END IF;

    IF v_call.status NOT IN ('initiated', 'ringing', 'connecting', 'active') THEN
        RAISE EXCEPTION 'Call not joinable';
    END IF;

    -- Add or update participant
    INSERT INTO call_participants (call_id, user_id, status, joined_at)
    VALUES (p_call_id, p_user_id, 'connected', NOW())
    ON CONFLICT (call_id, user_id)
    DO UPDATE SET
        status = 'connected',
        joined_at = COALESCE(call_participants.joined_at, NOW()),
        left_at = NULL;

    -- Get participants
    SELECT jsonb_agg(jsonb_build_object(
        'id', cp.id,
        'user_id', cp.user_id,
        'username', u.username,
        'avatar_url', u.avatar_url,
        'is_muted', cp.is_muted,
        'is_video_off', cp.is_video_off,
        'joined_at', cp.joined_at
    )) INTO v_participants
    FROM call_participants cp
    JOIN users u ON u.id = cp.user_id
    WHERE cp.call_id = p_call_id;

    -- Update call status if needed
    IF v_call.status = 'initiated' THEN
        UPDATE calls SET status = 'ringing', updated_at = NOW() WHERE id = p_call_id;
    END IF;

    RETURN QUERY SELECT
        p_call_id,
        v_call.room_id,
        '[
            {"urls": "stun:stun.l.google.com:19302"},
            {"urls": "turn:turn.example.com:3478", "username": "user", "credential": "pass"}
        ]'::JSONB,
        v_participants;
END;
$$ LANGUAGE plpgsql;

-- Function to leave a call
CREATE OR REPLACE FUNCTION leave_call(
    p_call_id UUID,
    p_user_id UUID,
    p_reason VARCHAR DEFAULT 'left'
) RETURNS VOID AS $$
DECLARE
    v_remaining INT;
BEGIN
    UPDATE call_participants
    SET status = 'left', left_at = NOW()
    WHERE call_id = p_call_id AND user_id = p_user_id;

    -- Check remaining participants
    SELECT COUNT(*) INTO v_remaining
    FROM call_participants
    WHERE call_id = p_call_id AND status IN ('connected', 'reconnecting');

    -- End call if no participants left
    IF v_remaining = 0 THEN
        UPDATE calls
        SET status = 'ended', ended_at = NOW(),
            duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INT
        WHERE id = p_call_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to update participant media state
CREATE OR REPLACE FUNCTION update_call_participant_media(
    p_call_id UUID,
    p_user_id UUID,
    p_is_muted BOOLEAN DEFAULT NULL,
    p_is_video_off BOOLEAN DEFAULT NULL,
    p_is_screen_share BOOLEAN DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    UPDATE call_participants
    SET
        is_muted = COALESCE(p_is_muted, is_muted),
        is_video_off = COALESCE(p_is_video_off, is_video_off),
        is_screen_share = COALESCE(p_is_screen_share, is_screen_share)
    WHERE call_id = p_call_id AND user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- Function to log signaling message
CREATE OR REPLACE FUNCTION log_signaling_message(
    p_call_id UUID,
    p_participant_id UUID,
    p_direction VARCHAR,
    p_message_type VARCHAR,
    p_payload JSONB,
    p_sequence_id BIGINT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    INSERT INTO call_signaling_logs (call_id, participant_id, direction, message_type, payload, sequence_id)
    VALUES (p_call_id, p_participant_id, p_direction, p_message_type, p_payload, p_sequence_id);
END;
$$ LANGUAGE plpgsql;