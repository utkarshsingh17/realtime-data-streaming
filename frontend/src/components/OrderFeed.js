import React from "react";

const STATUS_STYLES = {
  pending:   { bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" },
  shipped:   { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  delivered: { bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0" },
};

const OP_STYLES = {
  INSERT:   { bg: "#dcfce7", color: "#166534" },
  UPDATE:   { bg: "#fef9c3", color: "#854d0e" },
  DELETE:   { bg: "#fee2e2", color: "#991b1b" },
  SNAPSHOT: { bg: "#f3f4f6", color: "#374151" },
};

const BORDER_COLOR = {
  c: "#22c55e",   // INSERT → green
  u: "#3b82f6",   // UPDATE → blue
  d: "#ef4444",   // DELETE → red
  r: "#9ca3af",   // SNAPSHOT → gray
};

function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] || { bg: "#f3f4f6", color: "#374151", border: "#e5e7eb" };
  return (
    <span style={{
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      padding: "2px 10px", borderRadius: "99px",
      fontSize: "0.72rem", fontWeight: 700,
      letterSpacing: "0.05em", textTransform: "uppercase",
    }}>
      {status || "—"}
    </span>
  );
}

function OpBadge({ op }) {
  const s = OP_STYLES[op] || OP_STYLES.SNAPSHOT;
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: "2px 8px", borderRadius: "4px",
      fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.06em",
    }}>
      {op}
    </span>
  );
}

function OrderCard({ event, isNew }) {
  const order = event.after || event.before;
  const time  = new Date(event.processedAt).toLocaleTimeString();

  return (
    <div style={{
      background: "#ffffff",
      border: "1px solid #e5e7eb",
      borderLeft: `4px solid ${BORDER_COLOR[event.op] || "#9ca3af"}`,
      borderRadius: "10px",
      padding: "14px 18px",
      marginBottom: "10px",
      animation: isNew ? "slideIn 0.35s ease" : "none",
      boxShadow: isNew ? "0 2px 12px rgba(0,0,0,0.06)" : "none",
    }}>

      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <OpBadge op={event.operationLabel} />
          <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#111827" }}>
            Order #{order?.id}
          </span>
        </div>
        <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{time}</span>
      </div>

      {/* Fields grid */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr",
        gap: "6px 20px", fontSize: "0.85rem", color: "#374151",
      }}>
        <span><b>Customer:</b> {order?.customerName}</span>
        <span><b>Product:</b>  {order?.productName}</span>

        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <b>Status:</b> <StatusBadge status={order?.status} />
        </span>

        {/* Show previous status on UPDATE if it changed */}
        {event.before && event.after && event.before.status !== event.after.status && (
          <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "#6b7280" }}>
            <b>Was:</b> <StatusBadge status={event.before.status} />
          </span>
        )}

        <span style={{ color: "#9ca3af", fontSize: "0.78rem", gridColumn: "span 2" }}>
          updated_at: {order?.updatedAt}
        </span>
      </div>
    </div>
  );
}

export default function OrderFeed({ events, connected, onClear }) {
  return (
    <div>
      {/* Feed header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#111827" }}>
          Live Feed
          <span style={{ marginLeft: "10px", fontWeight: 400, fontSize: "0.78rem", color: "#6b7280" }}>
            {events.length} event{events.length !== 1 ? "s" : ""} received
          </span>
        </h2>
        <button
          onClick={onClear}
          style={{
            background: "none", border: "1px solid #e5e7eb", borderRadius: "6px",
            padding: "4px 12px", fontSize: "0.78rem", cursor: "pointer", color: "#6b7280",
          }}
        >
          Clear
        </button>
      </div>

      {/* Empty state */}
      {events.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "52px 0",
          border: "2px dashed #e5e7eb", borderRadius: "12px", color: "#9ca3af",
        }}>
          <div style={{ fontSize: "2.2rem", marginBottom: "10px" }}>📡</div>
          <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>
            {connected ? "Waiting for database changes…" : "Connecting to server…"}
          </div>
          {connected && (
            <div style={{ fontSize: "0.8rem", marginTop: "6px" }}>
              Run INSERT / UPDATE / DELETE on the <code>orders</code> table in MySQL
            </div>
          )}
        </div>
      ) : (
        events.map((ev, i) => (
          <OrderCard
            key={`${ev.processedAt}-${i}`}
            event={ev}
            isNew={i === 0}
          />
        ))
      )}
    </div>
  );
}
