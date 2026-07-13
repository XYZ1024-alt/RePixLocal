import * as React from "react";
import { cn } from "@/lib/utils";

function PageContainer({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 pb-8 pt-5 lg:px-6", className)}
      {...props}
    />
  );
}

export { PageContainer };
