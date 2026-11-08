// src/components/profile/MyProfilePanel.tsx
//
// "My Profile" — stands where Profile Intelligence's Pro paywall used to be.
// This local build answers through the user's own Claude Code CLI, so there is
// nothing to unlock: the user attaches a CV and a cover letter and fills a few
// short fields (name, what they are looking for, about them, the job post), and
// the app builds the prompt itself (electron/services/claudeCodeContext.ts →
// LLMHelper.streamWithClaudeCode). Documents are read locally by the app's
// shared SafeDocumentTextExtractor (PDF / Word / text).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, FileText, Loader2, Mail, User, X } from 'lucide-react';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';

type DocKind = 'resume' | 'coverLetter';
interface DocSummary { fileName: string; chars: number; pages?: number; truncated: boolean; addedAt: number }
interface Profile {
  name: string; lookingFor: string; about: string; jobDescription: string;
  resume: DocSummary | null; coverLetter: DocSummary | null;
}
type Result = { success: boolean; canceled?: boolean; error?: string; profile?: Profile };

const EMPTY: Profile = { name: '', lookingFor: '', about: '', jobDescription: '', resume: null, coverLetter: null };
const api = () => (window as any).electronAPI;

export function MyProfilePanel({ onClose }: { onClose?: () => void }) {
  const theme = useResolvedTheme() === 'light' ? 'light' : 'dark';
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [view, setView] = useState<'home' | 'profile'>('home');
  const [busy, setBusy] = useState<DocKind | null>(null);
  const [errors, setErrors] = useState<Partial<Record<DocKind, string>>>({});

  useEffect(() => {
    api()?.getClaudeProfile?.().then((p: Profile) => p && setProfile(p)).catch(() => {});
  }, []);

  const attach = async (kind: DocKind) => {
    setBusy(kind);
    setErrors((e) => ({ ...e, [kind]: undefined }));
    try {
      const r: Result = await api()?.attachClaudeProfileDoc?.(kind);
      if (r?.profile) setProfile(r.profile);
      else if (r && !r.success && !r.canceled) setErrors((e) => ({ ...e, [kind]: r.error || 'Could not read that file' }));
    } catch (err: any) {
      setErrors((e) => ({ ...e, [kind]: err?.message || 'Could not read that file' }));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (kind: DocKind) => {
    const r: Result = await api()?.removeClaudeProfileDoc?.(kind);
    if (r?.profile) setProfile(r.profile);
  };

  const used = [
    profile.resume && 'CV',
    (profile.name || profile.lookingFor || profile.about || profile.jobDescription) && 'Profile',
    profile.coverLetter && 'Cover letter',
  ].filter(Boolean) as string[];

  return (
    <div className={`mp-root mp-${theme}`}>
      <style>{CSS}</style>
      {view === 'profile' ? (
        <ProfileForm profile={profile} onSaved={setProfile} onBack={() => setView('home')} />
      ) : (
        <>
          <div className="mp-top">
            <span />
            {onClose && <button className="mp-icon-btn" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={1.6} /></button>}
          </div>

          <div className="mp-hero">
            <h1>Every answer.<br />Grounded in you.</h1>
            <p>
              Attach your CV and cover letter and add a few lines about yourself. Natively turns them into
              the prompt for your own Claude, so every answer draws on your real experience.
            </p>
          </div>

          <div className="mp-grid">
            <DocCard
              kind="resume" tall tint="violet" icon={<User size={18} strokeWidth={1.7} />}
              title="Identity" blurb="Your CV or résumé. Answers use your real roles, skills and results."
              attachLabel="Attach CV" doc={profile.resume} busy={busy === 'resume'} error={errors.resume}
              onAttach={() => attach('resume')} onRemove={() => remove('resume')}
            />
            <button className="mp-card mp-tint-green" onClick={() => setView('profile')}>
              <span className="mp-chip"><FileText size={18} strokeWidth={1.7} /></span>
              <span className="mp-card-text">
                <span className="mp-card-title">Profile</span>
                {profile.name || profile.lookingFor ? (
                  <span className="mp-card-sub mp-ok">
                    <Check size={13} strokeWidth={2.2} />
                    <span className="mp-ellip">{[profile.name, profile.lookingFor].filter(Boolean).join(' · ')}</span>
                  </span>
                ) : (
                  <span className="mp-card-sub">Your name, what you're looking for, a few lines about you.</span>
                )}
              </span>
              <span className="mp-pill">{profile.name || profile.about ? 'Edit' : 'Add'}</span>
            </button>
            <DocCard
              kind="coverLetter" tint="rose" icon={<Mail size={18} strokeWidth={1.7} />}
              title="Cover Letter" blurb="Your motivation and story for this role."
              attachLabel="Attach letter" doc={profile.coverLetter} busy={busy === 'coverLetter'} error={errors.coverLetter}
              onAttach={() => attach('coverLetter')} onRemove={() => remove('coverLetter')}
            />
          </div>

          <div className="mp-foot">
            <span className="mp-foot-status">
              {used.length
                ? <>Every answer now draws on: <b>{used.join(' · ')}</b></>
                : 'Nothing added yet. Your answers carry no personal context.'}
            </span>
            {onClose && <button className="mp-done" onClick={onClose}>Done</button>}
          </div>
        </>
      )}
    </div>
  );
}

function DocCard(props: {
  kind: DocKind; tall?: boolean; tint: string; icon: React.ReactNode; title: string; blurb: string;
  attachLabel: string; doc: DocSummary | null; busy: boolean; error?: string;
  onAttach: () => void; onRemove: () => void;
}) {
  const { tall, tint, icon, title, blurb, attachLabel, doc, busy, error, onAttach, onRemove } = props;
  const meta = doc && [doc.pages ? `${doc.pages} page${doc.pages === 1 ? '' : 's'}` : null,
    `${doc.chars.toLocaleString()} characters`, doc.truncated ? 'trimmed to fit' : null].filter(Boolean).join(' · ');
  return (
    <div className={`mp-card mp-tint-${tint}${tall ? ' mp-tall' : ''}`}>
      <span className="mp-chip">{icon}</span>
      <span className="mp-card-text">
        <span className="mp-card-title">{title}</span>
        {busy ? (
          <span className="mp-card-sub mp-busy"><Loader2 size={13} className="mp-spin" /> Reading the file…</span>
        ) : doc ? (
          <>
            <span className="mp-card-sub mp-ok" title={doc.fileName}><Check size={13} strokeWidth={2.2} /><span className="mp-ellip">{doc.fileName}</span></span>
            <span className="mp-card-meta">{meta}</span>
          </>
        ) : (
          <span className="mp-card-sub">{blurb}</span>
        )}
        {error && <span className="mp-err">{error}</span>}
      </span>
      <span className="mp-actions">
        {doc ? (
          <>
            <button className="mp-pill" disabled={busy} onClick={onAttach}>Replace</button>
            <button className="mp-pill mp-pill-quiet" disabled={busy} onClick={onRemove}>Remove</button>
          </>
        ) : (
          <button className="mp-pill" disabled={busy} onClick={onAttach}>{attachLabel}</button>
        )}
      </span>
    </div>
  );
}

const FIELDS: Array<{ key: 'name' | 'lookingFor' | 'about' | 'jobDescription'; label: string; hint: string; rows?: number }> = [
  { key: 'name', label: 'Your name', hint: 'e.g. Alex Chen' },
  { key: 'lookingFor', label: "What you're looking for", hint: 'e.g. Senior frontend engineer role at a fintech' },
  { key: 'about', label: 'About you', hint: 'A few lines: your background, strengths, and how you want to come across.', rows: 4 },
  { key: 'jobDescription', label: 'Job description (optional)', hint: "Paste the job post you're interviewing for. Swap it for each interview.", rows: 7 },
];

function ProfileForm({ profile, onSaved, onBack }: { profile: Profile; onSaved: (p: Profile) => void; onBack: () => void }) {
  const [draft, setDraft] = useState(() => ({
    name: profile.name, lookingFor: profile.lookingFor, about: profile.about, jobDescription: profile.jobDescription,
  }));
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(draft);

  const save = useCallback(async () => {
    setStatus('saving');
    try {
      const r: Result = await api()?.saveClaudeProfileFields?.(latest.current);
      if (r?.profile) onSaved(r.profile);
      setStatus(r?.success === false ? 'error' : 'saved');
    } catch {
      setStatus('error');
    }
  }, [onSaved]);

  // Flush a pending edit when leaving the form.
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void save(); } }, [save]);

  const change = (key: keyof typeof draft, value: string) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    latest.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void save(); }, 600);
  };

  return (
    <div className="mp-form">
      <div className="mp-top">
        <button className="mp-icon-btn" aria-label="Back" onClick={onBack}><ArrowLeft size={16} strokeWidth={1.6} /></button>
        <span className="mp-save-status">
          {status === 'saving' ? 'Saving…' : status === 'saved' ? <><Check size={13} strokeWidth={2.2} /> Saved</> : status === 'error' ? 'Could not save' : ''}
        </span>
      </div>
      <h2>Your profile</h2>
      <p className="mp-form-sub">Short answers are fine. Natively turns these into the prompt for your Claude; it saves as you type.</p>
      <div className="mp-fields">
        {FIELDS.map((f) => (
          <label key={f.key} className="mp-field">
            <span>{f.label}</span>
            {f.rows ? (
              <textarea rows={f.rows} value={draft[f.key]} placeholder={f.hint} onChange={(e) => change(f.key, e.target.value)} />
            ) : (
              <input value={draft[f.key]} placeholder={f.hint} onChange={(e) => change(f.key, e.target.value)} />
            )}
          </label>
        ))}
      </div>
      <div className="mp-foot">
        <span />
        <button className="mp-done" onClick={onBack}>Done</button>
      </div>
    </div>
  );
}

