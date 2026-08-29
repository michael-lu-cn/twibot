/**
 * dsh 信封协议客户端（实验 2 MVP）。
 *
 * - 不依赖任何浏览器全局（无 location/window/document）：baseUrl 必须是绝对 http(s) 地址，
 *   fetch 与 WebSocket 均经构造注入（或取 globalThis 兜底），可在 React Native 上直接运行。
 * - unary：POST /api/<method>，body 为 ClientRequest 全形信封，rpcId 自增铸造、应答必须回显。
 * - 事件流：并行打开 /api/events.mux 与 /api/events.host 两条下行 WS；客户端绝不在 WS 上发送
 *   消息（真实宿主会以 1008 'downlink only' 关闭），上行一律走 HTTP POST /api/respond。
 * - 断线恢复 = 重开双流 + 触发 onReconnect 回调，由调用方整页拉取 history 重建基线；
 *   协议的 mux `since` 参数在宿主 v1 就是未实现的占位符，本客户端不发送也不假装增量。
 * - answerable 帧（approval/requested、question/requested）：注入了 approvalAnswerer 就按其
 *   决定经 POST /api/respond 应答；未注入或应答器抛错一律 fail-closed（approval=rejected，
 *   question=空 answers），绝不留宿主 pending。
 */
import {
  API_PATH,
  HOST_EVENTS_PATH,
  MUX_EVENTS_PATH,
  RESPOND_PATH,
  ProtocolError,
  approvalAnswerValue,
  clientRequest,
  clientResponse,
  finalAssistantText,
  isAnswerableMethod,
  nextRpcId,
  okResult,
  parseRpcReceipt,
  parseServerRequest,
  parseServerResponse,
  questionAnswerValue,
  type DshFrame,
  type HistoryPage,
  type HostFrame,
  type MuxFrame,
  type PluginInventoryItem,
  type RpcId,
  type RpcReceipt,
  type SessionEvent,
  type SessionId,
} from './protocol';

// ---- 注入面（最小结构面，浏览器 / RN / node ws 三方都满足）----

/** 最小 WebSocket 结构面：仅使用 downlink 需要的成员。 */
export interface MinimalWebSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: (event: { code?: number; reason?: string }) => void): void;
  addEventListener(type: 'error', listener: (event: unknown) => void): void;
  removeEventListener?(type: string, listener: (event: never) => void): void;
}

export type WebSocketFactory = (url: string) => MinimalWebSocket;

/** 最小 HTTP 应答面。 */
export interface HttpResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface HttpRequestInit {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

export type FetchLike = (url: string, init: HttpRequestInit) => Promise<HttpResponseLike>;

// ---- 应答器 ----

export interface ApprovalRequestedInfo {
  kind: 'approval';
  rpcId: RpcId;
  sessionId: SessionId;
  approvalId: string;
  toolName: string;
  callId?: string;
  reason?: string;
}

export interface QuestionRequestedInfo {
  kind: 'question';
  rpcId: RpcId;
  sessionId: SessionId;
  questions: Array<{ id: string; question: string; options?: Array<{ label: string }> }>;
}

/** 决定：审批回 outcome；问题回 answers 数组；void 走 fail-closed 缺省。 */
export type AnswererDecision =
  | 'allowed-once'
  | 'rejected'
  | Array<{ id: string; selected: string[]; custom?: string }>
  | void;

export type ApprovalAnswerer = (info: ApprovalRequestedInfo | QuestionRequestedInfo) => AnswererDecision | Promise<AnswererDecision>;

// ---- 事件分发 ----

export type StreamTag = 'mux' | 'host';

/** 一条下行帧的分发记录：信封元数据 + 已按 payload.type 收窄前的帧本体。 */
export interface IncomingFrame {
  stream: StreamTag;
  rpcId: RpcId;
  method: string;
  frame: DshFrame;
}

export type FrameListener = (incoming: IncomingFrame) => void;
export type ReconnectListener = (info: { generation: number }) => void;
export type StateListener = (state: ConnectionState) => void;

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

// ---- 错误类型 ----

/** 业务错误：result.ok=false（HTTP 仍是 200）。 */
export class DshRpcError extends Error {
  readonly code: string;
  readonly details: unknown;
  constructor(code: string, message: string, details: unknown) {
    super(`dsh rpc error ${code}: ${message}`);
    this.name = 'DshRpcError';
    this.code = code;
    this.details = details;
  }
}

/** 载体层错误：网络失败、非 2xx、超时。 */
export class DshTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DshTransportError';
  }
}

