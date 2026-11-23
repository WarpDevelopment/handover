# Mac owner session: one 15-minute checklist

Merges `docs/recorder/smoke/L5.md` (click helper) with the L4 checks (Explain, review, blur), plus narration, pause, export and diagnostics. Run it with the app from this checkout (`npm run dev`, after `npm run build:helper:mac`) or the CI macOS zip. Where L4's button names are not final they are marked "(label may differ slightly)".

The exported package from this session is what a fresh Claude will read, with nothing else, and be scored on rebuilding **the known test process** below. So do the steps exactly, in order, and say the narration lines.

## 0. Permissions (about 3 minutes)
| # | Do | Expect | Result |
|---|----|--------|--------|
| P1 | System Settings → Privacy & Security → **Screen Recording**: enable Handover. | Granted. Restart the app if asked. | |
| P2 | **Accessibility**: add and enable Handover (and `HandoverHelper` if listed). Restart the app. | Granted. | |
| P3 | **Microphone**: start a recording with Narrate on and allow the prompt. | Granted. | |
| P4 | Run `native/build/HandoverHelper --selftest`, or open the doctor. | `accessibilityTrusted: true`, doctor `helper: ok` with a version. | |

For the no-grant behaviour (L5 section A: `permission_missing`, `visual_only` steps) and helper-missing (L5 section C), follow `docs/recorder/smoke/L5.md`. They are not part of the 15 minutes.

## The known test process: "Meeting note to Desktop"
Title: **Save a meeting note**. Apps: Finder, TextEdit, Safari. Use test data only. Every step is one click unless stated. Do them in this order and pause about 2 seconds between steps.

| # | Exact action | Narration line (say it as you act) | Expected step (what the package should show) |
|---|---|---|---|
| 1 | In **Finder**, click **Desktop** in the sidebar. | "I start in Finder and open the Desktop folder, because the note will be saved there." | click, listitem "Desktop", Finder |
| 2 | Open **TextEdit** (Spotlight: Cmd+Space, type TextEdit, Enter), and in the new document click the text area. | "I open TextEdit to write the meeting note." | app switch to TextEdit, then click in the text area (textbox, name may be empty, weak) |
| 3 | Type the text `Meeting note: agree supplier delivery for Friday.` (typing is not recorded; this is only what you write.) Then click the **File** menu in the menu bar. | "I type a short note and open the File menu to save it." | click menuitem "File", TextEdit |
| 4 | Click **Save…** in the File menu. In the save sheet click **Save** (name it `handover-mac-test`, where: Desktop). | "I save the note to the Desktop as handover-mac-test." | click menuitem "Save…", then click button "Save" |
| 5 | **Explain** (see section A below), while TextEdit is visible. | (comment text, see section A) | highlights H1, H2, H3 and one comment on the last step before the freeze |
| 6 | Open **Safari**, click the address bar, type `https://example.com`, press Enter, then click the link **More information…**. | "I check the supplier site, example.com, to confirm the delivery policy." | app switch to Safari, click address bar (textbox/combobox), click link |
| 7 | **Pause** (section B). | "I am pausing now; the next bit should not appear." | `gaps.jsonl` has a `user_paused` gap |
| 8 | **Resume**, and click **Desktop** in Finder again to finish. | "That is done: the note is saved on the Desktop." | click listitem "Desktop", Finder |

