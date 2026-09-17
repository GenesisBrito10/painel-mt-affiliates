export interface PaginationInput {
  page?: number;
  limit?: number;
}

export interface PaginationOptions {
  defaultLimit: number;
  maxLimit: number;
}

export interface PaginationResult {
  page: number;
  limit: number;
  skip: number;
}

export function clampPagination(
  input: PaginationInput,
  options: PaginationOptions,
): PaginationResult {
  const page = Math.max(1, Math.floor(input.page ?? 1) || 1);
  const limit = Math.min(
    Math.max(
      1,
      Math.floor(input.limit ?? options.defaultLimit) || options.defaultLimit,
    ),
    options.maxLimit,
  );
  return { page, limit, skip: (page - 1) * limit };
}
