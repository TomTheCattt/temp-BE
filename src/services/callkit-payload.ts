/**
 * CallKit Payload Builder
 * Builds the APNs VoIP push payload format required by iOS CallKit
 *
 * CallKit payload format (from Apple documentation):
 * {
 *   aps: {
 *     'content-available': 1,
 *     'mutable-content': 1
 *   },
 *   callkit: {
 *     uuid: string,                    // Call UUID (must match CallKit CXCall UUID)
 *     handle: string,                  // Caller identifier (username, phone, email)
 *     handleType: 'generic' | 'phoneNumber' | 'emailAddress',
 *     hasVideo: boolean,
 *     isGroupCall: boolean,
 *     callId: string,                  // Backend call ID
 *     roomId: string,                  // Media server room ID
 *     iceServers: RTCIceServer[],      // Pre-fetched ICE servers for faster connect
 *     callerName: string,
 *     callerAvatar: string,
 *     // Optional fields for call updates
 *     action?: 'accepted' | 'declined' | 'missed' | 'ended' | 'failed',
 *     timestamp?: string,
 *     duration?: number,
 *     error?: string,
 *   }
 * }
 */

// ICE Server type (matches WebRTC RTCIceServer)
export interface RTCIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

// Input data for building CallKit payload
export interface CallKitPayloadData {
  callId: string;              // UUID for the call (matches CallKit CXCall UUID)
  roomId: string;              // Media server room ID
  callerId: string;            // Caller user ID
  callerName: string;          // Caller display name
  callerUsername: string;      // Caller username (used as handle)
  callerAvatarUrl?: string;    // Caller avatar URL
  hasVideo: boolean;           // Whether call has video
  isGroupCall: boolean;        // Whether this is a group call
  iceServers: RTCIceServer[];  // ICE servers for WebRTC connection
}

// Complete VoIP push payload structure
export interface VoIPPushPayload {
  aps: {
    alert?: {
      title: string;
      body: string;
    };
    badge?: number;
    sound?: string;
    'content-available': 1;
    'mutable-content': 1;
    category?: string;
    threadId?: string;
  };
  callkit: {
    uuid: string;                    // Call UUID
    handle: string;                  // Caller identifier (username/phone)
    handleType: 'generic' | 'phoneNumber' | 'emailAddress';
    hasVideo: boolean;
    isGroupCall: boolean;
    callId: string;                  // Backend call ID
    roomId: string;                  // Media server room ID
    iceServers?: RTCIceServer[];     // Pre-fetched for faster connect (optional for updates)
    callerName?: string;             // Display name (optional for updates)
    callerAvatar?: string;           // Avatar URL (optional for updates)
    // Optional call update fields
    action?: 'incoming' | 'accepted' | 'declined' | 'missed' | 'ended' | 'failed';
    timestamp?: string;              // ISO 8601 timestamp
    duration?: number;               // Call duration in seconds (for ended)
    error?: string;                  // Error message (for failed)
  };
}

/**
 * Build the complete CallKit VoIP push payload for incoming calls
 * This is the primary payload sent when a new call is initiated
 */
