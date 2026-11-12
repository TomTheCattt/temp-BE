/**
 * Network Detection Utilities
 *
 * Provides network type detection (WiFi, Cellular, Unknown) for adaptive heartbeat intervals.
 * On native platforms (iOS/Android), this would use platform-specific APIs:
 * - iOS: NWPathMonitor
 * - Android: ConnectivityManager / NetworkCallback
 * - Web: navigator.connection (Network Information API)
 *
 * For Node.js/Neon Functions server-side, we infer from headers or use a fallback.
 */

// Extend Navigator interface for web APIs not in TypeScript lib
interface NetworkInformation {
  effectiveType?: string;
  type?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
}

interface NavigatorWithNetwork extends Navigator {
  onLine: boolean;
  connection?: NetworkInformation;
}

export type NetworkType = "wifi" | "cellular" | "unknown" | "ethernet" | "none";

/**
 * Network information interface
 */
export interface NetworkInfo {
  type: NetworkType;
  effectiveType?: "2g" | "3g" | "4g" | "5g" | "slow-2g";
  downlink?: number;      // Mbps
  rtt?: number;           // Round-trip time in ms
  saveData?: boolean;     // Data saver mode
  isOnline: boolean;
}

/**
 * Network change callback
 */
export type NetworkChangeCallback = (info: NetworkInfo) => void;

/**
 * NetworkDetector - Platform-agnostic network detection
 *
 * On the server (Neon Functions), we can't directly detect client network.
 * This utility provides:
 * 1. Server-side inference from headers
 * 2. Client-side interface for native platforms
 * 3. Type definitions for cross-platform use
 */
export class NetworkDetector {
  private currentInfo: NetworkInfo;
  private listeners: Set<NetworkChangeCallback> = new Set();
  private pollInterval?: ReturnType<typeof setInterval>;

  constructor() {
    this.currentInfo = this.getDefaultInfo();
  }

  /**
   * Get default network info (unknown)
   */
  private getDefaultInfo(): NetworkInfo {
    return {
      type: "unknown",
      isOnline: true,
    };
  }

  /**
   * Infer network type from request headers (server-side)
   * Uses headers that might be set by CDN/proxy
   */
  static inferFromHeaders(headers: Record<string, string | undefined>): NetworkInfo {
    // Check for common CDN/proxy headers that indicate network type
    const connectionType = headers["x-connection-type"] ||
                          headers["x-network-type"] ||
                          headers["cf-connection-type"] ||
                          headers["x-forwarded-network-type"];

    if (connectionType) {
      const type = connectionType.toLowerCase();
      if (type.includes("wifi") || type === "wlan") {
        return { type: "wifi", isOnline: true };
      }
      if (type.includes("cellular") || type.includes("mobile") || type.includes("4g") || type.includes("5g") || type.includes("3g")) {
        return { type: "cellular", isOnline: true };
      }
      if (type.includes("ethernet") || type === "wired") {
        return { type: "ethernet", isOnline: true };
      }
    }

    // Check for save-data header (data saver mode)
    const saveData = headers["save-data"] === "on";

    // Check for effective connection type (Client Hints)
    const effectiveType = headers["x-effective-connection-type"] ||
                         headers["ect"] as "2g" | "3g" | "4g" | "5g" | "slow-2g" | undefined;

    // Check downlink (Client Hints)
    const downlinkHeader = headers["x-downlink"] || headers["downlink"];
    const downlink = downlinkHeader ? parseFloat(downlinkHeader) : undefined;

    // Check RTT (Client Hints)
    const rttHeader = headers["x-rtt"] || headers["rtt"];
    const rtt = rttHeader ? parseInt(rttHeader, 10) : undefined;

    // Infer from effective type
    let inferredType: NetworkType = "unknown";
    if (effectiveType) {
      if (["4g", "5g"].includes(effectiveType)) {
        inferredType = "cellular"; // Could be WiFi too, but treat as cellular for conservative intervals
      } else if (["2g", "3g", "slow-2g"].includes(effectiveType)) {
        inferredType = "cellular";
      }
    }

    // If we have downlink, we can make better guess
    if (downlink !== undefined) {
      if (downlink > 10) {
        // High bandwidth - could be WiFi or good cellular
        inferredType = inferredType === "unknown" ? "wifi" : inferredType;
      } else if (downlink < 1) {
        inferredType = "cellular";
      }
    }

    return {
      type: inferredType,
      effectiveType: effectiveType as "2g" | "3g" | "4g" | "5g" | "slow-2g" | undefined,
      downlink,
      rtt,
      saveData,
      isOnline: true,
    };
  }

