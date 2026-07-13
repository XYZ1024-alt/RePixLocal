import type { KeyboardEvent } from "react";

export function handleRovingRadioKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
  const direction = getKeyDirection(event.key);
  if (direction === null) return;
  const group = event.currentTarget.closest('[role="radiogroup"]');
  const buttons = Array.from(
    group?.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)') ?? []
  );
  const currentIndex = buttons.indexOf(event.currentTarget);
  if (currentIndex < 0 || buttons.length === 0) return;

  event.preventDefault();
  const targetIndex = direction === "first"
    ? 0
    : direction === "last"
      ? buttons.length - 1
      : (currentIndex + direction + buttons.length) % buttons.length;
  buttons[targetIndex]?.focus();
  buttons[targetIndex]?.click();
}

function getKeyDirection(key: string): number | "first" | "last" | null {
  if (key === "ArrowRight" || key === "ArrowDown") return 1;
  if (key === "ArrowLeft" || key === "ArrowUp") return -1;
  if (key === "Home") return "first";
  if (key === "End") return "last";
  return null;
}
