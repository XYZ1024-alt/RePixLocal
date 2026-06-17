import type { ReactNode } from "react";

export function MetricCard(props: {
  accent: "cyan" | "purple" | "blue" | "green" | "red";
  icon: ReactNode;
  label: string;
  value: string | number;
  delta?: string;
  deltaPositive?: boolean;
}) {
  return (
    <article className={`metric-card ${props.accent}`}>
      <div className="metric-head">
        <span className="icon-chip">{props.icon}</span>
        <span>{props.label}</span>
      </div>
      <div className="metric-value-row">
        <strong>{props.value}</strong>
        {props.delta && (
          <span className={props.deltaPositive === false ? "metric-delta negative" : "metric-delta"}>{props.delta}</span>
        )}
      </div>
      <div className="metric-line" />
    </article>
  );
}