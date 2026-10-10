export type TResponse<T> = {
  statusCode: number;
  success: boolean;
  message?: string;
  pagination?: {
    totalPage?: number;
    currentPage?: number;
    prevPage: number;
    nextPage: number;
    limit?: number;
    totalItem?: number;
  };
  data: T;
};
