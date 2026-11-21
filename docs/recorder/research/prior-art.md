# Prior art and competitors: Workflow Recording Assistant

Research date: 2026-11-21. Scope: tools that record how a person does a task on a computer, and what each one hands on to a human or an AI. This is planning input for the recorder lane plan. It is not a spec.

## How to read this document

Every claim carries one of these tags:

- **[V]** verified from the cited source (vendor documentation, a launch post, a paper or a repository), with the source date where the page shows one.
- **[VC]** vendor claim: the vendor says it in marketing, and nobody independent has checked it.
- **[U]** unverified or not found: I looked and could not confirm it. "Not found" is a real answer, not a gap I papered over.
- **[I]** my inference, labelled so the planner can challenge it.

Variants of these tags:

- **[V-secondary]**: stated by a reputable secondary source (press, analyst, tutorial), not by the vendor's own documentation.
- **[V-single]** or "single source": only one source states it, and the vendor's main page does not repeat it.
- **[reviewers]**: G2 or Capterra review sentiment. This is individual opinion, reported as "reviewers say", not as fact.
- **[unresolved]**: sources disagree.

**How each source was read.** Some sources I fetched and read directly. Others I read only through a search engine's summary of the page.

- **Fetched and read directly:**
  - Claude support 12512198 and 14128542, plus the Claude in Chrome page;
  - OpenAI Record & Replay docs;
  - Atlassian "Record for agents" blog;
  - Microsoft Skill Recorder repo page and README;
  - Instruction Agent paper;
  - Scribe Smart Blur page;
  - Tango help 6218179;
  - UiPath Task Mining collected-data page;
  - Microsoft Learn process-advisor page;
  - The Decoder, remio.ai, MindStudio, Menon Lab and dev.to articles.
- **Read through search summaries only:** everything else. A [V] on those means the search summary quoted the vendor page. Treat them as one notch weaker than a direct read.

---

## 1. Executive summary

1. **"Record once, teach the agent" became a first-party feature in 2026.** Anthropic, OpenAI, Atlassian and Microsoft all ship it:
   - Anthropic: Claude Cowork "Record a skill", announced 21 July 2026 [V].
   - OpenAI: ChatGPT/Codex "Record & Replay" [V].
   - Atlassian: Loom "Record for agent", open beta, 22 October 2026 [V].
   - Microsoft: the open-source "Skill Recorder", MIT licence [V].

   The category is real and validated. Our product cannot just be "a recorder that makes a Claude skill": Claude already does that on a Mac.
2. **Every one of those agent recorders falls short of what Moore needs.**
   - Claude Record a skill runs only on Mac. It is not available on Windows or on Enterprise plans [V].
   - OpenAI Record & Replay runs only on macOS [V].
   - Loom Record for agent runs only in the Mac app and the Chrome extension [V].
   - Microsoft Skill Recorder runs on Windows 11 and can send to your own model endpoint, including Anthropic, producing a plain SKILL.md [V]. Its README mentions no accessibility or UI Automation capture, no annotation overlay, no redaction of screen frames, and no step-by-step review before Analyze [V].
   - Claude sends "everything captured" once the user clicks Done, with no review-and-blur pass first [V]. OpenAI and Loom do not document one [U].
   - None of them records which control was clicked in a form that survives export (role, name, automation id) [V/U, see section 3].
3. **The how-to documentation tools are mature but built for humans.** Scribe, Tango, Guidde and iorad turn a recording into screenshots, text and video.
   - Their redaction and their accurate element labels are strongest in the browser and weaker on the desktop.
   - Scribe's Smart Blur works only in the browser extension, so desktop captures need manual redaction [V].
   - Tango's own help centre says "Tango Desktop does not offer Live Blur" [V, fetched]. An earlier version of the help centre, seen only in a search summary, said desktop step descriptions "may be less precise" [V-secondary].
   - Their exports (PDF, HTML, Markdown, video, SCORM) do not contain a machine-readable event log [V/I].
4. **Task and process mining shows what happens, not why.** UiPath Task Mining, Power Automate task mining, Celonis, Skan, KYP.ai, Soroco and Mimica record many users passively and statistically.
   - They capture a lot and capture intent poorly.
   - They are mostly Windows-only: Celonis [V] and UiPath Task Capture [V].
   - They are shaped like employee monitoring, which makes them a hard sell under POPIA and at a 100-person firm [I].
5. **Research says what an agent-ready package needs.**
   - **Instruction Agent** (arXiv 2509.07098, 8 September 2025) used one recorded demonstration per task.
     - It succeeded on 12 of 20 OSWorld tasks (60%). Those 20 tasks were *selected because* the leading open agents had all failed them [V].
     - Two parts of the method were tested by removing them and measuring the drop:
       - an explicit **expected outcome** for every step reduced verification errors;
       - a verifier and backtracker: removing the backtracker cut success from 60% to 45%, and removing both cut it to 40% [V].
     - The recorder takes screenshots before and after each action as part of its design. Their effect was not measured separately [V].
   - OpenCUA's AgentNet Tool captures screen video, mouse and keyboard input, and the accessibility tree on Windows, macOS and Ubuntu [V]. That is precedent for the planner's snap-to-control idea.
6. **Two hard limits shape the design.**
   - **Remote desktops.** Inside Citrix or RDP the accessibility tree is not available to the client. UiPath needs a Remote Runtime installed on the Citrix server to get element data [V]. Screenpipe falls back to OCR [VC]. ProfSoft's access mode is unknown, so the package must define a degraded, vision-only step.
   - **Recording length.** Claude caps a recording at about 10 minutes [V], and Loom reportedly at 5 minutes (one source) [V-single]. Accounting processes are often longer [I].
7. **The opening for us** is a recorder that is:
   - Windows-first with Mac parity;
   - local-first, with review and redaction before export;
   - built on a dual-evidence step record (pixels plus control metadata, with an honest degraded mode);
   - built for structured intent capture (pause, highlight, explain, mark decisions and exceptions);
   - able to produce an open, vendor-neutral package that any Claude instance can rebuild the process from.

   No product in this survey does all of that [I, based on the evidence below].

---

## 2. Landscape at a glance

