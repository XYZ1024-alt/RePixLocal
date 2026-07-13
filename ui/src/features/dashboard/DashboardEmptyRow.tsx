export function DashboardEmptyRow({ text }: { text: string }) {
  return (
    <div className="px-5 py-6">
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
