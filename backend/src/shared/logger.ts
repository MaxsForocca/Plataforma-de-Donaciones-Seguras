/**
 * Logger JSON estructurado (T018). Usa una lista blanca de campos: cualquier otro dato (tokens,
 * `donorSub`, cabeceras, cuerpos, claves de idempotencia) se descarta, de modo que los logs no
 * puedan contener secretos ni datos personales (constitución, principio I).
 */
export type LogLevel = "info" | "warn" | "error";

export interface LogFields {
  action: string;
  result: "success" | "denied" | "error";
  statusCode?: number;
  durationMs?: number;
  errorCode?: string;
}

export interface LogEntry extends LogFields {
  level: LogLevel;
  timestamp: string;
  requestId: string;
}

export type LogSink = (line: string) => void;

const ALLOWED_KEYS = ["action", "result", "statusCode", "durationMs", "errorCode"] as const;

export interface Logger {
  readonly requestId: string;
  info(fields: LogFields): LogEntry;
  warn(fields: LogFields): LogEntry;
  error(fields: LogFields): LogEntry;
  /** Inicia un cronómetro; la función devuelta entrega la duración en milisegundos. */
  startTimer(): () => number;
}

export interface LoggerOptions {
  sink?: LogSink;
  now?: () => Date;
  clock?: () => number;
}

export function createLogger(requestId: string, options: LoggerOptions = {}): Logger {
  const sink = options.sink ?? ((line: string) => console.log(line));
  const now = options.now ?? (() => new Date());
  const clock = options.clock ?? (() => performance.now());

  const write = (level: LogLevel, fields: LogFields): LogEntry => {
    const safe: Partial<LogFields> = {};
    for (const key of ALLOWED_KEYS) {
      const value = (fields as unknown as Record<string, unknown>)[key];
      if (value !== undefined) (safe as Record<string, unknown>)[key] = value;
    }
    const entry = {
      level,
      timestamp: now().toISOString(),
      requestId,
      ...safe,
    } as LogEntry;
    sink(JSON.stringify(entry));
    return entry;
  };

  return {
    requestId,
    info: (fields) => write("info", fields),
    warn: (fields) => write("warn", fields),
    error: (fields) => write("error", fields),
    startTimer: () => {
      const start = clock();
      return () => Math.round(clock() - start);
    },
  };
}
