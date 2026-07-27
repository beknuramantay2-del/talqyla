// Error helpers — every controller throws `ApiError`; the global error handler
// in app.ts turns it into a consistent JSON envelope matching ApiErrorBody.

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYMENT_REQUIRED'
  | 'RATE_LIMITED'
  | 'UPSTREAM'
  | 'INTERNAL';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYMENT_REQUIRED: 402,
  RATE_LIMITED: 429,
  UPSTREAM: 502,
  INTERNAL: 500,
};

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.details = details;
  }

  static badRequest(msg = 'Некорректный запрос', details?: unknown) {
    return new ApiError('BAD_REQUEST', msg, details);
  }
  static unauthorized(msg = 'Требуется авторизация') {
    return new ApiError('UNAUTHORIZED', msg);
  }
  static forbidden(msg = 'Недостаточно прав') {
    return new ApiError('FORBIDDEN', msg);
  }
  static notFound(msg = 'Не найдено') {
    return new ApiError('NOT_FOUND', msg);
  }
  static conflict(msg = 'Конфликт') {
    return new ApiError('CONFLICT', msg);
  }
  /** Spend/usage ceilings (daily round cap, daily AI budget). */
  static rateLimited(msg = 'Слишком много запросов', details?: unknown) {
    return new ApiError('RATE_LIMITED', msg, details);
  }
  static upstream(msg = 'Ошибка внешнего сервиса') {
    return new ApiError('UPSTREAM', msg);
  }
}

/** Convenience for handlers — `throw notFound('Раунд не найден')`. */
export const notFound = ApiError.notFound;
export const badRequest = ApiError.badRequest;
export const unauthorized = ApiError.unauthorized;
export const forbidden = ApiError.forbidden;
export const conflict = ApiError.conflict;
export const rateLimited = ApiError.rateLimited;

/** Sanitize user input — strip HTML tags, trim, collapse whitespace. */
export function sanitize(input: string): string {
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}