// ---- 选项 ----

export interface DshClientOptions {
  /** 绝对公网地址，如 http://admin.dsh.port.dpdns.org（禁止相对路径与内网/回环地址——RN 无 location 可解析，且设备侧一律走公网域名拓扑）。 */
  baseUrl: string;
  fetch?: FetchLike;
  webSocketFactory?: WebSocketFactory;
  /** 未提供时对 answerable 帧 fail-closed。 */
  approvalAnswerer?: ApprovalAnswerer;
  timeouts?: {
    /** 单次 unary 超时毫秒数，默认 15000。 */
    unaryMs?: number;
    /** 双流建立握手上限毫秒数，默认 5000。 */
    streamOpenMs?: number;
  };
  reconnect?: {
    /** 首次重试退避上限毫秒（实际延迟为其一半到全量之间的抖动值），默认 100。 */
    baseMs?: number;
    /** 每次连续失败的指数因子，默认 2。 */
    factor?: number;
    /** 退避上限毫秒，默认 4000。 */
    maxMs?: number;
  };
}

interface TurnWaiter {
  sessionId: SessionId;
  events: SessionEvent[];
  promise: Promise<void>;
  settle: () => void;
}

const OPEN_READY_STATE = 1;

function defaultFetch(): FetchLike {
  const candidate = (globalThis as { fetch?: unknown }).fetch;
  if (typeof candidate !== 'function') throw new DshTransportError('no global fetch available; inject one via options.fetch');
  return candidate.bind(globalThis) as FetchLike;
}

