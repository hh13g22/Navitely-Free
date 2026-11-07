// Claude Code CLI provider: stream-json parsing, spawn argv/env, and the one-session
// turn queue (interrupt, overlap, process death). Fixture lines are trimmed from
// real CLI 2.1.319 captures. The child is faked, so this runs on any OS; the
// live check runs only with RUN_CLAUDE_CODE_LIVE=1 and a logged-in `claude`.
//
// Run via: npm run build:electron && node --test electron/services/__tests__/ClaudeCodeCli2026_11_07.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const dist = (p) => pathToFileURL(path.join(root, 'dist-electron/electron', p)).href;
const { parseLine, buildSpawn, ClaudeCodeCliService } = await import(dist('services/ClaudeCodeCliService.js'));
const { accountOrSetupUserMessage } = await import(dist('llm/providerErrorClassifier.js'));

const TEXT = '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"OK"}},"session_id":"s"}';
const THINK = '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":""}},"session_id":"s"}';
const OK = '{"type":"result","subtype":"success","is_error":false,"result":"OK","terminal_reason":"completed","session_id":"s"}';
const ABORTED = '{"type":"result","subtype":"error_during_execution","is_error":true,"terminal_reason":"aborted_streaming","session_id":"s"}';
const LIMIT = '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1794083400,"rateLimitType":"five_hour"}}';

test('parseLine keeps text deltas, results and rate limits only', () => {
  assert.deepEqual(parseLine(TEXT), { kind: 'text', text: 'OK' });
  assert.equal(parseLine(THINK), null);
  assert.equal(parseLine('not json'), null);
  assert.equal(parseLine(OK).isError, false);
  assert.equal(parseLine(ABORTED).terminalReason, 'aborted_streaming');
  assert.deepEqual(parseLine(LIMIT), { kind: 'rateLimit', status: 'rejected', type: 'five_hour', resetsAt: 1794083400 });
});

test('buildSpawn strips nested-session markers and disables compaction', () => {
  const { cmd, args, env } = buildSpawn('C:\\x y\\claude.exe', { PATH: 'p', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'z' });
  assert.equal(cmd, 'C:\\x y\\claude.exe');
  assert.equal(env.PATH, 'p');
  assert.equal(env.CLAUDECODE, undefined);
  assert.equal(env.CLAUDE_CODE_SESSION_ID, undefined);
  assert.equal(env.DISABLE_AUTO_COMPACT, '1');
  const t = args.indexOf('--tools');
  assert.equal(args[t + 1], '');
  assert.match(args[t + 2], /^--/);
  assert.ok(args.includes('--strict-mcp-config'));
  for (const banned of ['--model', '--effort', '--agent', '--bare', '--safe-mode']) assert.ok(!args.includes(banned));
  assert.deepEqual(buildSpawn('claude', {}, ['--model', 'haiku']).args.slice(-2), ['--model', 'haiku']);
});

/** A fake `claude` child: records stdin lines, lets the test script stdout. */
function fakeSpawn() {
  const children = [];
  const spawn = () => {
    const c = new EventEmitter();
    c.stdin = new PassThrough(); c.stdout = new PassThrough(); c.stderr = new PassThrough();
    c.exitCode = null; c.lines = [];
    c.stdin.on('data', (b) => c.lines.push(...b.toString().split('\n').filter(Boolean).map((l) => JSON.parse(l))));
    c.say = (...ls) => c.stdout.write(ls.join('\n') + '\n');
    c.kill = () => { c.exitCode = 1; c.emit('exit', null, 'SIGTERM'); };
    children.push(c);
    return c;
  };
  return { spawn, children };
}
const tick = () => new Promise((r) => setTimeout(r, 10));
async function collect(gen) { let s = ''; for await (const t of gen) s += t; return s; }

test('overlapping requests are answered in order on one session', async () => {
  const { spawn, children } = fakeSpawn();
  const svc = new ClaudeCodeCliService(spawn);
  const a = collect(svc.stream({ text: 'one', systemPrompt: 'SYS' }));
  const b = collect(svc.stream({ text: 'two', systemPrompt: 'SYS' }));
  await tick();
  const c = children[0];
  assert.equal(c.lines.length, 1, 'second turn waits for the first');
  assert.match(c.lines[0].message.content.at(-1).text, /<instructions>\nSYS/);
  c.say(TEXT.replace('"OK"', '"A"'), OK);
  assert.equal(await a, 'A');
  await tick();
  assert.equal(c.lines.length, 2);
  assert.equal(c.lines[1].message.content.at(-1).text, 'two', 'unchanged system prompt is not re-sent');
  c.say(TEXT.replace('"OK"', '"B"'), OK);
  assert.equal(await b, 'B');
  assert.equal(children.length, 1);
});

test('images ride as base64 blocks before the text', async () => {
  const { spawn, children } = fakeSpawn();
  const svc = new ClaudeCodeCliService(spawn);
  const p = collect(svc.stream({ text: 'what?', images: [{ mimeType: 'image/jpeg', data: 'QUJD' }] }));
  await tick();
  assert.deepEqual(children[0].lines[0].message.content[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } });
  children[0].say(OK);
  await p;
});

