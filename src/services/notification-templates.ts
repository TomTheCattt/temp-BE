import { notificationTypeEnum } from "../db/schema.js";

type NotificationType = (typeof notificationTypeEnum.enumValues)[number];

/**
 * Notification Templates Service
 * Generates formatted notification content for all notification types
 * Supports in-app, push (APNs/FCM), email, and SMS channels
 */

export interface NotificationTemplateData {
  // Actor info
  actorName: string;
  actorUsername: string;
  actorAvatarUrl?: string;
  actorIsVerified?: boolean;

  // Reference object info
  referenceType?: string;
  referenceId?: string;

  // Content-specific data
  postCaption?: string;
  postThumbnailUrl?: string;
  reelTitle?: string;
  reelThumbnailUrl?: string;
  storyThumbnailUrl?: string;
  commentText?: string;
  mentionText?: string;
  dmPreview?: string;
  callType?: "audio" | "video";
  isGroupCall?: boolean;
  groupName?: string;
  participantCount?: number;

  // Grouping
  groupKey?: string;
  groupCount?: number;
  groupActorNames?: string[];

  // Security/Critical
  alertType?: string;
  alertDetails?: string;
  actionRequired?: boolean;
}

export interface FormattedNotification {
  title: string;
  body: string;
  previewText?: string;
  thumbnailUrl?: string;
  deepLink: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  sound?: string;
  badge?: number;
  // Push-specific
  apnsPayload?: APNSPayload;
  fcmPayload?: FCMPayload;
}

export type NotificationCategory =
  | "social"      // likes, comments, follows, mentions
  | "message"     // DMs, reactions
  | "call"        // incoming calls, missed calls
  | "live"        // live video
  | "security"    // security alerts, account changes
  | "system"      // announcements, achievements
  | "reminder";   // post reminders

export type NotificationPriority = "low" | "normal" | "high" | "critical";

export interface APNSPayload {
  aps: {
    alert: {
      title: string;
      body: string;
    };
    badge?: number;
    sound?: string;
    "content-available"?: 1;
    "mutable-content"?: 1;
    category?: string;
    threadId?: string;
  };
  // Custom data
  notificationId?: string;
  type?: string;
  deepLink?: string;
  actorId?: string;
  referenceType?: string;
  referenceId?: string;
  groupKey?: string;
  groupCount?: number;
  // CallKit data for VoIP pushes
  callkit?: {
    uuid: string;
    handle: string;
    handleType: "generic" | "phoneNumber" | "email";
    hasVideo: boolean;
    isGroupCall: boolean;
    callId: string;
    roomId?: string;
    iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
    callerName: string;
    callerAvatar?: string;
  };
}

export interface FCMPayload {
  notification: {
    title: string;
    body: string;
    image?: string;
    icon?: string;
    sound?: string;
    tag?: string;
    color?: string;
    clickAction?: string;
  };
  data: {
    notificationId: string;
    type: string;
    deepLink: string;
    actorId: string;
    referenceType?: string;
    referenceId?: string;
    groupKey?: string;
    groupCount?: string;
  };
  android?: {
    priority: "high" | "normal";
    notification: {
      channelId: string;
      priority: "high" | "default" | "low" | "min" | "max";
      visibility: "public" | "private" | "secret";
      category: string;
    };
  };
  apns?: APNSPayload;
}

// Channel-specific template configuration
interface ChannelTemplate {
  inApp: (data: NotificationTemplateData) => { title: string; body: string; previewText?: string };
  push: (data: NotificationTemplateData) => { title: string; body: string; previewText?: string };
  email?: (data: NotificationTemplateData) => { subject: string; html: string; text: string };
}

