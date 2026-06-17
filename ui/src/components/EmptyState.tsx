export function EmptyState(props: { message: string }) {
  return (
    <div className="empty-state">
      <p>{props.message}</p>
    </div>
  );
}