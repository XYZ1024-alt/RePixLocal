import type { ReactNode } from "react";

export function EmptyState(props: { icon?: ReactNode; title: string; detail: string }) {
  return (
    <div className="empty-state">
      {props.icon && <span className="empty-icon">{props.icon}</span>}
      <strong>{props.title}</strong>
      <p>{props.detail}</p>
    </div>
  );
}
