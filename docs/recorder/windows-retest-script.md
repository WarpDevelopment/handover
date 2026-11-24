# Handover test build: Windows retest (10 minutes)

Thank you again. This is a short second round on **the build you were sent with this script**, for the same tester. It covers only five things that went wrong or looked odd on 24 Nov. Nothing you see can be "your fault". Write what you saw on the line **"What happened: ____"** and in the small **results table at the end of this file**. Take a screenshot (Windows key + Shift + S) whenever something looks wrong.

**Test data only**, as before. The "TEST BUILD" banner is still there as a reminder.

## Before you start

- **Time:** about 10 minutes.
- **Install the build you were sent with this script first.** Run the installer as before (SmartScreen: **More info**, then **Run anyway**). It replaces the old one.
- **Do the checks in this order.** Check A uses one short recording; Check B needs its own new one.
- **What to send back:** this file with the results table filled in (it is not the old results form), the new package `.zip`, `reviewed-1.json`, `reviewed-2.json` and `manifest.json` from Check B, and any screenshots.

## Check A: no narration warning in the log

1. In the Handover window, switch **Narrate off**.
2. Start a recording (Ctrl + Shift + R), click on two or three things on the desktop, and stop it (**Done** on the floating bar, or Ctrl + Shift + R).
3. Wait about ten seconds. In File Explorer, paste `%APPDATA%\Handover\logs` into the address bar and press Enter. Open the newest `handover-….log` in Notepad.
4. Press Ctrl + F and search for `no saved narration`.

What you should see: no match. Before, every recording printed a line starting `WARN [Narration] cached narration transcription failed`.
What happened: ____ (if you find the line, copy it)

## Check B: the reviewed marker, and Export after an edit

The app writes a small file, `reviewed.json`, when you press **Done reviewing**. It records the time and how many edits you had made. If you edit again afterwards, Export must stay switched off until you press **Done reviewing** again. On 24 Nov we think this worked, but the file looked old to you, so please follow these exact steps.

**Times:** the app writes every time in **UTC** (for example `reviewed_at` and the log). Your clock, and the **Date modified** column in File Explorer, are two hours ahead (UTC+2). So `12:45` in the file is 14:45 on your clock. Write down times as the file shows them.

**Make a new recording for this check** (do not reuse the one from Check A):
- Start a recording (Ctrl + Shift + R), open **Notepad**, and make **at least four clicks** in it (for example the **File** menu, **Save as**, the file name box, **Cancel**). Stop the recording. You need enough steps to delete one, edit one and blur one.

1. In **Review sessions**, open the new recording. Delete **one** step (**Delete step**, then confirm).
2. Click **Done reviewing**. The review closes.
3. Open File Explorer, paste `%LOCALAPPDATA%\Handover\sessions` into the address bar, and open the folder of this recording (the newest one). Open `reviewed.json` in Notepad. **Write down `reviewed_at` and `edit_count`** (you should see `edit_count` 1). Copy the file to your Desktop and rename it `reviewed-1.json`.
4. Back in Handover, open the same recording in **Review sessions** again. Make **two more edits**: change one word in a step description (**Save wording**), and blur an area on one screenshot.
5. Click **← Back to recording** (do **not** press Done reviewing). Look at the **Export package** button.
6. Note exactly what you see. **Export package should be greyed out**, and clicking it should do nothing. Hold the mouse over it: a small tooltip should say "Review the steps and choose Done reviewing before exporting."
7. Open the review again and click **Done reviewing**. **Export package** should now be available again. Click it and save to the **Desktop**.
8. Open `reviewed.json` again. **`reviewed_at` should be later than in step 3, and `edit_count` should be 3.** Copy it to your Desktop as `reviewed-2.json`.
9. Open the exported folder and copy its `manifest.json` to your Desktop too. In it, find `reviewed_at` (under `privacy`). It should be a time **after your last edit**.

What you should see: step 6 greyed out with that tooltip, step 7 available again, the second `reviewed.json` newer and showing 3 edits, and the manifest `reviewed_at` after your last edit.
What happened: ____

