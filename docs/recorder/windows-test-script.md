# Handover test build: Windows test script

Thank you for helping. You are testing an early version of **Handover**, a Warp Development tool that watches you do a task on screen and writes it up so someone else (or an assistant) can repeat it. It has never run on a Windows laptop before, so **this script is our only test plan**. Nothing you see can be "your fault". If something looks odd, that is exactly what we want to hear about.

For every step, write what you saw in the line **"What happened: ____"**, or in the results form (`tester-results-form.md`). Short and honest is best, for example "worked", "nothing happened", "the window went black". Take a screenshot (Windows key + Shift + S) whenever something looks wrong.

## Before you start

- **Test data only.** Use made-up text, as this script says. Do not open client files, client websites or real passwords while Handover is recording. The app shows a banner, "TEST BUILD — use test data only, not real client data", as a reminder.
- **Time:** about 30 to 40 minutes.
- **You need:** a Windows 11 x64 laptop where you have admin rights, an internet connection for the download and for one web page, and (for the narration check) a working microphone. A second monitor is optional.
- **Privacy, in plain words:** Handover does not record what you type, does not read what is inside text boxes, does not read your clipboard, does not record audio or video into the package (only a written transcript of what you say), and does not send anything over the internet. If you want to check, `release-notes-0.1.0-tester.md` explains each point.
- **What to send back at the end:**
  1. the exported package `.zip` (Check 6);
  2. the diagnostics `.zip` (Check 7);
  3. the filled-in results form (`tester-results-form.md`);
  4. any screenshots of warnings or oddities.

Fill in the header of the results form now (Windows version, laptop model, monitors and scale, antivirus). Windows version: Start → Settings → System → About. Display scale: Settings → System → Display, the "Scale" box (for example 125%).

---

## Install

### 1. Download
1. Open the link the owner sent you and download the installer. It is called something like `Handover-0.1.0-windows-x64.exe`.
2. Note the file size and whether the browser warned you about the file.

What you should see: a download of roughly 500 MB.
What happened: ____

### 2. Run the installer and get past SmartScreen
The installer is not signed yet, so Windows is expected to warn you.
1. Double-click the downloaded file.
2. If a blue box says **"Windows protected your PC"**, click **More info**, then **Run anyway**.
3. If **User Account Control** asks "Do you want to allow this app to make changes?", note it and click **Yes**.

What you should see: the blue SmartScreen box, then the installer opening.
What happened: ____ (screenshot the blue box)

### 3. Antivirus warnings
If Microsoft Defender or any other antivirus shows a warning, blocks the file, or moves it to quarantine:
- **Write down the exact text** and take a screenshot.
- **Do NOT switch the antivirus off.** If the file is removed, stop here, tell the owner what the message said, and skip to "Send back".

What you should see: ideally nothing.
What happened: ____

### 4. Choose where to install
1. The installer offers a folder. It installs for **your user only** (no all-users option), and you can click **Browse** to pick another folder. Leave the default.
2. Click **Install**, wait for it to finish, then click **Finish** with "Run Handover" ticked, if it is offered.

What you should see: a folder choice page, a progress bar, then a finish page.
What happened: ____

### 5. First launch
1. If Handover did not start, open it from the Start menu (type "Handover").
2. Look at the top of the window for the banner **"TEST BUILD — use test data only, not real client data"**.
3. Look for a small Handover icon near the clock (bottom right). If it is not there, click the little **^** arrow to see hidden icons.
4. If Windows Firewall asks to allow Handover on networks, note it and click **Cancel** or "Cancel/Deny". (Handover should not need the network. This prompt appearing is itself worth reporting.)

What you should see: the Handover window with the test banner, a round record button and a "Narrate" switch.
What happened: ____

---

## Check 1: start and stop an empty recording

1. Press **Ctrl + Shift + R**. (If nothing happens, click the round record button in the Handover window instead, and note that the keys did not work.)
2. A small floating bar should appear with a red dot, a running timer, a microphone button, **Discard** and **Done**. Note whether it appeared on the right screen.
3. Wait about 5 seconds without doing anything.
4. Click **Done** on the floating bar. (Pressing Ctrl + Shift + R again also stops it.)
5. The Handover window should say the capture was saved. Click **Review sessions** (the button at the bottom of the window): the new recording should be listed.

What you should see: the bar, a timer counting up, a saved recording in the list.
What happened: ____

---

## Check 2: the test task (about 5 to 8 steps)

1. Open Handover. In the window, switch **Narrate** on (see Check 2b) and click **Start recording** (or press **Ctrl + Shift + R**).
2. Do the task below at a normal, unhurried speed. **While you do it, say out loud what you are doing and why**, as if explaining to a new colleague. For example: "I'm opening Notepad because I want to write down a note."
   1. Click the Start menu, type **Notepad**, open it.
   2. Type a short made-up note, for example: *Test note: call the supplier about order 1234 on Friday.*
   3. Press **Ctrl + S**, choose **Desktop**, name it **handover-test-note**, click **Save**.
   4. Open **Microsoft Edge**. Go to **https://example.com** and click the link on the page (**"More information…"** or similar).
   5. Open **File Explorer** (Windows key + E), click **Desktop** in the left list, and click once on **handover-test-note** to select it.
3. Leave the recording running. Go straight on to Checks 3 and 4 below, then stop it as described in Check 5.

