export class ApiError extends Error {
  statusCode: number;
  errorCode: string;
  retryable: boolean;
  details?: Record<string, unknown>;

  constructor(options: {
    message: string;
    errorCode: string;
    statusCode?: number;
    retryable?: boolean;
    details?: Record<string, unknown>;
  }) {
    super(options.message);
    this.name = "ApiError";
    this.statusCode = options.statusCode ?? 500;
    this.errorCode = options.errorCode;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, errorCode = "CONTRACT_VERSION_MISMATCH") {
    super({
      message,
      errorCode,
      statusCode: 400,
      retryable: false,
    });
    this.name = "ValidationError";
  }
}

export class ProviderError extends ApiError {
  constructor(options: {
    message: string;
    errorCode: string;
    retryable?: boolean;
    statusCode?: number;
    details?: Record<string, unknown>;
  }) {
    super({
      message: options.message,
      errorCode: options.errorCode,
      statusCode: options.statusCode ?? 502,
      retryable: options.retryable ?? true,
      details: options.details,
    });
    this.name = "ProviderError";
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
