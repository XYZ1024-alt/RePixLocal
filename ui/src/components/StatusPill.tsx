export function StatusPill(props: { status: string }) {
  return <span className={`status-pill ${statusClass(props.status)}`}>{statusLabel(props.status)}</span>;
}

function statusClass(status: string) {
  if (status === "running") return "running";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "canceled") return "canceled";
  return "draft";
}

function statusLabel(status: string) {
  return {
    running: "运行中",
    completed: "已完成",
    failed: "失败",
    canceled: "已取消",
    draft: "草稿"
  }[status] ?? status;
}
