/** Renders a CAP settlement tx as a Basescan link — or plain, unlinked text for a SIMULATED/fixture run, so a demo-mode value can never be mistaken for a real receipt. */
export function TxLink({ tx }: { tx?: string }) {
  if (!tx) return null;

  if (tx.startsWith("SIMULATED")) {
    return (
      <span className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>
        SIMULATED
      </span>
    );
  }

  const short = tx.length > 16 ? `${tx.slice(0, 8)}…${tx.slice(-6)}` : tx;
  return (
    <a
      href={`https://basescan.org/tx/${tx}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs underline decoration-dotted underline-offset-2"
      style={{ color: "var(--accent-blue)" }}
    >
      {short} ↗
    </a>
  );
}
