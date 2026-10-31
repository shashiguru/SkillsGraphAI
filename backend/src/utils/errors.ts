export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string) => new AppError(404, 'not_found', `${what} not found`);
export const badRequest = (message: string, details?: unknown) => new AppError(400, 'bad_request', message, details);
export const notConfigured = (service: string, vars: string) =>
  new AppError(503, 'not_configured', `${service} is not configured. Set ${vars} in backend/.env.`);
export const upstreamFailure = (service: string, message: string, details?: unknown) =>
  new AppError(502, `${service}_error`, message, details);
