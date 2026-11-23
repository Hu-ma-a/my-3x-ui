const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level = 'info') {
  const min = LEVELS[level] ?? LEVELS.info;
  const emit = (kind, args) => {
    if ((LEVELS[kind] ?? 99) < min) return;
    const line = `${new Date().toISOString()} ${kind.toUpperCase()} ${args.map(format).join(' ')}`;
    if (kind === 'error') console.error(line);
    else if (kind === 'warn') console.warn(line);
    else console.log(line);
  };
  return {
    level,
    debug: (...args) => emit('debug', args),
    info: (...args) => emit('info', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
  };
}

function format(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
