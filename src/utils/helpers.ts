export interface PaginationParams {
  page: number;
  perPage: number;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
}

export function parsePagination(query: {
  page?: string;
  perPage?: string;
}): PaginationParams {
  const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
  const perPage = Math.min(50, Math.max(1, parseInt(query.perPage ?? '20', 10) || 20));
  return { page, perPage };
}

export function paginatedResponse<T>(
  items: T[],
  total: number,
  { page, perPage }: PaginationParams
): PaginatedResult<T> {
  return {
    items,
    page,
    perPage,
    total,
    hasMore: page * perPage < total,
  };
}

export function getOffset({ page, perPage }: PaginationParams): number {
  return (page - 1) * perPage;
}

export function generateUsername(email: string): string {
  const base = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
  const suffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${base}_${suffix}`;
}
