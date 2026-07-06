import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-cyan-400 text-black shadow-glow hover:bg-cyan-300 hover:shadow-[0_0_28px_rgba(34,211,238,0.35)]",
        secondary: "border border-zinc-700 bg-zinc-900 text-white hover:bg-zinc-800 hover:border-zinc-600",
        outline: "border border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-950 hover:text-cyan-300 hover:border-cyan-400/50",
        ghost: "text-zinc-400 hover:bg-zinc-900 hover:text-cyan-300",
        destructive: "bg-red-600 text-white hover:bg-red-500"
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-11 rounded-xl px-6",
        icon: "size-10"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

function Button({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { Button, buttonVariants };