// Template registry
const templates: Record<NotificationType, ChannelTemplate> = {
  // Social interactions
  LIKE: {
    inApp: (data) => ({
      title: data.groupCount && data.groupCount > 1
        ? `${data.groupCount} people liked your post`
        : `${data.actorName} liked your post`,
      body: data.postCaption
        ? `"${truncate(data.postCaption, 80)}"`
        : "your post",
      previewText: data.postCaption,
    }),
    push: (data) => ({
      title: data.groupCount && data.groupCount > 1
        ? `${data.groupCount} people liked your post`
        : `${data.actorName} liked your post`,
      body: data.postCaption ? truncate(data.postCaption, 100) : "your post",
    }),
  },

  COMMENT: {
    inApp: (data) => ({
      title: `${data.actorName} commented on your post`,
      body: data.commentText ? truncate(data.commentText, 100) : "commented",
      previewText: data.commentText,
    }),
    push: (data) => ({
      title: `${data.actorName} commented`,
      body: data.commentText ? truncate(data.commentText, 120) : "on your post",
    }),
  },

  FOLLOW: {
    inApp: (data) => ({
      title: `${data.actorName} started following you`,
      body: `${data.actorUsername} is now following you`,
      previewText: "New follower",
    }),
    push: (data) => ({
      title: "New follower",
      body: `${data.actorName} (@${data.actorUsername}) started following you`,
    }),
  },

  FOLLOW_REQUEST: {
    inApp: (data) => ({
      title: `${data.actorName} requested to follow you`,
      body: `${data.actorUsername} wants to follow you`,
      previewText: "Follow request",
    }),
    push: (data) => ({
      title: "Follow request",
      body: `${data.actorName} (@${data.actorUsername}) requested to follow you`,
    }),
  },

  FOLLOW_ACCEPT: {
    inApp: (data) => ({
      title: `${data.actorName} accepted your follow request`,
      body: `You're now following ${data.actorUsername}`,
      previewText: "Follow accepted",
    }),
    push: (data) => ({
      title: "Follow request accepted",
      body: `${data.actorName} accepted your follow request`,
    }),
  },

  MENTION: {
    inApp: (data) => ({
      title: `${data.actorName} mentioned you`,
      body: data.mentionText ? truncate(data.mentionText, 100) : "in a comment",
      previewText: data.mentionText,
    }),
    push: (data) => ({
      title: `${data.actorName} mentioned you`,
      body: data.mentionText ? truncate(data.mentionText, 120) : "in a comment",
    }),
  },

  TAGGED_IN_POST: {
    inApp: (data) => ({
      title: `${data.actorName} tagged you in a post`,
      body: data.postCaption ? truncate(data.postCaption, 100) : "in a post",
      previewText: data.postCaption,
    }),
    push: (data) => ({
      title: `${data.actorName} tagged you in a post`,
      body: data.postCaption ? truncate(data.postCaption, 120) : "Check it out",
    }),
  },

  TAGGED_IN_COMMENT: {
    inApp: (data) => ({
      title: `${data.actorName} tagged you in a comment`,
      body: data.commentText ? truncate(data.commentText, 100) : "in a comment",
      previewText: data.commentText,
    }),
    push: (data) => ({
      title: `${data.actorName} tagged you in a comment`,
      body: data.commentText ? truncate(data.commentText, 120) : "Check it out",
    }),
  },

  TAGGED_IN_STORY: {
    inApp: (data) => ({
      title: `${data.actorName} mentioned you in their story`,
      body: "Tap to view their story",
      previewText: "Story mention",
    }),
    push: (data) => ({
      title: `${data.actorName} mentioned you in a story`,
      body: "Tap to view",
    }),
  },

  STORY_MENTION: {
    inApp: (data) => ({
      title: `${data.actorName} mentioned you in their story`,
      body: "Tap to view their story",
      previewText: "Story mention",
    }),
    push: (data) => ({
      title: `${data.actorName} mentioned you in a story`,
      body: "Tap to view",
    }),
  },

  STORY_REPLY: {
    inApp: (data) => ({
      title: `${data.actorName} replied to your story`,
      body: data.commentText ? truncate(data.commentText, 100) : "replied",
      previewText: data.commentText,
    }),
    push: (data) => ({
      title: `${data.actorName} replied to your story`,
      body: data.commentText ? truncate(data.commentText, 120) : "Story reply",
    }),
  },

  REEL_LIKE: {
    inApp: (data) => ({
      title: data.groupCount && data.groupCount > 1
        ? `${data.groupCount} people liked your reel`
        : `${data.actorName} liked your reel`,
      body: data.reelTitle ? truncate(data.reelTitle, 80) : "your reel",
      previewText: data.reelTitle,
    }),
    push: (data) => ({
      title: data.groupCount && data.groupCount > 1
        ? `${data.groupCount} people liked your reel`
        : `${data.actorName} liked your reel`,
      body: data.reelTitle ? truncate(data.reelTitle, 100) : "your reel",
    }),
  },

  REEL_COMMENT: {
    inApp: (data) => ({
      title: `${data.actorName} commented on your reel`,
      body: data.commentText ? truncate(data.commentText, 100) : "commented",
      previewText: data.commentText,
    }),
    push: (data) => ({
      title: `${data.actorName} commented on your reel`,
      body: data.commentText ? truncate(data.commentText, 120) : "Check it out",
    }),
  },

  LIVE_VIDEO: {
    inApp: (data) => ({
      title: `${data.actorName} started a live video`,
      body: data.reelTitle ? `"${data.reelTitle}"` : "Live now",
      previewText: "Live video started",
    }),
    push: (data) => ({
      title: `${data.actorName} is live!`,
      body: data.reelTitle ? `"${data.reelTitle}"` : "Join now",
    }),
  },

  LIVE_JOIN: {
    inApp: (data) => ({
      title: `${data.actorName} joined your live video`,
      body: `${data.actorUsername} is now watching`,
      previewText: "Viewer joined",
    }),
    push: (data) => ({
      title: `${data.actorName} joined your live`,
      body: `${data.actorUsername} is now watching`,
    }),
  },

  // Direct Messages
  DM_MESSAGE: {
    inApp: (data) => ({
      title: data.isGroupCall || data.groupName ? data.groupName || "Group chat" : data.actorName,
      body: data.dmPreview ? truncate(data.dmPreview, 100) : "New message",
      previewText: data.dmPreview,
    }),
    push: (data) => ({
      title: data.isGroupCall || data.groupName ? data.groupName || "Group chat" : data.actorName,
      body: data.dmPreview ? truncate(data.dmPreview, 120) : "New message",
    }),
  },

  DM_REACTION: {
    inApp: (data) => ({
      title: `${data.actorName} reacted to your message`,
      body: "with an emoji",
      previewText: "Message reaction",
    }),
    push: (data) => ({
      title: `${data.actorName} reacted`,
      body: "to your message",
    }),
  },

  // System
  POST_REMINDER: {
    inApp: (data) => ({
      title: "Post reminder",
      body: "You haven't posted in a while. Share something!",
      previewText: "Post reminder",
    }),
    push: (data) => ({
      title: "Post reminder",
      body: "Haven't posted in a while? Share something!",
    }),
  },

  ACHIEVEMENT: {
    inApp: (data) => ({
      title: "Achievement unlocked! 🏆",
      body: data.alertDetails || "You've reached a new milestone",
      previewText: "Achievement",
    }),
    push: (data) => ({
      title: "Achievement unlocked! 🏆",
      body: data.alertDetails || "New milestone reached",
    }),
  },

  SECURITY_ALERT: {
    inApp: (data) => ({
      title: "Security Alert 🔒",
      body: data.alertDetails || "Important security notification",
      previewText: data.alertDetails,
    }),
    push: (data) => ({
      title: "Security Alert",
      body: data.alertDetails || "Important security notification",
    }),
  },

  FEATURE_ANNOUNCEMENT: {
    inApp: (data) => ({
      title: "New Feature! ✨",
      body: data.alertDetails || "Check out what's new",
      previewText: "Feature announcement",
    }),
    push: (data) => ({
      title: "New Feature! ✨",
      body: data.alertDetails || "Check out what's new",
    }),
  },
};

