type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
type LogData = Record<string, unknown> & { userId?: never };

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const resolveLevel = (): LogLevel => {
  const raw = process.env.LOG_LEVEL?.toUpperCase();
  return raw && raw in LEVEL_PRIORITY ? (raw as LogLevel) : 'INFO';
};

const shouldLog = (level: LogLevel): boolean =>
  LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[resolveLevel()];

const log = (level: LogLevel, data: LogData): void => {
  if (!shouldLog(level)) return;
  const entry = { level, timestamp: new Date().toISOString(), ...data };
  const line = JSON.stringify(entry);
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);
};

export const logger = {
  debug: (data: LogData) => log('DEBUG', data),
  info: (data: LogData) => log('INFO', data),
  warn: (data: LogData) => log('WARN', data),
  error: (data: LogData) => log('ERROR', data),
};