  /**
   * Update network info (called from client or when headers change)
   */
  update(info: Partial<NetworkInfo>): void {
    const newInfo: NetworkInfo = {
      ...this.currentInfo,
      ...info,
    };

    // Only notify if type changed
    if (newInfo.type !== this.currentInfo.type) {
      console.log(`[NetworkDetector] Network type changed: ${this.currentInfo.type} -> ${newInfo.type}`);
    }

    this.currentInfo = newInfo;
    this.notifyListeners();
  }

  /**
   * Get current network info
   */
  getCurrentInfo(): NetworkInfo {
    return { ...this.currentInfo };
  }

  /**
   * Get current network type (simplified)
   */
  getNetworkType(): NetworkType {
    return this.currentInfo.type;
  }

  /**
   * Check if on cellular (for aggressive intervals)
   */
  isCellular(): boolean {
    return this.currentInfo.type === "cellular";
  }

  /**
   * Check if on WiFi
   */
  isWifi(): boolean {
    return this.currentInfo.type === "wifi";
  }

  /**
   * Check if data saver is enabled
   */
  isDataSaverEnabled(): boolean {
    return this.currentInfo.saveData === true;
  }

  /**
   * Check if online
   */
  isOnline(): boolean {
    return this.currentInfo.isOnline;
  }

  /**
   * Subscribe to network changes
   */
  subscribe(callback: NetworkChangeCallback): () => void {
    this.listeners.add(callback);
    // Immediately call with current state
    callback(this.currentInfo);

    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Notify all listeners
   */
  private notifyListeners(): void {
    Array.from(this.listeners).forEach((listener) => {
      try {
        listener(this.currentInfo);
      } catch (error) {
        console.error("[NetworkDetector] Listener error:", error);
      }
    });
  }

  /**
   * Start polling for network changes (for environments without native APIs)
   * This is a fallback - native platforms should use their own APIs
   */
  startPolling(intervalMs: number = 30_000): void {
    if (this.pollInterval) return;

    this.pollInterval = setInterval(() => {
      // In a real implementation, this would check actual network state
      // For server-side, we can't really poll client network
      // This is a placeholder for client-side implementations
    }, intervalMs);

    this.pollInterval.unref?.();
  }

  /**
   * Stop polling
   */
  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
  }
}

/**
 * Client-side network detector interface
 * To be implemented per platform (iOS, Android, Web)
 */
export interface ClientNetworkDetector {
  /** Start monitoring network changes */
  start(): void;
  /** Stop monitoring */
  stop(): void;
  /** Get current network info */
  getCurrentInfo(): NetworkInfo;
  /** Subscribe to changes */
  subscribe(callback: NetworkChangeCallback): () => void;
}

/**
 * iOS Network Detector using NWPathMonitor (to be implemented in Swift)
 * This is a reference implementation - actual iOS code would be in Swift
 */
export interface IOSNetworkDetectorConfig {
  /** Queue for NWPathMonitor callbacks */
  queue?: any; // DispatchQueue in Swift
  /** Required interface types (e.g., .wifi, .cellular) */
  requiredInterfaceTypes?: string[];
}

/**
 * Android Network Detector using ConnectivityManager (to be implemented in Kotlin)
 * This is a reference implementation - actual Android code would be in Kotlin
 */
