/**
 * dsh (deepseek-harness) 信封协议的 TS 类型与构造/解析纯函数。
 *
 * 逐字段对齐真实源码（只读参考）：
 * - 信封四元组：tmp-research/deepseek-harness/packages/host/apiproxy/src/api/rpc.ts
 *   POST /api/<method> body = ClientRequest，HTTP 应答体 = ServerResponse（业务错误也是 HTTP 200 + result.ok=false）
 * - 应答式帧：ClientResponse 走 POST /api/respond，回显 server-request 的 rpcId，应答体是 RpcReceipt
 * - 下行流：packages/client/connection/src/api-path.ts 的 /api/events.mux 与 /api/events.host；
 *   每一帧都是完整 ServerRequest 信封（method = payload.type），客户端在 WS 上发任何消息都会被宿主
 *   以 1008 'downlink only' 关闭 —— 上行一律走 HTTP。
 * - 帧词汇：apiproxy/src/api/events.schema.ts 的 muxFrameSchema / hostFrameSchema。
 *
 * 本模块零运行时依赖、不触碰任何浏览器/Node 全局（可在 RN 上直接使用）。
 * id 一律按不透明字符串处理：宿主侧的 brand 只是编译期标注，wire 上就是 string。
 */

// ---- 基础 id 别名（wire 上均为不透明 string）----

export type RpcId = string;
export type SessionId = string;

/** rpcId 风格前缀：本客户端自增铸造（真实客户端铸 UUID；wire 视其为不透明串）。 */
export const RPC_ID_PREFIX = 'rn-';

// ---- RpcResult / RpcError（rpc.ts）----

export interface RpcError {
  code: string;
  message: string;
  details: unknown;
}

export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: RpcError };

export function okResult<T>(value: T): RpcResult<T> {
  return { ok: true, value };
}

export function errorResult(error: RpcError): RpcResult<never> {
  return { ok: false, error };
}

// ---- 四元信封全形（rpc.ts wire full forms）----

/** 客户端发起调用（载体：POST /api/<method> 的 body）。 */
export interface ClientRequest {
  type: 'client-request';
  rpcId: RpcId;
  method: string;
  payload: unknown;
}

/** 对 ClientRequest 的应答（载体：该 POST 的 HTTP 应答体）；rpcId 回显。 */
export interface ServerResponse {
  type: 'server-response';
  rpcId: RpcId;
  result: RpcResult<unknown>;
}

/** 服务端发起的消息（载体：下行 WS/SSE 帧）；answerable 帧 rpcId 稳定复用，纯推送每次新铸。 */
export interface ServerRequest {
  type: 'server-request';
  rpcId: RpcId;
  method: string;
  payload: unknown;
}

/** 对 ServerRequest 的应答（载体：POST /api/respond 的 body）；rpcId 回显，绝不新铸。 */
export interface ClientResponse {
  type: 'client-response';
  rpcId: RpcId;
  result: RpcResult<unknown>;
}

export type RpcMessage = ClientRequest | ServerResponse | ServerRequest | ClientResponse;

/** POST /api/respond 的 HTTP 应答体（载体层回执，非 RpcMessage）。 */
export type RpcReceipt = { accepted: true } | { accepted: false; reason: 'not-pending' | 'bad-response' };

// ---- 会话事件（sessions.schema.ts 的 strict-envelope + wide-data passthrough）----

/** contentBlockSchema 是 looseObject({type:string})：词汇开放，text/reasoning 为已知形态。 */
export interface TextBlock {
  type: 'text';
  text: string;
}

export type ContentBlock =
  | TextBlock
  | { type: 'reasoning'; text: string }
  | { type: string; [key: string]: unknown };

/** SessionEvent：strict envelope, wide data。 */
export interface SessionEvent {
  type: string;
  seq: number;
  time: number;
  data: unknown;
  sourceEventSeqs?: number[];
  surfaceOp?: unknown;
  ignorable?: true;
}

/**
 * user/message 事件的 data：一条完整 user 消息。
 * 真宿主把 content 平铺在 data 上（role/id/source 同级）；MockHost 等旧形态
 * 包一层 message。读取方按 `content ?? message?.content` 取。
 */
export interface UserMessageData {
  content?: ContentBlock[];
  role?: string;
  id?: string;
  source?: { kind?: string; rpcId?: string };
  message?: MessageLike;
  [key: string]: unknown;
}

/** assistant/message 事件的 data。 */
export interface AssistantMessageData {
  turn?: number;
  step?: number;
  message?: MessageLike;
  usage?: unknown;
  [key: string]: unknown;
}

/** assistant/chunk 事件的 data（chunk-rows.ts 白名单形态）。 */
export interface AssistantChunkData {
  turn?: number;
  step?: number;
  chunk?:
    | { type: 'text-delta'; index: number; text: string }
    | { type: string; [key: string]: unknown };
  [key: string]: unknown;
}

