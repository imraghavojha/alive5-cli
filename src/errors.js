// Error type, HTTP status mapping, and the JSON envelope. Every failure the CLI
// reports passes through here, so codes and exit statuses stay consistent.

export class CliError extends Error {
  constructor(code, message, exitCode = 1, extra = {}) {
    super(message);
    Object.assign(this, { code, exitCode, ...extra });
  }
}

export const EXIT = {
  ok: 0,
  local: 1,
  usage: 2,
  auth: 3,
  api: 4,
  rateLimited: 5,
  cancelled: 130,
};

export const EXIT_CODES = {
  0: 'success',
  1: 'local error',
  2: 'invalid arguments or confirmation required',
  3: 'authentication',
  4: 'API or network error',
  5: 'rate limited',
  130: 'cancelled',
};

/** One place that decides how an HTTP status becomes a code and an exit status. */
export function httpError(status, message) {
  const auth = status === 401 || status === 403;
  const limited = status === 429;
  return new CliError(
    auth ? 'AUTH_FAILED' : limited ? 'RATE_LIMITED' : 'API_ERROR',
    message,
    auth ? EXIT.auth : limited ? EXIT.rateLimited : EXIT.api,
    { status },
  );
}

export const usage = (message) => new CliError('INVALID_ARGUMENT', message, EXIT.usage);

export const envelope = (data, meta = {}) => ({
  ok: true,
  data,
  error: null,
  meta: { schemaVersion: 1, ...meta },
});

export const failure = (e) => ({
  ok: false,
  data: null,
  error: {
    code: e.code || 'INTERNAL_ERROR',
    message: e.message,
    retryable: e.retryable || false,
    ...(e.status && { status: e.status }),
    ...(e.deliveryUnknown && { deliveryUnknown: true }),
    ...(e.retryAfter && { retryAfter: e.retryAfter }),
    ...(e.field && { field: e.field }),
    ...(e.details && { details: e.details }),
  },
  meta: { schemaVersion: 1 },
});