Reference answer (the scorer's key): the process is **8 actions in 3 apps**, in this order: open Desktop in Finder; open TextEdit and click the text area; open File menu; Save…, Save (file `handover-mac-test` on the Desktop); Explain annotations on the saved note; open Safari, visit example.com, click the link; paused interval excluded; return to Finder Desktop. Decision points: none. Inputs: the typed note text and the file name. Outputs: `handover-mac-test.rtf` (or `.txt`) on the Desktop. Systems: Finder, TextEdit, Safari. The pause must not appear as a step.

## A. Explain: box, arrow, comment (step 5)
| # | Do | Expect | Result |
|---|----|--------|--------|
| A1 | While recording, with TextEdit visible, press **Cmd+Shift+E** (or click the **Explain** button on the floating bar; label may differ slightly). | The screen freezes on every display; the tool buttons are visible with labels; the comment box takes focus straight away. | |
| A2 | Draw a **box** around the document title bar, an **arrow** at your typed text, and a **highlight** over the text line (tool names may differ slightly). | Each shape stays visible while you type. | |
| A3 | Type the comment `This is the note the supplier needs.` and press **Enter** (or **Done**; label may differ slightly). | The overlay closes; the live screen is unchanged. | |
| A4 | Press **Cmd+Shift+E** again, draw one box, press **Esc**. | Nothing is saved. | |
| A5 | If you have two displays, repeat A1 to A3 on the second one. | Both displays freeze; marks land where drawn. | |
| A6 | Note: clicks you made on the overlay must **not** appear as steps. | Confirmed in the review screen. | |

## B. Pause, resume and narration (steps 7 and 8)
| # | Do | Expect | Result |
|---|----|--------|--------|
| B1 | Narrate is on from the start (set it in the main window before pressing record). Speak the narration lines in the table above. | The bar shows the microphone on. | |
| B2 | Click **Pause** on the bar (label may differ slightly), open Calculator for 10 s, click **Resume**. | Timer stops and restarts; Calculator is not a step. | |
| B3 | Click **Done** on the bar. | Saved. | |

## C. Review: delete, edit and blur
Open **Review sessions**, pick the recording. (Screen is new; labels may differ slightly.)
| # | Do | Expect | Result |
|---|----|--------|--------|
| C1 | Delete a **spare** step: add one extra throwaway click in Finder during recording, or delete the duplicate "TextEdit text area" step if one appears. Keep the 8 process steps. | The step vanishes; the rest renumber. | |
| C2 | Edit the comment (change "supplier" to "customer") or a step summary. | Marked as edited. | |
| C3 | Blur the typed note text on the TextEdit screenshot. | Blocky only inside the rectangle. | |

## D. Export and diagnostics
| # | Do | Expect | Result |
|---|----|--------|--------|
| D1 | **Export package**, choose the Desktop. | A message with the step count; folder `.handover` and `.zip` on the Desktop. | |
| D2 | Open `PROCESS.md`. | Steps match the table above; narration lines present; comment under the step it was attached to; the blurred image is blurred; each click names the right control. | |
| D3 | Open the `media/` folder. | `…_before_full.png`, `…_crop.png`, and `…_full_annotated.png` showing H1 to H3. | |
| D4 | Tray menu (menu bar icon) → **Save diagnostics…**. | `handover-diagnostics-<timestamp>.zip` on the Desktop with no screenshots or comments inside. | |
| D5 | In `events.jsonl` or the package, search for the typed note text. | Not found (nothing typed is recorded). | |

## L5 click checks
L5-1 is checked on the main recording above. **L5-2 and L5-3 go in a second, separate short recording** (Record, do them, Done, Export). That keeps the scored "Save a meeting note" package free of extra steps.

| # | Recording | Do | Expect |
|---|---|----|--------|
| L5-1 | main | During the process, clicks in Finder, Safari and TextEdit. | Steps with role and name (listitem "Desktop", menuitem "File", link text). |
| L5-2 | second | In Safari, click a **password** field of any login page once. | The field's label as the name, no value anywhere, a blur over the field in that step's before image. |
| L5-3 | second | Double-click a Finder item once. | One `double_click` step. |
| L5-4 | after both | Open the doctor. | `helper: ok`, p95 lookup under 300 ms, counts add up to your clicks. |

Record anything unexpected in `docs/recorder/evidence/`, or reply to the orchestrator. Send only the exported package folder of the **main** recording to the fresh-Claude scoring run.
