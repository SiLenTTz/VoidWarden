# ADR-0001 — Display-Akteur: minimal berechtigt, entscheidet nur `write`

**Status:** akzeptiert und vom Projektinhaber bestätigt (2026-11-02) · **Gegenseite:** umgesetzt als
AncientVoid ADR-0048, MR !290 (`feat/policy-display-akteur`), **gemergt** (`b8dad00` auf AncientVoid origin/main; externe Abhängigkeit **AV-D1** erfüllt) · **Betrifft:** EPIC-P1, EPIC-P3,
`docs/spec.md` §1, §10

## Kontext

AncientVoids Policy (ADR-0021) kennt fünf Akteure. `approvals.decide` erlauben
nur `human` und `fleet`; `agent` und `companion` sind gesperrt. Ein
VoidWarden-Companion mit menschlichem Geräte-Token könnte *alles*, was ein
Mensch darf (Sessions stoppen, Tokens verwalten, Flotte) — für ein Gerät, das
nur anzeigen und `write`-Freigaben erteilen soll, ist das zu mächtig. Zugleich
verlangt ADR-0007, dass `destructive` nur per WebAuthn entschieden wird; ein
ESP32 kann das nicht.

## Entscheidung

1. VoidWarden nutzt einen **eigenen Akteur `display:<name>`** (Token-Label).
   Zielrechte: `read` = allow; `approvals.decide` = allow **nur** für Klasse
   `write` und nur ohne `reasonRequired`; alles andere = deny. `destructive`
   bleibt für diesen Akteur 403.
2. Bis der AncientVoid-MR !290 gemergt ist (AV-D1), läuft VoidWarden **nur lesend**
   mit `agent:voidwarden` (Policy `read`=allow, `approvals.decide`=deny). EPIC-P3
   beginnt nicht, bevor AV-D1 verfügbar ist **oder** per neuem ADR eine
   dokumentierte Übergangslösung gewählt wurde. Ein menschliches Token wird nie
   als Übergang verwendet.
3. Die Entscheidung des Geräts wird im Hub-Audit (`session.approval_decided`)
   mit Label `display:<name>` sichtbar (wer-wann-was, PRD §8.4).
4. Der Companion prüft **vor** jedem `decide` selbst `class`, `status` und
   `reasonRequired` aus dem frisch gelesenen `ApprovalRequest` und sendet
   `decidable:false` an das Gerät, wenn eine Bedingung nicht passt
   (Defense in Depth; die Hub-Policy bleibt die harte Grenze).

## Umsetzung AV-D1 (AncientVoid-Repo)

Umgesetzt am 2026-11-02 auf `feat/policy-display-akteur` (Gate lokal grün,
E2E 280 grün / 2 Skips), MR !290 offen. Zielzustand und Prüfliste:

1. ADR in `AncientVoid/docs/adr/` (nächste freie Nummer), das diesen ADR referenziert.
2. `packages/contracts/src/approvals/policy.ts`: `DISPLAY_TOKEN_PREFIX = "display:"`,
   `ActorKind` um `"display"` erweitern, `actorKind()` und jede Zeile der
   `POLICY`-Tabelle ergänzen: `read` = allow, `approvals.decide` = allow,
   alle übrigen Operationen = deny.
3. Hub-Seite: `approvals.decide` für `display` nur bei Klasse `write` und
   `reasonRequired === false`, sonst 403; Token-Routenbegrenzung analog
   `companionTokenAllows` in `apps/hub/src/platform/auth.ts`
   (nur `GET` der Lese-Routen und `POST /api/approvals/:id/decide`).
4. `hubctl token issue <name> --display` (Label `display:<name>`).
5. Tests: Invarianten in `policy.test.ts` (display entscheidet nie `destructive`,
   hat nie `allow` außer `read` und `approvals.decide`), Auth-Test (andere Routen 403),
   Test `destructive` → 403.
6. AncientVoid-Gate (`npm run gate`) grün; MR dort, Merge nur über GitLab.

Umgesetzte Details gegenüber dem Plan: Route-Grenze `displayTokenAllows` erlaubt nur
`GET` auf Health, Ready, Notifications, Sessions (Liste/Detail), Approvals
(Liste/Detail) und `POST /api/approvals/:id/decide`; `tool.question` ist am
Display ebenfalls 403; Loopback ohne Tailnet-Header ist erlaubt. **Nicht**
erreichbar sind Session-Events/WS-Tail sowie Loop-/Factory-Routen.
EPIC-P3 T3.1 wird abgehakt, sobald !290 gemergt ist.

## Konsequenzen

- AncientVoid-Änderung: `ActorKind` + `POLICY`-Tabelle + Invarianten-Test
  (`policy.test.ts`) erweitern; Contract-Änderung → dortiges ADR.
- VoidWarden testet gegen einen Fake-Hub, der die Zielpolicy nachbildet, und
  zusätzlich (sobald verfügbar) gegen den echten Hub (`test:hub`).
