import { env } from 'node:process' 
import { createConsola, LogLevels, type LogLevel } from 'consola'

function parseLogLevel(): LogLevel {
  const envLogLevel = env.LOG_LEVEL

  if (!envLogLevel) {
    return LogLevels.info
  }

  if (envLogLevel in LogLevels) {
    return LogLevels[envLogLevel as keyof typeof LogLevels] as LogLevel
  }

  const numericLevel = Number(envLogLevel)
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
