import { HttpException, HttpStatus } from '@nestjs/common';
import { TErrorSources } from './error.types';

export class AppError extends HttpException {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly errorSources?: TErrorSources;

  constructor(
    statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR,
    message: string,
    isOperational: boolean = true,
    errorSources?: TErrorSources,
  ) {
    super(message, statusCode);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.errorSources = errorSources;
    Error.captureStackTrace(this, this.constructor);
  }
}