### Check 2b: narration
1. Before starting, in the Handover window the **Narrate** switch should be on. The first time, Windows may ask for **microphone access**. Click **Yes** / allow. Note exactly what it asked.
2. Open the gear (**Recording settings**) and check that your microphone is listed under **Microphone**. Note its name.
3. While recording, the floating bar's microphone button should show the microphone is on ("Mute" / "Unmute" in its tooltip). Note whether it did.

What you should see: the recording running while you work; the microphone on.
What happened: ____

---

## Check 3: Explain (freeze and annotate)

Do this in the middle of the same recording, while Notepad is on screen with your note (open it again from the Desktop if you closed it).

1. Press **Ctrl + Shift + E**, or click the **Explain** button on the floating bar (label may differ slightly). Note which one you used.
2. The screen should **freeze** like a photo, with a set of tools at the top. Note anything strange: a black screen, a flicker, a delay, the mouse pointer missing.
3. Draw a **box** around the **Save** menu or the title bar of Notepad (use the box tool, label may differ slightly).
4. Draw an **arrow** pointing at your typed text (arrow tool).
5. Draw a **highlight** over one line of your text (highlighter tool).
6. Type a comment in the comment box, for example: "This is the note I save before moving on." The comment box should already be ready for typing; note if you had to click first.
7. Save it (**Done** or press **Enter** in the comment box; label may differ slightly). The screen should unfreeze and the drawings should disappear from the live screen.
8. Press **Ctrl + Shift + E** again, draw one box, then press **Esc** to cancel. Nothing should be saved.
9. **Two monitors?** Repeat steps 1 to 7 once with Notepad on the second monitor. Note whether **both** screens froze and whether your drawings landed in the right place.

What you should see: a frozen screen you can draw on, then back to normal.
What happened: ____ (screenshot if anything looks wrong, including a frozen screen that does not go away: press Esc)

---

## Check 4: pause and resume

1. While recording, click **Pause** on the floating bar (label may differ slightly).
2. Do something unrelated for about 10 seconds, for example open Calculator. This must **not** end up in the write-up.
3. Click **Resume** (label may differ slightly). Close Calculator and carry on with one more click in File Explorer.

What you should see: the timer stops while paused and starts again after Resume.
What happened: ____

---

## Check 5: stop and review

1. Click **Done** on the floating bar (or Ctrl + Shift + R).
2. In the Handover window click **Review sessions**, then pick your recording at the top of the list.
3. Look at the steps (label may differ slightly: this screen is new). Each step should have a screenshot and a one-line description such as `Click button "Save" in Notepad`. Count them and note anything missing or odd.
4. **Delete one step** that you do not need. It should disappear from the list.
5. **Edit a comment** or a step description: change one word and save.
6. **Blur the note text** on one screenshot: choose the blur tool, drag a rectangle over your typed note, and confirm. The area should become blocky or unreadable.

What you should see: your steps with pictures, and your three changes applied.
What happened: ____

---

## Check 6: export the package

1. In the same recording's page, click **Export package**.
2. A "save" window opens. Choose the **Desktop**.
3. When it finishes it says how many steps it exported. Note the message.
4. On the Desktop you should now have a folder ending in `.handover` and a `.zip` with the same name. Open the folder.
5. Open **PROCESS.md** in **Notepad** (right-click → Open with → Notepad).
6. Read it. Do the steps make sense and are they in the order you did them? Does each click name the right button? Does the blurred screenshot still hide your note? Is your narration there? Note anything wrong, missing or wrongly named, for example "step 4 says Button 'OK' but I clicked a link".
7. Open the `media` folder, open one `…_before_full.png`, and one image whose name ends `_annotated.png` (it should show your box, arrow and highlight with labels such as H1).

What you should see: a folder with `PROCESS.md`, `manifest.json` and a `media` folder of pictures.
What happened: ____

---

## Check 7: save diagnostics

1. Find the Handover icon near the clock (click the **^** arrow if it is hidden) and **right-click** it.
2. Click **Save diagnostics…**.
3. A file named like `handover-diagnostics-2026-11-24….zip` should appear on the **Desktop**. (This file holds technical information only: no screenshots, no text you typed.)

What you should see: the zip on the Desktop within a few seconds.
What happened: ____

---

## Check 8 (optional): clicking into an app run as administrator

1. Start a new recording (Ctrl + Shift + R).
2. Press the Windows key, type **Task Manager**, right-click it → **Run as administrator** → **Yes**.
3. Click on a few things inside Task Manager, then close it.
4. Click **Done**, open the recording in **Review sessions**, and look at the steps for Task Manager. Note exactly what the step text says (for example whether it says it could not see the button).

What happened: ____

## Check 9 (optional): a Remote Desktop window

Only if you already use one. Use a test machine, not a client machine.
1. Start a recording and open **Remote Desktop Connection** (or Windows App).
2. Click a few times inside the remote window, then stop the recording.
3. Look at those steps in the review screen. Note what they say.

What happened: ____

---

## Send back

Send the owner, by email or the shared link they give you:
1. the exported **`.zip`** from the Desktop (not the folder);
2. the **diagnostics `.zip`**;
3. the filled-in **results form**;
4. any **screenshots** of warnings (SmartScreen, antivirus, firewall, microphone) or oddities.

If the zip is very large, tell the owner and they will give you another way to send it.

## Uninstall

1. Start → **Settings** → **Apps** → **Installed apps**.
2. Find **Handover**, click the three dots, then **Uninstall**, and confirm.
3. Note whether it uninstalled cleanly. You may keep or delete your Desktop files.

What happened: ____

Thank you. Anything you noticed that is not covered above is welcome too.