| Tool | Category | Platforms | Element/control metadata | Narration | Annotations | Output | Where redaction happens |
|---|---|---|---|---|---|---|---|
| Claude Cowork "Record a skill" | Agent recorder | Mac only [V] | Not documented [U] | Yes [V] | No (narration only) [U] | Claude skill [V] | None before send. User closes apps first [V] |
| OpenAI Record & Replay | Agent recorder | macOS only [V] | "Actions and window content" [V], detail not documented [U] | Not documented [U] | Not documented [U] | Skill (when to use, inputs, steps, verification) [V] | Not documented. Guidance: avoid secrets [V] |
| Loom Record for agent | Agent recorder | Mac app, Chrome extension [V] | Screenshots of clicked elements, URLs [V]. DOM not documented [U] | Yes [V] | Selection tool and Magic pen [V] | Agent prompt / action plan, Jira work item [V] | Not documented [U] |
| Microsoft Skill Recorder (OSS) | Agent recorder | macOS primary, Windows 11, partial Ubuntu [V] | Clicks, window switches, URLs (macOS) [V]. No AX/UIA in README [V] | Yes, on-device Whisper [V] | Not documented [U] | SKILL.md or Automation [V] | Local until Analyze. Secret/PII scan covers terminal only [V] |
| Claude in Chrome "Teach Claude" | Agent recorder (browser) | Chrome only [V] | Not documented [U] | Not documented [U] | No [U] | Shortcut (name + prompt) [V] | Not documented [U] |
| Project Mariner "Teach and repeat" | Agent recorder (browser) | Chrome extension [V] | Not documented [U] | Yes, per secondary sources [V-secondary] | No [U] | Template for later runs [V-secondary] | Not documented [U]. Product status conflicting (see 3.6) |
| browser-use workflow-use (OSS) | Record-to-RPA | Browser [V] | Yes (browser events, form variables) [V] | No [U] | No [U] | Parameterised workflow with LLM fallback [V] | n/a |
| Screenpipe (OSS) | Always-on capture + MCP | Desktop (OSS) [VC] | Accessibility text first, OCR fallback [VC] | Audio transcripts [VC] | No [U] | Local SQLite + MCP search [VC] | Local only [VC] |
| Scribe | How-to docs | Browser (free), Windows/Mac desktop (Pro+) [V] | Web strong. Desktop captures partial button text, per reviewers | No (text guides) [V] | Crop, annotate, blur [V] | Link/embed, PDF, HTML, Markdown. Word/Confluence on Enterprise [V] | Smart Blur before capture, browser only. Desktop manual [V] |
| Tango | How-to docs | Browser. Desktop (Mac ARM/x64, Windows 10/11) on Pro/Enterprise [V] | Desktop descriptions "less precise" [V-secondary] | Not on plans reviewers expected [reviewers] | Yes [V] | Written guide [V] | Live Blur before capture (not desktop). Secure Blur on Enterprise [V] |
| Guidde | How-to video | Browser. Windows/macOS desktop since 2025 [V-secondary] | Not documented [U] | Narration turned into an AI voiceover [V] | Yes [VC] | Video guides. MP4 on paid plans [V] | Not found [U] |
| iorad | Interactive tutorials | Windows, Mac, mobile [VC] | Not documented [U] | Voice-over [V-secondary] | Yes [VC] | Click-through tutorial, article, PDF, video, SCORM [VC] | Not found [U] |
| Loom AI workflows | Video to docs | Mac, Windows, Chrome [I] | No [U] | Transcript is the core input [V] | Yes | SOP, step guide, Confluence page, Jira issue [V] | Not found [U] |
| Steps Recorder (psr.exe) | OS built-in | Windows (deprecated) [V] | Text description of each click [V]. Element naming [U] | No [I] | No [I] | Zipped MHT: screenshot plus description per step [V] | None [I] |
| UiPath Task Capture | RPA discovery | Windows only [V] | Yes (it is an RPA tool) [I] | No [U] | Yes (PDD editing) [V] | Word PDD, Studio XAML skeleton, Automation Hub bundle [V] | Not found [U] |
| UiPath Task Mining | Task mining | Windows [I] | Per-action fields not documented on the page read [U] | No | No | Analytics in UiPath cloud [V] | Server-side (Azure PII detection) [V] |
| Power Automate task mining | Task mining | Windows 10/11, Server, no ARM [V-secondary] | Action descriptions, red focus box shown on the element [V] | No | Group actions into activities [V] | Process map / analytics [V] | User deletes steps. "Protect your data" guidance [V] |
| Celonis Task Mining | Task mining | Windows only [V] | Clicks, shortcuts, optional screenshots, web data [V] | No | No | Celonis platform [V] | On the client, before disk or upload (hashing) [V] |
| Skan.ai | Process intelligence (computer vision) | Not found [U] | Computer vision [VC] | No | No | Process analytics [VC] | "Privacy first by design" [VC] |
| KYP.ai | Process/productivity intelligence | Not found [U] | "100% of desktop activity" [VC] | No | No | Opportunities, "agent code", MCP [VC] | Anonymised on the workstation [VC] |
| Soroco Scout | Work graph | Not found [U] | Human-machine interaction data [VC] | No | No | Work graph via APIs [VC] | Anonymised, team level, opt-in [VC] |
| Mimica | Task mining to agents | Not found [U] | "Every click, keystroke" [VC] | No | No | Process maps, automation scoring, agent builder [VC] | PII anonymised, "never leaves the machine" [VC] |

---

## 3. The 2026 "record for agents" cluster (most important)

These products compete directly with the end goal: a package Claude can understand well enough to automate the process.

### 3.1 Claude Cowork "Record a skill" (Anthropic)

- **Launch:** announced 21 July 2026 [V, The Decoder, 2026-07-21].
- **Availability:** "Recording a skill is available on Pro, Max, Ultra, and Team plans, in Cowork in Claude for Mac." It is not available in chat, on Windows, or on Free and Enterprise plans [V, Claude support article 12512198, read 2026-11-21].
- **Permissions:** macOS Accessibility (mouse and keyboard tracking) and Screen Recording [V].
- **What it captures:** "Everything on your screen is captured for the length of the session, along with anything you say" [V]. Secondary coverage lists screen, clicks, typing and voice [V-secondary, The Decoder].
- **Length:** "about 10 minutes". A countdown starts with about a minute left. At zero the recording stops and everything captured is sent to Claude, as if the user had clicked Done [V].
- **Output:** a Cowork task reviews the recording and proposes a new skill, or an update to an overlapping skill. The user can read the content and then Save or Dismiss [V]. The page does not name the format. Claude skills are SKILL.md-based folders [I, from general knowledge of Claude Skills; not stated on this page].
- **Privacy model:**
  - "The video and audio from your recording aren't retained."
  - Screenshots from the session are kept in the Cowork task and deleted when the task is deleted [V].
  - There is no step where the user reviews or blurs before the recording goes to Claude. The guidance is to close sensitive apps and not type secrets [V].
- **Weaknesses noted by commentators** [V-secondary, remio.ai, 2026-07-22]:
  - one example overgeneralises;
  - tacit expert checks never reach the skill;
  - interface drift breaks skills;
  - errors cannot be attributed (was it the demo, the interpretation or the model?);
  - it is unclear what the generated package contains.
- **Practical limits** [V-secondary, MindStudio, 2026-07-25]:
  - stray tabs or clicks confuse the skill;
  - a Chrome extension is needed for web tasks.
- **What it means for us** [I]:
  - It shows Anthropic believes narration plus screen is the right input.
  - It leaves out Windows, Enterprise plans, long processes, pre-send redaction, a portable artefact, and any audit trail of what was captured. That list is exactly Moore's profile: mostly Windows, regulated, and needing a reviewable record.
  - Our package should be able to *produce* a Claude skill as one export target, so we sit upstream of Cowork rather than competing with it.

### 3.2 OpenAI "Record & Replay" (ChatGPT Work and Codex)