export function buildCallKitPayload(data: CallKitPayloadData): VoIPPushPayload {
  const {
    callId,
    roomId,
    callerId,
    callerName,
    callerUsername,
    callerAvatarUrl,
    hasVideo,
    isGroupCall,
    iceServers
  } = data;

  // CallKit handle should be the caller's username for generic type
  // For phone numbers, use phoneNumber type and the phone number as handle
  // For email, use emailAddress type and the email as handle
  const handleType: 'generic' | 'phoneNumber' | 'emailAddress' = 'generic';
  const handle = callerUsername;

  // Ensure ICE servers have proper format
  const formattedIceServers = iceServers.map(server => ({
    urls: server.urls,
    username: server.username,
    credential: server.credential,
  }));

  return {
    aps: {
      // Silent push - no alert shown to user (CallKit handles UI)
      'content-available': 1,
      'mutable-content': 1,
      category: 'call',
      threadId: callId,
    },
    callkit: {
      uuid: callId,                          // Must match CallKit CXCall UUID
      handle,                                // Caller username
      handleType,
      hasVideo,
      isGroupCall,
      callId,                                // Backend call ID
      roomId,                                // Media server room ID
      iceServers: formattedIceServers,       // Pre-fetched ICE servers
      callerName,                            // Display name for CallKit UI
      callerAvatar: callerAvatarUrl || '',   // Avatar for CallKit UI
      action: 'incoming',
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Build CallKit payload for call accepted (callee answered)
 * Sent to caller to update their CallKit UI
 */
export function buildCallAcceptedPayload(
  callId: string,
  roomId: string,
  calleeId: string,
  calleeName: string,
  calleeUsername: string
): VoIPPushPayload {
  return {
    aps: {
      'content-available': 1,
      'mutable-content': 1,
      category: 'call',
      threadId: callId,
    },
    callkit: {
      uuid: callId,
      handle: calleeUsername,
      handleType: 'generic',
      hasVideo: false,  // Will be set by sender
      isGroupCall: false,
      callId,
      roomId,
      iceServers: [],
      callerName: calleeName,
      callerAvatar: '',
      action: 'accepted',
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Build CallKit payload for call declined (callee rejected)
 * Sent to caller to update their CallKit UI
 */
export function buildCallDeclinedPayload(
  callId: string,
  roomId: string,
  calleeId: string,
  calleeUsername: string
): VoIPPushPayload {
  return {
    aps: {
      'content-available': 1,
      'mutable-content': 1,
      category: 'call',
      threadId: callId,
    },
    callkit: {
      uuid: callId,
      handle: calleeUsername,
      handleType: 'generic',
      hasVideo: false,
      isGroupCall: false,
      callId,
      roomId,
      iceServers: [],
      callerName: '',
      callerAvatar: '',
      action: 'declined',
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Build CallKit payload for missed call (timeout)
 * Sent as a regular push notification (not VoIP) to show missed call
 */
export function buildMissedCallPayload(
  callId: string,
  roomId: string,
  callerName: string,
  callerUsername: string,
  hasVideo: boolean
): VoIPPushPayload {
  return {
    aps: {
      alert: {
        title: "Missed Call",
        body: `${callerName} ${hasVideo ? 'video ' : ''}called you`,
      },
      'content-available': 1,
      'mutable-content': 1,
      sound: 'default',
      category: 'missed_call',
      threadId: callId,
    },
    callkit: {
      uuid: callId,
      handle: callerUsername,
      handleType: 'generic',
      hasVideo,
      isGroupCall: false,
      callId,
      roomId,
      iceServers: [],
      callerName,
      callerAvatar: '',
      action: 'missed',
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Build CallKit payload for call ended
 * Used to notify both parties that call has ended
 */
export function buildCallEndedPayload(
  callId: string,
  roomId: string,
  otherPartyUsername: string,
  duration: number
): VoIPPushPayload {
  return {
    aps: {
      'content-available': 1,
      'mutable-content': 1,
      category: 'call',
      threadId: callId,
    },
    callkit: {
      uuid: callId,
      handle: otherPartyUsername,
      handleType: 'generic',
      hasVideo: false,
      isGroupCall: false,
      callId,
      roomId,
      iceServers: [],
      callerName: '',
      callerAvatar: '',
      action: 'ended',
      timestamp: new Date().toISOString(),
      duration,
    },
  };
}

/**
 * Build CallKit payload for call failed
 * Used when call fails to connect
 */
export function buildCallFailedPayload(
  callId: string,
  roomId: string,
  error: string
): VoIPPushPayload {
  return {
    aps: {
      alert: {
        title: "Call Failed",
        body: error || "Could not connect the call",
      },
      'content-available': 1,
      'mutable-content': 1,
      sound: 'default',
      category: 'call_failed',
      threadId: callId,
    },
    callkit: {
      uuid: callId,
      handle: '',
      handleType: 'generic',
      hasVideo: false,
      isGroupCall: false,
      callId,
      roomId,
      iceServers: [],
      callerName: '',
      callerAvatar: '',
      action: 'failed',
      timestamp: new Date().toISOString(),
      error,
    },
  };
}

/**
 * Build CallKit payload for group call invite
 */
export function buildGroupCallInvitePayload(
  callId: string,
  roomId: string,
  callerId: string,
  callerName: string,
  callerUsername: string,
  callerAvatarUrl: string,
  hasVideo: boolean,
  participantCount: number,
  iceServers: RTCIceServer[]
): VoIPPushPayload {
  return {
    aps: {
      'content-available': 1,
      'mutable-content': 1,
      category: 'call',
      threadId: callId,
    },
    callkit: {
      uuid: callId,
      handle: callerUsername,
      handleType: 'generic',
      hasVideo,
      isGroupCall: true,
      callId,
      roomId,
      iceServers: iceServers.map(s => ({
        urls: s.urls,
        username: s.username,
        credential: s.credential,
      })),
      callerName: `${callerName} + ${participantCount - 1} others`,
      callerAvatar: callerAvatarUrl || '',
      action: 'incoming',
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Validate CallKit payload for correctness
 */
export function validateCallKitPayload(payload: VoIPPushPayload): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check required aps fields
  if (!payload.aps) {
    errors.push("Missing aps object");
  } else {
    if (payload.aps['content-available'] !== 1) {
      errors.push("aps.content-available must be 1");
    }
    if (payload.aps['mutable-content'] !== 1) {
      errors.push("aps.mutable-content must be 1");
    }
  }

  // Check required callkit fields
  if (!payload.callkit) {
    errors.push("Missing callkit object");
  } else {
    const ck = payload.callkit;
    if (!ck.uuid) errors.push("callkit.uuid is required");
    if (!ck.handle) errors.push("callkit.handle is required");
    if (!['generic', 'phoneNumber', 'emailAddress'].includes(ck.handleType)) {
      errors.push("callkit.handleType must be 'generic', 'phoneNumber', or 'emailAddress'");
    }
    if (typeof ck.hasVideo !== 'boolean') errors.push("callkit.hasVideo must be boolean");
    if (typeof ck.isGroupCall !== 'boolean') errors.push("callkit.isGroupCall must be boolean");
    if (!ck.callId) errors.push("callkit.callId is required");
    if (!ck.roomId) errors.push("callkit.roomId is required");
    if (!Array.isArray(ck.iceServers)) errors.push("callkit.iceServers must be array");
    if (!ck.callerName) errors.push("callkit.callerName is required");
    if (ck.callerAvatar === undefined) errors.push("callkit.callerAvatar is required (can be empty string)");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Parse incoming CallKit payload from APNs (for debugging/verification)
 */
export function parseCallKitPayload(payload: any): CallKitPayloadData | null {
  try {
    const ck = payload.callkit;
    if (!ck) return null;

    return {
      callId: ck.uuid || ck.callId,
      roomId: ck.roomId,
      callerId: '', // Not in payload
      callerName: ck.callerName,
      callerUsername: ck.handle,
      callerAvatarUrl: ck.callerAvatar,
      hasVideo: ck.hasVideo,
      isGroupCall: ck.isGroupCall,
      iceServers: ck.iceServers || [],
    };
  } catch {
    return null;
  }
}

// Default ICE servers for development
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.google.com:19302" },
];

// Production ICE servers (should be configured via environment)
export function getProductionIceServers(): RTCIceServer[] {
  const turnUrls = process.env.TURN_URLS?.split(',') || [];
  const turnUsername = process.env.TURN_USERNAME || '';
  const turnCredential = process.env.TURN_CREDENTIAL || '';

  const servers: RTCIceServer[] = [...DEFAULT_ICE_SERVERS];

  for (const url of turnUrls) {
    if (url.trim()) {
      servers.push({
        urls: url.trim(),
        username: turnUsername,
        credential: turnCredential,
      });
    }
  }

  return servers;
}