**One question for you:** on 24 Nov, did you open `reviewed.json` **before** you pressed **Done reviewing** the second time (so you saw the 12:45 file, not a newer one)? Yes or no. Please also send the exported package's `manifest.json` from that day if you still have it: its `privacy.reviewed_at` tells us at once whether the app wrote the marker after your last edit.

## Check C: the zip name

1. Look at the **Desktop** after the export in Check B step 7.

What you should see: a folder ending in `.handover` and a zip whose name **starts with `handover-`**, for example `handover-…__pkg_….zip`. Before, the zip started with `recorded-process-` and was easy to miss.
What happened: ____ (write down the exact zip name)

## Check D: administrator window (the old Check 8)

1. Start a new recording (Ctrl + Shift + R).
2. Press the Windows key, type **Task Manager**, right-click it, choose **Run as administrator**. A Windows permission prompt (UAC) may or may not appear; if it does, click **Yes**.
3. Click on a few things **inside** Task Manager (for example the **Performance** tab), then close it.
4. Stop the recording (**Done**) and open it in **Review sessions**. Look at the steps for Task Manager.
5. Export the package (Done reviewing, then Export package) and open it. In `PROCESS.md`, look for a note containing the words **"Not observed"** and **"administrator window"**. Open `gaps.jsonl` in Notepad and look for a line containing `"reason":"elevated_window"` (the words "administrator window" are in `PROCESS.md`, not in this file).

What you should see: a clear note with those words in `PROCESS.md` and a line with `"reason":"elevated_window"` in `gaps.jsonl`, not silence. Clicks inside the elevated window are still not recorded; that is expected. On 24 Nov there was no note at all.
What happened: ____ (copy the whole note exactly as it reads)

**Paused version.** Start another new recording. Click **Pause** on the floating bar, open Task Manager as administrator as above, leave it open for about 10 seconds, close it, click **Resume**, click once or twice on the desktop, and finish (**Done**). Review, export and open `PROCESS.md` as before.

What you should see: **no** "Not observed" line for the paused stretch, because you were not recording then.
What happened: ____

## Check E: uninstall leaves no installer copy

1. Start → **Settings** → **Apps** → **Installed apps**. Find **Handover**, click the three dots, then **Uninstall**, and confirm.
2. Open File Explorer, paste `%LOCALAPPDATA%` into the address bar and press Enter. Look for a folder called **`handover-updater`**.

What you should see: **no `handover-updater` folder**. Before, it held a 627 MB copy of the installer. (Your recordings in `%LOCALAPPDATA%\Handover` and your settings in `%APPDATA%\Handover` are still expected to be there, because uninstalling does not remove them.)
What happened: ____

Also, if you can: before you uninstall, look in `%LOCALAPPDATA%` right after installing the new build. Note whether `handover-updater` was already absent then.

## Results (fill this in and send this file back)

Mark each check **pass**, **fail** or **partly**. "What happened" can be one line.

| Check | Pass / fail / partly | What happened | Screenshot (y/n) |
|---|---|---|---|
| A: no narration warning in the log | | | |
| B: new recording with four clicks, steps 1 to 9 | | | |
| B: Export greyed out after the edits, tooltip text as quoted | | | |
| B: Export available again after Done reviewing | | | |
| B: second `reviewed.json` newer, `edit_count` 3 (write down both `reviewed_at` times, UTC) | | | |
| B: manifest `reviewed_at` after the last edit | | | |
| B: answer to the question (opened `reviewed.json` before the second Done, yes or no) | | | |
| C: zip name starts with `handover-` (exact name) | | | |
| D: "Not observed" and "administrator window" note in `PROCESS.md` | | | |
| D: line with `"reason":"elevated_window"` in `gaps.jsonl` | | | |
| D: paused version, no "Not observed" line for the paused stretch | | | |
| E: no `handover-updater` folder after uninstall | | | |

Anything else you noticed is welcome too. Thank you.
