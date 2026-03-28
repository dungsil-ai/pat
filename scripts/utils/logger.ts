import { env } from 'node:process'
import { createConsola, LogLevels, type LogLevel } from 'consola'

export function parseLogLevel(envLogLevel = env.LOG_LEVEL): LogLevel {
  const normalizedLogLevel = envLogLevel?.trim().toLowerCase()

  if (!normalizedLogLevel) {
    return LogLevels.info
  }

  if (Object.hasOwn(LogLevels, normalizedLogLevel)) {
    return LogLevels[normalizedLogLevel as keyof typeof LogLevels] as LogLevel
  }

  const numericLevel = Number(normalizedLogLevel)
  if (Number.isFinite(numericLevel)) {
    return numericLevel as LogLevel
  }

  return LogLevels.info
}

export const log = createConsola({
  formatOptions: {
    colors: true,
  },
  level: parseLogLevel(),
})
