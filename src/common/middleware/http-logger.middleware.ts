import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { green, blue, yellowBright, yellow, red, magenta } from 'colorette';

@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const colorizeStatus = (status: number): string => {
        if (status >= 500) return red(status.toString());
        if (status >= 400) return yellow(status.toString());
        if (status >= 300) return blue(status.toString());
        return green(status.toString());
      };

      const colorizeMethod = (method: string): string => {
        switch (method) {
          case 'GET':
            return green(method);
          case 'POST':
            return blue(method);
          case 'PUT':
            return yellowBright(method);
          case 'PATCH':
            return yellow(method);
          case 'DELETE':
            return red(method);
          default:
            return magenta(method);
        }
      };

      console.log(
        `${colorizeMethod(req.method)} ${colorizeStatus(res.statusCode)} ${magenta(req.originalUrl)} ${yellowBright(`${duration}ms`)} - ${req.ip}`,
      );
    });

    next();
  }
}
