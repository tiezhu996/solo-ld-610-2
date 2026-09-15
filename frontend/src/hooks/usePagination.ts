import { useMemo, useState } from "react";

export function usePagination<T>(rows: T[] = []) {
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const pageRows = useMemo(() => rows.slice((page - 1) * pageSize, page * pageSize), [rows, page]);
  return { page, setPage, pageSize, pageRows, total: rows.length };
}
