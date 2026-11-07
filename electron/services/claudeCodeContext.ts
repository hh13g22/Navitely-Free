/**
 * The user's own interview context (about-you / résumé / target job) for the
 * `claudecode` provider. It is a plain file the user edits — no license, no
 * embeddings, no server. LLMHelper prepends it to the Claude Code system prompt
 * so every answer is tailored; the one continuous session means it is sent once
 * and remembered for the run.
 *
 * Pure + node-only (no electron) so it is unit-testable. The caller supplies the
 * path; the filename constant keeps the panel's IPC and the reader in sync.
 */

import fs from 'fs';

/** Lives in the app's userData dir. The panel's IPC and LLMHelper both use it. */
export const CLAUDE_CODE_CONTEXT_FILE = 'claude-code-context.md';

/** What a brand-new context file holds: headings the user fills in. */
export const CLAUDE_CODE_CONTEXT_TEMPLATE = `# My Claude context

<!--
Everything you write below is sent to your own Claude so it can tailor answers
to you. Edit freely, save, and it takes effect on the next answer. Nothing here
leaves your machine except to the Claude you are logged in to. While this file
still holds only these headings and comments, nothing is sent.
-->

## About me
<!-- A few lines: who you are, your background, how you want to come across. -->

## My resume
<!-- Paste your resume text here (a PDF? open it, copy the text, paste it). -->

## The job I'm interviewing for
<!-- Paste the job post / role you are targeting. Swap this out per interview. -->
`;

/**
 * Wrap the user's context as an instruction block for the model, or '' when it
 * is empty or still only the template's comments. Trims, and drops the file if
 * the user has written nothing but the scaffold.
 */
export function claudeCodeContextBlock(raw: string | null | undefined): string {
  const text = (raw ?? '').trim();
  if (!text) return '';
  // Nothing but headings and <!-- comments --> → treat as unset.
  const meat = text.replace(/<!--[\s\S]*?-->/g, '').replace(/^#.*$/gm, '').trim();
  if (!meat) return '';
  return `<my_context>\nThe person you are helping provided the following about themselves and the role they want. Use it to tailor your answers; do not read it back verbatim.\n\n${text}\n</my_context>`;
}

/** Read + wrap the context file. Never throws: a missing/locked file is just ''. */
export function readClaudeCodeContextFile(filePath: string): string {
  try {
    return claudeCodeContextBlock(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return '';
  }
}
