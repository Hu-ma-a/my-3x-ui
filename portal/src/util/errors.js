export class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

export const errors = {
  validation: (message) => new AppError('validation_error', message, 400),
  badRequest: (code, message) => new AppError(code, message, 400),
  unauthorized: (message = '请先登录') => new AppError('unauthorized', message, 401),
  forbidden: (message = '没有权限执行此操作') => new AppError('forbidden', message, 403),
  notFound: (code = 'not_found', message = '资源不存在') => new AppError(code, message, 404),
  conflict: (code, message) => new AppError(code, message, 409),
  tooMany: (message = '操作过于频繁，请稍后再试') => new AppError('too_many_attempts', message, 429),
  internal: (message = '服务器内部错误') => new AppError('internal_error', message, 500),
};

export function assert(condition, errorFactory, message) {
  if (condition) return;
  throw typeof errorFactory === 'function' ? errorFactory(message) : errorFactory;
}

export function isAppError(err) {
  return err instanceof AppError;
}