- **What it does:** you demonstrate a workflow on a Mac once, and it drafts a reusable skill [V, OpenAI docs, learn.chatgpt.com, undated page].
- **Requirements:** macOS only, with Computer Use turned on. Admins can disable it with `[features].computer_use = false` in `requirements.toml` [V].
- **What it captures:** during recording it "observes the actions and window content needed to learn the workflow". Further detail is not documented [V/U].
- **Output:** a draft skill covering when to use it, required inputs, the steps, and how to verify the result. The user corrects it in chat [V].
- **Region:** reportedly unavailable in the EU, UK and Switzerland [V-secondary, dev.to/gentic_news, dated "June 22" with the year not shown; probably 2026, since it mentions EU Computer Use from June 16 [I]].
- **Privacy:** the only guidance is "avoid secrets and sensitive data". Retention is not documented [V].
- **For us:** its skill structure (when to use, inputs, steps, verification) is a good template for our generated process spec [I].

### 3.3 Loom "Record for agent" / video prompts (Atlassian)

- **Launch:** blog post 22 October 2026. Open beta on Business + AI and Enterprise plans [V].
- **Platforms:** the new Loom for Mac desktop app and the Chrome extension [V].
- **What it captures:**
  - a narration transcript;
  - screenshots of the elements that were clicked;
  - visited URLs;
  - a **Selection tool** that pins one precise UI element;
  - a **Magic pen** for freehand annotation [V].
- **Output:** "a clear set of instructions an agent can act on". It can be sent straight to an agent or opened as a Jira work item assigned to an agent [V]. The Japanese support page describes an action plan of task titles, bullet instructions and transcript excerpts [V-secondary].
- **Agent access:** Loom tools are part of Atlassian MCP v2. Claude, Cursor, VS Code, Codex and Rovo can pull transcripts and metadata [V].
- **Limit:** 5 minutes, per the Jira release announcement as summarised by search. The 22 October 2026 blog does not state it [single source].
- **Privacy:** no dedicated statement. Access follows existing Loom permissions [V].
- **For us:** this is the closest product to the owner's "highlight and comment" vision, since it combines a selection tool, a pen and narration. Its gaps are Windows desktop capture, local-first handling, length, and an open artefact [I].

### 3.4 Microsoft Skill Recorder (open source)

- **Repository:** github.com/microsoft/skill-recorder. MIT licence, about 174 commits, © 2026 [V]. A secondary article dated 3 August 2026 covers it [V-secondary].
- **Stack:** Electron, Vite, TypeScript, Node.js 24, on-device Whisper, and the GitHub Copilot SDK and CLI. Screen video is "recorded by Chromium" [V, README].
- **Platforms:** macOS primary, Windows 11 (x64 and ARM64), partial Ubuntu. Browser URL capture is macOS only [V].
- **What it captures:**
  - clicks (mentioned in the intro, mechanism not described);
  - active app and window switches;
  - URLs (macOS);
  - screen frames, kept only when the screen changes or a heartbeat is due;
  - clipboard previews;
  - optional narration (Whisper, on device);
  - an optional app-owned terminal with full commands and output [V].

  The README does not mention keystroke logging or accessibility/UIA capture [V]. On macOS only Screen Recording permission is requested at first launch [V], which suggests no AX-tree capture [I].
- **Privacy:**
  - Everything stays local until the user clicks Analyze. Then the event timeline, frames, narration text and terminal excerpts go to GitHub Copilot or to the user's own model endpoint (OpenAI, Anthropic, Azure OpenAI) [V].
  - The on-device secret/PII scan covers terminal content only. Screen frames are not scanned [V].
- **Output:** a SKILL.md procedure (intent plus ordered steps), or a scheduled Automation. It is documented for Microsoft Scout, Copilot Cowork and Copilot Studio, but the skill file is plain SKILL.md and analysis can run on an Anthropic endpoint [V]. That makes it model-neutral in practice, not locked in [I].
- **For us:**
  - It is the strongest evidence for the planner's Electron call (see section 8).
  - It is the closest open-source starting point that exists. The spike should decide whether to **fork it as a base or read it only as a reference** for capture, frame-diffing and Whisper patterns. MIT allows either, with attribution [I].
  - What the README shows it lacks [V]:
    - control metadata (no AX/UIA);
    - an annotation or highlight overlay;
    - redaction of screen frames (its PII scan covers terminal text only);
    - a review step before Analyze sends the data.
  - It also produces no package beyond the skill [V].

### 3.5 Claude in Chrome "Teach Claude" / recorded shortcuts

- Record steps in the browser, then save them as a shortcut (name plus prompt). Run it with "/" and schedule it with the clock icon. Available only in the classic side panel, not in a Cowork session. Paid plans, Google Chrome only [V, support article 12012173].
- What is captured is not documented [U].
- **For us:** browser-only, so it cannot see Caseware, Excel desktop or a ProfSoft thick client [I].

### 3.6 Google Project Mariner "Teach and repeat"

- DeepMind lists "teach and repeat" as a use case [V]. Secondary sources say the user records and narrates in a Chrome extension, and the recording becomes a template [V-secondary, DataCamp, Growthjockey].
- **Status conflict:** Google's page says it is available to US AI Ultra subscribers, while Wikipedia says it was discontinued on 4 May 2026 [unresolved].

### 3.7 browser-use "workflow-use" (open source)

- "Deterministic, self-healing workflows (RPA 2.0)". It records a browser task once, extracts form variables automatically, replays it deterministically, and falls back to an LLM agent when a step fails. Newer versions run without LLM calls [V, README and PyPI 0.2.x].
- **For us:** good precedent for detecting **variables** (inputs that change each run) and for keeping deterministic replay hints next to the semantic description [I].

### 3.8 Screenpipe (open source, local, always on)

- Records screen and audio continuously. Accessibility-tree text is the primary capture, with OCR as the fallback "in remote desktops or games". Stores everything in local SQLite under `~/.screenpipe/` and exposes an MCP search tool (filters for OCR, audio, input events, accessibility text, time and app) [VC, README and directory listings].
- Claimed cost: 5 to 10% CPU, 0.5 to 3 GB RAM, about 20 GB a month of storage [VC].
- **For us:** the pattern "accessibility first, then OCR fallback" is the degraded mode we need for Citrix/RDP. Always-on capture is the wrong privacy posture for Moore [I].

### 3.9 Research on learning from demonstration

- **Instruction Agent** (arXiv 2509.07098, 8 September 2025) [V]:
  - **Recorder:** clicks, keys, and screenshots before and after each action. No accessibility tree.
  - **Pipeline:** an LLM writes a description for each step, with the click coordinates drawn onto the screenshot.
  - **Results:** 60% success on 20 OSWorld tasks. The tasks were sampled *because* the three leading open agents had all failed them (0%).
    - Adding an **expected outcome** to every step reduced verification errors.
    - Removing the backtracker cut success from 60% to 45%. Removing the verifier as well cut it to 40%.
    - Before/after screenshots are part of the method. Their effect was not measured separately.
  - **Limits:** 20 selected tasks, no variance reported. The demonstration must come from the same environment. GPT-4o backbone.
