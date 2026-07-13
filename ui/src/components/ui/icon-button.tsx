import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type IconButtonProps = Omit<ButtonProps, "aria-label"> & {
  tooltip: string;
  label?: string;
  "aria-label"?: string;
};

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ tooltip, label, "aria-label": ariaLabel, size = "icon", className, ...props }, ref) => (
    <Tooltip content={tooltip}>
      <Button
        ref={ref}
        size="icon"
        aria-label={ariaLabel ?? label ?? tooltip}
        className={cn(size === "sm" && "size-8", size === "lg" && "size-11", className)}
        {...props}
      />
    </Tooltip>
  )
);
IconButton.displayName = "IconButton";

export { IconButton };
