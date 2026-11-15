/** Sichtbarer Freigabetext für `#take-body` (BUG-0014). Title allein reicht
 * nicht — der Hub-Summary ist oft leer/kurz; `body` trägt action · tool. */
export function takeBodyText(payload: { title: string; body: string }): string {
  const title = payload.title.trim();
  const body = payload.body.trim();
  if (title !== "" && body !== "" && title !== body) return `${title}\n${body}`;
  return title !== "" ? title : body;
}
