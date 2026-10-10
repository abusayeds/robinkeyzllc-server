import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { AppError } from './appError';
import { TErrorSources } from './error.types';

@Catch()
export class GlobalErrorHandler implements ExceptionFilter {
  private readonly logger = new Logger(GlobalErrorHandler.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'Internal Server Error';
    let errorSources: TErrorSources | undefined;

    if (exception instanceof AppError) {
      status = exception.statusCode;
      message = exception.message;
      error = exception.name;
      errorSources = exception.errorSources;
    } else if (exception instanceof BadRequestException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse() as any;
      error = exception.name;

      if (
        exceptionResponse.message &&
        Array.isArray(exceptionResponse.message)
      ) {
        message = exceptionResponse.message[0];
        errorSources = exceptionResponse.message.map((msg: string) => {
          const fieldMatch = msg.match(/^(\w+)\s/);
          const path = fieldMatch ? fieldMatch[1].toLowerCase() : '';
          return {
            path,
            message: msg,
          };
        });
      } else {
        message =
          typeof exceptionResponse === 'string'
            ? exceptionResponse
            : exceptionResponse.message || exception.message;
      }
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse as any).message || exception.message;
      error = exception.name;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      status = HttpStatus.BAD_REQUEST;

      if (exception.code === 'P2002') {
        message = 'Duplicate entry found';
        error = 'DuplicateError';
        const field = (exception.meta?.target as string[]) || [];
        errorSources = field.map((f) => ({
          path: f,
          message: `${f} already exists`,
        }));
      } else if (exception.code === 'P2003') {
        message = 'Foreign key constraint violation';
        error = 'ForeignKeyError';
        errorSources = [
          {
            path: (exception.meta?.field_name as string) || '',
            message: exception.message,
          },
        ];
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        message = 'Record not found';
        error = 'NotFoundError';
      } else if (exception.code === 'P2000') {
        message = 'Required field value is too long';
        error = 'ValidationError';
      } else if (exception.code === 'P2016') {
        status = HttpStatus.NOT_FOUND;
        message = 'Record does not exist';
        error = 'NotFoundError';
      } else {
        message = 'Database operation failed';
        error = 'DatabaseError';
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Invalid data provided';
      error = 'ValidationError';
    } else if (exception instanceof Prisma.PrismaClientInitializationError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      message = 'Database connection failed';
      error = 'DatabaseConnectionError';
    } else if (exception instanceof Error) {
      message = exception.message;
      error = exception.name;
    }

    if (process.env.NODE_ENV !== 'production') {
      this.logger.error(
        `${request.method} ${request.url}`,
        JSON.stringify(
          {
            statusCode: status,
            message,
            error,
            errorSources,
            stack: exception instanceof Error ? exception.stack : undefined,
            timestamp: new Date().toISOString(),
            path: request.url,
          },
          null,
          2,
        ),
      );
    } else {
      this.logger.error(
        `${request.method} ${request.url} - ${status} - ${message}`,
      );
    }

    const responseBody: any = {
      success: false,
      statusCode: status,
      message,
    };

    if (errorSources && errorSources.length > 0) {
      responseBody.errorSources = errorSources;
    }

    responseBody.path = request.url;
    responseBody.timestamp = new Date().toISOString();

    response.status(status).json(responseBody);
  }
}