- **OpenCUA / AgentNet Tool** (arXiv 2508.09123, NeurIPS 2025) [V]:
  - The tool records screen video, mouse and keyboard, and the **accessibility tree** on Windows, macOS and Ubuntu.
  - Annotators review, trim and submit demonstrations in a browser UI.
  - It produced 22.6K trajectories across more than 100 apps and 200 websites, and the metadata is published as JSONL.
  - This is direct precedent for a cross-platform recorder that captures the AX tree, and for a review/trim step before submission.
- **VideoAgentTrek** (October 2025): mines public screen videos for computer-use pretraining [V-secondary]. **ShowUI-Aloha: Human-Taught GUI Agent** (arXiv 2601.07181): its title matches our goal; contents not read [U].
- **Takeaway for the package** [I]:
  - every step should carry a before frame, an after frame, an action, a target (coordinates plus control metadata), and a natural-language expected outcome;
  - the accessibility tree is useful context but must be optional.

---

## 4. How-to and documentation capture tools

### 4.1 Scribe

- **Capture:** turns clicks and keystrokes into step-by-step text with screenshots. The relevant UI element is highlighted and steps are numbered [V-secondary, several 2026 reviews].
  - Free tier: browser only.
  - Desktop app (Windows and Mac, Pro/Enterprise): any native application [V].
- **Output:** link or embed. PDF, HTML and Markdown exports on paid tiers. Word and Confluence on Enterprise [V, pricing page]. Text and screenshots only, no video [V-secondary].
- **Privacy:**
  - **Smart Blur** blurs before the screenshot is taken, so "sensitive data never ends up on our servers". It covers 7 categories, but it is **browser extension only**. Desktop captures need manual redaction [V, scribe.com/library/smart-blur, 2026-09-04].
  - Enterprise adds a "Smart Privacy Screen" with custom RE2 regex categories [V].
- **Company direction:**
  - $75M Series C on 10 November 2025 at a $1.3B valuation [V, TechCrunch, SiliconANGLE].
  - Launched **Scribe Optimize**, which mines workflow data for automation opportunities [V].
  - Has an MCP for Claude Code and Cursor to search Scribe documents [V-secondary, Sacra].
  - In other words, Scribe is moving toward workflow intelligence for AI [I].
- **What users love:** speed, and hours saved on documentation [reviewers].
- **What users hate** [reviewers, G2/Capterra 2026]:
  - captures unnecessary steps and every keystroke, so cleanup is manual;
  - steps sometimes go missing;
  - merge and unmerge is awkward, and auto-merged steps are hard to undo;
  - captures only part of a button's text;
  - some screens get no screenshot;
  - the desktop window glitches;
  - desktop needs Pro.

### 4.2 Tango

- **Capture:** browser-first. The help centre (fetched 2026-11-21) says:
  - "Desktop is available on Tango Pro and Enterprise plans";
  - it runs on Mac (ARM and x64) and Windows 10/11;
  - "Workflows captured with the Desktop app are not compatible with Guide Me";
  - "Tango Desktop does not offer Live Blur";
  - "The AI Agent automates web apps and websites only, not desktop software" [V, help.tango.ai 6218179].

  A search summary of an earlier version also said desktop step descriptions "may be less precise". The current page does not say this [V-secondary].
- **Privacy:** **Live Blur** blurs before capture (paid plans). **Secure Blur** auto-detects sensitive data before capture (Enterprise). Batch Blur works after capture. A saved blur discards the original, so it cannot be undone [V].
- **Direction:** an AI automation service for browser workflows, April 2025 [V, SiliconANGLE 2025-04-16]. Workflow branching in 2026 [V-secondary].
- **What users love:** easy tutorial creation in the browser [reviewers].
- **What users hate** [reviewers, G2]:
  - desktop lags behind the browser and is full-screen only;
  - "can't record Excel workflows";
  - voice and desktop capture advertised but not on their plan;
  - refunds refused;
  - branding cannot be removed;
  - manual notes needed on every desktop step.

### 4.3 Guidde

- **Capture:** desktop app for Windows and macOS, since v2.6 on 3 April 2025 [V-secondary, aggregator].
  - **Magic Mic** (July 2025) turns the user's narration into a polished AI voiceover with an editable transcript and translation. It reached the desktop app in November 2025 [V, Guidde release notes].
  - Automatic guide and step titles since September 2025 [V].
  - The desktop app does not capture system audio [V].
- **Output:** video guides. MP4 export needs a paid plan [V].
- **Plans:** Screen Recorder on Enterprise. Magic Mic on Business and Enterprise [V].
- **Privacy:** not found [U].
- **Sentiment:** G2 rating about 4.8 [reviewers].
  - Love: ease of use.
  - Hate: robotic voices, weak non-English (Dutch) support, basic analytics [reviewers].

### 4.4 iorad

- **Capture:** desktop capture for Windows, Mac and mobile apps. The desktop app is installed separately from the browser extension. The Windows app is 32-bit [VC/V, help page].
- **Output:** one capture produces a click-through tutorial, a step-by-step article, a PDF, a video and a SCORM package [VC].
- **Privacy:** not found [U]. Sentiment: thin [U].

### 4.5 Loom AI workflows (non-agent)

- AI workflow templates: SOP, step-by-step guide, PR description, QA steps, code docs. Screenshots from the recording are inserted into the steps, except in trimmed or stitched videos. It can turn a transcript into a Confluence page or a Jira task [V, Atlassian/Loom support].
- Document generation was English-only at the time of the Japanese support page [V-secondary].
- **For us:** a transcript-plus-screenshot SOP is the baseline a Claude-ready package has to clearly beat [I].
- **User love/hate:** not found for Loom AI workflows or for Record for agent. The searches returned only Atlassian's own pages [U].

---

## 5. Operating system built-ins

### 5.1 Windows Steps Recorder (psr.exe) and its "replacements"

- **Status:** deprecated. "No longer updated and will be removed in a future release of Windows". Microsoft points users to the Snipping Tool, Xbox Game Bar or Clipchamp [V, Microsoft support "Steps Recorder deprecation"; coverage January 2024]. A removal date for 2025 or 2026 was not found [U].
- **What it captured:** a zipped MHT file with user and system information, and a screenshot plus a text description of each click and keystroke [V, Microsoft archive blogs].
  - From memory, the descriptions named the control ("User left click on 'Save (button)' in 'Notepad'"), which would mean it used UI Automation names [I/U]. I could not find a source quoting the wording.
- **The gap it leaves:** commentators note none of the suggested replacements does step logging [V, Neowin, gHacks]. The replacements record pixels only [I].
- **For us:** PSR proves that support teams valued "screenshot plus a description of which control was clicked" enough to keep using it for 15 years. Nothing on Windows does this now with AI-grade output. That is a real wedge [I].

### 5.2 macOS

- macOS has screen recording (Cmd+Shift+5) and no built-in step recorder [I, general knowledge; not re-verified in this session].

---

## 6. RPA discovery and task capture

### 6.1 UiPath Task Capture

