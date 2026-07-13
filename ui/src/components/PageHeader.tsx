import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  className
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 px-4 pb-2 pt-5 sm:flex-row sm:items-start sm:justify-between lg:px-6 lg:pt-6",
        className
      )}
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2 pt-1">{actions}</div> : null}
    </header>
  );
}
