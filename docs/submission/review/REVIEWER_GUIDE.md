# Native-speaker review: a guide for reviewers

Thank you for helping. Neighborline is a hotline for neighborhood mutual-aid groups: after a storm or a fire, a
neighbor leaves a voice note in their own language, two volunteers approve it, and money arrives in their PayPal or
Venmo. Everything the neighbor reads or hears was written ahead of time in their language, by an AI, and **no native
speaker has checked it yet**. You are that check.

The people reading these messages may be elderly, tired, cold, frightened, new to the country, or not used to
reading on a phone. A message that is grammatically right but cold, bossy or confusing is a failure.

## Your file

| Language | File | Rows | Rows shown in the demo video | Status: machine-assisted, pending native review | Rows with no translation yet |
|---|---|---|---|---|---|
| Vietnamese | [vi.csv](vi.csv) | 197 | 16 | 89 | 0 |
| Spanish | [es.csv](es.csv) | 120 | 14 | 11 | 0 |
| Haitian Creole | [ht.csv](ht.csv) | 115 | 0 | 5 | 0 |
| Chinese (Simplified) | [zh.csv](zh.csv) | 110 | 0 | 21 | 0 |
| Arabic (MSA) | [ar.csv](ar.csv) | 110 | 0 | 5 | 0 |
| Korean | [ko.csv](ko.csv) | 110 | 0 | 34 | 0 |
| Russian | [ru.csv](ru.csv) | 110 | 0 | 34 | 0 |
| French | [fr.csv](fr.csv) | 110 | 0 | 37 | 0 |
| Tagalog | [tl.csv](tl.csv) | 110 | 0 | 35 | 0 |

The **Status** column says *machine-assisted, pending native review* on every row that was not in the first packet:
the gaps we have since filled (Chinese, Korean, Russian, French and Tagalog status, decline and appeal messages, and
the message catalog for the last four), the `/call` microphone lines in every language, the Spanish rows we made
gender-neutral, and the Vietnamese forms of address (below). Please look at those first after the video rows. An
empty Status means the text is unchanged since the first packet (still AI-written and unreviewed).

Open it in Google Sheets (File → Import → Upload) or Excel (it is UTF-8 with a BOM, so accents and Arabic display
correctly). One row is one piece of text. Fill in the last two columns:

- **OK? (Y / N / ?)**: `Y` if you would be happy for your own grandmother to receive it; `N` if it must change; `?` if
  you're unsure (say why).
- **Suggested fix**: your wording. Keep every `{slot}` exactly as it is (see below). A short note on *why* helps
  ("too formal", "sounds like a bank", "wrong word in Haiti").

Order: rows with an **In video** time first (Vietnamese and Spanish; the video is public), then the
*machine-assisted* rows, then *Message catalog*, *Read-back framing*, *Web line status messages*, *Web line UI*,
*PayPal / Venmo payout text*, *Phone line prompts*. Expect 60–90 minutes per language (Vietnamese longer: it has the
elder and peer variants). There are no gaps left; if a row ever has an empty "Translation under review", the neighbor
sees English there today, and your translation becomes the first one.

**Columns you can use for context:** *Where it appears* (the screen or moment), *Screenshot* (an image in
`apps/web/screenshots/`), *In video* (a time in the demo video), *English source* (what we meant). The *Source* column
is for us: it is the file and line we will change.

## What to look for

1. **Respect and warmth.** It should sound like a kind neighbor, not a bank, a government office or a robot. Nothing
   should sound like the person is being judged, tested or suspected. "This is not a judgment about you" is deliberate.
2. **Register: how we address the person.** We chose one polite form per language. Tell us if it is wrong for an
   elder, or if a better neutral form exists.
   - **Vietnamese:** the neighbor is addressed the way they speak. The intake listens for how the person refers to
     themselves ("tôi là **bà** Lan" → bà; "em là Hoa" → em) or, failing that, whether they thank the volunteers as
     "các cháu" / "mấy con" (→ **bác**). Never from a guess about age or gender, and never from words about someone
     else ("ông nhà tôi" is her husband). Each Vietnamese message then exists in three versions, written whole:
     - neutral (**bạn**, volunteers say **chúng tôi**): when we heard no form. Rows without a suffix.
     - **elder** (bà, ông, cô, chú, bác; volunteers say **chúng cháu**, with **ạ** / **Dạ**): rows whose ID ends in
       "› elder". `{you}` is the form mid-sentence ("của bà"), `{You}` at the start of a sentence ("Bà xem giúp…").
     - **peer** (anh, chị, em; volunteers say **chúng tôi**, no **ạ**): rows ending in "› peer".
     Mrs. Lan calls herself **bà** and the volunteers **các cháu**, so the video now shows the elder forms ("Chào bà
     Lan ạ. Chúng cháu đã gửi $150 vào Venmo của bà."). Please check: is "chúng cháu" right for a volunteer service
     talking to an elder? Is "ạ" overused? Is "bác" the right fallback for an elder whose form we did not hear? Should
     "em" be addressed as "em", or is "bạn" kinder from a service? The screen chrome (buttons, placeholders) stays
     neutral: it is shown before we have heard anything.
   - **Spanish:** **usted** throughout, and no gender assumed for the neighbor or the volunteer: "le llamemos y le
     ayudemos" (not "la llamemos para ayudarla"), "el dinero se guarda para usted" (not "la espera"), "alguien / una
     persona del grupo" (not "una organizadora" / "un voluntario"). Tell us if any row still assumes a gender, or if
     the neutral wording sounds stiff.
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
7. **Machine-assisted rows** (*Status* column) were written after the first packet without a native speaker. Read
   them as carefully as the video rows: wrong register, an unnatural word order, or a word nobody in your community
   uses are all worth an `N`.

## Known issues we already see (no need to report, but tell us if you see more)

- Fixed since the first packet: the English line ("EN …") under each message now translates the very message the
  neighbor got (same template, same amounts). Before, the "approved, sending" bubble's English line came from a
  different template. The `/call` microphone errors are translated into every language now (they are in your file),
  and the Chinese, Korean, Russian, French and Tagalog gaps are filled (marked *machine-assisted*).
- Tagalog uses **mo / iyong** and rarely **po**; the new rows keep that so one thread does not switch register. Tell us
  if every requester message should use **po**.
- A language outside these ten (say, Portuguese) still gets a machine translation with a back-translation fact check,
  or the English if the check fails.

## Sending it back

Return the CSV (or share the sheet) to the team. We apply each fix at the *Source* file and line, then regenerate the
files with:

```bash
node docs/submission/review/extract.mjs           # rewrites <lang>.csv and strings.json from the code
node docs/submission/review/extract.mjs --check   # fails if the CSVs are out of date with the code
```

Your name (or "anonymous") goes in the README's acknowledgements if you want. Thank you.
