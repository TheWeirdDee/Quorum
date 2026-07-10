export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-4" style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--surface)" }}>
      <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: "var(--foreground)" }}>
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}
