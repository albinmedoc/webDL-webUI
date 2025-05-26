export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class ProcessError extends AppError {
  constructor(message: string) {
    super(message, 500);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404);
  }
}

export function handleError(error: Error): { message: string; statusCode: number } {
  if (error instanceof AppError) {
    return {
      message: error.message,
      statusCode: error.statusCode
    };
  }

  // Default error handling
  return {
    message: 'Internal server error',
    statusCode: 500
  };
}
