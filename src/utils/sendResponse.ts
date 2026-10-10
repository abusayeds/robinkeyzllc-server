// src/utils/sendResponse.ts
import { Response } from 'express';
import { TResponse } from '../interface/TRespopnse.interface';

export const sendResponse = <T>(res: Response, data: TResponse<T>): void => {
  res.status(data.statusCode).json({
    success: data.success,
    statusCode: data.statusCode,
    message: data?.message,
    pagination: data.pagination,
    data: data.data,
  });
};
