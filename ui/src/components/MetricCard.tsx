import type { ReactNode } from "react";

export function MetricCard(props: {
  accent: "cyan" | "purple" | "blue" | "green" | "red";
  icon: ReactNode;
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <article className={`metric-card ${props.accent}`}>
      <div className="metric-head">
        <span className="icon-chip">{props.icon}</span>
        <span>{props.label}</span>
      </div>
      <strong>{props.value}</strong>
      <p>{props.detail}</p>
      <div className="metric-line" />
    </article>
  );
}
