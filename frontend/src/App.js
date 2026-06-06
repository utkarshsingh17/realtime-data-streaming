import React from "react";
import { useOrderWebSocket } from "./hooks/useOrderWebSocket";
import OrderFeed from "./components/OrderFeed";

/**
 * Root component.
 * Opens a single persistent WebSocket connection to Spring Boot.
 * All updates arrive automatically from the Debezium → Kafka pipeline.
 * No polling. No manual triggers.
 */
export default function App() {
  const { events, connected, clearEvents } = useOrderWebSocket();

  return (
    <div style={{ minHeight: "100vh", background: "#f9fafb", fontFamily: "'IBM Plex Mono', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(-10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(34,197,94,0.25); }
          50%       { box-shadow: 0 0 0 6px rgba(34,197,94,0.1); }
        }
      `}</style>

      {/* ── Header ── */}
      <div style={{
        background: "#111827", padding: "18px 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ color: "#f9fafb", fontWeight: 700, fontSize: "1.1rem", letterSpacing: "0.04em" }}>
            ⚡ Order CDC Monitor
          </div>
          <div style={{ color: "#6b7280", fontSize: "0.72rem", marginTop: "3px" }}>
            MySQL → Debezium → Kafka → Spring Boot → WebSocket → React
          </div>
        </div>

        {/* Connection indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{
            width: 10, height: 10, borderRadius: "50%", display: "inline-block",
            background: connected ? "#22c55e" : "#ef4444",
            animation: connected ? "pulse 2s infinite" : "none",
          }} />
          <span style={{ fontSize: "0.82rem", color: connected ? "#86efac" : "#fca5a5" }}>
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ maxWidth: "780px", margin: "32px auto", padding: "0 20px" }}>

        {/* Info banner */}
        <div style={{
          background: "#eff6ff", border: "1px solid #bfdbfe",
          borderRadius: "10px", padding: "12px 18px", marginBottom: "24px",
          fontSize: "0.82rem", color: "#1d4ed8",
        }}>
          Listening on Kafka topic <b>mysql1.ecom_db.orders</b>.
          Any INSERT / UPDATE / DELETE on the <b>orders</b> table will appear below automatically.
        </div>

        {/* Op legend */}
        <div style={{ display: "flex", gap: "16px", marginBottom: "18px", fontSize: "0.75rem", color: "#6b7280" }}>
          {[
            { color: "#22c55e", label: "INSERT" },
            { color: "#3b82f6", label: "UPDATE" },
            { color: "#ef4444", label: "DELETE" },
            { color: "#9ca3af", label: "SNAPSHOT" },
          ].map(({ color, label }) => (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <span style={{ width: 10, height: 10, borderRadius: "2px", background: color, display: "inline-block" }} />
              {label}
            </span>
          ))}
        </div>

        {/* Live event feed */}
        <OrderFeed events={events} connected={connected} onClear={clearEvents} />
      </div>
    </div>
  );
}
