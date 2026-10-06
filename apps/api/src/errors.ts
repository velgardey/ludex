export class ApiError extends Error {
  status: number;
  code: string;
  retryAfterSeconds?: number;
  constructor(
    status: number,
    code: string,
    message = code,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
export function requireValue<T>(
  value: T | null | undefined,
  code = "not-found",
): T {
  if (value === null || value === undefined) throw new ApiError(404, code);
  return value;
}
