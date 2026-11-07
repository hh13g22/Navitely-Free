// src/components/upgrade/ClaudeContextPanel.tsx
//
// "Your Context" — the panel that stands where the Unlock Pro pricing page used
// to (this is a local build driving the user's own Claude Code CLI, so there is
// nothing to sell). The user pastes their about-you / résumé / target job here;
// it is saved to a plain markdown file in userData and prepended to every Claude
// Code answer (electron/services/claudeCodeContext.ts + LLMHelper). No license,
// no embeddings, no server — the same benefit the Pro "Profile Intelligence"
// sold, done with the user's own subscription.
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, X, Check, FileText, FolderOpen } from 'lucide-react';

interface Props {
  theme: 'light' | 'dark';
  onBack?: () => void;
  onClose?: () => void;
  dismiss?: { label: string; onClick: () => void };
  subtitle?: string;
}

export function ClaudeContextPanel({ theme, onBack, onClose, dismiss, subtitle }: Props) {
  const dark = theme !== 'light';
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    (window as any).electronAPI?.getClaudeContext?.()
      .then((r: { text?: string }) => { if (alive) { setText(r?.text ?? ''); setStatus('ready'); } })
      .catch(() => { if (alive) setStatus('ready'); });
    return () => { alive = false; if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, []);

  const save = async (next: string) => {
    setStatus('saving');
    setError(null);
    try {
      const r = await (window as any).electronAPI?.saveClaudeContext?.(next);
      if (r && r.success === false) { setStatus('error'); setError(r.error || 'Could not save'); return; }
      setStatus('saved');
      setTimeout(() => setStatus((s) => (s === 'saved' ? 'ready' : s)), 1500);
    } catch (e: any) {
      setStatus('error');
      setError(e?.message || 'Could not save');
    }
  };

  const onChange = (v: string) => {
    setText(v);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(v), 600); // autosave, debounced
  };

  const openInEditor = async () => {
    try {
      await (window as any).electronAPI?.openClaudeContext?.();
      // When they come back from Notepad, pick up whatever they saved.
      const r = await (window as any).electronAPI?.getClaudeContext?.();
      if (r) setText(r.text ?? '');
    } catch { /* best effort */ }
  };

  const C = dark
    ? { bg: '#15131c', card: '#1d1a26', text: '#ece9f5', dim: '#9d97ad', line: '#2c2838', input: '#0f0e15', accent: '#AF8CFE', btn: '#2a2636', btnText: '#ece9f5' }
    : { bg: '#f6f4fc', card: '#ffffff', text: '#1d1830', dim: '#6b6480', line: '#e7e1f3', input: '#faf9ff', accent: '#8a5cf0', btn: '#efeafb', btnText: '#2a2340' };

  const statusLine =
    status === 'saving' ? 'Saving…'
    : status === 'saved' ? 'Saved'
    : status === 'error' ? (error || 'Could not save')
    : '';

  return (
    <div style={{ width: '100%', height: '100%', boxSizing: 'border-box', background: C.bg, color: C.text,
      font: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif', padding: 24,
      display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>

      <div style={{ display: 'flex', alignItems: 'center', minHeight: 28 }}>
        {onBack
          ? <button onClick={onBack} aria-label="Back" style={iconBtn(C)}><ArrowLeft size={16} strokeWidth={1.5} /></button>
          : <span />}
        <div style={{ flex: 1 }} />
        {dismiss
          ? <button onClick={dismiss.onClick} style={{ ...textBtn(C) }}>{dismiss.label}</button>
          : onClose ? <button onClick={onClose} aria-label="Close" style={iconBtn(C)}><X size={16} strokeWidth={1.5} /></button> : <span />}
      </div>

      <div>
        <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>Your Context</div>
        <div style={{ fontSize: 13.5, color: C.dim, marginTop: 4, lineHeight: 1.5 }}>
          {subtitle || 'Your about-you, résumé and the job you’re targeting — sent to your own Claude so every answer is tailored to you. Stays on this machine; no account, no payment.'}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={openInEditor} style={pillBtn(C)}><FolderOpen size={14} strokeWidth={1.6} /> Open file in editor</button>
        <span style={{ flex: 1 }} />
        <span style={{ alignSelf: 'center', fontSize: 12.5, color: status === 'error' ? '#e0607a' : C.dim, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          {status === 'saved' && <Check size={13} strokeWidth={2} />}{statusLine}
        </span>
      </div>

      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        placeholder={PLACEHOLDER}
        style={{ flex: 1, width: '100%', boxSizing: 'border-box', resize: 'none', borderRadius: 12,
          border: `1px solid ${C.line}`, background: C.input, color: C.text, padding: 14, lineHeight: 1.55,
          fontSize: 13.5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', outline: 'none' }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.dim }}>
        <FileText size={13} strokeWidth={1.6} />
        Saved automatically. Edit any time — it takes effect on your next answer. Select “Claude Code CLI” as your model to use it.
      </div>
    </div>
  );
}

const PLACEHOLDER = `## About me
A few lines about who you are and how you want to come across.

## My resume
Paste your resume text here.

## The job I'm interviewing for
Paste the role / job post. Swap this out per interview.`;

const iconBtn = (C: any): React.CSSProperties => ({
  width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 8, border: `1px solid ${C.line}`, background: C.card, color: C.text, cursor: 'pointer',
});
const textBtn = (C: any): React.CSSProperties => ({
  background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 13, padding: '4px 6px',
});
const pillBtn = (C: any): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 9, padding: '7px 12px',
  border: `1px solid ${C.line}`, background: C.btn, color: C.btnText, cursor: 'pointer', fontSize: 13, fontWeight: 500,
});

export default ClaudeContextPanel;
