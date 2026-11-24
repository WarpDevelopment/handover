# Handover test build: Windows retest (10 minutes)

Thank you again. This is a short second round on the **next build**, for the same tester. It covers only five things that went wrong or looked odd on 24 Nov. Nothing you see can be "your fault". Write what you saw on the line **"What happened: ____"**, or in the results form (`2-Results-form.md`). Take a screenshot (Windows key + Shift + S) whenever something looks wrong.

**Test data only**, as before. The "TEST BUILD" banner is still there as a reminder.

## Before you start

- **Time:** about 10 minutes.
- **Install the new build first.** Run the installer as before (SmartScreen: **More info**, then **Run anyway**). It replaces the old one.
- **Do the checks in this order.** Checks A and B share one recording.
- **What to send back:** the new package `.zip`, the filled-in results form, the file `reviewed.json` from Check B (both versions, see below), and any screenshots.

## Check A: no narration warning in the log

1. In the Handover window, switch **Narrate off**.
2. Start a recording (Ctrl + Shift + R), click on two or three things on the desktop, and stop it (**Done** on the floating bar, or Ctrl + Shift + R).
3. Wait about ten seconds. In File Explorer, paste `%APPDATA%\Handover\logs` into the address bar and press Enter. Open the newest `handover-….log` in Notepad.
4. Press Ctrl + F and search for `no saved narration`.

What you should see: no match. Before, every recording printed a line starting `WARN [Narration] cached narration transcription failed`.
What happened: ____ (if you find the line, copy it)

## Check B: the reviewed marker, and Export after an edit

The app writes a small file, `reviewed.json`, when you press **Done reviewing**. It records the time and how many edits you had made. If you edit again afterwards, Export must be refused until you press **Done reviewing** again. On 24 Nov we think this worked, but the file looked old to you, so please follow these exact steps. Use the recording from Check A, or make a new one with at least three steps.

1. In **Review sessions**, open the recording. Delete **one** step (**Delete step**, then confirm).
2. Click **Done reviewing**. The review closes.
3. Open File Explorer, paste `%LOCALAPPDATA%\Handover\sessions` into the address bar, and open the folder of this recording (the newest one). Open `reviewed.json` in Notepad. **Write down `reviewed_at` and `edit_count`** (you should see `edit_count` 1). Copy the file to your Desktop and rename it `reviewed-1.json`.
4. Back in Handover, open the same recording in **Review sessions** again. Make **two more edits**: change one word in a step description (**Save wording**), and blur an area on one screenshot.
5. Click **← Back to recording** (do **not** press Done reviewing). Click **Export package**.
6. Note exactly what happens. Export should be **refused** with a message such as "Review the steps and choose Done reviewing before exporting."
7. Open the review again, click **Done reviewing**, then **Export package**, and save to the **Desktop**. This time it should work.
8. Open `reviewed.json` again. **`reviewed_at` should be later, and `edit_count` should be 3.** Copy it to your Desktop as `reviewed-2.json`.

What you should see: step 6 refused, step 7 works, and the second `reviewed.json` newer and showing 3 edits.
What happened: ____

**One question for you:** on 24 Nov, after your edits at 12:47 to 12:51, did you click **Done reviewing** a second time before you exported? And was the `reviewed.json` you opened in the same recording folder as the one you exported (`20261124-143433`), with the Date modified column showing 12:45? Please answer yes or no to each.

## Check C: the zip name

1. Look at the **Desktop** after the export in Check B step 7.

What you should see: a folder ending in `.handover` and a zip whose name **starts with `handover-`**, for example `handover-…__pkg_….zip`. Before, the zip started with `recorded-process-` and was easy to miss.
What happened: ____ (write down the exact zip name)

## Check D: administrator window (the old Check 8)

1. Start a new recording (Ctrl + Shift + R).
2. Press the Windows key, type **Task Manager**, right-click it, choose **Run as administrator**, then **Yes**.
3. Click on a few things **inside** Task Manager (for example the **Performance** tab), then close it.
4. Stop the recording (**Done**) and open it in **Review sessions**. Look at the steps for Task Manager.
5. Export the package (Done reviewing, then Export package) and open it. In `PROCESS.md`, look for a line saying **"Not observed"**. Open `gaps.jsonl` in Notepad and look for an entry about the administrator window.

What you should see: a clear **"Not observed"** note in `PROCESS.md` and an entry in `gaps.jsonl`, not silence. Clicks inside the elevated window are still not recorded; that is expected. On 24 Nov there was no note at all.
What happened: ____ (copy the "Not observed" wording)

## Check E: uninstall leaves no installer copy

1. Start → **Settings** → **Apps** → **Installed apps**. Find **Handover**, click the three dots, then **Uninstall**, and confirm.
2. Open File Explorer, paste `%LOCALAPPDATA%` into the address bar and press Enter. Look for a folder called **`handover-updater`**.

What you should see: **no `handover-updater` folder**. Before, it held a 627 MB copy of the installer. (Your recordings in `%LOCALAPPDATA%\Handover` and your settings in `%APPDATA%\Handover` are still expected to be there, because uninstalling does not remove them.)
What happened: ____

Also, if you can: before you uninstall, look in `%LOCALAPPDATA%` right after installing the new build. Note whether `handover-updater` was already absent then.

Thank you. Anything else you noticed is welcome too.
