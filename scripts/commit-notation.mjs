/**
 * Arlo's Commit Notation as this repo uses it (docs/commit-notation.md).
 * Shared by .githooks/commit-msg and scripts/check-commits.mjs.
 */
export const NOTATION = /^([.^!@]) ([FBrdteam]) ([a-z0-9][a-z0-9./-]*): (\S.*)$/;

/** Null when the subject is fine, else the reason in words. */
export function checkSubject(subject) {
  if (/^(fixup|squash|amend)! /.test(subject)) return null; // git's own rebase helpers
  if (/^Merge branch '/.test(subject)) return null; // local merge into a feature branch
  if (!NOTATION.test(subject)) {
    return `"${subject}" folgt nicht der Commit-Notation "<Risiko> <Absicht> <bereich>: <Satz>", z. B. "^ F pwa: Einladung als QR-Code" (docs/commit-notation.md)`;
  }
  if (subject.length > 100) return `Zusammenfassung länger als 100 Zeichen: "${subject.slice(0, 60)}…"`;
  return null;
}
