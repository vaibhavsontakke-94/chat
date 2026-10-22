export type ProviderErrorCode =
  | 'not_configured'
  | 'bad_request'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'provider_error'
  | 'network_error'

/** An error that is safe to surface to the browser (never contains secrets). */
export class ProviderError extends Error {
  readonly status: number
  readonly code: ProviderErrorCode

  constructor(status: number, code: ProviderErrorCode, message: string) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
    this.code = code
  }
}

export class HttpError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}
