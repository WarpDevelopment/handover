# Save the budget and open mail
> Goal: Keep the budget file saved · Done when: The file is saved and mail is open
> Trigger: Every Friday · Recorded 2026-11-24 (Africa/Johannesburg) by finance analyst · 6 steps · 15.0 s task time · package pkg_01KAT8ZJ3Q5R7M9N2B4C6D8E0F
> TEST BUILD — test data only.

## Steps

**S01. Switch to Microsoft Excel** `[observed]` · evidence T0
- Where: Microsoft Excel › Budget.xlsx (window change)
- Images: media/S01_before_full.png

**S02. Click button "Save" in Microsoft Excel** `[observed]` · evidence T3
- Where: Microsoft Excel › Budget.xlsx › button "Save" (accessibility)
- Narration: "Now I save the file" `[narration, ann_0003]`
- Images: media/S02_before_full.png, media/S02_before_crop.png

**S03. Double-click at (400, 300) in Microsoft Excel** (H1) `[observed]` · evidence T0 (timeout)
- Where: Microsoft Excel › point 193,145 in media/S03_before_full.png (pixels only)
- Why: Always save before closing the file `[user, ann_0002]`
- Images: media/S03_before_full.png, media/S03_before_crop.png

**S04. Switch to Google Chrome** `[observed]` · evidence T0
- Where: Google Chrome › mail.example.com/inbox (window change)
- Images: media/S04_before_full.png

**S05. Click text box "Password" in Google Chrome** `[observed]` · evidence T3
- Where: Google Chrome › mail.example.com/inbox › textbox "Password" (accessibility)
- Images: media/S05_before_full.png, media/S05_before_crop.png

**S06. Right-click pane "Mail list" in Google Chrome** `[observed]` · evidence T2 (opaque_toolkit)
- Where: Google Chrome › mail.example.com/inbox › pane "Mail list" (accessibility_weak)
- Images: media/S06_before_full.png, media/S06_before_crop.png, media/S06_after_full.png

## What the recorder could not see
- gap_0001 (S05 → S06): paused by the user, 2.0 s.
- S03: no control identified (timeout: the control lookup timed out); the target is pixels only.
- S06: no control identified (opaque_toolkit: an app that exposes no controls); the target is pixels only.
