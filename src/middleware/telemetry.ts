import { createMiddleware } from "hono/factory";
import { env } from "../config/env";
import { randomUUID } from "crypto";
import { logger, createModuleLogger, logRequest, logDatabaseQuery, logError } from "../services/logger";

/**
 * Enhanced Telemetry Middleware
 *
 * Combines:
 * - Request ID generation/propagation (X-Request-ID)
 * - OpenTelemetry tracing with W3C TraceContext
 * - Structured JSON logging with Pino
 * - Prometheus metrics collection
 * - Database query logging
 * - Error tracking
 */

// ============================================================================
// Types
// ============================================================================

export interface TraceContext {
  traceId: string;
  spanId: string;
  traceFlags: string; // "01" = sampled
  tracestate?: string;
}

export interface RequestTraceInfo {
  requestId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  sampled: boolean;
  startTime: number;
  attributes: Record<string, any>;
}

export interface TelemetryMetrics {
  httpRequestsTotal: Counter;
  httpRequestDuration: Histogram;
  httpRequestsActive: UpDownCounter;
  dbQueryDuration: Histogram;
  dbPoolConnections: Gauge;
  wsConnectionsActive: Gauge;
  wsMessagesTotal: Counter;
}

// OpenTelemetry metric types (simplified for when OTel is not available)
type Counter = any;
type Histogram = any;
type UpDownCounter = any;
type Gauge = any;

// ============================================================================
// OpenTelemetry Setup (Lazy Initialization)
// ============================================================================

let tracer: any = null;
let meter: any = null;
let otelInitialized = false;
let otelModules: any = null;
let metrics: TelemetryMetrics | null = null;

interface OTelModules {
  NodeTracerProvider: any;
  SimpleSpanProcessor: any;
  BatchSpanProcessor: any;
  Resource: any;
  SemanticResourceAttributes: any;
  OTLPTraceExporter: any;
  OTLPMetricExporter: any;
  PeriodicExportingMetricReader: any;
  MeterProvider: any;
  trace: any;
  metrics: any;
  context: any;
  propagation: any;
  W3CTraceContextPropagator: any;
}

/**
 * Initialize OpenTelemetry SDK
 */
