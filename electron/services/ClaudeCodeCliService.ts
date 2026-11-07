/**
 * ClaudeCodeCliService: drives the user's locally installed `claude` CLI as ONE
 * long-lived child process (stream-json in and out) for the `claudecode` model.
 *
 * The CLI keeps its own login, model, effort and agent settings; this file
 * passes none of them and never reads ~/.claude. One continuous session per
 * app run: history accumulates and auto-compaction is off, so when the session
 * dies or fills up, the request throws and the next one starts a new session.
 *
 * Owns process lifecycle and protocol framing only. Prompt building, scopes and
 * images stay in LLMHelper.
 */

import { spawn as nodeSpawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { noteStreamActivity } from '../llm/streamActivity';

export const CLAUDE_CODE_ERROR_PREFIX = 'Claude Code CLI:';

// Measured on CLI 2.1.319 (probe FINDINGS-protocol.md). `--tools ""` must be
// followed by another flag: the option takes several values.
const ARGS = [
  '-p',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--include-partial-messages',
  '--verbose',
  '--tools', '',
  '--strict-mcp-config',
  '--settings', JSON.stringify({ autoCompactEnabled: false }),
];

/** Interrupt is answered in ms; if the CLI does not settle by then, kill it. */
const INTERRUPT_KILL_MS = 5_000;

// ── Wire types: only the fields read here ────────────────────────────────────

type WireLine =
  | { type: 'stream_event'; event: { type: string; delta?: { type: string; text?: string } } }
  | { type: 'result'; subtype: string; is_error: boolean; result?: string; terminal_reason?: string }
  | { type: 'rate_limit_event'; rate_limit_info: { status: string; rateLimitType?: string; resetsAt?: number } };

export type CliEvent =
  | { kind: 'text'; text: string }
  | { kind: 'result'; isError: boolean; subtype: string; terminalReason?: string; text?: string }
  | { kind: 'rateLimit'; status: string; type?: string; resetsAt?: number };

export interface ClaudeCodeImage { mimeType: string; data: string }

export interface ClaudeCodeStreamOptions {
  text: string;
  systemPrompt?: string;
  images?: ClaudeCodeImage[];
  signal?: AbortSignal;
}

/** One stdout line → the event it carries, or null for everything we ignore. */
export function parseLine(line: string): CliEvent | null {
  let j: WireLine;
  try { j = JSON.parse(line); } catch { return null; }
  if (j?.type === 'stream_event') {
    const d = j.event?.delta;
    return j.event?.type === 'content_block_delta' && d?.type === 'text_delta' && d.text ? { kind: 'text', text: d.text } : null;
  }
  if (j?.type === 'result') {
    return { kind: 'result', isError: !!j.is_error, subtype: j.subtype, terminalReason: j.terminal_reason, text: j.result };
  }
  if (j?.type === 'rate_limit_event') {
    const r = j.rate_limit_info;
    return { kind: 'rateLimit', status: r?.status, type: r?.rateLimitType, resetsAt: r?.resetsAt };
  }
  return null;
}

/** argv + env for the child. The env drops this-app-inside-Claude-Code markers. */
export function buildSpawn(cliPath: string, env: NodeJS.ProcessEnv, extraArgs: readonly string[] = []): { cmd: string; args: string[]; env: NodeJS.ProcessEnv } {
  const clean: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (!/^CLAUDECODE|^CLAUDE_CODE_/.test(k)) clean[k] = v;
  clean.DISABLE_AUTO_COMPACT = '1';
  return { cmd: cliPath, args: [...ARGS, ...extraArgs], env: clean };
}

export interface ClaudeCodeSessionOptions {
  /** Appended to argv. The answer session passes none: it runs the user's CLI defaults. */
  extraArgs?: readonly string[];
  /** Replace the session (kill + spawn a warm spare) after this many completed turns. 0 = never. */
  recycleAfterTurns?: number;
}

function fail(msg: string): Error { return new Error(`${CLAUDE_CODE_ERROR_PREFIX} ${msg}`); }

export class ClaudeCodeCliService {
  private static instance: ClaudeCodeCliService | null = null;
  static getInstance(): ClaudeCodeCliService {
    return (this.instance ??= new ClaudeCodeCliService());
  }

  /**
   * Auto Answer's judge: its own session, so verdicts never queue behind an
   * answer or land in the answer session's history. Haiku (user's choice) for
   * latency. Each call carries a ~12k-char judge prompt, so the session is
   * replaced every 20 verdicts (~60k tokens of history). The spare's first
   * verdict is cold (measured 3.6 s vs 1.4 s median, past the 2.3 s budget), so
   * a shorter cycle trades more missed verdicts for less history.
   */
  private static judgeInstance: ClaudeCodeCliService | null = null;
  static getJudgeInstance(): ClaudeCodeCliService {
    return (this.judgeInstance ??= new ClaudeCodeCliService(nodeSpawn, { extraArgs: ['--model', 'haiku'], recycleAfterTurns: 20 }));
  }

  constructor(
    private readonly spawnFn: typeof nodeSpawn = nodeSpawn,
    private readonly session: ClaudeCodeSessionOptions = {},
  ) {}

  private cliPath = 'claude';
  private child: ChildProcess | null = null;
  private stderrHead = '';
  private lastSystemPrompt: string | undefined;
  private turnsDone = 0;
  /** The turn currently reading `child`'s stdout. One at a time: see `tail`. */
  private listener: { child: ChildProcess; onEvent(e: CliEvent): void; onExit(err: Error): void } | null = null;
  // ponytail: one session = one turn at a time; add a second process if
  // overlapping Auto Answer + manual turns queue too long.
  private tail: Promise<void> = Promise.resolve();

  setPath(p: string | undefined): void {
    const next = (p || '').trim() || 'claude';
    if (next === this.cliPath) return;
    this.cliPath = next;
    this.stop();
  }

  /** Start the session ahead of the first request. A failure is logged here and thrown by the first request. */
  warm(): void {
    if (!this.child) this.ensureChild();
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    this.lastSystemPrompt = undefined;
    // shell:false spawns the real binary, so kill() reaches it directly
    // (TerminateProcess on Windows, SIGTERM on macOS). Synchronous: safe from before-quit.
    if (child && child.exitCode === null) child.kill();
  }

  async *stream(opts: ClaudeCodeStreamOptions): AsyncGenerator<string, void, unknown> {
    let release!: () => void;
    const prev = this.tail;
    this.tail = new Promise<void>(r => (release = r));
    try {
      await prev;
      if (opts.signal?.aborted) return;
      yield* this.turn(opts);
      const limit = this.session.recycleAfterTurns ?? 0;
      if (limit > 0 && ++this.turnsDone >= limit) { this.stop(); this.warm(); }
    } finally {
      release();
    }
  }

  private ensureChild(): ChildProcess {
    if (this.child) return this.child;
    const { cmd, args, env } = buildSpawn(this.cliPath, process.env, this.session.extraArgs);
    const cwd = path.join(os.tmpdir(), 'natively-claude-code');
    fs.mkdirSync(cwd, { recursive: true });
    const child = this.spawnFn(cmd, args, { cwd, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    this.stderrHead = '';
    this.turnsDone = 0;
    // Only this child's own turn hears its death: a stopped session's late exit
    // must not fail the turn already running on its replacement.
    const lost = (err: Error) => {
      const current = this.child === child;
      if (current) { this.child = null; this.lastSystemPrompt = undefined; }
      if (this.listener?.child === child) this.listener.onExit(err);
      else if (current) console.error('[ClaudeCodeCli]', err.message);
    };
    child.on('error', (e: NodeJS.ErrnoException) => lost(e.code === 'ENOENT'
      ? fail(`not found ("${cmd}"). Install it or set claudeCodePath to the full path of claude(.exe).`)
      : fail(e.message)));
    child.on('exit', (code, signal) => {
      const why = this.stderrHead.trim().split('\n')[0];
      lost(/log ?in|auth|sign(ed)? ?in|credential/i.test(why)
        ? fail(`not signed in. Run "claude" once in a terminal and log in. (${why})`)
        : fail(`process exited (${code ?? signal}). The next request starts a new session.${why ? ` ${why}` : ''}`));
    });
    // A write to a dead child raises EPIPE on stdin; 'exit'/'error' above already report it.
    child.stdin?.on('error', () => {});
    child.stderr?.on('data',(b: Buffer) => { if (this.stderrHead.length < 2000) this.stderrHead += b.toString(); });
    readline.createInterface({ input: child.stdout! }).on('line', line => {
      const e = parseLine(line);
      if (e && this.child === child) this.listener?.onEvent(e);
    });
    return child;
  }

  private write(child: ChildProcess, msg: unknown): void {
    child.stdin?.write(JSON.stringify(msg) + '\n');
  }

  private async *turn({ text, systemPrompt, images = [], signal }: ClaudeCodeStreamOptions): AsyncGenerator<string, void, unknown> {
    const child = this.ensureChild();
    const events: CliEvent[] = [];
    let failure: Error | null = null;
    let wake: (() => void) | null = null;
    const notify = () => { const w = wake; wake = null; w?.(); };
    this.listener = { child, onEvent: e => { events.push(e); notify(); }, onExit: err => { failure = err; notify(); } };

    let interrupted = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const interrupt = () => {
      if (interrupted || this.child !== child) return;
      interrupted = true;
      this.write(child, { type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } });
      killTimer = setTimeout(() => { if (this.child === child) this.stop(); }, INTERRUPT_KILL_MS);
    };
    signal?.addEventListener('abort', interrupt, { once: true });

    // A session's system prompt is fixed at spawn, so Natively's per-Mode prompt
    // rides in the message, and only when it changed since the last turn.
    let body = text;
    if (systemPrompt && systemPrompt !== this.lastSystemPrompt) {
      body = `<instructions>\n${systemPrompt}\n</instructions>\n\n${text}`;
      this.lastSystemPrompt = systemPrompt;
    }
    this.write(child, {
      type: 'user',
      message: {
        role: 'user',
        content: [
          ...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mimeType, data: i.data } })),
          { type: 'text', text: body },
        ],
      },
    });

    let settled = false;
    let rejected: Extract<CliEvent, { kind: 'rateLimit' }> | null = null;
    const next = async (): Promise<CliEvent | null> => {
      while (!events.length) {
        if (failure) return null;
        await new Promise<void>(r => (wake = r));
      }
      noteStreamActivity();
      return events.shift()!;
    };
    try {
      for (let e = await next(); e; e = await next()) {
        if (e.kind === 'text') { if (!interrupted) yield e.text; continue; }
        if (e.kind === 'rateLimit') { if (e.status === 'rejected') rejected = e; continue; }
        settled = true;
        if (interrupted || e.terminalReason === 'aborted_streaming') return;
        if (rejected) throw fail(`subscription limit reached (${rejected.type ?? 'unknown'})${rejected.resetsAt ? `, resets ${new Date(rejected.resetsAt * 1000).toLocaleString()}` : ''}.`);
        if (e.isError) {
          const why = e.text || e.subtype;
          if (/prompt is too long|context (window|length|limit)/i.test(why)) {
            this.stop();
            throw fail('session is full. The next request starts a new session.');
          }
          throw fail(why);
        }
        return;
      }
      settled = true;
      if (signal?.aborted) return;
      throw failure ?? fail('process exited. The next request starts a new session.');
    } finally {
      signal?.removeEventListener('abort', interrupt);
      // Consumer stopped early (deadline / iterator.return()): cancel the turn and
      // drain to its result so nothing leaks into the next turn's stream.
      if (!settled && !failure) {
        interrupt();
        for (let e = await next(); e && e.kind !== 'result'; e = await next()) { /* discard */ }
      }
      clearTimeout(killTimer);
      this.listener = null;
    }
  }
}