function defaultWebSocketFactory(): WebSocketFactory {
  const candidate = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (typeof candidate !== 'function') {
    throw new DshTransportError('no global WebSocket available; inject one via options.webSocketFactory');
  }
  return (url) => new (candidate as new (url: string) => MinimalWebSocket)(url);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * dsh 宿主直连客户端。一个实例持有自己的 rpcId 计数与一条双流连接。
 */
export class DshClient {
  readonly baseUrl: string;

  private readonly fetchFn: FetchLike;
  private readonly wsFactory: WebSocketFactory;
  private readonly approvalAnswerer: ApprovalAnswerer | undefined;
  private readonly unaryTimeoutMs: number;
  private readonly streamOpenTimeoutMs: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectFactor: number;
  private readonly reconnectMaxMs: number;

  private readonly rpcCounter = { value: 0 };
  private readonly frameListeners = new Set<FrameListener>();
  private readonly reconnectListeners = new Set<ReconnectListener>();
  private readonly stateListeners = new Set<StateListener>();
  private readonly waiters = new Set<TurnWaiter>();

  private stateValue: ConnectionState = 'idle';
  private generation = 0;
  private attempt = 0;
  private everConnected = false;
  private userClosed = false;
  private openTags = new Set<StreamTag>();
  private readyResolve: (() => void) | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly sockets = new Map<StreamTag, MinimalWebSocket | undefined>();

  constructor(options: DshClientOptions) {
    let parsed: URL;
    try {
      parsed = new URL(options.baseUrl);
    } catch {
      throw new Error(`baseUrl must be an absolute URL, got ${JSON.stringify(options.baseUrl)}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`baseUrl must be http(s), got ${parsed.protocol}`);
    }
    if (parsed.pathname !== '/' && parsed.pathname !== '') {
      throw new Error(`baseUrl must not carry a path, got ${parsed.pathname}`);
    }
    this.baseUrl = parsed.origin;
    this.fetchFn = options.fetch ?? defaultFetch();
    this.wsFactory = options.webSocketFactory ?? defaultWebSocketFactory();
    this.approvalAnswerer = options.approvalAnswerer;
    this.unaryTimeoutMs = options.timeouts?.unaryMs ?? 15_000;
    this.streamOpenTimeoutMs = options.timeouts?.streamOpenMs ?? 5_000;
    this.reconnectBaseMs = options.reconnect?.baseMs ?? 100;
    this.reconnectFactor = options.reconnect?.factor ?? 2;
    this.reconnectMaxMs = options.reconnect?.maxMs ?? 4_000;
  }

  get connectionState(): ConnectionState {
    return this.stateValue;
  }

  // ---- 监听注册（返回退订函数）----

  onEvent(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  /**
   * 每次非自愿断线后双流重新建立完成时触发（首次连接不触发）。
   * 调用方应在回调里重新拉取会话历史重建基线 —— 协议不提供增量。
   */
  onReconnect(listener: ReconnectListener): () => void {
    this.reconnectListeners.add(listener);
    return () => this.reconnectListeners.delete(listener);
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  // ---- 连接生命周期 ----

  /** 打开双下行流并等待握手完成；重复调用幂等。 */
  async connect(): Promise<void> {
    if (this.userClosed) throw new DshTransportError('client is closed');
    if (this.stateValue === 'connected') return;
    this.userClosed = false;
    this.setState('connecting');
    try {
      await this.runGeneration();
    } catch (error) {
      this.scheduleReconnect();
      throw error;
    }
  }

  /** 停止重连并关闭双流；此后本实例不可再用。 */
  close(): void {
    this.userClosed = true;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.teardownSockets();
    this.setState('closed');
  }

  // ---- unary RPC ----

  async unary(method: string, payload: unknown, opts?: { timeoutMs?: number }): Promise<unknown> {
    const rpcId = nextRpcId(this.rpcCounter);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? this.unaryTimeoutMs);
    try {
      let response: HttpResponseLike;
      console.log(`[WS-DEBUG] unary POST /${method} -> ${this.baseUrl}`);
      try {
        response = await this.fetchFn(`${this.baseUrl}${API_PATH}/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(clientRequest(rpcId, method, payload)),
          signal: controller.signal,
        });
      } catch (cause) {
        throw new DshTransportError(`POST ${API_PATH}/${method} failed: ${String(cause)}`);
      }
      if (!response.ok) {
        throw new DshTransportError(`POST ${API_PATH}/${method}: HTTP ${response.status}`);
      }
      let rawBody: unknown;
      try {
        rawBody = await response.json();
      } catch (cause) {
        throw new ProtocolError(`response body of ${method} is not JSON (${String(cause)})`);
      }
      const full = parseServerResponse(rawBody);
      if (full.rpcId !== rpcId) {
        throw new ProtocolError(`rpcId mismatch for ${method}: sent ${rpcId}, got ${full.rpcId}`);
      }
      if (!full.result.ok) {
        throw new DshRpcError(full.result.error.code, full.result.error.message, full.result.error.details);
      }
      return full.result.value;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 对 answerable 帧回送 ClientResponse（rpcId 原样回显）；返回载体层回执。 */
  async respond(rpcId: RpcId, value: unknown): Promise<RpcReceipt> {
    const response = await this.fetchFn(`${this.baseUrl}${RESPOND_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(clientResponse(rpcId, okResult(value))),
    });
    if (!response.ok) {
      throw new DshTransportError(`POST ${RESPOND_PATH}: HTTP ${response.status}`);
    }
    return parseRpcReceipt(await response.json());
  }

  // ---- 高层便捷 ----

  /** 真实方法名 session.create（rpc-map.ts）；payload 可带 cwd/workspaceId 等。 */
  async startSession(opts?: { cwd?: string }): Promise<{ sessionId: SessionId; agentPreset?: string }> {
    const payload: Record<string, unknown> = {};
    if (opts?.cwd !== undefined) payload['cwd'] = opts.cwd;
    const value = (await this.unary('session.create', payload)) as { sessionId?: unknown };
    if (typeof value?.sessionId !== 'string' || value.sessionId === '') {
      throw new ProtocolError('session.create returned no sessionId');
    }
    return value as { sessionId: SessionId; agentPreset?: string };
  }

  /**
   * 真实方法名 session.list（rpc-map.ts）：{} → {items}，updatedAt 降序。
   * 用于跨进程恢复：客户端无需本地持久化 sessionId，重启后取最近非空会话即可。
   * 宿主 v1 未实现 cursor；这里只做形状收窄，字段按 SessionSummary 可见子集。
   */
  async listSessions(opts?: { cursor?: string }): Promise<
    Array<{ sessionId: SessionId; updatedAt: number; running: boolean; blank: boolean }>
  > {
    const payload: Record<string, unknown> = {};
    if (opts?.cursor !== undefined) payload['cursor'] = opts.cursor;
    const value = (await this.unary('session.list', payload)) as { items?: unknown };
    if (!Array.isArray(value?.items)) throw new ProtocolError('session.list returned no items array');
    return (value.items as Array<Record<string, unknown>>)
      .filter((item) => typeof item['sessionId'] === 'string' && item['sessionId'] !== '')
      .map((item) => ({
        sessionId: item['sessionId'] as SessionId,
        updatedAt: typeof item['updatedAt'] === 'number' ? item['updatedAt'] : 0,
        running: item['running'] === true,
        blank: item['blank'] === true,
      }));
  }

  /**
   * 真实方法名 session.history（rpc-map.ts）：{sessionId, beforeSeq?, maxMessages?} 向旧翻页；
   * 尾页（不带 beforeSeq）附 projections 基线。lastSeq 不在此应答里 —— 它随 mux 的
   * session/subscribed 控制帧下发。
   */
  async fetchHistory(
    sessionId: SessionId,
    opts?: { beforeSeq?: number; maxMessages?: number },
  ): Promise<HistoryPage> {
    const payload: Record<string, unknown> = { sessionId };
    if (opts?.beforeSeq !== undefined) payload['beforeSeq'] = opts.beforeSeq;
    if (opts?.maxMessages !== undefined) payload['maxMessages'] = opts.maxMessages;
    const value = (await this.unary('session.history', payload)) as { events?: unknown };
    if (!Array.isArray(value?.events)) throw new ProtocolError('session.history returned no events array');
    return value as HistoryPage;
  }

  /**
   * 真实方法名 pluginInventory.list:只读投影宿主 Loader 条目。
   * P2 起条目可携带 web bundle 的 url/rev(宿主部署 2026-08-25 契约后);
   * 旧宿主返回的条目缺省这两个字段,本方法原样透传、不做补全。
   */
  async listPlugins(): Promise<PluginInventoryItem[]> {
    const value = (await this.unary('pluginInventory.list', {})) as { entries?: unknown };
    if (!Array.isArray(value?.entries)) {
      throw new ProtocolError('pluginInventory.list returned no entries array');
    }
    return (value.entries as Array<Record<string, unknown>>)
      .filter((item) => typeof item['entryId'] === 'string' && item['entryId'] !== '')
      .map((item) => ({
        entryId: item['entryId'] as string,
        moduleName: typeof item['moduleName'] === 'string' ? (item['moduleName'] as string) : '',
        enabled: item['enabled'] === true,
        fiberPhase:
          item['fiberPhase'] === 'pending' ||
          item['fiberPhase'] === 'loading' ||
          item['fiberPhase'] === 'active' ||
          item['fiberPhase'] === 'failed' ||
          item['fiberPhase'] === 'unloading'
            ? (item['fiberPhase'] as NonNullable<PluginInventoryItem['fiberPhase']>)
            : null,
        ...(typeof item['url'] === 'string' ? { url: item['url'] as string } : {}),
        ...(typeof item['rev'] === 'string' ? { rev: item['rev'] as string } : {}),
      }));
  }

  /**
   * 发送一轮 prompt 并等待回合结束（host/session-status{running:false}），
   * 返回最后一条 assistant/message 的文本块拼接结果与期间收集的全部事件。
   */
  async prompt(
    sessionId: SessionId,
    text: string,
    opts?: { mode?: 'queue' | 'steer'; clientTimeZone?: string },
  ): Promise<{ text: string; events: SessionEvent[] }> {
    if (this.stateValue !== 'connected') {
      throw new DshTransportError(`prompt needs connected event streams, state is ${this.stateValue}`);
    }
    const waiter = this.createWaiter(sessionId);
    this.waiters.add(waiter);
    try {
      await this.unary('session.prompt', {
        sessionId,
        mode: opts?.mode ?? 'queue',
        content: [{ type: 'text', text }],
        ...(opts?.clientTimeZone !== undefined ? { clientTimeZone: opts.clientTimeZone } : {}),
      });
      await waiter.promise;
    } finally {
      this.waiters.delete(waiter);
    }
    const replyText = finalAssistantText(waiter.events);
    if (!replyText.trim()) {
      const summary = waiter.events.slice(-8).map(e => e.type).join('|');
      const diag = `[${waiter.events.length}ev: ${summary}]`;
      return { text: diag || '[0 events captured]', events: waiter.events };
    }
    return { text: replyText, events: waiter.events };
  }

  // ---- 内部：连接生成与重连机 ----

  private async runGeneration(): Promise<void> {
    const generation = ++this.generation;
    this.openTags = new Set<StreamTag>();
    const ready = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });
    this.openSocket('mux', MUX_EVENTS_PATH, generation);
    this.openSocket('host', HOST_EVENTS_PATH, generation);
    await Promise.race([
      ready,
      sleep(this.streamOpenTimeoutMs).then(() => {
        throw new DshTransportError('both event streams did not open within streamOpenMs');
      }),
    ]);
  }

  private wsUrl(path: string): string {
    return `${this.baseUrl.replace(/^http/, 'ws')}${path}`;
  }

  private openSocket(tag: StreamTag, path: string, generation: number): void {
    const url = this.wsUrl(path);
    console.log(`[WS-DEBUG] ${tag} opening url=${url} gen=${generation}`);
    let socket: MinimalWebSocket;
    try {
      socket = this.wsFactory(url);
    } catch (e) {
      console.log(`[WS-DEBUG] ${tag} factory threw:`, e instanceof Error ? e.message : String(e));
      throw e;
    }
    this.sockets.set(tag, socket);
    socket.addEventListener('open', () => { console.log(`[WS-DEBUG] ${tag} OPEN`); this.handleStreamOpen(tag, generation); });
    socket.addEventListener('message', (event) => this.handleFrameText(tag, generation, event.data));
    socket.addEventListener('close', () => this.handleStreamDown(generation));
    socket.addEventListener('error', (ev) => { console.log(`[WS-DEBUG] ${tag} ERROR`, JSON.stringify(ev).slice(0,200)); this.handleStreamDown(generation); });
  }

  private handleStreamOpen(tag: StreamTag, generation: number): void {
    if (generation !== this.generation || this.userClosed) return;
    this.openTags.add(tag);
    if (this.openTags.size < 2) return;
    const firstConnect = !this.everConnected;
    this.everConnected = true;
    this.attempt = 0;
    this.setState('connected');
    const settle = this.readyResolve;
    this.readyResolve = undefined;
    settle?.();
    if (!firstConnect) {
      for (const listener of this.reconnectListeners) {
        try {
          listener({ generation });
        } catch {
          // 业务层回调抛错不得拖垮连接机。
        }
      }
    }
  }

  private handleStreamDown(generation: number): void {
    if (generation !== this.generation || this.userClosed) return;
    if (this.reconnectTimer !== undefined) return;
    this.teardownSockets();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.userClosed) return;
    this.setState('reconnecting');
    this.attempt += 1;
    const cap = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * this.reconnectFactor ** Math.max(0, this.attempt - 1));
    const delay = cap / 2 + Math.random() * (cap / 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.runGeneration().catch(() => {
        // 握手失败：回到退避重试循环，等待下一次调度。
        this.teardownSockets();
        this.scheduleReconnect();
      });
    }, delay);
  }

  private teardownSockets(): void {
    for (const [tag, socket] of this.sockets) {
      this.sockets.set(tag, undefined);
      if (socket !== undefined && socket.readyState !== 3) {
        try {
          socket.close();
        } catch {
          // 已死连接上的 close 抛错无需处理。
        }
      }
    }
  }

  private setState(state: ConnectionState): void {
    if (this.stateValue === state) return;
    this.stateValue = state;
    for (const listener of this.stateListeners) {
      try {
        listener(state);
      } catch {
        // 同上：监听器隔离。
      }
    }
  }

  // ---- 内部：帧处理 ----

  private handleFrameText(tag: StreamTag, generation: number, data: unknown): void {
    if (generation !== this.generation || typeof data !== 'string') return;
    let envelope;
    try {
      envelope = parseServerRequest(JSON.parse(data));
    } catch {
      // 畸形帧丢弃并继续（与真实客户端同姿态），不打断流。
      return;
    }
    const incoming: IncomingFrame = {
      stream: tag,
      rpcId: envelope.rpcId,
      method: envelope.method,
      frame: envelope.payload as DshFrame,
    };
    this.feedWaiters(incoming.frame);
    for (const listener of this.frameListeners) {
      try {
        listener(incoming);
      } catch {
        // 监听器隔离：业务层异常不影响泵与应答路径。
      }
    }
    if (isAnswerableMethod(envelope.method)) {
      void this.answerEnvelope(envelope);
    }
  }

  private async answerEnvelope(envelope: ReturnType<typeof parseServerRequest>): Promise<void> {
    const { rpcId } = envelope;
    const payload = envelope.payload as Record<string, unknown>;
    try {
      if (payload['type'] === 'approval/requested') {
        const frame = payload as Extract<MuxFrame, { type: 'approval/requested' }>;
        let outcome: 'allowed-once' | 'rejected' = 'rejected';
        const decision = await this.approvalAnswerer?.({
          kind: 'approval',
          rpcId,
          sessionId: frame.sessionId,
          approvalId: frame.approvalId,
          toolName: frame.toolName,
          callId: frame.callId,
          reason: frame.reason,
        });
        if (decision === 'allowed-once' || decision === 'rejected') outcome = decision;
        await this.respond(rpcId, approvalAnswerValue(frame.sessionId, frame.approvalId, outcome));
        return;
      }
      const frame = payload as Extract<MuxFrame, { type: 'question/requested' }>;
      let answers: Array<{ id: string; selected: string[]; custom?: string }> = [];
      const decision = await this.approvalAnswerer?.({
        kind: 'question',
        rpcId,
        sessionId: frame.sessionId,
        questions: frame.questions,
      });
      if (Array.isArray(decision)) answers = decision;
      await this.respond(rpcId, questionAnswerValue(frame.sessionId, answers));
    } catch {
      // fail-closed：应答器或传输失败也要回 deny，绝不留宿主无限 pending。
      try {
        if (payload['type'] === 'approval/requested') {
          const frame = payload as Extract<MuxFrame, { type: 'approval/requested' }>;
          await this.respond(rpcId, approvalAnswerValue(frame.sessionId, frame.approvalId, 'rejected'));
        } else {
          const frame = payload as Extract<MuxFrame, { type: 'question/requested' }>;
          await this.respond(rpcId, questionAnswerValue(frame.sessionId, []));
        }
      } catch {
        // 宿主不可达时已无处可答；pending 表由宿主自身治理。
      }
    }
  }

  private createWaiter(sessionId: SessionId): TurnWaiter {
    let settle!: () => void;
    const promise = new Promise<void>((resolve) => {
      settle = resolve;
    });
    return { sessionId, events: [], promise, settle };
  }

  /** 由 handleFrameText 的分发路径调用：喂事件给等待中的 prompt。 */
  private feedWaiters(frame: DshFrame): void {
    if (frame.type === 'session/event') {
      for (const waiter of this.waiters) {
        if (waiter.sessionId === frame.sessionId) waiter.events.push(frame.event);
      }
      return;
    }
    if (frame.type === 'host/session-status' && frame.running === false) {
      for (const waiter of this.waiters) {
        if (waiter.sessionId === frame.sessionId) waiter.settle();
      }
    }
  }
}
