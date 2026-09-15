# Privat-grind — driftsättning

Den här mappen innehåller Cloudflare Workern som skyddar `/privat/*`
på riktigt (server-side), istället för det gamla låset som bara var
ett CSS-lager ovanpå data som redan låg i sidkällan.

**VIKTIGT — ordningen spelar roll.** HTML-sidorna i repot (`privat/`,
`privat/mobler/`, `privat/inkopslista/`, `privat/recept/`) postar nu
till `/privat-api/unlock` istället för att jämföra koden lokalt i
webbläsaren. Om de sidorna går live på GitHub Pages **innan** Workern
är igång, kan ingen låsa upp sidorna längre (formuläret pratar med en
endpoint som inte finns än). Gör därför stegen nedan i ordning, och
vänta med att publicera HTML-ändringarna till sist.

## 1. Domänen i Cloudflare (pågår/klart)

Lägg till domänen i Cloudflare, importera DNS-posterna (de pekar redan
rätt mot GitHub Pages — inget att ändra där) och byt namnservrar hos
registrarn (Loopia) till de Cloudflare tilldelar. Kan ta allt från
några minuter till några timmar innan Cloudflare visar zonen som
**Active**.

## 2. Skapa Workern

1. Cloudflare-dashboarden → **Workers & Pages** → **Create** →
   **Create Worker**.
2. Ge den ett namn, t.ex. `kv21-privat-gate`. Deploya (den startar
   med exempelkod, det är okej — vi ersätter den).
3. Öppna workern → **Edit code** (Quick edit / online-editorn, inget
   kommandoradsverktyg behövs).
4. Klistra in hela innehållet från `privat-gate.js` i den här mappen.
   Spara och deploya.

## 3. Sätt de hemliga variablerna

Workern → **Settings** → **Variables and Secrets** → **Add**:

| Namn | Typ | Värde |
|---|---|---|
| `PRIVAT_CODE` | **Encrypt** (secret) | Den riktiga koden ni vill ha, t.ex. `7391` — byt bort från `2121` som legat i klartext i repot |
| `COOKIE_SECRET` | **Encrypt** (secret) | En lång slumpad sträng. Generera t.ex. med `openssl rand -hex 32` i en terminal, eller vilken lång slumpad text som helst |

Spara/deploya igen efter att båda är satta.

## 4. Koppla Workern till domänen (Route)

Workern → **Settings** → **Triggers** → **Routes** → **Add route**:

- Route: `kristiansandsvägen21.se/*` (hela zonen — Workern avgör själv
  internt vilka paths den ska röra vid, allt annat skickas vidare
  oförändrat)
- Zone: er domän

## 5. SSL/TLS-läge

Cloudflare-dashboarden → **SSL/TLS** → sätt till **Full** (inte
"Flexible" — det ger omdirigerings-loopar mot GitHub Pages, som redan
har eget certifikat).

## 6. Testa Workern INNAN HTML:en publiceras

Med Workern live men de gamla HTML-sidorna (med lokal SHA-256-koll)
fortfarande kvar på GitHub Pages fungerar sidorna exakt som förut —
Workern rör bara `/privat-api/*`, som inte anropas av den gamla koden.
Testa att Workern själv svarar:

```
curl -i -X POST https://kristiansandsvägen21.se/privat-api/unlock \
  -H "content-type: application/json" \
  -d '{"code":"fel-kod"}'
```

Ska ge `401` och `{"ok":false}`. Testa sedan med rätt kod (samma som
`PRIVAT_CODE`) — ska ge `200`, `{"ok":true}` och en `Set-Cookie`-rad.

## 7. Publicera HTML-ändringarna

När Workern är bekräftat igång: säg till, så pushar jag
HTML-ändringarna (redan klara på arbetsgrenen) till `main`. Då byter
låsformulären över till att prata med Workern, och den hemliga datan
(`private-data`-taggarna i `privat/` och `privat/mobler/`) slutar
skickas till obehöriga besökare.

## Att komma ihåg framöver

- **Byt kod**: uppdatera `PRIVAT_CODE` i Cloudflare — inget att ändra
  i repot.
- **Logga ut alla på en gång**: ändra `COOKIE_SECRET` i Cloudflare,
  så blir alla utfärdade cookies ogiltiga direkt.
- Detta skyddar de **statiska HTML-sidorna**. Inköpslistan, möbellistan
  och recepten synkas separat via Firebase Firestore, vars
  säkerhetsregler är ett eget ämne (inte det den här Workern löser).