/**
 * Notification Templates Service Class
 */
export class NotificationTemplatesService {
  /**
   * Format a notification for a specific channel (inApp or push)
   */
  format(
    type: NotificationType,
    data: NotificationTemplateData,
    channel: "inApp" | "push" = "inApp"
  ): FormattedNotification {
    const template = templates[type];
    if (!template) {
      return this.getDefaultFormat(type, data, channel);
    }

    const formatter = template[channel] || template.inApp;
    const formatted = formatter(data);

    return {
      title: formatted.title,
      body: formatted.body,
      previewText: formatted.previewText,
      thumbnailUrl: data.actorAvatarUrl || data.postThumbnailUrl || data.reelThumbnailUrl || data.storyThumbnailUrl,
      deepLink: this.generateDeepLink(type, data),
      category: this.getCategory(type),
      priority: this.getPriority(type),
      sound: this.getSound(type),
      apnsPayload: channel === "push" ? this.buildAPNSPayload(type, formatted, data) : undefined,
      fcmPayload: channel === "push" ? this.buildFCMPayload(type, formatted, data) : undefined,
    };
  }

  /**
   * Format for in-app notification
   */
  formatInApp(type: NotificationType, data: NotificationTemplateData): FormattedNotification {
    return this.format(type, data, "inApp");
  }

