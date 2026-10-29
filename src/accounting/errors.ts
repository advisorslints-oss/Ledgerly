export type AccountingErrorCode = 'invalid' | 'locked' | 'not_found' | 'conflict'

/** An expected, user-facing failure: the message is safe to show as-is. */
export class AccountingError extends Error {
  code: AccountingErrorCode

  constructor(message: string, code: AccountingErrorCode = 'invalid') {
    super(message)
    this.name = 'AccountingError'
    this.code = code
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof AccountingError) return err.message
  if (err instanceof Error) return `Something went wrong: ${err.message}`
  return 'Something went wrong.'
}
