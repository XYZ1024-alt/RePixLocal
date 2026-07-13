import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-28 w-full resize-y rounded-lg border border-input bg-surface-inset px-3 py-2 text-sm text-foreground transition-[border-color,background-color] [transition-duration:var(--motion-control)] ease-fluid-out placeholder:text-muted-foreground focus-visible:border-ring focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export { Textarea };