  /**
   * Format for push notification (APNs + FCM)
   */
  formatPush(type: NotificationType, data: NotificationTemplateData): FormattedNotification {
    return this.format(type, data, "push");
  }

  /**
   * Format for email notification
   */
  formatEmail(type: NotificationType, data: NotificationTemplateData): { subject: string; html: string; text: string } | null {
    const template = templates[type];
    if (!template?.email) return null;
    return template.email(data);
  }

  /**
   * Generate deep link for navigation
   */
  private generateDeepLink(type: NotificationType, data: NotificationTemplateData): string {
    const baseUrl = "instagram-clone://";

    switch (type) {
      case "LIKE":
      case "COMMENT":
      case "MENTION":
      case "TAGGED_IN_POST":
      case "TAGGED_IN_COMMENT":
        return data.referenceId
          ? `${baseUrl}post/${data.referenceId}`
          : `${baseUrl}activity`;

      case "FOLLOW":
      case "FOLLOW_REQUEST":
      case "FOLLOW_ACCEPT":
        return data.actorUsername
          ? `${baseUrl}profile/${data.actorUsername}`
          : `${baseUrl}activity`;

      case "TAGGED_IN_STORY":
      case "STORY_MENTION":
      case "STORY_REPLY":
        return data.referenceId
          ? `${baseUrl}story/${data.referenceId}`
          : `${baseUrl}stories`;

      case "REEL_LIKE":
      case "REEL_COMMENT":
        return data.referenceId
          ? `${baseUrl}reel/${data.referenceId}`
          : `${baseUrl}reels`;

      case "LIVE_VIDEO":
      case "LIVE_JOIN":
        return data.referenceId
          ? `${baseUrl}live/${data.referenceId}`
          : `${baseUrl}live`;

      case "DM_MESSAGE":
      case "DM_REACTION":
        return data.referenceId
          ? `${baseUrl}dm/${data.referenceId}`
          : `${baseUrl}dm`;

      case "POST_REMINDER":
        return `${baseUrl}create/post`;

      case "ACHIEVEMENT":
        return `${baseUrl}profile/me/achievements`;

      case "SECURITY_ALERT":
        return `${baseUrl}settings/security`;

      case "FEATURE_ANNOUNCEMENT":
        return `${baseUrl}settings/whats-new`;

      default:
        return `${baseUrl}activity`;
    }
  }

  /**
   * Get notification category
   */
  private getCategory(type: NotificationType): NotificationCategory {
    const categories: Record<NotificationType, NotificationCategory> = {
      LIKE: "social",
      COMMENT: "social",
      FOLLOW: "social",
      FOLLOW_REQUEST: "social",
      FOLLOW_ACCEPT: "social",
      MENTION: "social",
      TAGGED_IN_POST: "social",
      TAGGED_IN_COMMENT: "social",
      TAGGED_IN_STORY: "social",
      STORY_MENTION: "social",
      STORY_REPLY: "social",
      REEL_LIKE: "social",
      REEL_COMMENT: "social",
      LIVE_VIDEO: "live",
      LIVE_JOIN: "live",
      DM_MESSAGE: "message",
      DM_REACTION: "message",
      POST_REMINDER: "reminder",
      ACHIEVEMENT: "system",
      SECURITY_ALERT: "security",
      FEATURE_ANNOUNCEMENT: "system",
    };
    return categories[type] || "system";
  }

