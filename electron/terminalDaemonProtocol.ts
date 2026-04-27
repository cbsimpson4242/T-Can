export interface TerminalDaemonRequestMessage {
  id: string
  token: string
  type: string
  payload?: unknown
}

export interface TerminalDaemonResponseMessage {
  id: string
  ok: boolean
  result?: unknown
  error?: string
}

export function buildTerminalDaemonErrorResponse(
  request: Pick<TerminalDaemonRequestMessage, 'id'> | null | undefined,
  error: unknown,
): TerminalDaemonResponseMessage {
  return {
    id: request?.id ?? 'unknown',
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }
}
