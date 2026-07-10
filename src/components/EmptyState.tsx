export function EmptyState({ message }: { message: string }) {
  return (
    <div
      className="rounded-lg border border-dashed p-6 text-center text-sm"
      style={{ borderColor: "var(--border-hairline)", color: "var(--text-muted)" }}
    >
      {message}
    </div>
  );
}