const CSS = `
.mp-root { --bg:#161618; --card:#1f1f22; --line:rgba(255,255,255,0.07); --text:#f2f2f4; --sub:#9a9aa3; --chip:rgba(255,255,255,0.07);
  --pill:#f2f2f4; --pill-text:#111; --quiet:rgba(255,255,255,0.08); --ok:#7dd3a0; --err:#f28b9b; --input:#0f0f11;
  width:100%; height:100%; box-sizing:border-box; background:var(--bg); color:var(--text); padding:22px 28px 0;
  display:flex; flex-direction:column; overflow:hidden; font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif; }
.mp-light { --bg:#f7f6fb; --card:#ffffff; --line:rgba(20,16,40,0.08); --text:#17141f; --sub:#6c6878; --chip:rgba(20,16,40,0.06);
  --pill:#17141f; --pill-text:#fff; --quiet:rgba(20,16,40,0.07); --ok:#1f8a54; --err:#c43d55; --input:#ffffff; }
.mp-top { display:flex; align-items:center; justify-content:space-between; min-height:32px; }
.mp-icon-btn { width:32px; height:32px; border-radius:50%; border:1px solid var(--line); background:var(--chip); color:var(--text);
  display:inline-flex; align-items:center; justify-content:center; cursor:pointer; }
.mp-hero { text-align:center; margin:2px 0 18px; }
.mp-hero h1 { margin:0; font-size:34px; line-height:1.12; font-weight:700; letter-spacing:-0.02em; }
.mp-hero p { margin:10px auto 0; max-width:560px; font-size:14px; line-height:1.5; color:var(--sub); }
.mp-grid { display:grid; grid-template-columns:1fr 1fr; grid-template-rows:1fr 1fr; gap:12px; flex:1; min-height:0; max-height:330px;
  width:100%; max-width:660px; margin:0 auto; }
.mp-card { position:relative; display:flex; flex-direction:column; gap:10px; text-align:left; padding:18px; border-radius:18px;
  border:1px solid var(--line); background:var(--card); color:var(--text); font:inherit; overflow:hidden; min-width:0; }
button.mp-card { cursor:pointer; flex-direction:row; align-items:center; }
button.mp-card:hover, .mp-card:hover { border-color:rgba(255,255,255,0.16); }
.mp-light .mp-card:hover { border-color:rgba(20,16,40,0.18); }
.mp-tall { grid-row:span 2; justify-content:space-between; }
.mp-tint-violet { background:radial-gradient(120% 90% at 0% 0%, rgba(139,92,246,0.22), transparent 60%), var(--card); }
.mp-tint-green  { background:radial-gradient(120% 120% at 100% 0%, rgba(52,211,153,0.16), transparent 60%), var(--card); }
.mp-tint-rose   { background:radial-gradient(120% 120% at 100% 100%, rgba(244,114,182,0.17), transparent 60%), var(--card); }
.mp-chip { width:40px; height:40px; flex:0 0 40px; border-radius:12px; background:var(--chip); border:1px solid var(--line);
  display:inline-flex; align-items:center; justify-content:center; }
.mp-card-text { display:flex; flex-direction:column; gap:4px; min-width:0; flex:1; }
.mp-card-title { font-size:17px; font-weight:650; }
.mp-card:not(.mp-tall) { flex-direction:row; align-items:center; gap:14px; }
.mp-card:not(.mp-tall) .mp-actions { flex-direction:column; align-items:stretch; }
.mp-card-sub { font-size:13px; line-height:1.45; color:var(--sub); min-width:0; overflow:hidden;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
.mp-card-sub.mp-ok, .mp-card-sub.mp-busy { display:flex; align-items:center; gap:6px; }
.mp-ellip { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.mp-card-sub svg { flex:0 0 auto; }
.mp-card-meta { font-size:12px; color:var(--sub); }
.mp-ok { color:var(--ok); }
.mp-err { font-size:12px; line-height:1.4; color:var(--err); white-space:normal; }
.mp-actions { display:flex; gap:8px; flex-wrap:wrap; }
.mp-pill { border:none; border-radius:999px; padding:7px 14px; font:inherit; font-size:13px; font-weight:600; cursor:pointer;
  background:var(--pill); color:var(--pill-text); flex:0 0 auto; }
.mp-pill-quiet { background:var(--quiet); color:var(--text); }
.mp-pill:disabled { opacity:0.5; cursor:default; }
.mp-foot { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-top:16px; padding:16px 0 18px;
  border-top:1px solid var(--line); }
.mp-foot-status { font-size:12.5px; color:var(--sub); }
.mp-foot-status b { color:var(--text); font-weight:600; }
.mp-done { border:none; border-radius:999px; padding:10px 22px; font:inherit; font-size:14px; font-weight:600; cursor:pointer;
  background:var(--pill); color:var(--pill-text); }
.mp-form { display:flex; flex-direction:column; height:100%; min-height:0; }
.mp-form h2 { margin:8px 0 4px; font-size:24px; font-weight:700; letter-spacing:-0.01em; }
.mp-form-sub { margin:0 0 14px; font-size:13.5px; color:var(--sub); }
.mp-save-status { font-size:12.5px; color:var(--sub); display:inline-flex; align-items:center; gap:5px; }
.mp-fields { display:flex; flex-direction:column; gap:12px; overflow-y:auto; flex:1; min-height:0; padding-right:4px; }
.mp-field { display:flex; flex-direction:column; gap:6px; font-size:13px; font-weight:600; }
.mp-field input, .mp-field textarea { font:inherit; font-size:13.5px; font-weight:400; color:var(--text); background:var(--input);
  border:1px solid var(--line); border-radius:10px; padding:10px 12px; outline:none; resize:vertical; line-height:1.5; }
.mp-field input:focus, .mp-field textarea:focus { border-color:rgba(139,92,246,0.6); }
.mp-spin { animation:mp-spin 0.9s linear infinite; }
@keyframes mp-spin { to { transform:rotate(360deg); } }
`;

export default MyProfilePanel;