test('abort sends one interrupt and nothing leaks into the next turn', async () => {
  const { spawn, children } = fakeSpawn();
  const svc = new ClaudeCodeCliService(spawn);
  const ctl = new AbortController();
  const a = collect(svc.stream({ text: 'long', signal: ctl.signal }));
  await tick();
  const c = children[0];
  c.say(TEXT.replace('"OK"', '"1"'));
  await tick();
  ctl.abort();
  await tick();
  assert.equal(c.lines.filter((l) => l.type === 'control_request').length, 1);
  c.say(TEXT.replace('"OK"', '"LATE"'), ABORTED);
  assert.equal(await a, '1');
  const b = collect(svc.stream({ text: 'next' }));
  await tick();
  c.say(TEXT.replace('"OK"', '"fresh"'), OK);
  assert.equal(await b, 'fresh');
});

test('a consumer that stops early interrupts and drains the turn', async () => {
  const { spawn, children } = fakeSpawn();
  const svc = new ClaudeCodeCliService(spawn);
  const it = svc.stream({ text: 'x' });
  const first = it.next();
  await tick();
  const c = children[0];
  c.say(TEXT);
  assert.equal((await first).value, 'OK');
  const done = it.return();
  await tick();
  assert.equal(c.lines.at(-1).request.subtype, 'interrupt');
  c.say(TEXT.replace('"OK"', '"LEAK"'), ABORTED);
  await done;
  const b = collect(svc.stream({ text: 'y' }));
  await tick();
  c.say(OK.replace('"result":"OK"', '"result":"done"'));
  assert.equal(await b, '');
});

test('rate limit rejection throws a clear error', async () => {
  const { spawn, children } = fakeSpawn();
  const svc = new ClaudeCodeCliService(spawn);
  const p = collect(svc.stream({ text: 'x' }));
  await tick();
  children[0].say(LIMIT, '{"type":"result","subtype":"success","is_error":true,"result":"limit","session_id":"s"}');
  await assert.rejects(p, /^Error: Claude Code CLI: subscription limit reached \(five_hour\)/);
});

test('process death mid-turn throws, and the next request starts a new session', async () => {
  const { spawn, children } = fakeSpawn();
  const svc = new ClaudeCodeCliService(spawn);
  const p = collect(svc.stream({ text: 'x' }));
  await tick();
  children[0].emit('exit', 1, null);
  await assert.rejects(p, /Claude Code CLI: process exited \(1\)/);
  const q = collect(svc.stream({ text: 'y' }));
  await tick();
  assert.equal(children.length, 2);
  children[1].say(TEXT, OK);
  assert.equal(await q, 'OK');
});

test('missing binary throws the actionable not-found error', async () => {
  const svc = new ClaudeCodeCliService(() => {
    const c = new EventEmitter();
    c.stdin = new PassThrough(); c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.exitCode = null;
    setTimeout(() => c.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })), 5);
    return c;
  });
  await assert.rejects(collect(svc.stream({ text: 'x' })), /Claude Code CLI: not found .*claudeCodePath/);
});

test('a recycling session swaps in a warm spare after N turns', async () => {
  const { spawn, children } = fakeSpawn();
  const svc = new ClaudeCodeCliService(spawn, { recycleAfterTurns: 2 });
  for (const n of [1, 2]) {
    const p = collect(svc.stream({ text: `t${n}` }));
    await tick();
    children[0].say(TEXT, OK);
    assert.equal(await p, 'OK');
  }
  assert.equal(children.length, 2, 'spare spawned right after turn 2');
  assert.equal(children[0].exitCode, 1, 'old session killed');
  const p = collect(svc.stream({ text: 't3' }));
  await tick();
  assert.equal(children[1].lines[0].message.content.at(-1).text, 't3');
  children[1].say(TEXT, OK);
  assert.equal(await p, 'OK');
});

test("a stopped session's late exit does not fail its replacement's turn", async () => {
  const { spawn, children } = fakeSpawn();
  const svc = new ClaudeCodeCliService(spawn);
  svc.warm();
  const old = children[0];
  old.kill = () => { old.exitCode = 1; }; // exit arrives later, not inside kill()
  svc.stop();
  const p = collect(svc.stream({ text: 'x' }));
  await tick();
  old.emit('exit', null, 'SIGTERM');
  children[1].say(TEXT, OK);
  assert.equal(await p, 'OK');
});

test('Auto Answer shows Claude Code errors verbatim', () => {
  assert.equal(accountOrSetupUserMessage(new Error('Claude Code CLI: session is full.')), 'Claude Code CLI: session is full.');
});

test('live: one continuous session remembers the previous turn', { skip: process.env.RUN_CLAUDE_CODE_LIVE !== '1' }, async () => {
  const svc = new ClaudeCodeCliService();
  try {
    await collect(svc.stream({ text: 'Remember the code word PELICAN-7. Reply "noted".' }));
    const answer = await collect(svc.stream({ text: 'What was the code word? Reply with it only.' }));
    assert.match(answer, /PELICAN-7/);
  } finally {
    svc.stop();
  }
});

test('live: the judge session runs on Haiku and answers a verdict', { skip: process.env.RUN_CLAUDE_CODE_LIVE !== '1' }, async () => {
  const judge = ClaudeCodeCliService.getJudgeInstance();
  try {
    const t0 = Date.now();
    const out = await collect(judge.stream({ text: 'Reply with exactly this JSON and nothing else: {"answer":true}' }));
    console.log(`judge reply in ${Date.now() - t0} ms: ${out}`);
    assert.match(out, /"answer"\s*:\s*true/);
  } finally {
    judge.stop();
  }
});