async function initializeOtel(): Promise<boolean> {
  if (otelInitialized) return !!tracer;

  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    console.log("[Telemetry] OTEL_EXPORTER_OTLP_ENDPOINT not set, skipping OpenTelemetry initialization");
    otelInitialized = true;
    return false;
  }

  try {
    const loadModule = async (name: string): Promise<any> => {
      try {
        const mod = await import(/* @vite-ignore */ /* webpackIgnore: true */ name);
        return mod;
      } catch {
        return null;
      }
    };

    const [
      sdkTraceNode,
      sdkTraceBase,
      resources,
      semanticConventions,
      exporterTraceOtlpHttp,
      exporterMetricsOtlpHttp,
      sdkMetrics,
      api,
      core,
    ] = await Promise.all([
      loadModule("@opentelemetry/sdk-trace-node"),
      loadModule("@opentelemetry/sdk-trace-base"),
      loadModule("@opentelemetry/resources"),
      loadModule("@opentelemetry/semantic-conventions"),
      loadModule("@opentelemetry/exporter-trace-otlp-http"),
      loadModule("@opentelemetry/exporter-metrics-otlp-http"),
      loadModule("@opentelemetry/sdk-metrics"),
      loadModule("@opentelemetry/api"),
      loadModule("@opentelemetry/core"),
    ]);

    if (!sdkTraceNode?.NodeTracerProvider || !sdkTraceBase?.SimpleSpanProcessor || !sdkTraceBase?.BatchSpanProcessor ||
        !resources?.Resource || !semanticConventions?.SemanticResourceAttributes || !exporterTraceOtlpHttp?.OTLPTraceExporter ||
        !exporterMetricsOtlpHttp?.OTLPMetricExporter || !sdkMetrics?.PeriodicExportingMetricReader || !sdkMetrics?.MeterProvider ||
        !api?.trace || !api?.metrics || !api?.context || !api?.propagation || !core?.W3CTraceContextPropagator) {
      console.warn("[Telemetry] OpenTelemetry packages not installed, using built-in metrics only");
      console.warn("[Telemetry] Install @opentelemetry/sdk-trace-node, @opentelemetry/sdk-trace-base, @opentelemetry/resources, @opentelemetry/semantic-conventions, @opentelemetry/exporter-trace-otlp-http, @opentelemetry/exporter-metrics-otlp-http, @opentelemetry/sdk-metrics, @opentelemetry/api, @opentelemetry/core to enable full OTel");
      otelInitialized = true;
      initializeBuiltInMetrics();
      return false;
    }

    otelModules = {
      NodeTracerProvider: sdkTraceNode.NodeTracerProvider,
      SimpleSpanProcessor: sdkTraceBase.SimpleSpanProcessor,
      BatchSpanProcessor: sdkTraceBase.BatchSpanProcessor,
      Resource: resources.Resource,
      SemanticResourceAttributes: semanticConventions.SemanticResourceAttributes,
      OTLPTraceExporter: exporterTraceOtlpHttp.OTLPTraceExporter,
      OTLPMetricExporter: exporterMetricsOtlpHttp.OTLPMetricExporter,
      PeriodicExportingMetricReader: sdkMetrics.PeriodicExportingMetricReader,
      MeterProvider: sdkMetrics.MeterProvider,
      trace: api.trace,
      metrics: api.metrics,
      context: api.context,
      propagation: api.propagation,
      W3CTraceContextPropagator: core.W3CTraceContextPropagator,
    };

    // Create resource
    const ResourceClass = otelModules.Resource;
    const resource = new ResourceClass({
      [otelModules.SemanticResourceAttributes.SERVICE_NAME]: env.OTEL_SERVICE_NAME || "instagram-clone-api",
      [otelModules.SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || "0.1.0",
      [otelModules.SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: env.NODE_ENV || "development",
    });

    // Create trace exporter
    const OTLPTraceExporterClass = otelModules.OTLPTraceExporter;
    const traceExporter = new OTLPTraceExporterClass({
      url: `${endpoint}/v1/traces`,
      headers: {},
    });

    // Create tracer provider
    const NodeTracerProviderClass = otelModules.NodeTracerProvider;
    const BatchSpanProcessorClass = otelModules.BatchSpanProcessor;
    const tracerProvider = new NodeTracerProviderClass({
      resource,
      spanProcessors: [
        new BatchSpanProcessorClass(traceExporter, {
          maxQueueSize: 2048,
          maxExportBatchSize: 512,
          scheduledDelayMillis: 5000,
          exportTimeoutMillis: 30000,
        }),
      ],
    });

    tracerProvider.register();
    tracer = tracerProvider.getTracer(env.OTEL_SERVICE_NAME || "instagram-clone-api");

    // Create metric exporter
    const OTLPMetricExporterClass = otelModules.OTLPMetricExporter;
    const metricExporter = new OTLPMetricExporterClass({
      url: `${endpoint}/v1/metrics`,
      headers: {},
    });

    // Create meter provider
    const PeriodicExportingMetricReaderClass = otelModules.PeriodicExportingMetricReader;
    const metricReader = new PeriodicExportingMetricReaderClass({
      exporter: metricExporter,
      exportIntervalMillis: 60000,
    });

    const MeterProviderClass = otelModules.MeterProvider;
    const meterProvider = new MeterProviderClass({
      resource,
      readers: [metricReader],
    });

    otelModules.metrics.setGlobalMeterProvider(meterProvider);
    meter = meterProvider.getMeter(env.OTEL_SERVICE_NAME || "instagram-clone-api");

    // Set global propagator for W3C TraceContext
    const W3CTraceContextPropagatorClass = otelModules.W3CTraceContextPropagator;
    otelModules.propagation.setGlobalPropagator(new W3CTraceContextPropagatorClass());

    // Initialize metrics
    initializeOtelMetrics();

    otelInitialized = true;
    console.log("[Telemetry] OpenTelemetry initialized successfully");
    return true;
  } catch (error) {
    console.error("[Telemetry] Failed to initialize OpenTelemetry:", error);
    otelInitialized = true;
    initializeBuiltInMetrics();
    return false;
  }
}

/**
 * Initialize OpenTelemetry metrics
 */
function initializeOtelMetrics(): void {
  if (!meter) return;

  try {
    metrics = {
      httpRequestsTotal: meter.createCounter("http_requests_total", {
        description: "Total number of HTTP requests",
        unit: "1",
      }),
      httpRequestDuration: meter.createHistogram("http_request_duration_ms", {
        description: "HTTP request latency in milliseconds",
        unit: "ms",
      }),
      httpRequestsActive: meter.createUpDownCounter("http_requests_active", {
        description: "Number of active HTTP requests",
        unit: "1",
      }),
      dbQueryDuration: meter.createHistogram("db_query_duration_ms", {
        description: "Database query latency in milliseconds",
        unit: "ms",
      }),
      dbPoolConnections: meter.createGauge("db_pool_connections", {
        description: "Database pool connections",
        unit: "1",
      }),
      wsConnectionsActive: meter.createGauge("ws_connections_active", {
        description: "Active WebSocket connections",
        unit: "1",
      }),
      wsMessagesTotal: meter.createCounter("ws_messages_total", {
        description: "Total WebSocket messages",
        unit: "1",
      }),
    };
  } catch (error) {
    console.error("[Telemetry] Failed to create OpenTelemetry metrics:", error);
  }
}

/**
 * Initialize built-in Prometheus-compatible metrics (fallback when OTel not available)
 */
let builtInMetrics: {
  httpRequestsTotal: Map<string, number>;
  httpRequestDurations: number[];
  httpRequestsActive: number;
  dbQueryDurations: number[];
  dbPoolConnections: { active: number; idle: number; waiting: number };
  wsConnectionsActive: number;
  wsMessagesTotal: { sent: number; received: number };
} = {
  httpRequestsTotal: new Map(),
  httpRequestDurations: [],
  httpRequestsActive: 0,
  dbQueryDurations: [],
  dbPoolConnections: { active: 0, idle: 0, waiting: 0 },
  wsConnectionsActive: 0,
  wsMessagesTotal: { sent: 0, received: 0 },
};

function initializeBuiltInMetrics(): void {
  // Built-in metrics are ready to use
  console.log("[Telemetry] Using built-in Prometheus metrics");
}

// Initialize on module load (non-blocking)
initializeOtel().catch(() => {});

// ============================================================================
// Request ID Middleware
// ============================================================================

export const requestIdMiddleware = createMiddleware(async (c, next) => {
  const requestId = c.req.header("x-request-id") || randomUUID();
  c.set("requestId", requestId);
  c.res.headers.set("x-request-id", requestId);
  await next();
});

export function getRequestId(c: any): string {
  return c.get("requestId") || "unknown";
}

// ============================================================================
// Tracing Middleware
// ============================================================================

export const tracingMiddleware = createMiddleware(async (c, next) => {
  const requestId = getRequestId(c);

  // Extract trace context from headers (W3C TraceContext)
  let parentContext: any = undefined;
  let traceId = "";
  let spanId = "";
  let sampled = false;
  let parentSpanId: string | undefined;

  if (otelModules?.propagation) {
    const carrier: Record<string, string> = {};
    const traceparent = c.req.header("traceparent");
    const tracestate = c.req.header("tracestate");

    if (traceparent) carrier["traceparent"] = traceparent;
    if (tracestate) carrier["tracestate"] = tracestate;

    if (Object.keys(carrier).length > 0) {
      parentContext = otelModules.propagation.extract(otelModules.context.active(), carrier);

      if (traceparent) {
        const parts = traceparent.split("-");
        if (parts.length >= 3) {
          traceId = parts[1];
          spanId = parts[2];
          sampled = parts[3] === "01";
        }
      }
    }
  }

  if (!traceId) traceId = randomUUID().replace(/-/g, "").substring(0, 32);
  if (!spanId) spanId = randomUUID().replace(/-/g, "").substring(0, 16);

  const traceInfo: RequestTraceInfo = {
    requestId,
    traceId,
    spanId,
    parentSpanId,
    sampled,
    startTime: Date.now(),
    attributes: {},
  };
  c.set("traceInfo", traceInfo);

  const traceparent = `00-${traceId}-${spanId}-${sampled ? "01" : "00"}`;
  c.res.headers.set("traceparent", traceparent);

  // Create OpenTelemetry span
  let span: any = null;
  let spanEnded = false;

  if (tracer && otelModules?.trace) {
    try {
      span = tracer.startSpan(
        `${c.req.method} ${c.req.path}`,
        {
          attributes: {
            "http.method": c.req.method,
            "http.url": c.req.url,
            "http.scheme": new URL(c.req.url).protocol.replace(":", ""),
            "http.target": c.req.path,
            "http.flavor": "1.1",
            "http.user_agent": c.req.header("user-agent") || "",
            "http.request_content_length": parseInt(c.req.header("content-length") || "0"),
            "net.host.port": new URL(c.req.url).port || (new URL(c.req.url).protocol === "https:" ? "443" : "80"),
            "request.id": requestId,
          },
        },
        parentContext
      );
      c.set("otelSpan", span);
    } catch (error) {
      console.error("[Telemetry] Failed to create span:", error);
    }
  }

  // Create request-scoped logger
  const requestLogger = logger.child({
    requestId,
    traceId,
    spanId,
    module: "http",
  });
  c.set("logger", requestLogger);

  // Increment active requests
  incrementActiveRequests(c, 1);

  try {
    await next();
  } catch (error) {
    if (span && !spanEnded) {
      span.recordException(error as Error);
      span.setStatus({ code: otelModules?.trace?.SpanStatusCode?.ERROR || 2, message: (error as Error).message });
      span.end();
      spanEnded = true;
    }
    // Log error
    logError(requestLogger, { error: error as Error, context: { requestId, traceId, spanId } });
    throw error;
  } finally {
    // End span
    if (span && !spanEnded) {
      const duration = Date.now() - traceInfo.startTime;

      span.setAttributes({
        "http.status_code": c.res.status,
        "http.response_content_length": parseInt(c.res.headers.get("content-length") || "0"),
        "http.duration_ms": duration,
      });

      if (c.res.status >= 500) {
        span.setStatus({ code: otelModules?.trace?.SpanStatusCode?.ERROR || 2 });
      } else if (c.res.status >= 400) {
        span.setStatus({ code: otelModules?.trace?.SpanStatusCode?.ERROR || 2, message: `HTTP ${c.res.status}` });
      } else {
        span.setStatus({ code: otelModules?.trace?.SpanStatusCode?.OK || 1 });
      }

      span.end();
      spanEnded = true;
    }

    // Record metrics
    const duration = Date.now() - traceInfo.startTime;
    c.res.headers.set("x-response-time", `${duration}ms`);
    recordHttpMetrics(c, duration);

    // Log request
    logRequest(requestLogger, {
      method: c.req.method,
      path: c.req.path,
      statusCode: c.res.status,
      durationMs: duration,
      userAgent: c.req.header("user-agent"),
      ip: c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For"),
      userId: c.get("user")?.id,
      requestId,
      traceId,
      spanId,
      requestSize: parseInt(c.req.header("content-length") || "0"),
      responseSize: parseInt(c.res.headers.get("content-length") || "0"),
    });

    // Decrement active requests
    incrementActiveRequests(c, -1);
  }
});

// ============================================================================
// Span Helpers
// ============================================================================

export function getTraceInfo(c: any): RequestTraceInfo | null {
  return c.get("traceInfo") || null;
}

export function getOtelSpan(c: any): any {
  return c.get("otelSpan") || null;
}

export function addSpanAttributes(c: any, attributes: Record<string, any>): void {
  const span = getOtelSpan(c);
  if (span) {
    span.setAttributes(attributes);
  }
  const traceInfo = getTraceInfo(c);
  if (traceInfo) {
    Object.assign(traceInfo.attributes, attributes);
  }
}

export function addSpanEvent(c: any, name: string, attributes?: Record<string, any>): void {
  const span = getOtelSpan(c);
  if (span) {
    span.addEvent(name, attributes);
  }
}

// ============================================================================
// Metrics Helpers
// ============================================================================

function sanitizeRoute(path: string): string {
  let sanitized = path.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:id");
  sanitized = sanitized.replace(/\/\d+/g, "/:id");
  return sanitized;
}

function recordHttpMetrics(c: any, durationMs: number): void {
  const route = sanitizeRoute(c.req.path);
  const method = c.req.method;
  const status = c.res.status.toString();
  const statusClass = `${status[0]}xx`;

  const attributes = { method, route, status, status_class: statusClass };

  if (metrics?.httpRequestsTotal) {
    metrics.httpRequestsTotal.add(1, attributes);
    metrics.httpRequestDuration?.record(durationMs, attributes);
  } else {
    // Built-in metrics
    const key = `${method}:${route}:${statusClass}`;
    builtInMetrics.httpRequestsTotal.set(key, (builtInMetrics.httpRequestsTotal.get(key) || 0) + 1);
    builtInMetrics.httpRequestDurations.push(durationMs);
    // Keep only last 10000 durations
    if (builtInMetrics.httpRequestDurations.length > 10000) {
      builtInMetrics.httpRequestDurations = builtInMetrics.httpRequestDurations.slice(-10000);
    }
  }
}

function incrementActiveRequests(c: any, delta: number): void {
  const route = sanitizeRoute(c.req.path);

  if (metrics?.httpRequestsActive) {
    metrics.httpRequestsActive.add(delta, { route });
  } else {
    builtInMetrics.httpRequestsActive += delta;
  }
}

/**
 * Record database query metrics
 */
export function recordDbQuery(c: any, query: string, durationMs: number, error?: Error): void {
  const queryType = query.trim().split(/\s+/)[0].toUpperCase();
  const tableMatch = query.match(/(?:FROM|INTO|UPDATE|JOIN)\s+(\w+)/i);
  const table = tableMatch ? tableMatch[1] : "unknown";

  const attributes = { query_type: queryType, table, error: error ? "true" : "false" };

  if (metrics?.dbQueryDuration) {
    metrics.dbQueryDuration.record(durationMs, attributes);
  } else {
    builtInMetrics.dbQueryDurations.push(durationMs);
    if (builtInMetrics.dbQueryDurations.length > 10000) {
      builtInMetrics.dbQueryDurations = builtInMetrics.dbQueryDurations.slice(-10000);
    }
  }

  // Log slow queries
  if (durationMs > 100 || error) {
    logDatabaseQuery(logger, query, durationMs, undefined, error);
  }
}

/**
 * Record WebSocket metrics
 */
export function recordWsConnection(delta: number): void {
  if (metrics?.wsConnectionsActive) {
    metrics.wsConnectionsActive.add(delta);
  } else {
    builtInMetrics.wsConnectionsActive += delta;
  }
}

export function recordWsMessage(direction: "sent" | "received", type: string): void {
  if (metrics?.wsMessagesTotal) {
    metrics.wsMessagesTotal.add(1, { direction, type });
  } else {
    if (direction === "sent") builtInMetrics.wsMessagesTotal.sent++;
    else builtInMetrics.wsMessagesTotal.received++;
  }
}

/**
 * Update database pool metrics
 */
export function updateDbPoolMetrics(active: number, idle: number, waiting: number): void {
  if (metrics?.dbPoolConnections) {
    metrics.dbPoolConnections.set(active, { state: "active" });
    metrics.dbPoolConnections.set(idle, { state: "idle" });
    metrics.dbPoolConnections.set(waiting, { state: "waiting" });
  } else {
    builtInMetrics.dbPoolConnections = { active, idle, waiting };
  }
}

// ============================================================================
// Prometheus Metrics Export
// ============================================================================

/**
 * Generate Prometheus-formatted metrics output
 */
export function generatePrometheusMetrics(): string {
  const lines: string[] = [];
  const now = Date.now();

  // HTTP Requests Total
  lines.push("# HELP http_requests_total Total number of HTTP requests");
  lines.push("# TYPE http_requests_total counter");

  if (metrics?.httpRequestsTotal) {
    // OTel metrics would be exported via OTLP, not here
    lines.push("# Metrics exported via OTLP to configured endpoint");
  } else {
    for (const [key, value] of builtInMetrics.httpRequestsTotal.entries()) {
      const [method, route, statusClass] = key.split(":");
      lines.push(`http_requests_total{method="${method}",route="${route}",status_class="${statusClass}"} ${value}`);
    }
  }
  lines.push("");

  // HTTP Request Duration (histogram)
  lines.push("# HELP http_request_duration_ms HTTP request latency in milliseconds");
  lines.push("# TYPE http_request_duration_ms histogram");

  if (builtInMetrics.httpRequestDurations.length > 0) {
    const durations = builtInMetrics.httpRequestDurations.sort((a, b) => a - b);
    const count = durations.length;
    const sum = durations.reduce((a, b) => a + b, 0);
    const buckets = [50, 100, 200, 500, 1000, 2000, 5000, 10000];

    for (const bucket of buckets) {
      const countInBucket = durations.filter(d => d <= bucket).length;
      lines.push(`http_request_duration_ms_bucket{le="${bucket}"} ${countInBucket}`);
    }
    lines.push(`http_request_duration_ms_bucket{le="+Inf"} ${count}`);
    lines.push(`http_request_duration_ms_sum ${sum}`);
    lines.push(`http_request_duration_ms_count ${count}`);
  } else {
    lines.push("http_request_duration_ms_bucket{le=\"50\"} 0");
    lines.push("http_request_duration_ms_bucket{le=\"100\"} 0");
    lines.push("http_request_duration_ms_bucket{le=\"200\"} 0");
    lines.push("http_request_duration_ms_bucket{le=\"500\"} 0");
    lines.push("http_request_duration_ms_bucket{le=\"1000\"} 0");
    lines.push("http_request_duration_ms_bucket{le=\"2000\"} 0");
    lines.push("http_request_duration_ms_bucket{le=\"5000\"} 0");
    lines.push("http_request_duration_ms_bucket{le=\"10000\"} 0");
    lines.push("http_request_duration_ms_bucket{le=\"+Inf\"} 0");
    lines.push("http_request_duration_ms_sum 0");
    lines.push("http_request_duration_ms_count 0");
  }
  lines.push("");

  // Active Requests
  lines.push("# HELP http_requests_active Number of active HTTP requests");
  lines.push("# TYPE http_requests_active gauge");
  lines.push(`http_requests_active ${builtInMetrics.httpRequestsActive}`);
  lines.push("");

  // Database Query Duration
  lines.push("# HELP db_query_duration_ms Database query latency in milliseconds");
  lines.push("# TYPE db_query_duration_ms histogram");

  if (builtInMetrics.dbQueryDurations.length > 0) {
    const durations = builtInMetrics.dbQueryDurations.sort((a, b) => a - b);
    const count = durations.length;
    const sum = durations.reduce((a, b) => a + b, 0);
    const buckets = [10, 50, 100, 200, 500, 1000, 2000, 5000];

    for (const bucket of buckets) {
      const countInBucket = durations.filter(d => d <= bucket).length;
      lines.push(`db_query_duration_ms_bucket{le="${bucket}"} ${countInBucket}`);
    }
    lines.push(`db_query_duration_ms_bucket{le="+Inf"} ${count}`);
    lines.push(`db_query_duration_ms_sum ${sum}`);
    lines.push(`db_query_duration_ms_count ${count}`);
  } else {
    const buckets = [10, 50, 100, 200, 500, 1000, 2000, 5000];
    for (const bucket of buckets) {
      lines.push(`db_query_duration_ms_bucket{le="${bucket}"} 0`);
    }
    lines.push("db_query_duration_ms_bucket{le=\"+Inf\"} 0");
    lines.push("db_query_duration_ms_sum 0");
    lines.push("db_query_duration_ms_count 0");
  }
  lines.push("");

  // Database Pool Connections
  lines.push("# HELP db_pool_connections Database pool connections");
  lines.push("# TYPE db_pool_connections gauge");
  lines.push(`db_pool_connections{state="active"} ${builtInMetrics.dbPoolConnections.active}`);
  lines.push(`db_pool_connections{state="idle"} ${builtInMetrics.dbPoolConnections.idle}`);
  lines.push(`db_pool_connections{state="waiting"} ${builtInMetrics.dbPoolConnections.waiting}`);
  lines.push("");

  // WebSocket Connections
  lines.push("# HELP ws_connections_active Active WebSocket connections");
  lines.push("# TYPE ws_connections_active gauge");
  lines.push(`ws_connections_active ${builtInMetrics.wsConnectionsActive}`);
  lines.push("");

  // WebSocket Messages
  lines.push("# HELP ws_messages_total Total WebSocket messages");
  lines.push("# TYPE ws_messages_total counter");
  lines.push(`ws_messages_total{direction="sent"} ${builtInMetrics.wsMessagesTotal.sent}`);
  lines.push(`ws_messages_total{direction="received"} ${builtInMetrics.wsMessagesTotal.received}`);
  lines.push("");

  // Process metrics
  const memUsage = process.memoryUsage();
  lines.push("# HELP process_memory_bytes Process memory usage in bytes");
  lines.push("# TYPE process_memory_bytes gauge");
  lines.push(`process_memory_bytes{type="rss"} ${memUsage.rss}`);
  lines.push(`process_memory_bytes{type="heap_used"} ${memUsage.heapUsed}`);
  lines.push(`process_memory_bytes{type="heap_total"} ${memUsage.heapTotal}`);
  lines.push(`process_memory_bytes{type="external"} ${memUsage.external}`);
  lines.push("");

  lines.push("# HELP process_uptime_seconds Process uptime in seconds");
  lines.push("# TYPE process_uptime_seconds gauge");
  lines.push(`process_uptime_seconds ${process.uptime()}`);
  lines.push("");

  lines.push("# HELP nodejs_version_info Node.js version info");
  lines.push("# TYPE nodejs_version_info gauge");
  lines.push(`nodejs_version_info{version="${process.version}"} 1`);
  lines.push("");

  return lines.join("\n");
}

// ============================================================================
// Combined Middleware
// ============================================================================

/**
 * Combined telemetry middleware including request ID, tracing, logging, and metrics
 */
export const telemetry = createMiddleware(async (c, next) => {
  // Request ID
  const requestId = c.req.header("x-request-id") || randomUUID();
  c.set("requestId", requestId);
  c.res.headers.set("x-request-id", requestId);

  // Extract trace context
  let parentContext: any = undefined;
  let traceId = "";
  let spanId = "";
  let sampled = false;
  let parentSpanId: string | undefined;

  if (otelModules?.propagation) {
    const carrier: Record<string, string> = {};
    const traceparent = c.req.header("traceparent");
    const tracestate = c.req.header("tracestate");

    if (traceparent) carrier["traceparent"] = traceparent;
    if (tracestate) carrier["tracestate"] = tracestate;

    if (Object.keys(carrier).length > 0) {
      parentContext = otelModules.propagation.extract(otelModules.context.active(), carrier);
      const parts = traceparent?.split("-");
      if (parts && parts.length >= 3) {
        traceId = parts[1];
        spanId = parts[2];
        sampled = parts[3] === "01";
      }
    }
  }

  if (!traceId) traceId = randomUUID().replace(/-/g, "").substring(0, 32);
  if (!spanId) spanId = randomUUID().replace(/-/g, "").substring(0, 16);

  const traceInfo: RequestTraceInfo = {
    requestId,
    traceId,
    spanId,
    parentSpanId,
    sampled,
    startTime: Date.now(),
    attributes: {},
  };
  c.set("traceInfo", traceInfo);

  const traceparent = `00-${traceId}-${spanId}-${sampled ? "01" : "00"}`;
  c.res.headers.set("traceparent", traceparent);

  // Create span
  let span: any = null;
  let spanEnded = false;

  if (tracer) {
    try {
      span = tracer.startSpan(
        `${c.req.method} ${c.req.path}`,
        {
          attributes: {
            "http.method": c.req.method,
            "http.url": c.req.url,
            "http.scheme": new URL(c.req.url).protocol.replace(":", ""),
            "http.target": c.req.path,
            "http.flavor": "1.1",
            "http.user_agent": c.req.header("user-agent") || "",
            "http.request_content_length": parseInt(c.req.header("content-length") || "0"),
            "net.host.port": new URL(c.req.url).port || (new URL(c.req.url).protocol === "https:" ? "443" : "80"),
            "request.id": requestId,
          },
        },
        parentContext
      );
      c.set("otelSpan", span);
    } catch (error) {
      console.error("[Telemetry] Failed to create span:", error);
    }
  }

  // Logger
  const requestLogger = logger.child({
    requestId,
    traceId,
    spanId,
    module: "http",
  });
  c.set("logger", requestLogger);

  // Increment active requests
  incrementActiveRequests(c, 1);

  try {
    await next();
  } catch (error) {
    if (span && !spanEnded) {
      span.recordException(error as Error);
      span.setStatus({ code: otelModules?.trace?.SpanStatusCode?.ERROR || 2, message: (error as Error).message });
      span.end();
      spanEnded = true;
    }
    logError(requestLogger, { error: error as Error, context: { requestId, traceId, spanId } });
    throw error;
  } finally {
    // End span
    if (span && !spanEnded) {
      const duration = Date.now() - traceInfo.startTime;

      span.setAttributes({
        "http.status_code": c.res.status,
        "http.response_content_length": parseInt(c.res.headers.get("content-length") || "0"),
        "http.duration_ms": duration,
      });

      if (c.res.status >= 500) {
        span.setStatus({ code: otelModules?.trace?.SpanStatusCode?.ERROR || 2 });
      } else if (c.res.status >= 400) {
        span.setStatus({ code: otelModules?.trace?.SpanStatusCode?.ERROR || 2, message: `HTTP ${c.res.status}` });
      } else {
        span.setStatus({ code: otelModules?.trace?.SpanStatusCode?.OK || 1 });
      }

      span.end();
      spanEnded = true;
    }

    // Record metrics
    const duration = Date.now() - traceInfo.startTime;
    c.res.headers.set("x-response-time", `${duration}ms`);
    recordHttpMetrics(c, duration);

    // Log request
    logRequest(requestLogger, {
      method: c.req.method,
      path: c.req.path,
      statusCode: c.res.status,
      durationMs: duration,
      userAgent: c.req.header("user-agent"),
      ip: c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For"),
      userId: c.get("user")?.id,
      requestId,
      traceId,
      spanId,
      requestSize: parseInt(c.req.header("content-length") || "0"),
      responseSize: parseInt(c.res.headers.get("content-length") || "0"),
    });

    // Decrement active requests
    incrementActiveRequests(c, -1);
  }
});

export { tracer, meter, metrics };

// Re-export logger functions for convenience
export { logger, createModuleLogger, logRequest, logDatabaseQuery, logError } from "../services/logger";