export interface AndroidNetworkDetectorConfig {
  /** Context for ConnectivityManager */
  context: any; // Context in Kotlin
  /** Network capabilities to monitor */
  capabilities?: any; // NetworkCapabilities in Kotlin
}

/**
 * Web Network Detector using Network Information API
 */
export class WebNetworkDetector implements ClientNetworkDetector {
  private listeners: Set<NetworkChangeCallback> = new Set();
  private currentInfo: NetworkInfo;
  private onChangeHandler?: (event: Event) => void;

  constructor() {
    this.currentInfo = this.getNetworkInfo();
  }

  start(): void {
    if (typeof navigator === "undefined" || !(navigator as any).connection) {
      console.warn("[WebNetworkDetector] Network Information API not available");
      return;
    }

    const connection = (navigator as any).connection;

    this.onChangeHandler = () => {
      this.currentInfo = this.getNetworkInfo();
      this.notifyListeners();
    };

    connection.addEventListener("change", this.onChangeHandler);
  }

  stop(): void {
    if (typeof navigator !== "undefined" && (navigator as any).connection && this.onChangeHandler) {
      (navigator as any).connection.removeEventListener("change", this.onChangeHandler);
      this.onChangeHandler = undefined;
    }
  }

  getCurrentInfo(): NetworkInfo {
    return this.getNetworkInfo();
  }

  subscribe(callback: NetworkChangeCallback): () => void {
    this.listeners.add(callback);
    callback(this.currentInfo);

    return () => {
      this.listeners.delete(callback);
    };
  }

  private getNetworkInfo(): NetworkInfo {
    const nav = navigator as NavigatorWithNetwork;
    if (typeof navigator === "undefined" || !nav.connection) {
      return {
        type: "unknown",
        isOnline: nav?.onLine ?? true,
      };
    }

    const connection = nav.connection!;
    const type = this.mapConnectionType(connection.effectiveType || connection.type);

    return {
      type,
      effectiveType: connection.effectiveType as "2g" | "3g" | "4g" | "5g" | "slow-2g" | undefined,
      downlink: connection.downlink,
      rtt: connection.rtt,
      saveData: connection.saveData,
      isOnline: nav.onLine,
    };
  }

  private mapConnectionType(effectiveType?: string): NetworkType {
    if (!effectiveType) return "unknown";

    switch (effectiveType) {
      case "slow-2g":
      case "2g":
      case "3g":
      case "4g":
      case "5g":
        return "cellular";
      case "wifi":
      case "ethernet":
        return effectiveType;
      default:
        return "unknown";
    }
  }

  private notifyListeners(): void {
    Array.from(this.listeners).forEach((listener) => {
      try {
        listener(this.currentInfo);
      } catch (error) {
        console.error("[WebNetworkDetector] Listener error:", error);
      }
    });
  }
}

/**
 * Server-side network detector (for Neon Functions)
 * Infers network type from request headers
 */
export class ServerNetworkDetector extends NetworkDetector {
  /**
   * Update from request headers
   */
  updateFromRequest(request: Request): void {
    const headers: Record<string, string | undefined> = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    const info = NetworkDetector.inferFromHeaders(headers);
    this.update(info);
  }
}

// Export singleton instances
export const networkDetector = new NetworkDetector();
export const serverNetworkDetector = new ServerNetworkDetector();

/**
 * Create appropriate network detector for platform
 */
export function createNetworkDetector(platform: "server" | "web" | "ios" | "android"): ClientNetworkDetector | NetworkDetector {
  switch (platform) {
    case "server":
      return new ServerNetworkDetector();
    case "web":
      return new WebNetworkDetector();
    case "ios":
      // Would return iOS native implementation
      console.warn("[NetworkDetector] iOS detector not implemented in TypeScript");
      return new NetworkDetector();
    case "android":
      // Would return Android native implementation
      console.warn("[NetworkDetector] Android detector not implemented in TypeScript");
      return new NetworkDetector();
    default:
      return new NetworkDetector();
  }
}