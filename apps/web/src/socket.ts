import { io } from 'socket.io-client';

export const socket = io({ autoConnect: true, transports: ['websocket', 'polling'] });

export type AckResult<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; error: string };

export function call<T = Record<string, unknown>>(event: string, payload: object = {}): Promise<AckResult<T>> {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload, (err: unknown, res: AckResult<T>) => {
      if (err) resolve({ ok: false, error: '서버 응답이 없습니다' });
      else resolve(res);
    });
  });
}