  /**
   * Get notification priority
   */
  private getPriority(type: NotificationType): NotificationPriority {
    const priorities: Record<NotificationType, NotificationPriority> = {
      LIKE: "normal",
      COMMENT: "normal",
      FOLLOW: "normal",
      FOLLOW_REQUEST: "normal",
      FOLLOW_ACCEPT: "normal",
      MENTION: "high",
      TAGGED_IN_POST: "high",
      TAGGED_IN_COMMENT: "high",
      TAGGED_IN_STORY: "high",
      STORY_MENTION: "high",
      STORY_REPLY: "high",
      REEL_LIKE: "normal",
      REEL_COMMENT: "normal",
      LIVE_VIDEO: "high",
      LIVE_JOIN: "normal",
      DM_MESSAGE: "high",
      DM_REACTION: "normal",
      POST_REMINDER: "low",
      ACHIEVEMENT: "normal",
      SECURITY_ALERT: "critical",
      FEATURE_ANNOUNCEMENT: "low",
    };
    return priorities[type] || "normal";
  }

  /**
   * Get notification sound
   */
  private getSound(type: NotificationType): string | undefined {
    const sounds: Partial<Record<NotificationType, string>> = {
      DM_MESSAGE: "default",
      LIVE_VIDEO: "default",
      SECURITY_ALERT: "alarm",
      FOLLOW_REQUEST: "default",
      MENTION: "default",
      TAGGED_IN_POST: "default",
      TAGGED_IN_STORY: "default",
      STORY_MENTION: "default",
      STORY_REPLY: "default",
    };
    return sounds[type];
  }

  /**
   * Build APNs payload
   */
  private buildAPNSPayload(
    type: NotificationType,
    formatted: { title: string; body: string },
    data: NotificationTemplateData
  ): APNSPayload {
    const category = this.getCategory(type);
    const priority = this.getPriority(type);

    return {
      aps: {
        alert: {
          title: formatted.title,
          body: formatted.body,
        },
        badge: undefined, // Set by server based on unread count
        sound: this.getSound(type) || "default",
        "content-available": priority === "critical" ? 1 : undefined,
        "mutable-content": 1,
        category,
        threadId: data.groupKey || data.referenceId,
      },
      notificationId: data.referenceId,
      type,
      deepLink: this.generateDeepLink(type, data),
      actorId: data.referenceId,
      referenceType: data.referenceType,
      referenceId: data.referenceId,
      groupKey: data.groupKey,
      groupCount: data.groupCount,
    };
  }

  /**
   * Build FCM payload
   */
  private buildFCMPayload(
    type: NotificationType,
    formatted: { title: string; body: string },
    data: NotificationTemplateData
  ): FCMPayload {
    const priority = this.getPriority(type);
    const category = this.getCategory(type);

    return {
      notification: {
        title: formatted.title,
        body: formatted.body,
        image: data.actorAvatarUrl,
        icon: "ic_notification",
        sound: this.getSound(type) || "default",
        tag: data.groupKey || data.referenceId,
        color: "#E1306C", // Instagram brand color
        clickAction: "FLUTTER_NOTIFICATION_CLICK",
      },
      data: {
        notificationId: data.referenceId || "",
        type,
        deepLink: this.generateDeepLink(type, data),
        actorId: data.referenceId || "",
        referenceType: data.referenceType || "",
        referenceId: data.referenceId || "",
        groupKey: data.groupKey || "",
        groupCount: (data.groupCount || 1).toString(),
      },
      android: {
        priority: priority === "critical" || priority === "high" ? "high" : "normal",
        notification: {
          channelId: this.getChannelId(category),
          priority: priority === "critical" ? "max" : priority === "high" ? "high" : "default",
          visibility: "public",
          category,
        },
      },
      apns: this.buildAPNSPayload(type, formatted, data),
    };
  }

  /**
   * Get Android notification channel ID
   */
  private getChannelId(category: NotificationCategory): string {
    const channels: Record<NotificationCategory, string> = {
      social: "social_notifications",
      message: "messages",
      call: "calls",
      live: "live_videos",
      security: "security_alerts",
      system: "system_notifications",
      reminder: "reminders",
    };
    return channels[category] || "default";
  }

  /**
   * Default format for unknown types
   */
  private getDefaultFormat(
    type: NotificationType,
    data: NotificationTemplateData,
    channel: "inApp" | "push"
  ): FormattedNotification {
    const title = data.actorName ? `${data.actorName} activity` : "New notification";
    const body = "You have a new notification";

    return {
      title,
      body,
      deepLink: `${"instagram-clone://"}activity`,
      category: "system",
      priority: "normal",
    };
  }
}

// Utility function
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

// Export singleton instance
export const notificationTemplates = new NotificationTemplatesService();