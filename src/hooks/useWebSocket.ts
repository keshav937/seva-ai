import { useEffect, useRef, useState } from 'react';
import { getSessionToken } from '../lib/api.ts';

export function useWebSocket(
  onEvent: (event: any) => void,
  options?: { enabled?: boolean; trackingToken?: string }
) {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  const enabled = options?.enabled ?? true;
  const trackingToken = options?.trackingToken;

  useEffect(() => {
    if (!enabled) return;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    const sendAuth = () => {
      const token = getSessionToken();
      if (token && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'auth', token }));
      }
    };

    const connect = () => {
      if (closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);

      ws.onopen = () => {
        setConnected(true);
        sendAuth();
        if (trackingToken && ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'subscribe_tracking', trackingToken }));
        }
        pingTimer = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      ws.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data);
          handlerRef.current(parsed);
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (pingTimer) clearInterval(pingTimer);
        if (!closed) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();
    window.addEventListener('seva:auth-changed', sendAuth);

    return () => {
      closed = true;
      window.removeEventListener('seva:auth-changed', sendAuth);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      ws?.close();
    };
  }, [enabled, trackingToken]);

  return { connected };
}