- **Platforms:** Windows only (Windows 10 or later). "Task Capture Launcher" is listed as unavailable on macOS [V, UiPath docs].
- **Output:**
  - a **Process Definition Document (PDD)** in Word, from a template;
  - an exported **XAML** workflow skeleton for UiPath Studio;
  - an Automation Hub bundle (PDD, XAML and .ssp).

  It can also import a Studio XAML file and generate a PDD (Flowchart and Sequence only) [V].
- **Citrix:** UiPath generally needs a **Remote Runtime** installed on the Citrix or RDP server, plus a client extension, before it can see UI elements inside remote apps [V, UiPath Studio docs]. Task Capture's own Citrix behaviour was not found [U].
- **For us:** the PDD is the closest existing "hand this to an automation builder" artefact. Our PROCESS.md should be a better PDD: readable by people and by Claude [I].
- **User love/hate:** not found in this research [U].

---

## 7. Task mining and process intelligence

These tools record passively across many users, for weeks. They are useful as precedent for privacy controls and for variant analysis. They are not good at capturing intent.

| Tool | Verified facts | Vendor claims and unknowns |
|---|---|---|
| **UiPath Task Mining** | Data is cached locally, archived to encrypted Azure Blob storage, then deleted locally. PII masking is **server-side** with Azure Cognitive Services (names, phone numbers, emails, addresses, URLs, IPs, dates, account and card numbers, government IDs), on by default, and originals are not stored. A consent dialog is shown. Recording is limited to allowed apps. The user can pause and see what is recorded [V, UiPath docs]. | The per-action field list is not on the page read [U]. |
| **Power Automate task mining (Process Mining)** | Uses the Power Automate desktop recorder. Action descriptions are listed live. A red focus box marks the element. The user can delete actions, pause and reset. Actions are grouped into named "activities" for the process map. Microsoft says to remove sensitive information before analysis [V, Microsoft Learn, updated 2026-10-29]. No retirement on Microsoft's "important changes" page [V]. | Windows 10/11 and Server 2016 to 2025, no ARM [V-secondary]. Recordings stored in Dataverse [V-secondary]. |
| **Celonis Task Mining** | Captures clicks, keyboard shortcuts and user actions in allow-listed apps, and optionally web data and screenshots. Consent screen. The user can see, pause and view captures. **Redaction runs on the client immediately after capture, before anything is written to disk or sent** (hashing by default). Allowlists and denylists [V, Celonis docs]. **Windows only** (10/11, .NET 4.8) [V]. | The per-event field list sits behind a login [U]. |
| **Skan.ai** | Nothing primary verified. | Desktop "Virtual Assistant" using computer vision, client-controlled scope, "privacy first by design", the process rather than the individual as the unit [VC]. HFS describes it as tracking "every action" of each individual [V-secondary], which sits uneasily with that framing. Platforms and Citrix support not found [U]. |
| **KYP.ai** | Nothing primary verified. | Captures "100% of desktop activity", anonymised on the workstation, under 2% CPU, GDPR/SOC 2 Type II/ISO 27001, an MCP interface so LLMs can query process intelligence, "production-ready agent code" [VC]. |
| **Soroco Scout** | Nothing primary verified. | AI "work graph" built from human-machine interaction data. Insights in 48 hours, a dataset from 5 to 10 users over 4 weeks. Anonymised, team level, "always opt-in". Repositioning toward human and agent workflows in 2026 [VC]. |
| **Mimica** | Nothing primary verified. | Records "every click, keystroke". Modules Miner, Mapper and Maker (an agent builder). Automatic PII anonymisation, "sensitive data never leaves the user's machine". Every module depends on the recorder, which is a problem for organisations with works councils [VC / V-secondary, Beri]. |

**User love/hate:** not found for any of the task-mining vendors in this research [U]. The only critical third-party note is Beri on Mimica's dependence on its recorder, a problem where works councils restrict desktop recording.

**Patterns** [I]:

