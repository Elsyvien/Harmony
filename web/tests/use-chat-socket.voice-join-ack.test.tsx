import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatSocket } from '../src/hooks/use-chat-socket';

type WsMessage = {
  type: string;
  payload?: Record<string, unknown>;
};

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  static reset() {
    MockWebSocket.instances = [];
  }

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;
  sent: string[] = [];

  constructor(url: string | URL) {
    this.url = String(url);
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    if (this.readyState === MockWebSocket.CLOSING || this.readyState === MockWebSocket.CLOSED) {
      return;
    }
    this.readyState = MockWebSocket.CLOSING;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.call(this as unknown as WebSocket, {} as CloseEvent);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.call(this as unknown as WebSocket, new Event('open'));
  }

  receive(message: WsMessage) {
    this.onmessage?.call(
      this as unknown as WebSocket,
      { data: JSON.stringify(message) } as MessageEvent,
    );
  }
}

function parseSent(socket: MockWebSocket, index: number): WsMessage {
  return JSON.parse(socket.sent[index]) as WsMessage;
}

function setupHook() {
  const hook = renderHook(() =>
    useChatSocket({
      token: 'test-token',
      subscribedChannelIds: [],
      onMessageNew: vi.fn(),
    }),
  );
  const socket = MockWebSocket.instances[0];
  if (!socket) {
    throw new Error('Expected useChatSocket to create a WebSocket');
  }
  return { ...hook, socket };
}

describe('useChatSocket voice join ack lifecycle', () => {
  beforeEach(() => {
    MockWebSocket.reset();
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends voice:join with requestId and resolves on matching voice:join:ack after auth', async () => {
    const { result, unmount, socket } = setupHook();

    act(() => {
      socket.open();
    });

    expect(parseSent(socket, 0)).toEqual({
      type: 'auth',
      payload: { token: 'test-token' },
    });

    act(() => {
      socket.receive({ type: 'auth:ok', payload: {} });
    });

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    const joinPromise = result.current.joinVoiceWithAck('voice-room', {
      muted: true,
      deafened: false,
    });

    const joinMessage = parseSent(socket, 1);
    expect(joinMessage.type).toBe('voice:join');
    expect(joinMessage.payload?.channelId).toBe('voice-room');
    expect(joinMessage.payload?.muted).toBe(true);
    expect(joinMessage.payload?.deafened).toBe(false);
    expect(typeof joinMessage.payload?.requestId).toBe('string');
    expect((joinMessage.payload?.requestId as string).length).toBeGreaterThan(0);

    const requestId = joinMessage.payload?.requestId as string;

    act(() => {
      socket.receive({
        type: 'voice:join:ack',
        payload: {
          channelId: 'voice-room',
          requestId,
        },
      });
    });

    await expect(joinPromise).resolves.toEqual({
      channelId: 'voice-room',
      requestId,
    });

    unmount();
  });

  it('rejects a pending joinVoiceWithAck when the socket closes before ack', async () => {
    const { result, unmount, socket } = setupHook();

    act(() => {
      socket.open();
      socket.receive({ type: 'auth:ok', payload: {} });
    });

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    const joinPromise = result.current.joinVoiceWithAck('voice-room');
    const joinMessage = parseSent(socket, 1);
    expect(joinMessage.type).toBe('voice:join');
    expect(typeof joinMessage.payload?.requestId).toBe('string');

    act(() => {
      socket.close();
    });

    await expect(joinPromise).rejects.toThrow('Socket connection closed');

    unmount();
  });
});
