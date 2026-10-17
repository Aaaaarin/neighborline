# Native-speaker review: a guide for reviewers

Thank you for helping. Neighborline is a hotline for neighborhood mutual-aid groups: after a storm or a fire, a
neighbor leaves a voice note in their own language, two volunteers approve it, and money arrives in their PayPal or
Venmo. Everything the neighbor reads or hears was written ahead of time in their language, by an AI, and **no native
speaker has checked it yet**. You are that check.

The people reading these messages may be elderly, tired, cold, frightened, new to the country, or not used to
reading on a phone. A message that is grammatically right but cold, bossy or confusing is a failure.

## Your file

| Language | File | Rows | Rows shown in the demo video | Rows with no translation yet |
|---|---|---|---|---|
| Vietnamese | [vi.csv](vi.csv) | 110 | 15 | 0 |
| Spanish | [es.csv](es.csv) | 115 | 14 | 0 |
| Haitian Creole | [ht.csv](ht.csv) | 110 | 0 | 0 |
| Chinese (Simplified) | [zh.csv](zh.csv) | 105 | 0 | 18 |
| Arabic (MSA) | [ar.csv](ar.csv) | 105 | 0 | 0 |
| Korean | [ko.csv](ko.csv) | 111 | 0 | 34 |
| Russian | [ru.csv](ru.csv) | 111 | 0 | 34 |
| French | [fr.csv](fr.csv) | 113 | 0 | 34 |
| Tagalog | [tl.csv](tl.csv) | 111 | 0 | 34 |

Open it in Google Sheets (File → Import → Upload) or Excel (it is UTF-8 with a BOM, so accents and Arabic display
correctly). One row is one piece of text. Fill in the last two columns:

- **OK? (Y / N / ?)**: `Y` if you would be happy for your own grandmother to receive it; `N` if it must change; `?` if
  you're unsure (say why).
- **Suggested fix**: your wording. Keep every `{slot}` exactly as it is (see below). A short note on *why* helps
  ("too formal", "sounds like a bank", "wrong word in Haiti").

Order: rows with an **In video** time first (Vietnamese and Spanish; the video is public), then *Message catalog*,
*Read-back framing*, *Web line status messages*, *Web line UI*, *PayPal / Venmo payout text*, *Phone line prompts*.
Expect 60–90 minutes per language. Rows with an empty "Translation under review" are gaps: the neighbor sees English
today, and your translation becomes the first one.

**Columns you can use for context:** *Where it appears* (the screen or moment), *Screenshot* (an image in
`apps/web/screenshots/`), *In video* (a time in the demo video), *English source* (what we meant). The *Source* column
is for us: it is the file and line we will change.

## What to look for

1. **Respect and warmth.** It should sound like a kind neighbor, not a bank, a government office or a robot. Nothing
   should sound like the person is being judged, tested or suspected. "This is not a judgment about you" is deliberate.
2. **Register: how we address the person.** We chose one polite form per language. Tell us if it is wrong for an
   elder, or if a better neutral form exists.
   - **Vietnamese:** we use **bạn** everywhere. Mrs. Lan calls herself **bà** and the volunteers **các cháu** in her
     voice note, and the app still answers her with "bạn". Is that acceptable from a service, or should it be
     **cô / bác / bà / anh / chị**, or a form that avoids the pronoun ("Xin cảm ơn ạ", using **ạ** and **nhé**)? We do
     not know the person's age or gender in advance, so the best answer may be a pronoun-free phrasing. Please mark
     every row where "bạn" feels wrong.
   - **Spanish:** **usted** throughout. Some texts assume a woman ("la llamemos para ayudarla", "El dinero la espera",
     "una organizadora"). These must work for anyone: suggest neutral wording.
   - **Haitian Creole:** **ou / w**. Check that it reads as Haitian Creole, not French with Creole spelling.
   - **Arabic:** Modern Standard Arabic, masculine-singular imperatives ("اعتنِ بنفسك"). Is MSA right for this audience,
     and how should we handle gender?
   - **Chinese:** **您**. **Korean:** polite 존댓말. **Russian** and **French:** **вы / vous**. **Tagalog:** we rarely
     use **po/opo**; should we?
3. **Clarity for low literacy.** Short sentences, everyday words, one idea per sentence. No jargon ("payout",
   "transaction", "claim" may need plainer words). Would someone who reads slowly, or hears it read aloud, understand
   it the first time?
4. **Money and names must stay exact.** `{amount}`, `{wallet}`, `{name}`, `{receiver}`, `{group}`, `{n}`, `{label}`,
   `{tx}` are filled by code. Keep them, keep the brand names **PayPal** and **Venmo** as written, and don't add
   numbers. Text inside `[[ ]]` is dropped when the name is unknown (for example "[[Chào {name}. ]]"), so the rest
   must still read well without it.
5. **Spoken text.** *Phone line prompts* and the read-back are heard, not read: check that they sound natural aloud
   ("press 1" / "bấm số 1").
6. **Fixture rows** (*Demo scenario fixture*) are the fictional neighbors' own words and the AI's summary of them.
   Check that Mrs. Lan sounds like a real older Vietnamese speaker and Rosa like a real Spanish speaker, and that the
   summary read back to them is faithful and polite.
7. **Machine-translation rows** show the back-translation in *Where it appears*; check the translation, not the
   back-translation.

## Known issues we already see (no need to report, but tell us if you see more)

- Under each message the app shows an English line ("EN …") for the volunteers. For the "approved, sending" message the
  English line says "Two neighbors said yes. Sending the money through PayPal now…" while the Vietnamese/Spanish says
  "Good news: your request was approved. We are sending $150 to your Venmo." (`apps/web/lib/server/engine/engine.ts`
  uses a different template for the English twin). The meaning is close but not the same; this is visible in the video.
- A few `/call` error lines are English-only in every language ("The microphone is blocked.", "This browser can't
  record audio.", in `apps/web/components/call/ComposeParts.tsx` and `ReplyDock.tsx`), so they are not in your file.
- Chinese, Korean, Russian, French and Tagalog neighbors get some thread messages in English (the empty rows), and
  Korean, Russian, French and Tagalog get the core catalog messages through a machine translation with a
  back-translation fact check (in live AI mode; offline, only the few rows marked *Machine translation* exist).

## Sending it back

Return the CSV (or share the sheet) to the team. We apply each fix at the *Source* file and line, then regenerate the
files with:

```bash
node docs/submission/review/extract.mjs           # rewrites <lang>.csv and strings.json from the code
node docs/submission/review/extract.mjs --check   # fails if the CSVs are out of date with the code
```

Your name (or "anonymous") goes in the README's acknowledgements if you want. Thank you.