1. The serious vendors redact on the client (Celonis, KYP and Mimica claim it). UiPath redacts server-side, which a POPIA-minded firm will like less.
2. All of them use app allowlists, consent dialogs, visible indicators and pause. These are hygiene, and we must have them.
3. None captures *why*. They infer activities statistically and then need humans to name and group them (Power Automate's activity grouping is manual).
4. They are bought by operations leaders to watch many people. Ours is started by the person doing the work, to teach. That is a different trust model, and easier under POPIA.

---

## 8. Challenges to the planner's calls

### 8.1 Electron + TypeScript + React: supported

- Microsoft's Skill Recorder, a cross-platform recorder in the same category, is Electron + TypeScript + Vite. It ships on macOS and Windows 11 x64/ARM64 and records screen frames through Chromium [V].
- That lowers the spike's risk for screen capture and the overlay window [I].
- **It does not settle native accessibility capture.** Skill Recorder does not capture AX or UIA [V]. The spike must still prove two native helpers:
  - macOS: AXUIElement hit-testing at the click point;
  - Windows: UI Automation `ElementFromPoint`.
- Those helpers are the real risk, and they are the same work whether the shell is Electron or Tauri [I].
- **Recommendation:** keep Electron and timebox the native helpers first.
- **Decision for the spike:** fork Skill Recorder as the base, or read it only as a reference.
  - **For forking:** capture, frame-diffing, local Whisper and packaging are already done and cross-platform.
  - **Against forking:** it is shaped around Copilot analysis, and it has no overlay, AX/UIA capture or redaction model.

  Owner decision; flagged in open questions.

### 8.2 Snap-to-real-control: right, but it needs a defined degraded mode

- **Inside Citrix or RDP the client sees only a video stream.** UiPath needs a Remote Runtime on the server to get element data [V]. Screenpipe falls back to OCR in remote desktops [VC]. UiPath's computer-vision product exists precisely because Citrix, VMware, RDP and VNC expose no selectors [V].
- **ProfSoft's access mode is unknown.** If it is Citrix or RDP, snap-to-control returns nothing useful for the system Moore cares about most [I].
- **What the package needs** [I]:
  - **Every target gets an evidence tier:**
    - `ax` (full control metadata);
    - `ax-partial` (window and app only);
    - `vision` (OCR text under and around the click, plus a visual crop);
    - `manual` (the user drew the highlight).
  - **Freeform drawing must always work**, because it is the only option inside remote sessions.
  - **The OCR text near the click is captured in every case.** This also covers Electron and Java apps with poor accessibility trees [I].
- Caseware Working Papers is a Windows desktop app. Its UIA coverage is unknown [U]. The spike should hit-test it in the Windows 11 VM if a licence or trial is available.

### 8.3 Package format first: strongly supported

- Every agent recorder's weakness that commentators name is the artefact: undisclosed contents, no audit trail, errors that cannot be attributed [V-secondary, remio].
- In Instruction Agent, the per-step expected outcome reduced verification errors, which is a representation choice [V]. The measured success gains came from the verifier and backtracker [V]. A package that carries expected outcomes gives any downstream agent something to verify against [I].
- OpenAI's skill shape (when to use, inputs, steps, verification) [V] and UiPath's PDD [V] are the two existing templates to beat.

### 8.4 Narration: necessary, not optional

- All four first-party agent recorders treat narration as the main carrier of intent.
- Anthropic's guidance: narration gives "context it can't see on screen, such as why you skip a step or how you pick between options" [V].
- Narration should be on by default, transcribed on the device (Skill Recorder uses Whisper locally [V]), and aligned to steps by timestamp [I].

---

## 9. Gaps a tool built for Claude and Superbrain can exploit

Each gap is tied to evidence above.

1. **Windows desktop parity for agent-grade recording.** The agent-recording modes of Claude, OpenAI and Loom do not run on the Windows desktop [V]. Skill Recorder does, but it captures no control metadata, has no annotation overlay and does not redact frames [V]. Moore is mostly Windows, and Caseware is Windows-only.
2. **Control metadata that survives export.** How-to tools are weak on the desktop:
   - Tango's desktop descriptions are "less precise" [V-secondary];
   - Scribe captures partial button text [reviewers];
   - agent recorders and Instruction Agent use pixels plus coordinates only [V].

   PSR-style "clicked X in window Y" is gone from Windows [V/I].
3. **A local review and redaction pass before anything leaves the machine.**
   - Claude sends everything captured once the user clicks Done [V].
   - Scribe's and Tango's capture-time blur is browser-only [V].
   - UiPath masks only on the server [V].
   - Nobody redacts *all* modalities together (pixels, OCR text, AX values, typed text, transcript) [I].
4. **Structured intent beyond narration.**
   - Loom has a selection tool and a pen [V].
   - Nobody lets the user pause and label a step as a *decision rule*, an *exception path*, a *judgement call*, a *don't automate this* step, or a *sensitive* step [I].
   - Commentators say tacit expert checks never make it into recorded skills [V-secondary].
5. **Long and interrupted processes.** Claude's cap is about 10 minutes [V], and Loom's is 5 minutes in one source. Real audit and admin processes run longer and get interrupted [I].
6. **An open, portable artefact.**
   - Claude: a Cowork skill.
   - OpenAI: a skill inside ChatGPT/Codex.
   - Skill Recorder: a plain SKILL.md, the most portable of these, but with no event log, frames or annotations in the output.
   - Loom: inside the Atlassian MCP.
   - Scribe, Tango, Guidde and iorad: human formats with no event log [V/I].

   Nothing gives a versioned, documented, vendor-neutral package that a fresh Claude, a human auditor and Superbrain can all read.
7. **Remote-desktop honesty.** Products either silently lose element detail or need server-side installs [V]. A package that marks evidence quality step by step is new [I].
8. **One demonstration overgeneralises.** Commentators say so [V-secondary]. Task mining sees variants but not intent [I]. Merging several narrated recordings of the same process, plus a clarification round, is open ground [I].
9. **Clean editing.** Scribe reviewers complain about noisy steps, missing steps and irreversible merges [reviewers]. Tango's blur discards the original [V], which is right for privacy and wrong for editing unless the original stays local until export [I].
10. **A trust model that fits regulated, non-technical staff.**
    - Task mining is surveillance-shaped, and works councils object [V-secondary, Beri on Mimica].
    - Agent recorders say "close sensitive apps" [V].
    - A recorder the user starts, with a visible indicator, app allowlist, local storage, explicit export and an audit manifest, fits POPIA and IRBA expectations better [I].

---

## 10. The 10 features that would make ours clearly better

Ranked by how much each one moves the "fresh Claude rebuilds the process" acceptance check.

1. **Dual-evidence step record.** For every action, record:
   - the before frame and the after frame;
   - the action type;
   - click coordinates;
   - the target's control metadata: role or control type, name, automation id or AX identifier, bounding rectangle, window title, process or app, URL where known;
   - OCR text around the target;
   - a generated **expected outcome** line, which the user can edit.

   *Gap 2. Evidence: Instruction Agent's per-step expected outcome (reduced verification errors) and before/after frames (part of the method, not measured separately) [V]; OpenCUA's AX capture [V]; PSR's heritage.*
2. **Evidence tiers and graceful degradation.** Each target carries `ax | ax-partial | vision | manual`. Inside Citrix or RDP the recorder falls back to OCR plus a visual crop, and freeform highlights, without failing. The package states the tier, so Claude knows how much to trust each step. *Gap 7. Evidence: UiPath Remote Runtime [V]; Screenpipe's OCR fallback [VC].*
3. **Pause, highlight, explain.** One hotkey freezes the screen into an overlay where the user can:
   - draw a box, arrow or highlight, or snap to a control;
   - type or speak a comment;
   - tag it as `why`, `decision-rule`, `exception`, `judgement`, `do-not-automate`, `sensitive` or `verify`.

   Recording resumes where it stopped. *Gap 4. Evidence: Loom's selection tool and pen [V]; Anthropic's narration guidance [V].*
4. **Local review studio with redaction across every modality.** Before export the user can delete, merge, split and reorder steps, and blur regions. One redaction applies to:
   - the frame pixels;
   - the OCR text;
   - AX values;
   - typed text;
   - the transcript segment.

   It auto-suggests South African identifiers (SA ID numbers, tax reference numbers, bank account numbers), emails and amounts. Originals stay local, and only redacted copies go into the package. *Gap 3. Evidence: Scribe desktop manual-only [V]; Tango no desktop Live Blur [V]; UiPath server-side [V]; Celonis on-client redaction as a precedent [V].*
5. **Typed input recorded as meaning, not keystrokes.** Record "entered a value into field *Client code* (type: client code, 6 characters)", with the value hidden by default and kept only if the user chooses. Detect values that change between runs as **variables** (inputs). Collapse keystroke noise. *Gaps 2 and 9. Evidence: Scribe keystroke noise [reviewers]; workflow-use variable extraction [V]; OpenAI's "inputs it needs" [V].*
6. **Noise control and non-destructive editing.**
   - Automatically merge trivial steps (focus changes, scroll runs).
   - A "that was a mistake" hotkey while recording.
   - Merge, split and undo always work.
   - The raw event log stays local, so edits can always be reversed.

   *Gap 9. Evidence: Scribe reviewers [reviewers].*
7. **An open, versioned, agent-ready package.** A documented schema (JSON timeline, `PROCESS.md`, frames, transcript, `manifest.json` with hashes and redaction log) carrying:
   - intent, preconditions and inputs;
   - steps with expected outcomes;
   - decision points, exceptions and verification;
   - evidence tiers.

   Export adapters produce a Claude skill (SKILL.md), a PDD-style document, and Superbrain ingestion. *Gap 6. Evidence: OpenAI skill structure [V]; UiPath PDD/XAML [V]; Claude, OpenAI and Loom keep output inside their own products, and Skill Recorder's SKILL.md carries no event log or frames [V].*
8. **No hard length cap, with chapters and resume.** Record for an hour, split into chapters ("Open client file", "Roll forward", "Sign-off"), pause over lunch and resume tomorrow into the same package. *Gap 5. Evidence: Claude about 10 minutes [V]; Loom 5 minutes [single source].*
9. **Clarification round, then variant merge.** Before export, a local or user-approved Claude pass reads the reviewed package and asks the recorder targeted questions: "At step 7 you chose *Partner review*. When would you not?" The answers attach to steps. Later, recordings of the same process by different staff merge into one spec with variants. *Gaps 4 and 8. Evidence: commentators on overgeneralisation and tacit knowledge [V-secondary].* This must run only on the exported, reviewed package, to respect the owner's local-first rule.
10. **Windows-first, enterprise-ready trust model.**
    - Signed MSI and PKG installers, deployable by IT (for example Intune).
    - App allowlist and denylist.
    - Always-visible recording indicator, and consent shown on first run.
    - No background or passive capture.
    - A manifest of exactly what was captured and redacted, so a POPIA or IRBA reviewer can audit it.
    - The same package format on Windows and Mac.

    *Gaps 1 and 10. Evidence: Celonis/UiPath allowlists and consent [V]; the agent-recording modes of Claude, OpenAI and Loom do not run on the Windows desktop [V].*

---

## 11. Implications for the package format (input to the core lane)

My inference, drawn from the evidence above. Each step should carry at least:

- `id`, `t_start`, `t_end`, `chapter`
- `action`: `click | double_click | right_click | type | key_combo | drag | scroll | app_switch | annotation_only`
- `target`:
  - `evidence_tier`
  - `point`
  - `bounds`
  - `control`: `{role, name, automation_id, ax_identifier, value_redacted}`
  - `window`: `{title, app, process, url}`
  - `ocr_context`
- `frames`: `{before, after, crop}`, using the redacted copies only
- `input`: `{field_label, value_class, value (optional, redacted by default), is_variable}`
- `annotations[]`: `{shape, bounds, snapped_control, tag, text, transcript_ref}`
- `narration`: `{text, t_range}`, aligned by timestamp
- `expected_outcome`: generated, then edited by the user
- `redactions[]`: `{modality, region_or_span, reason}`
- `flags`: `mistake_removed`, `merged_from[]`

Package level:

- `intent`, `trigger`, `preconditions`, `inputs[]`, `outputs[]`, `decision_points[]`, `exceptions[]`, `verification[]`, `systems[]`
- `recorder_version`, `os`, `schema_version`
- `consent_and_capture_manifest`

---

## 12. Naming

The working name is long and generic. Names already taken in this space include Scribe, Tango, "Skill Recorder" (Microsoft), "Record a skill" (Anthropic) and "Record & Replay" (OpenAI). Avoid anything close to those.

Candidates [I, trademarks not checked]:

- **Superbrain Handover**, from the act of handing a process over;
- **Showpath**;
- **Superbrain Trace**.

Handover fits the owner's framing best: "end up with something that can be handed to a Claude instance".

---

## 13. Risks surfaced by this research

| Risk | Severity | Mitigation |
|---|---|---|
| ProfSoft runs over Citrix or RDP, so snap-to-control and click metadata are empty for the main system | High | Evidence tiers. OCR and visual-crop fallback. Freeform highlights always available. Confirm ProfSoft's access mode with Moore before the capture lane. |
| Anthropic adds Windows and pre-send review to Record a skill, eroding the gap | Medium | Position upstream: our package exports a Claude skill. Compete on what a first-party feature will not do: an open package, audit manifest, multi-modality redaction, long processes, variants. |
| Native accessibility helpers (AX/UIA) prove fragile in Caseware or Electron apps | Medium-High | Spike the native helpers first. Hit-test Caseware in the Windows 11 VM. Always store OCR context so a step never depends only on AX. |
| Redaction misses PII in OCR text or AX values even though the pixels are blurred | High (POPIA) | Apply one redaction to every modality. Validate the manifest before export. Test fixtures with SA identifiers. |
| Noisy steps (Scribe's top complaint) make the package hard for Claude and users | Medium | Auto-collapse, a mistake hotkey, non-destructive editing, raw log kept locally. |
| A single demonstration overgeneralises, so Superbrain automates the wrong rule | Medium | Clarification round, explicit decision-point and exception tags, variant merge across recordings. |
| Staff see the recorder as surveillance | Medium | User-started only, visible indicator, local storage, user reviews before export, no passive mode. |

---

## 14. Open questions

1. **How do Moore staff reach ProfSoft:** a thick client, a browser, or Citrix/RDP? This decides whether control metadata is available for the most important system.
2. **Does Caseware Working Papers expose a usable UI Automation tree?** Not found. Test it in the Windows 11 VM.
3. **Does Moore use Claude Enterprise or Team?** Record a skill excludes Enterprise and Windows. If Moore is on Team with Macs, some staff already have a weaker version of this.
4. Which South African identifiers must redaction detect by default (ID number, income tax reference, VAT number, bank account, CIPC registration number)?
5. **Is on-device transcription required for narration under POPIA?** Skill Recorder's local Whisper shows it is feasible.
6. Exact per-event fields for UiPath Task Mining, Celonis (login-walled) and Power Automate, if we want parity tables. Not needed to proceed.
7. **Should the spike fork Microsoft Skill Recorder (MIT, Electron + TypeScript, macOS and Windows 11) as the base, or use it only as a reference?** Owner decision.
8. Project Mariner's current status (sources conflict). PSR's exact click wording and current removal status. Loom's recording cap. None blocks the plan.

---

## 15. Sources

Dates are the page or publication date where shown, or "read 2026-11-21" where the page is undated.

**Agent recorders**

- Claude support, "How to create custom skills" (Record a skill section): https://support.claude.com/en/articles/12512198-how-to-create-custom-skills (read 2026-11-21)
- The Decoder, "Claude Cowork learns new skills through screen recordings and voice-over explanations": https://the-decoder.com/claude-cowork-learns-new-skills-through-screen-recordings-and-voice-over-explanations/ (2026-07-21)
- remio.ai, Claude Cowork skill recording analysis: https://www.remio.ai/post/claude-cowork-skill-recording-turns-demonstrations-into-reusable-workflows-but-t (2026-07-22)
- MindStudio, "Claude Record a skill feature": https://www.mindstudio.ai/blog/claude-record-a-skill-feature (2026-07-25)
- Claude support, Cowork computer use: https://support.claude.com/en/articles/14128542 (read 2026-11-21)
- Claude support, Claude in Chrome: https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome (read 2026-11-21)
- OpenAI, Record & Replay: https://learn.chatgpt.com/docs/extend/record-and-replay.md (undated, read 2026-11-21)
- dev.to/gentic_news, Codex Record & Replay: https://dev.to/gentic_news/openai-codex-record-replay-one-shot-workflow-recording-becomes-reusable-skill-1ooo ("June 22", year not shown)
- Atlassian blog, "Record for agents": https://www.atlassian.com/blog/loom/record-for-agents (2026-10-22)
- Atlassian support, Record video prompts for AI agents: https://support.atlassian.com/loom/docs/record-video-prompts-for-ai-agents/
- Jira release note, "Stop typing prompts, show your agents what to do with Loom": https://jirareleases.atlassian.com/announcements/stop-typing-prompts-show-your-agents-what-to-do-with-loom
- Microsoft Skill Recorder repository and README: https://github.com/microsoft/skill-recorder and https://raw.githubusercontent.com/microsoft/skill-recorder/main/README.md (read 2026-11-21)
- The Menon Lab, "Microsoft Skill Recorder": https://themenonlab.blog/blog/microsoft-skill-recorder-teach-agents-by-demonstration (2026-08-03)
- Google DeepMind, Project Mariner: https://deepmind.google/technologies/project-mariner/ ; Wikipedia: https://en.wikipedia.org/wiki/Project_Mariner ; DataCamp: https://www.datacamp.com/tutorial/project-mariner
- browser-use workflow-use: https://cdn.jsdelivr.net/gh/browser-use/workflow-use@main/README.md ; https://pypi.org/project/workflow-use/0.2.10/
- Screenpipe: https://cdn.jsdelivr.net/gh/screenpipe/screenpipe@main/README.md ; https://cdn.jsdelivr.net/npm/screenpipe-mcp@0.18.14/README.md

**Research**

- Instruction Agent, arXiv 2509.07098: https://arxiv.org/html/2509.07098 (2025-09-08)
- OpenCUA, arXiv 2508.09123: https://arxiv.org/abs/2508.09123 ; https://github.com/xlang-ai/OpenCUA ; https://opencua.xlang.ai/
- ShowUI-Aloha, arXiv 2601.07181: https://arxiv.org/pdf/2601.07181 (not read)
- VideoAgentTrek: https://www.researchgate.net/publication/396790565_VideoAgentTrek_Computer_Use_Pretraining_from_Unlabeled_Videos

**How-to tools**

- Scribe Smart Blur: https://scribe.com/library/smart-blur (2026-09-04)
- Scribe pricing: https://scribe.com/pricing/
- Scribe Series C: https://techcrunch.com/2025/11/10/scribe-hits-1-3b-valuation-as-it-moves-to-show-where-ai-will-actually-pay-off (2025-11-10) ; https://siliconangle.com/2025/11/10/scribe-raises-75m-process-documentation-platform/ ; https://scribe.com/library/scribe-raises-series-c
- Sacra on Scribe: https://sacra.com/c/scribe
- Scribe reviews: https://www.g2.com/products/scribe/reviews ; https://www.capterra.com/p/252555/Scribe/reviews/
- Tango help (desktop): https://help.tango.us/en/articles/6218179-will-the-desktop-app-work-with-the-programs-i-use
- Tango help (PII): https://help.tango.us/en/articles/5971552-how-do-i-protect-pii-and-confidential-information
- Tango help (Secure Blur): https://help.tango.us/en/articles/7225709-how-to-use-secure-blur
- Tango blog (Batch Blur): https://www.tango.us/blog/batch-blur
- SiliconANGLE, Tango AI automation: https://siliconangle.com/2025/04/16/tango-releases-ai-powered-automation-browser-based-workflows (2025-04-16)
- Tango reviews: https://www.g2.com/products/tango-tango/reviews
- Guidde release notes 2025: https://help.guidde.com/en/articles/11748276-release-notes-2025-discover-what-s-new-in-guidde
- Guidde desktop app: https://help.guidde.com/en/articles/9760354-desktop-application
- Guidde, There's an AI for That listing: https://theresanaiforthat.com/ai/guidde/
- Guidde reviews: https://www.g2.com/products/guidde/reviews
- iorad desktop use case: https://learning.iorad.com/use-cases/create-desktop-mobile-app-tutorials-with-iorad
- iorad features: https://www.iorad.com/features
- Softpedia, iorad Capture: https://www.softpedia.com/get/Others/Home-Education/Iorad-Capture.shtml
- Loom AI workflows: https://support.atlassian.com/loom/docs/use-ai-workflows/

**OS built-ins**

- Microsoft, Steps Recorder deprecation: https://support.microsoft.com/windows/apps/steps-recorder-deprecation
- Microsoft archive, Using PSR to capture replication steps: https://learn.microsoft.com/en-us/archive/blogs/developingfordynamicsgp/using-problem-steps-recorder-psr-to-capture-replication-steps
- Microsoft archive, Extract pictures from a Steps Recorder file: https://learn.microsoft.com/en-us/archive/blogs/pie/extract-pictures-from-a-steps-recorder-file
- Neowin, "It's a shame that Microsoft deprecated Steps Recorder": https://www.neowin.net/editorials/its-a-shame-that-microsoft-deprecated-steps-recorder-psr-in-windows/
- gHacks, Steps Recorder removal: https://www.ghacks.net/2024/01/08/microsoft-is-removing-a-tool-from-windows-11-that-you-may-have-never-used/

**RPA and task mining**

- UiPath Task Capture, Word export: https://docs.uipath.com/task-capture/standalone/2022.4/user-guide/export-word-document
- UiPath Task Capture, export to Studio: https://docs.uipath.com/task-capture/standalone/2022.4/user-guide/export-uipath-studiox
- UiPath Task Capture, software requirements: https://docs.uipath.com/task-capture/docs/software-requirements
- UiPath Assistant on Mac: https://docs.uipath.com/assistant/standalone/2025.10/user-guide/uipath-assistant-on-mac
- UiPath Remote Runtime: https://docs.uipath.com/studio/standalone/2026.10/user-guide/about-uipath-remote-runtime.md
- UiPath Citrix automation: https://docs.uipath.com/studio/standalone/latest/user-guide/automating-citrix-technologies
- UiPath AI Computer Vision: https://www.uipath.com/product/ai-computer-vision-for-rpa
- UiPath Task Mining, collected data: https://docs.uipath.com/task-mining/automation-cloud/latest/user-guide/information-about-the-collected-data
- UiPath Task Mining, privacy: https://docs.uipath.com/task-mining/docs/protection-of-personal-data-and-privacy-of-the-users
- Microsoft Learn, Prepare processes and recordings: https://learn.microsoft.com/en-us/power-automate/process-advisor-processes (updated 2026-10-29)
- Microsoft Learn, Power Platform important changes: https://learn.microsoft.com/en-us/power-platform/important-changes-coming
- Celonis, Task Mining data privacy and security: https://docs.celonis.com/en/task-mining-data-privacy-and-security.html (login-walled on fetch; search excerpt used)
- Celonis, Data redaction: https://docs.celonis.com/en/data-redaction.html
- Celonis, Task Mining desktop application: https://docs.celonis.com/en/task-mining-desktop-application.html
- Celonis, Getting started with task documentation: https://docs.celonis.com/en/task-mining-getting-started-with-task-documentation.html
- Skan, privacy by design: https://www.skan.ai/blogs/how-skan-ai-protects-privacy-by-design
- Skan platform: https://www.skan.ai/platform
- HFS Research on Skan: https://www.hfsresearch.com/?p=123574
- KYP.ai task mining: https://kyp.ai/task-mining-software
- KYP.ai, process intelligence through MCP: https://kyp.ai/process-intelligence-through-mcp/
- KYP.ai FAQs: https://kyp.ai/faqs/
- Soroco, work graph: https://soroco.com/work-graph/
- Soroco, Illuminate Dallas 2025: https://soroco.com/knowledge-hub/events/illuminate-dallas-2025/
- Mimica product: https://mimica.ai/product
- Mimica privacy policy: https://www.mimica.ai/privacy
- Beri on Mimica: https://www.beri.net/tools/mimica
