import { useEffect, useRef, useState, useCallback } from "react";
import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client";

/**
 * Manages the STOMP/WebSocket connection to Spring Boot.
 *
 * Connects to  : http://localhost:8080/ws  (via SockJS)
 * Subscribes to: /topic/orders
 *
 * Returns:
 *   events      – array of OrderEvent objects, newest first (capped at 100)
 *   connected   – boolean connection state
 *   clearEvents – function to wipe the list
 */
export function useOrderWebSocket(url = "http://localhost:8080/ws") {
  const [events,    setEvents]    = useState([]);
  const [connected, setConnected] = useState(false);
  const clientRef = useRef(null);

  const clearEvents = useCallback(() => setEvents([]), []);

  useEffect(() => {
    const client = new Client({
      webSocketFactory: () => new SockJS(url),
      reconnectDelay: 3000,

      onConnect: () => {
        setConnected(true);
        client.subscribe("/topic/orders", (message) => {
          try {
            const event = JSON.parse(message.body);
            setEvents((prev) => [event, ...prev].slice(0, 100));
          } catch (err) {
            console.error("Failed to parse WebSocket message", err);
          }
        });
      },

      onDisconnect:  ()      => setConnected(false),
      onStompError:  (frame) => { console.error("STOMP error", frame); setConnected(false); },
    });

    client.activate();
    clientRef.current = client;

    return () => { client.deactivate(); };
  }, [url]);

  return { events, connected, clearEvents };
}
