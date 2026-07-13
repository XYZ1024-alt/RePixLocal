import * as React from "react";
import { cn } from "@/lib/utils";

type DataTableColumn<Row> = {
  key: string;
  header: React.ReactNode;
  render: (row: Row) => React.ReactNode;
  className?: string;
  headerClassName?: string;
};

type DataTableProps<Row> = {
  columns: readonly DataTableColumn<Row>[];
  data: readonly Row[];
  getRowKey: (row: Row) => React.Key;
  caption: string;
  emptyState?: React.ReactNode;
  className?: string;
  onRowClick?: (row: Row) => void;
};

function DataTable<Row>({
  columns,
  data,
  getRowKey,
  caption,
  emptyState,
  className,
  onRowClick
}: DataTableProps<Row>) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-border bg-surface-inset text-xs text-muted-foreground">
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cn("px-4 py-3 font-semibold", column.headerClassName)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.map((row) => (
            <tr
              key={getRowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                "transition-colors [transition-duration:var(--motion-control)]",
                onRowClick && "cursor-pointer hover:bg-accent/55"
              )}
            >
              {columns.map((column, columnIndex) => (
                <td key={column.key} className={cn("px-4 py-3 text-foreground", column.className)}>
                  {onRowClick && columnIndex === 0 ? (
                    <button
                      type="button"
                      className="block w-full rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRowClick(row);
                      }}
                    >
                      {column.render(row)}
                    </button>
                  ) : column.render(row)}
                </td>
              ))}
            </tr>
          ))}
          {data.length === 0 && emptyState ? (
            <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">{emptyState}</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export { DataTable };
export type { DataTableColumn, DataTableProps };