/** 消息最小结构（dsh-llm Message 的可见子集）。 */
export interface MessageLike {
  id?: string;
  role?: 'system' | 'user' | 'assistant';
  content?: ContentBlock[];
  source?: unknown;
}

// ---- MuxFrame / HostFrame 并集（events.ts + events.schema.ts）----

export interface ToolEventView {
  for: 'call' | 'result';
  view: Record<string, unknown>;
}

export interface AskUserQuestionItem {
  id: string;
  question: string;
  header?: string;
  detail?: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';

export type MuxFrame =
  | { type: 'session/event'; sessionId: SessionId; event: SessionEvent; view?: ToolEventView }
  | { type: 'session/subscribed'; sessionId: SessionId; lastSeq: number }
  | {
      type: 'approval/requested';
      sessionId: SessionId;
      approvalId: string;
      toolName: string;
      callId?: string;
      reason?: string;
    }
  | { type: 'approval/resolved'; sessionId: SessionId; approvalId: string; outcome: ApprovalOutcome }
  | { type: 'question/requested'; sessionId: SessionId; questions: AskUserQuestionItem[] }
  | { type: 'question/resolved'; sessionId: SessionId; questionRpcId: RpcId; outcome: 'answered' | 'cancelled' }
  | { type: 'session/queue'; sessionId: SessionId; items: unknown[] }
  | { type: 'session/jobs'; sessionId: SessionId; jobs: unknown[] }
  | { type: 'session/projection'; sessionId: SessionId; key: string; value: unknown; seq: number }
  | { type: 'stream/error'; error: RpcError };

export type HostFrame =
  | {
      type: 'host/session-added';
      sessionId: SessionId;
      blank: boolean;
      parentSessionId?: SessionId;
      origin?: 'subagent';
      cwd?: string;
      agentPreset?: string;
    }
  | { type: 'host/session-removed'; sessionId: SessionId }
  | { type: 'host/session-status'; sessionId: SessionId; running: boolean }
  | { type: 'host/agent-error'; sessionId: SessionId; message: string }
  | { type: 'host/workspace-changed'; workspace: Record<string, unknown> }
  | { type: 'host/workspace-removed'; workspaceId: string }
  | { type: 'host/workspace-order-changed'; workspaceIds: string[] }
  | { type: 'host/archived-sessions-changed'; archivedSessionIds: SessionId[] }
  | { type: 'host/remote-event'; event: string; args: unknown[] }
  | { type: 'stream/error'; error: RpcError };

export type DshFrame = MuxFrame | HostFrame;

// ---- 会话历史分页（sessions.ts SessionsApi.history）----

export interface HistoryEntry {
  event: SessionEvent;
  view?: ToolEventView;
}

export interface SessionProjectionsBlock {
  asOfSeq: number;
  values: Record<string, unknown>;
}

export interface HistoryPage {
  events: HistoryEntry[];
  hasMore: boolean;
  projections?: SessionProjectionsBlock;
}

// ---- 路径常量（api-path.ts）----

export const API_PATH = '/api';
export const MUX_EVENTS_PATH = '/api/events.mux';
export const HOST_EVENTS_PATH = '/api/events.host';
export const RESPOND_PATH = '/api/respond';

// ---- 协议违规错误 ----

export class ProtocolError extends Error {
  constructor(message: string) {
    super(`protocol violation: ${message}`);
    this.name = 'ProtocolError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---- 构造函数（发起方铸造 rpcId；应答方原样回显）----

export function nextRpcId(counter: { value: number }): RpcId {
  counter.value += 1;
  return `${RPC_ID_PREFIX}${counter.value}`;
}

export function clientRequest(rpcId: RpcId, method: string, payload: unknown): ClientRequest {
  return { type: 'client-request', rpcId, method, payload };
}

export function clientResponse(rpcId: RpcId, result: RpcResult<unknown>): ClientResponse {
  return { type: 'client-response', rpcId, result };
}

/**
 * 审批应答值（client-response 的 result.value 槽位，approvals.ts/schema.ts）：
 * 客户端只能给 allowed-once / rejected；cancelled/unavailable 是宿主侧结局。
 * deny（fail-closed）= outcome 'rejected'。
 */
export function approvalAnswerValue(
  sessionId: SessionId,
  approvalId: string,
  outcome: 'allowed-once' | 'rejected',
): { sessionId: SessionId; approvalId: string; outcome: 'allowed-once' | 'rejected' } {
  return { sessionId, approvalId, outcome };
}

/** 问题应答值（questions.schema.ts）。空 answers 即"什么都没答"，是不给 answerer 时的 fail-closed 形态。 */
export function questionAnswerValue(
  sessionId: SessionId,
  answers: Array<{ id: string; selected: string[]; custom?: string }>,
): { sessionId: SessionId; answer: { answers: Array<{ id: string; selected: string[]; custom?: string }> } } {
  return { sessionId, answer: { answers } };
}

// ---- 解析函数（wire 边界上做形状校验，违例抛 ProtocolError）----

export function parseServerResponse(raw: unknown): ServerResponse {
  if (!isPlainObject(raw)) throw new ProtocolError('response is not an object');
  if (raw['type'] !== 'server-response') throw new ProtocolError(`unexpected response type ${JSON.stringify(raw['type'])}`);
  if (typeof raw['rpcId'] !== 'string' || raw['rpcId'] === '') throw new ProtocolError('response rpcId missing');
  const result = raw['result'];
  if (!isPlainObject(result) || typeof result['ok'] !== 'boolean') throw new ProtocolError('response result slot malformed');
  if (result['ok'] === false) {
    const error = result['error'];
    if (!isPlainObject(error) || typeof error['code'] !== 'string' || typeof error['message'] !== 'string') {
      throw new ProtocolError('error branch malformed');
    }
  }
  return raw as unknown as ServerResponse;
}

export function parseServerRequest(raw: unknown): ServerRequest {
  if (!isPlainObject(raw)) throw new ProtocolError('frame is not an object');
  if (raw['type'] !== 'server-request') throw new ProtocolError(`unexpected frame type ${JSON.stringify(raw['type'])}`);
  if (typeof raw['rpcId'] !== 'string' || raw['rpcId'] === '') throw new ProtocolError('frame rpcId missing');
  if (typeof raw['method'] !== 'string') throw new ProtocolError('frame method missing');
  if (!isPlainObject(raw['payload'])) throw new ProtocolError('frame payload missing');
  return raw as unknown as ServerRequest;
}

export function parseRpcReceipt(raw: unknown): RpcReceipt {
  if (!isPlainObject(raw)) throw new ProtocolError('receipt is not an object');
  if (raw['accepted'] === true) return { accepted: true };
  if (
    raw['accepted'] === false &&
    (raw['reason'] === 'not-pending' || raw['reason'] === 'bad-response')
  ) {
    return { accepted: false, reason: raw['reason'] };
  }
  throw new ProtocolError('receipt malformed');
}

/** 下行帧是否需要经 POST /api/respond 应答（严格二分：method 决定，无第三种）。 */
export function isAnswerableMethod(method: string): method is 'approval/requested' | 'question/requested' {
  return method === 'approval/requested' || method === 'question/requested';
}

/** 按 payload.type 收窄下行帧（与源码一致的判别字段）。 */
export function frameTypeOf(envelope: ServerRequest): string {
  return envelope.method;
}

// ---- 纯提取函数（高层便捷：拼 final text）----

/** 从消息内容里拼接全部 text 块（reasoning 等非可见块不计入）。 */
export function textOfContent(content: ContentBlock[] | undefined): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is TextBlock => block !== null && typeof block === 'object' && block.type === 'text')
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .join('');
}

/** 单个 assistant/message 事件的最终文本。 */
export function assistantTextFromEvent(event: SessionEvent): string {
  if (event.type !== 'assistant/message') return '';
  const data = event.data as AssistantMessageData | undefined;
  return textOfContent(data?.message?.content);
}

/**
 * 从一串事件里取最后一条 assistant/message 的文本块拼 final text。
 * （与 web runtime 的折叠口径一致：以最后一条完整消息为准，chunk 只用于流式渲染。）
 */
/**
 * 聚合全部 assistant/message 的 text 块。
 * dsh agent 可能产生多条消息（多步工具调用），取最后一条非空的而非盲取末条。
 */
export function finalAssistantText(events: SessionEvent[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event !== undefined && event.type === 'assistant/message') {
      const text = assistantTextFromEvent(event);
      if (text.trim().length > 0) return text;
    }
  }
  // 兜底：拼接所有 text-delta chunk（与 web UI 流式渲染口径一致）
  const deltas: string[] = [];
  for (const event of events) {
    if (event.type !== 'assistant/chunk') continue;
    const chunk = (event.data as AssistantChunkData | undefined)?.chunk;
    if (chunk !== null && typeof chunk === 'object' && chunk.type === 'text-delta') {
      deltas.push(typeof chunk.text === 'string' ? chunk.text : '');
    }
  }
  return deltas.join('');
}

/** pluginInventory/list 条目的客户端可见子集(宿主侧 types.ts 的对齐镜像)。 */
export interface PluginInventoryItem {
  /** Loader 条目 id(不透明)。 */
  entryId: string
  /** Loader 模块标识(动态行 = 包名)。 */
  moduleName: string
  enabled: boolean
  fiberPhase: 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null
  /**
   * 该条目 web bundle 的服务地址(`/plugins/<id>/client.js?rev=`)。
   * 仅当组合携带 client-modules 栈且图谱有该模块的活跃行时出现;
   * 旧宿主(未部署 P2 契约)永远缺省。
   */
  url?: string
  /** bundle 内容修订;每次重建变化。 */
  rev?: string
}
