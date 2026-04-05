type LogLevel = 'INFO' | 'WARN' | 'ERROR';
type LogData = Record<string, unknown> & { userId?: never };

const log = (level: LogLevel, data: LogData) => {
  const entry = { level, timestamp: new Date().toISOString(), ...data };
  console.log(JSON.stringify(entry));
};

export const logger = {
  info: (data: LogData) => log('INFO', data),
  warn: (data: LogData) => log('WARN', data),
  error: (data: LogData) => log('ERROR', data),
};
