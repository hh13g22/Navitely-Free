/**
 * The user's own profile for the `claudecode` provider: name, what they are
 * looking for, a short about-me, an optional job post, and the text of an
 * attached CV and cover letter. Stored as JSON in userData — no license, no
 * embeddings, no server. LLMHelper prepends the block built here to the Claude
 * Code system prompt; the continuous session means it is sent once per change.
 *
 * Pure + node-only (no electron) so it is unit-testable. Callers pass the path.
 */

import fs from 'fs';

/** Lives in the app's userData dir (ipcHandlers + LLMHelper join it). */
export const CLAUDE_PROFILE_FILE = 'claude-profile.json';

/** Per-document cap: a long CV must not swamp the session. ~10k tokens. */
export const PROFILE_DOC_MAX_CHARS = 40_000;

export type ProfileDocKind = 'resume' | 'coverLetter';

export interface ProfileDoc {
  fileName: string;
  text: string;
  pages?: number;
  truncated?: boolean;
  addedAt: number;
}

export interface ClaudeProfile {
  name: string;
  lookingFor: string;
  about: string;
  jobDescription: string;
  resume: ProfileDoc | null;
  coverLetter: ProfileDoc | null;
}

export const PROFILE_TEXT_FIELDS = ['name', 'lookingFor', 'about', 'jobDescription'] as const;
export type ProfileTextField = typeof PROFILE_TEXT_FIELDS[number];

export function emptyProfile(): ClaudeProfile {
  return { name: '', lookingFor: '', about: '', jobDescription: '', resume: null, coverLetter: null };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function normalizeDoc(v: unknown): ProfileDoc | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  const text = str(d.text);
  if (!text.trim()) return null;
  return {
    fileName: str(d.fileName) || 'document',
    text,
    ...(typeof d.pages === 'number' ? { pages: d.pages } : {}),
    ...(d.truncated === true ? { truncated: true } : {}),
    addedAt: typeof d.addedAt === 'number' ? d.addedAt : 0,
  };
}

/** Any stored value → a well-formed profile (unknown keys dropped). */
export function normalizeProfile(raw: unknown): ClaudeProfile {
  const p = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    name: str(p.name),
    lookingFor: str(p.lookingFor),
    about: str(p.about),
    jobDescription: str(p.jobDescription),
    resume: normalizeDoc(p.resume),
    coverLetter: normalizeDoc(p.coverLetter),
  };
}

/** Extracted document text → a stored doc, capped at PROFILE_DOC_MAX_CHARS. */
export function makeProfileDoc(fileName: string, text: string, pages?: number, now = Date.now()): ProfileDoc {
  const clean = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const truncated = clean.length > PROFILE_DOC_MAX_CHARS;
  return {
    fileName,
    text: truncated ? clean.slice(0, PROFILE_DOC_MAX_CHARS) : clean,
    ...(pages ? { pages } : {}),
    ...(truncated ? { truncated: true } : {}),
    addedAt: now,
  };
}

/** The block prepended to Claude's system prompt, or '' when nothing is set. */
export function profileContextBlock(p: ClaudeProfile): string {
  const parts: string[] = [];
  const name = p.name.trim();
  const lookingFor = p.lookingFor.trim();
  if (name) parts.push(`Name: ${name}`);
  if (lookingFor) parts.push(`Looking for: ${lookingFor}`);
  const section = (title: string, body: string) => {
    if (body.trim()) parts.push(`## ${title}\n${body.trim()}`);
  };
  section('About me', p.about);
  section("Job description (the role I'm interviewing for)", p.jobDescription);
  if (p.resume) section(`CV / résumé (from ${p.resume.fileName})`, p.resume.text);
  if (p.coverLetter) section(`Cover letter (from ${p.coverLetter.fileName})`, p.coverLetter.text);
  if (!parts.length) return '';
  return [
    '<my_context>',
    'The person you are helping (the candidate) gave you the following about themselves. Answer as them, drawing on their real experience; do not read this back verbatim or invent experience they do not have.',
    '',
    parts.join('\n\n'),
    '</my_context>',
  ].join('\n');
}

/** Read the stored profile; a missing or corrupt file is an empty profile. */
export function readProfile(filePath: string): ClaudeProfile {
  try {
    return normalizeProfile(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return emptyProfile();
  }
}

/** Write atomically (temp + rename) so a crash never leaves half a file. */
export function writeProfile(filePath: string, p: ClaudeProfile): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(normalizeProfile(p), null, 2));
  fs.renameSync(tmp, filePath);
}

/** What LLMHelper calls each Claude Code turn. Never throws. */
export function readProfileContext(filePath: string): string {
  try {
    return profileContextBlock(readProfile(filePath));
  } catch {
    return '';
  }
}

/** The profile as the panel sees it: documents reduced to name + size. */
export function profileSummary(p: ClaudeProfile) {
  const doc = (d: ProfileDoc | null) =>
    d ? { fileName: d.fileName, chars: d.text.length, pages: d.pages, truncated: !!d.truncated, addedAt: d.addedAt } : null;
  return {
    name: p.name,
    lookingFor: p.lookingFor,
    about: p.about,
    jobDescription: p.jobDescription,
    resume: doc(p.resume),
    coverLetter: doc(p.coverLetter),
  };
}
