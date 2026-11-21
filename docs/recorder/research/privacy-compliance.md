# Privacy, security and compliance research: Workflow Recording Assistant

- **Research date:** 21 November 2026 (sources accessed on this date unless stated otherwise)
- **Scope:** POPIA, IRBA confidentiality, employee-monitoring sensitivity, the Claude/Anthropic export route, and the OS-level guardrails a desktop screen and input recorder needs inside a South African audit firm. It ends with concrete requirements and defaults for each build lane, and a list of what needs Moore's sign-off.
- **Status:** planning input. This is not legal advice. Every legal position below is an option for Moore's information officer and legal counsel to decide, not a conclusion.

## How to read the evidence labels

| Label | Meaning |
|---|---|
| **[V]** | Verified this session by opening a primary source: statute text, the regulator's own document, vendor docs, or the standard-setter's pronouncement. The source is cited inline. |
| **[Vs]** | The primary source page (for example Microsoft Learn, Apple developer docs, Electron docs) was identified, but its content was read only through a search-result summary, not by opening the page. Very likely correct; the spike should confirm it against the page. |
| **[V2]** | Supported by a reputable secondary source only, such as a law-firm note, trade press or a third-party library. Treat it as likely, but confirm it before relying on it. |
| **[I]** | My inference or design judgement. It is not a sourced fact. |
| **[L]** | A legal or professional judgement that Moore's information officer, counsel or IRBA quality partner must make. |

POPIA section text was read from popia.co.za, a well-known consolidated copy of Act 4 of 2013. **It is not the official Government Gazette text.** Before anything is relied on in a contract or policy, check the wording against the gazetted Act.

---

## 1. Executive summary

1. **Everything on screen is regulated data, including company data.** POPIA defines "personal information" to cover an "identifiable, existing juristic person" as well as natural persons [V, POPIA s1]. Under the IESBA/IRBA Code, "confidential information" is any non-public information "in whatever form or medium (including written, electronic, visual or oral)" [V, IESBA technology revisions, Glossary]. So a screen recording of Caseware, ProfSoft, Outlook or Excel at an audit firm is, by default, both personal information and client-confidential information. That includes the narration ("oral") and the screenshots ("visual").
2. **Local-first is the right architecture, and it carries most of the compliance weight.** The owner's fixed decision is this: recordings stay on the machine, the user reviews, blurs and deletes before export, and Claude sees only the reviewed package. This maps directly onto:
   - POPIA s19 security safeguards;
   - s14 retention limits;
   - minimality;
   - the IESBA R114.2 duty not to disclose client confidential information.
   
   The design job is to make the review gate real rather than a formality.
3. **The export to Claude is a cross-border transfer and a disclosure of client-confidential information.** Two layers apply:
   - **Data residency.** Anthropic's data residency docs say workspace (at-rest) geo is currently only `"us"`. Inference geo is either `"us"` or `"global"`, and `"global"` means "any available geography" [V, Claude data residency docs].
   - **Legal bases.** POPIA s72 allows the transfer on one of five grounds. The realistic ones are a binding agreement giving adequate protection (s72(1)(a)) or the data subject's consent (s72(1)(b)) [V, POPIA s72]. IESBA R114.3 allows disclosure of client confidential information only where there is a legal or professional duty or right, or where the client (or someone with authority) authorises it [V, IESBA R114.3].
   
   **The strongest product answer is to make the exported package contain as little personal and client-confidential information as possible.** POPIA does not apply to information "de-identified to the extent that it cannot be re-identified again" [V, POPIA s6(1)(b)].
4. **The Claude route matters as much as the vendor.** Retention depends on how the package reaches Claude:
   - **API (Commercial Terms):** inputs and outputs are deleted within 30 days by default [V, Anthropic privacy center, commercial retention, as of 1 July 2026].
   - **Zero data retention (ZDR):** available on request [V, platform docs].
   - **Fable and Mythos models** are "Covered Models". They require 30-day retention and are not available under ZDR unless Anthropic expressly authorises it [V, platform docs].
   - **Consumer Claude plans** are outside ZDR [V, platform docs]. Their users can opt in to training, with retention of up to 5 years [V2, Anthropic consumer-terms update, Aug 2025].
   - **Commercial Terms** say "Anthropic may not train models on Customer Content from Services" [V, Commercial Terms, effective 17 June 2025].
   
   **Requirement:** name one approved route (account type, workspace, model, features) and prevent the tool from encouraging any other route.
5. **The tool must be visibly the user's own tool, never a monitoring tool.** Workplace monitoring in South Africa sits under RICA (interception) plus POPIA (processing) [V2, Polity/Michalsons commentary]. The South African Information Regulator has said in public that AI models keeping personal information beyond its original purpose conflicts with POPIA [V2, ITWeb, Sep 2026]. Design principles that follow:
   - recording starts only from a local user action;
   - an always-visible indicator shows while recording;
   - no remote or manager trigger exists;
   - no hidden mode exists;
   - recordings are never used for performance management.
   
   That last point is a purpose limitation under POPIA s13/s15 and needs Moore's written policy.
6. **Password and secret fields must be handled by the OS signals plus a fail-closed default.**
   - **macOS:** secure text fields expose an empty value and a secure subrole [V2, Mozilla/WebKit bug trackers]. Secure Event Input stops event taps from seeing keystrokes while it is enabled [V2, 1Password community, Mozilla bug 394106].
   - **Windows:** UI Automation exposes `IsPassword` [Vs, Microsoft Learn].
   - **Citrix/RDP and opaque apps:** these signals are absent inside a remote-desktop or Citrix window, which may be how ProfSoft is reached, and may be absent in legacy Win32 or Java UIs. So when the tool cannot determine what control has focus, it must treat typing as secret.
7. **Automated PII detection is a helper, not a guarantee.**
   - Microsoft Recall runs an on-device sensitive-information filter, on by default, for passwords, national ID numbers and card numbers [Vs, Microsoft support]. Independent testers still found card and ID numbers captured [V2, Tom's Hardware, TechRadar].
   - SA ID numbers are structured (YYMMDDSSSSCAZ with a Luhn check digit) [V2, Western Cape Government page, python-stdnum], so they are detectable with high precision. Names, client names and financial values are not.
   
   The review gate must stay mandatory, with detections pre-blurred or shown as suggestions.
8. **Moore must sign off on about 20 items** (section 9). The blocking ones are:
   - the lawful basis for client and third-party data visible on screen;
   - the s72 transfer basis and the operator agreement with Warp;
   - an IRBA confidentiality position, including whether to require synthetic or training client files for recordings;
   - the staff policy, including the no-performance-monitoring rule;
   - retention periods;
   - a personal information impact assessment (PIA), which POPIA Regulation 4 makes the information officer's duty [V, Information Regulator Guidance Note on Information Officers, para 6.2.2].

---

## 2. What the recorder captures, and why each item is sensitive

The capture inventory below assumes the planned design: clicks with control metadata from accessibility APIs, highlights, comments, narration, and screenshots or video. The sensitivity column is [I] unless a source is cited.

| Data item | Example at Moore | Sensitivity | Default handling (detail in section 7) |
|---|---|---|---|
| Screenshots / video frames | Caseware trial balance, ProfSoft client card, Outlook inbox | Client financials (juristic-person PI), natural-person PI of client staff and individuals, colleagues' email contents. Special PI possible: health data in payroll, criminal records in onboarding checks (POPIA s26 [V]). | Capture only the chosen window or display. Excluded apps are blanked. Detectors pre-blur. Review is mandatory. |
| Click events + control metadata (role, name, automation ID, bounding box) | "Button 'Post journal'", "Edit 'Client code'" | Usually low. But control *names* can contain data, for example list items or grid cells named after a client. | Keep role, label and ID. Run detectors over labels. Never keep values by default. |
| Control *values* (AXValue / UIA ValuePattern) | Text typed into a field, an Excel cell's content | High. This is the typed data itself. | Not captured by default. Per-field value capture only if enabled before recording. Never for secure fields. |
| Keystrokes | Typing a client name, a password, a tax number | Highest. A content keylogger is the single most dangerous capability in the product. | Record *that* typing happened, which field it went into, and the character count. Record shortcuts and navigation keys by name. Never record text content by default. |
| Window titles | `ABC (Pty) Ltd - AFS 2026.ac` | Often contain client names and file names. | Run detectors over titles. Redact by default in the export. Keep the app name. |
| URLs | `https://app.quicklysign.com/doc/8f3...?email=...` | Query strings carry IDs, emails and tokens. | Keep scheme, host and path template. Strip query and fragment by default. |
| Narration audio | The user explains a step and a colleague speaks in the background | Voice is personal information. Bystanders' speech is third-party PI. POPIA "biometrics" covers techniques of identification including voice recognition [V, s1]. Plain audio used for transcription is arguably not biometric processing [L]. | Microphone runs only while narration is on, with an indicator. Audio stays local. Only the PII-scanned transcript is exported by default. |
| Transcript | "Now I open Mr Smith's file, ID 8001015009087..." | Spoken PII. | Run detectors over the transcript. Review it alongside the step it belongs to. |
| Annotations, highlights, comments | "This is where we check the partner sign-off" | Low, unless the user types PII into a comment. | Run detectors over comment text. |
| Clipboard | A copied bank account number | High. | **Never read.** |
| Audit log | "Exported package X, 14 redactions" | Metadata about staff activity. | No content, titles or URLs. Hash-chained and kept local. |

Why the export does not need audio [V/I]: the Claude API features overview lists text, vision (images) and PDF inputs, and no audio input [V, platform.claude.com features overview, read 21 Nov 2026]. Sending audio to Claude would add risk without adding understanding, so the export carries the transcript [I].

---

## 3. Legal and professional framework

### 3.1 POPIA (Protection of Personal Information Act 4 of 2013)

| Provision | What it says | What it means for the recorder |
|---|---|---|
| s1 "personal information" | Covers identifiable living natural persons and, where applicable, identifiable existing juristic persons. Expressly includes "any identifying number, symbol, e-mail address, physical address, telephone number" [V]. | Client companies' data is in scope, not only individuals' data. |
| s1 "consent" | "any voluntary, specific and informed expression of will" [V] | Consent from employees is weak where they cannot freely refuse [I/L]. Consent from the recording user cannot cover third parties on screen [I]. |
| s6(1)(b) | The Act does not apply to information "de-identified to the extent that it cannot be re-identified again" [V] | This is the legal reason to minimise the exported package hard. |
| s11 | Six lawful bases, including consent (a), contract (b), legal obligation (c) and the legitimate interests of the responsible party or a third party (f). Consent can be withdrawn. The data subject can object to (d)-(f) processing [V]. | Moore must choose the basis for each data-subject group (section 3.6) [L]. If (f) is used, staff have an objection right, so the tool must support opting out and deleting. |
| s13 | Collection must be for "a specific, explicitly defined and lawful purpose", and the data subject must be made aware of it [V] | The purpose statement is fixed in the product and the policy: *documenting work processes so they can be improved or automated*. It is not performance monitoring. |
| s14 | Records are kept no longer than necessary (with exceptions), then destroyed, deleted or de-identified "as soon as reasonably practicable" [V] | Automatic expiry of raw recordings, crypto-shredding, and a deletion record. |
| s15 | Further processing must be compatible with the original purpose. Factors: how the purposes relate, the nature of the information, the consequences, how it was collected, and contractual rights [V] | Client data was collected for audit, accounting or tax engagements. Re-using its on-screen appearance for process documentation needs a compatibility assessment [L]. Redaction and de-identification weigh heavily in favour [I]. |
| s18 | Notification on collection: purpose, identity of the responsible party, recipients, **intended transfer to a third country and the protection level**, rights, and the right to complain to the Regulator [V] | Show an in-app notice on first run and link to the staff policy. Moore's privacy notice to clients may need a line on AI service providers [L]. |
| s19 | Appropriate, reasonable technical and organisational measures. Identify risks, maintain safeguards, verify them regularly, update them. Give due regard to generally accepted practice and any rules specific to the industry or profession [V] | Encryption at rest, access control, audit log, secure defaults. The "rules specific to the profession" include the IRBA Code. |
| s20-21 | An operator processes only with the responsible party's knowledge or authorisation and treats the information as confidential. A **written contract** must require the operator to keep s19 safeguards. The operator must notify the responsible party **immediately** of a suspected compromise [V] | Warp is very likely Moore's operator for exported packages, and Anthropic a sub-operator [L]. A Moore-Warp operator agreement is needed before any real export. |
| s22 | Notify the Regulator and data subjects "as soon as reasonably possible" when there are reasonable grounds to believe PI was accessed or acquired by an unauthorised person. **No encryption exemption appears in the section text** [V] | A lost laptop with unencrypted recordings, or a package sent to the wrong colleague, is a notifiable compromise. See the TVET precedent below. |
| s26 | Special personal information: religious or philosophical beliefs, race or ethnic origin, trade union membership, political persuasion, health or sex life, biometrics, criminal behaviour [V] | Payroll and HR screens may show medical aid details or union deductions. Onboarding checks may show criminal records. Default-block the HR/payroll apps Moore names [I]. |
| s55 + Regulation 4 | The information officer must ensure, among other things, "a personal information impact assessment is done to ensure that adequate measures and standards exist", plus a compliance framework and internal awareness sessions [V, Guidance Note on Information Officers (1 April 2021 text, re-hosted July 2025), paras 6.2.1-6.2.5] | Rolling out the recorder at Moore needs a PIA signed by Moore's information officer. This document can seed it. The POPIA Regulations were amended on 17 April 2025 (GN 6126, GG 52523) [V2, gov.za gazette listing, Baker McKenzie]. I did not confirm whether Regulation 4 changed, so check the consolidated text. |
| s57(1)(d) | Prior authorisation from the Regulator is needed to transfer **special** PI or children's PI to a foreign third party *without adequate protection* [V] | Special PI must be redacted before any export, so this trigger never arises [I]. |
| s71 | A data subject may not be subject to a decision with legal consequences, or that substantially affects them, based solely on automated processing intended to profile them, including work performance [V] | Superbrain automations built from recordings must not profile or decide about the staff who recorded them [I]. |
| s72 | A transfer abroad is allowed only if: (a) the recipient is bound by a law, binding corporate rules or binding agreement giving adequate protection (substantially similar principles, plus onward-transfer provisions); or (b) the data subject consents; or (c)/(d) it is necessary for a contract; or (e) it benefits the data subject and consent is impracticable [V] | Export to Anthropic. Realistic bases are (a), via the Anthropic DPA plus the Moore-Warp contract, or de-identification so that no PI crosses the border [L]. |

**Regulator activity relevant here:**

- **Accidental internal disclosure is a security compromise.** The Information Regulator served an enforcement notice on Central Johannesburg TVET College because employees' credential-verification reports were accidentally emailed to unauthorised staff, and the college did not notify under s22(1). Commentators read this as establishing that accidental, purely internal disclosures are security compromises. The college was later fined R500,000 for not complying with the notice [V2, Werksmans, Mondaq/ENSafrica, Polity 30 Oct 2026; notice PDF on inforegulator.org.za]. The notice is dated 22 May 2026 per its file name; one secondary summary says 20 May. **Implication:** sending a package to the wrong internal person is reportable, so export destinations and sharing must be deliberate and logged.
- **Transborder guidance is still pending.** The Regulator is reported to be finalising a guidance note on transborder flows (s72) and developing one on PIAs [V2, Bowmans]. Neither was found published as of this research. Re-check both before Moore signs off.
- **No dedicated generative-AI guidance from the Regulator was found.** It has publicly flagged AI retention beyond purpose as conflicting with POPIA [V2, ITWeb, Sep 2026]. A draft national AI policy was released for comment on 10 April 2026 [V2, Werksmans].

### 3.2 RICA (Regulation of Interception of Communications Act 70 of 2002)

- **What the statute allows [V2, commentary only].** RICA prohibits interception except under its Chapter 2 exceptions. Section 5 allows interception with prior written consent. Section 6 allows a business to intercept indirect communications made in connection with carrying on the business, with the express or implied consent of the system user. Polity (30 Jun 2025), Michalsons and ictpolicyafrica.org fragments of the Act support this. I did not retrieve the full gazetted text of s5/s6.
- **Whether RICA applies to this tool [I/L].** A user screen-recording an email they already received, on their own initiative, is probably not "interception in the course of transmission". The recorder does not touch traffic in transit. Counsel should confirm this, because the recorder will capture Outlook and Teams content.
- **The product rule either way [I].** The recorder never captures network traffic. It never runs on its own initiative. It is never started by anyone other than the local user.

### 3.3 Employee-monitoring sensitivity

- South African commentary describes a two-track regime: RICA for interception and POPIA for processing. Employers need a lawful ground, a contract or policy explaining the purpose, and fair processing [V2, Polity 2025; Michalsons; ENSafrica]. Monitoring on personal (BYOD) devices is described as unsettled [V2, Polity 2025].
- **Design stance [I].** Without guardrails, staff will see a desktop screen and keystroke recorder as surveillance. A trusted, voluntarily used tool needs:
  1. recording starts only from a local click or hotkey;
  2. a persistent, unmissable indicator while recording;
  3. pause is one keystroke away;
  4. nothing leaves the machine without the user's review and explicit export;
  5. no admin, remote or scheduled start, and no "silent" setting at all;
  6. no productivity metrics such as time per step per person, keystroke counts per person or idle time;
  7. a written Moore policy that recordings are not used for performance evaluation or discipline (s13/s15 purpose limitation, and s71).
  
  Moore should also consider informing or consulting staff before rollout [L].

### 3.4 IRBA / IESBA confidentiality

- **The confidentiality rules [V, IESBA Final Pronouncement, Technology-related Revisions, April 2023 (updated 30 May 2023), text extracted from the PDF this session].**
  - R114.1 requires accountants to respect confidentiality, including:
    - (a) being alert to inadvertent disclosure;
    - (b) keeping information confidential within the firm;
    - (d) taking reasonable steps so that "personnel under the accountant's control, and individuals from whom advice and assistance are obtained" comply.
  - 114.1 A1 (new) says maintaining confidentiality means "taking appropriate action to protect the confidentiality of such information in the course of its collection, use, transfer, storage or retention, dissemination and lawful destruction".
  - R114.2 bars disclosing, or using for the advantage of the firm or a third party, confidential information. That includes after the relationship ends.
  - R114.3 allows disclosure or use only where there is a legal or professional duty or right, or where "authorized by the client or any person with the authority to permit disclosure or use … and this is not prohibited by law or regulation".
  - Glossary: "confidential information" is "any information, data or other material in whatever form or medium (including written, electronic, visual or oral) that is not publicly available".
  - Effective date: revisions to Parts 1-3 effective 15 December 2024.
- **IRBA adoption [V2, IRBA site listings, accountingacademy.co.za, gazette notice references].** The IRBA Code revised November 2024 incorporates the technology revisions, with Parts 1-3 effective 15 December 2024, and replaces "professional accountant" with "registered auditor". I could not open the IRBA PDFs (403), so I assume IRBA's wording matches IESBA's for subsection 114. Moore's quality partner should confirm.
- **IRBA AI guidance [V2].**
  - Staff Audit Practice Alert 11 (Sep 2025, publicised 7 Oct 2025) on GenAI says firms take full responsibility for AI outputs. It says firms should update ISQM 1 policies to cover "the procurement, validation, and monitoring of GenAI tools", and flags data-privacy concerns. It suggests clients may need disclosures about the integrity and security of data they provide [V2, Acts Online summary].
  - IRBA's 2024 AI Audit Risks Mitigation Update reportedly warns that GenAI tools may lead to unintended disclosure of sensitive information. It advises firms to evaluate whether prompts and data could expose client information [V2, search summary; IRBA PDF returned 403].
  - A January 2023 IRBA communiqué reportedly recommended a firm AI-use policy and AI language in engagement letters [V2].
- **UK analogue, for context only (not IRBA authority).** ICAEW (9 Nov 2026) says firms need generative-AI policies covering confidentiality, regular policy review and training. It likens entering client data into an open AI tool to posting it publicly [V, ICAEW Regulatory News].
- **What this means for the product [I/L].**
  - A recording of a live client file is confidential information in "visual" and "oral" form.
  - Storing it on a Moore laptop is within the firm, so R114.1(b) applies (keep it confidential within the firm, which means access control and encryption).
  - Exporting it to Warp or Anthropic is disclosure to third parties. That is only permissible under R114.3, through client authorisation (for example an engagement-letter clause covering service providers and AI), or by not disclosing confidential information at all, through redaction or synthetic data.
  - The cleanest posture is for Moore to adopt a "**record on training/demo client files where possible**" rule, with real-client recordings allowed only when redaction removes client identifiers and figures. Moore's quality partner decides [L].
  - Recordings must not become engagement documentation by accident. They are process artefacts, not audit evidence [I].

### 3.5 The Claude / Anthropic export route

| Fact | Source |
|---|---|
| Commercial Terms: "Anthropic may not train models on Customer Content from Services." The DPA is incorporated by reference. Effective 17 June 2025. | [V] anthropic.com/legal/commercial-terms |
| DPA uses EU SCC Module 2/3 constructs. It is automatically part of the Commercial Terms. | [V2] search summary of anthropic.com/legal/data-processing-addendum and the support article. Read the live DPA before relying on it. |
| API inputs and outputs are deleted on the backend within 30 days by default. Usage-policy-flagged content is kept up to 2 years and classifier scores up to 7 years. | [V] privacy.claude.com commercial retention article, "as of July 1, 2026" |
| ZDR is available on request and enabled per organisation. Not covered: Console/playground, consumer plans, the Team/Enterprise *product interfaces*, Files API, Batch, code execution, MCP connector, Managed Agents (except self-hosted), and Covered Models. | [V] platform.claude.com API and data retention |
| Covered Models (Fable 5.x, Mythos 5.x) require 30-day retention. | [V] same page |
| Data residency: inference geo is `"global"` (default, "any available geography") or `"us"`. Workspace (at-rest) geo: only `"us"`. Workspaces can restrict `allowed_inference_geos`. | [V] platform.claude.com data residency |
| Claude API inputs: text, images, PDFs. No audio input is listed. | [V] platform.claude.com features overview |
| Consumer Claude (Free/Pro/Max): the user chooses whether chats train models. If yes, retention is up to 5 years. The commercial products are excluded from that change. | [V2] Anthropic news "Updates to our consumer terms" (Aug 2025), MacRumors, TechCrunch |

**Implications [I/L]:**

- The approved route should be one Commercial-Terms organisation, Moore's or Warp's (a decision for sign-off), with:
  - a dedicated workspace with `allowed_inference_geos: ["us"]`, so the s18(1)(g) notice and s72 analysis can name one country instead of "any geography";
  - ZDR requested, or else documented 30-day retention;
  - no Files API, Batch or MCP connector for packages;
  - a non-Covered model for package processing, since Covered Models force 30-day retention.
- **Note:** the workspace's own planning tiering assigns planning to Fable. That is fine for *planning the product*, but not for processing real client packages.
- **Assumption [I]:** the recorder itself does not call Claude in v1. The exported package is a local file, and the "Claude process spec" generator runs only on the reviewed package, outside the capture process. If the draft "review/export + Claude process-spec generation" lane makes the app call Claude directly, PRV-EXP-08 needs an explicit approved-route exception: an org-scoped key held outside the app, `inference_geo: "us"`, no Files API, and a call made only after the export gate passes. See open question 10. The tool should state the approved route in the package README and warn against uploading to personal or consumer Claude accounts.

### 3.6 Lawful-basis options by data-subject group (for Moore's decision) [L]

| Group | Who | Options | Notes |
|---|---|---|---|
| A. Recording user | The Moore staff member who chose to record | s11(1)(f) legitimate interest plus notice (s18) plus right to object (s11(3)). Or s11(1)(a) consent. | Consent is weak in employment (it must be "voluntary") [I]. Legitimate interest plus genuinely voluntary participation plus a no-consequence opt-out is the more robust combination [I/L]. |
| B. Colleagues visible incidentally | Names and emails in Outlook, Teams, ProfSoft | s11(1)(f) | Minimise: block chat and meeting apps by default, and redact names in the export. |
| C. Client individuals and client staff | Names, ID numbers, salaries, bank details in client files | s11(1)(f), with an s15 compatibility assessment. The consent of user A cannot cover them. | De-identify before export. Prefer synthetic or training files. Special PI must never be exported. |
| D. Client juristic persons | Company names, financials | s11(1)(f) and s15 | IRBA R114.3 authorisation is the stricter test here. |
| E. Bystanders in audio | Colleagues speaking near the mic | s11(1)(f) | Microphone only while narrating. Audio stays local. Transcript reviewed. |

---

## 4. OS-level facts the guardrails rely on

| Topic | Fact | Label / source |
|---|---|---|
| macOS secure text fields | Secure text fields return an empty accessibility value by design, and the subrole marks them as secure (`AXSecureTextField`). Browsers map password inputs to this. | [V2] Mozilla bug 721001, WebKit secure-field tests. Confirm with Accessibility Inspector in the spike. |
| macOS Secure Event Input | Apps enable `EnableSecureEventInput` when the user types into password fields. `NSSecureTextField` does this automatically. While it is on, other processes' event taps do not receive keystrokes. `IsSecureEventInputEnabled()` reports the state. The flag is process-global and reference-counted, and a misbehaving app can leave it on. | [V2] Mozilla bug 394106, 1Password community threads, openradar 48953777 |
| macOS Screen Recording permission | macOS Sequoia (15) asks users to re-approve screen-recording apps periodically (monthly at release). This also applies to ScreenCaptureKit apps. 15.1 reduced the frequency for regularly used apps. There is no permanent opt-out. | [V2] 9to5Mac, TidBITS, MacRumors (Aug-Oct 2024). Check the behaviour on the current macOS during the spike. |
| macOS capture exclusion | `SCContentFilter(display:excludingApplications:exceptingWindows:)` captures a display while leaving out the windows of chosen apps. | [Vs] Apple developer docs. A forum thread reports edge cases with `NSWindowSharingNone` windows [V2]. |
| macOS menu-bar recording indicator | macOS shows a system indicator while the screen is being captured. | [I] Not verified this session. Verify in the spike and do not rely on it alone. |
| Windows password controls | UI Automation `IsPassword` is a Boolean that is true when the element's content is protected. | [Vs] Microsoft Learn (AutomationElement.IsPasswordProperty) |
| Windows capture exclusion | `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` removes a window from capture. It was added in Windows 10 version 2004, and earlier versions fall back to `WDA_MONITOR` (black). Password managers and DRM apps use it, so they appear blank in captures. That is correct behaviour and the recorder must not try to defeat it. | [Vs] Microsoft Learn, SetWindowDisplayAffinity (the password-manager usage is [I]) |
| Windows capture border | Windows.Graphics.Capture draws a coloured border around the captured window or display. Removing it needs user consent via `GraphicsCaptureAccess.RequestAccessAsync(Borderless)`. `IsBorderRequired` was introduced in build 10.0.20348.0. | [Vs] Microsoft Learn, GraphicsCaptureSession.IsBorderRequired |
| Windows on-device OCR | `Windows.Media.Ocr.OcrEngine` (Windows 10+, needs package identity). Microsoft now positions the Windows AI text-recognition APIs as the newer, NPU-accelerated option. | [Vs] Microsoft Learn. The fully offline behaviour is [I], so verify with network monitoring in the spike. |
| macOS on-device OCR | Vision `VNRecognizeTextRequest` | [Vs] Apple docs for the API. On-device behaviour is [V2/I], so verify in the spike. |
| Encryption key storage | Electron `safeStorage`: macOS keys are held in the Keychain, and other apps in the same userspace cannot load them without user override. Windows uses DPAPI, which protects against other *users* on the same machine **but not against other apps in the same userspace**. Unsigned or inconsistently signed builds cause Keychain re-prompts. | [Vs] electronjs.org safeStorage docs. Reported deprecation of the sync methods in Electron 46 [V2, Japanese mirror only]. |
| Recall precedent | Microsoft Recall: sensitive-information filtering is on by default. It runs on-device (NPU plus Microsoft Classification Engine, the same technology as Purview) and covers passwords, national ID numbers and card numbers. Users can filter apps and websites, and private browsing is filtered in supported browsers. | [Vs] Microsoft support "Filtering apps, websites, and sensitive information in Recall". Independent tests found misses [V2]. |
| Task-mining precedents | UiPath Task Mining: admins and users can restrict capture to defined applications, users can pause at any time, PII is masked during processing, and "informing data subjects is the responsibility of the customer". Power Automate process mining: pause or resume to avoid sensitive information, then delete steps and remove screenshots and text entries before analysis. | [V] docs.uipath.com (pages opened); [Vs] learn.microsoft.com Power Automate pages |
| Steps Recorder (psr.exe) | Deprecated in Windows 11, with a banner since the Feb 2024 update. Microsoft points to Snipping Tool, Game Bar and Clipchamp instead. | [Vs] Microsoft support. Its handling of typed text was not verified. |
| SA ID number | 13 digits `YYMMDDSSSSCAZ`: date of birth, sequence (0000-4999 female, 5000-9999 male), C = 0 citizen / 1 permanent resident, A = 8 or 9, Z = Luhn check digit. | [V2] Western Cape Government page, python-stdnum `za/idnr.py`; [Vs] Microsoft Purview SIT definition (13 digits, checksum, keyword within 300 characters) |
| SARS income tax reference | 10 digits, starting with 0, 1, 2, 3 or 9, with a "Modulus 10" check per SARS BRS specs. VAT numbers start with 4 and PAYE numbers with 7 [V2]. | OECD TIN profile [V2], SARS PAYE BRS [V2]. Implement the exact algorithm from the SARS BRS appendix, and treat third-party descriptions as [I] until then. |

---

## 5. Threat and misuse model [I]

| # | Scenario | Harm | Primary control |
|---|---|---|---|
| T1 | The user forgets the recorder is on and opens personal banking or WhatsApp | Personal PI captured | Persistent indicator, default blocklist, idle auto-pause, lock-screen auto-stop |
| T2 | The user types a password into a Citrix or ProfSoft window where secure-field status is invisible | Credential captured in keystrokes or field value | No content keylogging by default. Fail closed when focus is unresolved. Blur the focused field box in frames. |
| T3 | An Outlook or Teams toast pops up mid-recording with a colleague's message | Third-party PI | Do-not-disturb checklist at start. Detectors over frames. Notification areas blurred by default [I]. |
| T4 | The package is exported with an unredacted client name in a window title or URL | Client confidentiality breach | Detectors over titles and URLs, titles redacted by default, query strings stripped |
| T5 | A blur is applied as an overlay but the original pixels remain in the exported file | Redaction bypass | Burn redactions into pixels. Re-run detection on the rendered export. Never ship originals or undo history. |
| T6 | A laptop is lost or stolen | s22 compromise | Encryption at rest with OS-protected keys, plus Moore's full-disk encryption |
| T7 | Recordings sync to OneDrive or iCloud because they sit in Documents or Desktop | Uncontrolled copy in a cloud tenant, possibly offshore | Store in app-data, refuse synced folders, check at startup |
| T8 | A crash report uploads a memory dump containing frames | Uncontrolled disclosure | No remote crash reporting by default. Local dumps encrypted or disabled. |
| T9 | A manager asks a staff member to record so they can watch them work | Surveillance and purpose creep | Policy, no productivity metrics, the user owns delete, no remote access |
| T10 | A package is uploaded to a personal consumer Claude account | Training opt-in, 5-year retention, no ZDR | Package README states the approved route. Approved-route export integration later. Training. |
| T11 | The package is emailed to the wrong colleague | Reportable compromise (TVET precedent) | Export audit log, package confidentiality banner, optional encrypted package |
| T12 | Special PI (medical aid, union deduction, criminal check) is exported | s57(1)(d) and s26 exposure | Default-block payroll and HR apps that Moore names. Special-PI keyword detectors. Reviewer attestation. |
| T13 | The recorder is abused as a keylogger or spyware (insider, or a malicious build) | Severe | Signed builds, no content keylogging code path in default builds, no network calls from the capture process, open audit log |
| T14 | Real client recordings land in the git repo, CI artefacts or the PR as "evidence" | Confidentiality breach on GitHub | Synthetic-only test processes. A CI check rejects package files outside fixtures. |

---

## 6. Design principles (non-negotiable) [I, grounded in sections 3-4]

1. **No capture outside an explicit recording.** No pre-roll buffer, no background capture, no "always on".
2. **The user is in control and can always see what is happening.** Indicator, pause, stop and delete are always one action away.
3. **Secret by default.** Typed content and control values are not captured unless the user opts in for a specific non-sensitive field. Secure fields are never captured. When the tool cannot tell, it treats the input as secure.
4. **Minimise at the source, then again at export.** Exclude apps before capture rather than blurring afterwards.
5. **Nothing leaves without review.** The export gate is mandatory, and the export is a file the user can see. The tool performs no network upload in v1.
6. **Redactions are destructive in the export.** The exported package contains rendered, redacted output only.
7. **Everything that leaves is logged.** The log records what, when, by whom, where and with which hash, but never the content.
8. **Fail closed.** If detectors or permissions are unavailable, the tool degrades towards capturing less, never more.
9. **Synthetic data only in development, CI and evidence.**

---

## 7. Requirements and defaults

Each requirement has an ID, a priority, a default, an acceptance check and an owning lane (from the current draft lanes: SPIKE, CORE, CAPTURE, OVERLAY, REVIEW, PACKAGING). **SO** marks a default or policy that needs Moore's sign-off (section 9).

### 7.1 Recording lifecycle and visibility (PRV-REC)

| ID | Req | Priority | Default | Acceptance check | Lane |
|---|---|---|---|---|---|
| PRV-REC-01 | Capture (frames, input events, accessibility queries, mic) runs only between an explicit user Start and Stop. No capture before Start or after Stop. No pre-roll buffer. | MUST | n/a | Automated test: input events, frame callbacks and AX queries generated before Start and after Stop produce zero entries in the timeline. Process inspection shows no capture threads while idle. | CAPTURE |
| PRV-REC-02 | Recording can be started only by the local user (UI click or global hotkey). No CLI, IPC, scheduled, remote or admin-initiated start exists. | MUST | n/a | Code review checklist plus test: the IPC surface has no start-record channel callable outside the renderer UI handler. | CAPTURE, CORE |
| PRV-REC-03 | A persistent recording indicator is visible on every display while recording: a red border or pill with elapsed time, and a tray/menu-bar state change. It is never hidden by the tool's own capture exclusion logic, and it is not itself captured in frames. | MUST | On | Smoke test on Mac and the Win11 VM: screenshot of the screen during recording shows the indicator, and the package frames do not contain it. | OVERLAY |
| PRV-REC-04 | One-key pause and resume through a global hotkey and the indicator. While paused, nothing is captured (frames, input, AX, mic). The timeline records a `paused` marker with duration but no content. | MUST | Hotkey shown on first run | Test: events generated while paused produce only the pause marker. | CAPTURE, OVERLAY |
| PRV-REC-05 | Auto-pause on screen lock, sleep, fast user switching, screensaver, and the session going to the login window. | MUST | On | Test (mocked OS events, plus a manual smoke run on both OSes): lock leads to pause, and unlock does not auto-resume (the user must resume). | CAPTURE |
| PRV-REC-06 | Idle auto-pause after N minutes without input, with a resume prompt. | SHOULD | 5 min **SO** | Unit test on the idle timer. | CAPTURE |
| PRV-REC-07 | A pre-recording checklist sheet asks the user to: close unrelated apps; turn on Do Not Disturb or Focus; use a training or demo client file where possible; choose the capture scope (one window or one display). | SHOULD | Shown each time, with a "don't show again for 7 days" option | UI test. | OVERLAY |
| PRV-REC-08 | Capture scope defaults to a **user-selected set of apps** (with their child windows), chosen on the pre-recording sheet. Moore workflows cross ProfSoft, Caseware, QuicklySign, AppSheet, Outlook and Excel, so a single app is too narrow [I]. The set is pre-filled from the managed allowlist when one exists. Full-display capture is an explicit choice. Multi-display capture is never the default. | MUST | Selected app set **SO** | Test: frames outside the selected apps' windows are blank in the stored frames. Switching to an unselected app produces an `out_of_scope` marker, not frames. | CAPTURE |
| PRV-REC-09 | Maximum recording length, with a warning before auto-stop. | SHOULD | 60 min **SO** | Unit test. | CAPTURE |

### 7.2 Scope control: app and URL allowlist and blocklist (PRV-SCOPE)

| ID | Req | Priority | Default | Acceptance check | Lane |
|---|---|---|---|---|---|
| PRV-SCOPE-01 | App blocklist. When a blocklisted app's window is visible, its region is replaced with a neutral fill and the label "Excluded app" in stored frames, through ScreenCaptureKit exclusion on macOS and a mask/composited fill on Windows. Input events targeting it are dropped and replaced with a single `excluded_app_focus` marker. | MUST | See default list below **SO** | Test with a fixture app on the blocklist: no pixels from it appear in stored frames (pixel diff against the fill colour), and no input events are recorded for it. | CAPTURE |
| PRV-SCOPE-02 | Default blocklist [I]: password managers (1Password, Bitwarden, KeePass, macOS Passwords and Keychain Access, Windows Credential Manager); messaging (WhatsApp, Telegram, Signal, Messages); Teams/Zoom/Meet *meeting and call windows*, because of faces and voices; personal email clients other than the firm's Outlook profile; system settings privacy panes; banking apps; and HR/payroll apps Moore names. | MUST | List ships in config | Config test: the defaults are present, and the managed policy can add but not remove (PRV-ADM-02). | CORE, CAPTURE |
| PRV-SCOPE-03 | URL blocklist for supported browsers (Chrome, Edge, Safari, Firefox): when the foreground tab's host matches, behave as PRV-SCOPE-01 for that browser window. Private and incognito windows are always excluded. | MUST | Banking domains, webmail, social media, the firm's HR portal (Moore names it) **SO** | Smoke test: open a blocklisted test domain and a private window, and confirm both are blanked. | CAPTURE |
| PRV-SCOPE-04 | Optional allowlist mode (managed policy): only listed apps and domains are captured, and everything else is blanked. | SHOULD | Off. **SO**: Moore may prefer allowlist-only for the pilot (Caseware, ProfSoft, QuicklySign, AppSheet, Outlook, Excel). | Test: in allowlist mode a non-listed fixture app is blanked. | CAPTURE |
| PRV-SCOPE-05 | Windows excluded by the OS (`WDA_EXCLUDEFROMCAPTURE`, `NSWindowSharingNone`) are respected and never worked around. | MUST | n/a | Code review: no BitBlt/GDI fallback used to capture protected windows. | CAPTURE |
| PRV-SCOPE-06 | When the browser URL or app identity cannot be determined (for example inside an RDP or Citrix session window), the frame is captured but flagged "unverified scope" for mandatory reviewer attention. | MUST | n/a | Test with the remote-session fixture: steps carry `scope_verified=false`, and the review UI requires acknowledgement. | CAPTURE, REVIEW |

### 7.3 Secrets and password fields (PRV-SEC)

| ID | Req | Priority | Default | Acceptance check | Lane |
|---|---|---|---|---|---|
| PRV-SEC-01 | Detect secure fields. On macOS: focused element role `AXTextField` with subrole `AXSecureTextField`, **or** `IsSecureEventInputEnabled()` true. On Windows: UIA `IsPassword == true`, **or** the Win32 edit style `ES_PASSWORD` [I: style check]. Browser password inputs surface through the same accessibility signals [V2]. | MUST | n/a | Native-helper unit and integration tests against fixture apps: a native secure field and an HTML `<input type=password>` on each OS are classified `secure`. | CAPTURE (native helpers) |
| PRV-SEC-02 | When focus is in a secure field: record no keystroke content, no count, no value. Record a single step "Entered a password into ⟨label⟩ (not recorded)". Blur the field's bounding box in every frame while focus remains there. | MUST | n/a | Test: typing into the fixture secure field produces exactly one redacted step and no key events. The frames' field box is a blur region. | CAPTURE, CORE |
| PRV-SEC-03 | **Fail closed.** If the focused control cannot be resolved, because the accessibility tree is unavailable, the element is opaque, the app is RDP/Citrix/VDI, or the helper timed out, treat typing as secure (as PRV-SEC-02) **and** flag the step "input target unknown" for mandatory review. | MUST | n/a | Test with the opaque-window fixture (a canvas-only app and a remote-desktop-style window): typing yields secure-treatment steps flagged for review. | CAPTURE |
| PRV-SEC-04 | The clipboard is never read. Paste is recorded as the shortcut name only ("Pasted (Ctrl+V)"). | MUST | n/a | Code search plus test: no clipboard API imports in capture code, and a paste event yields a shortcut step only. | CAPTURE |
| PRV-SEC-05 | If Secure Event Input is stuck on (macOS), do not try to bypass it. Surface "Keyboard capture limited by another app" in the indicator. | MUST | n/a | Manual smoke test. | CAPTURE |
| PRV-SEC-06 | Never request permissions beyond those needed. macOS: Screen Recording, Accessibility, Microphone (only when narration is first used). **Open tension for the spike:** PRV-KEY-01/02 need key-down events (for shortcut names and the count bucket), and on macOS a keyboard event tap may require Input Monitoring in addition to Accessibility [I]. The spike must establish the minimum permission set. The keyboard hook must classify keys in-process and discard printable characters immediately, never buffering them. Windows: a low-level keyboard hook in user mode, no elevation and no driver. | MUST | n/a | Spike report lists the exact entitlements and permissions and how key events are classified without retaining characters. The packaging lane's manifest matches it. | SPIKE, PACKAGING |

### 7.4 Keystroke and field-value policy (PRV-KEY)

The key insight [I]: **redacting typed text in the event stream is pointless if the next screenshot shows the text in the field.** The keystroke policy and frame redaction must be coupled.

| ID | Req | Priority | Default | Acceptance check | Lane |
|---|---|---|---|---|---|
| PRV-KEY-01 | Default tier "**typing redacted**". For each typing burst into a non-secure field, record in the event stream: target control (role, label, automation ID, bounds), start and end time, character count bucket (1-5, 6-20, 21+) [I], and a terminating key if any (Enter or Tab). No characters, and no value read from the control (unless PRV-KEY-04 was pre-enabled for that field). **Note:** the encrypted local *frames* still show what was typed until export. That is by design, so the reviewer can choose to un-blur (PRV-KEY-03). Typed text is kept out of the event and timeline data and out of the export. | MUST | On | Test: typing "Test Client 123" into the fixture field produces a step with label and count bucket. The string (and any 4+ character substring) is absent from the **decrypted** timeline/event data, the audit log, the app logs and the default exported package (including OCR of exported frames, since PRV-KEY-03 blurs the field). Searching the encrypted store alone does not count, because it passes trivially. | CAPTURE, CORE |
| PRV-KEY-02 | Shortcuts and navigation keys are recorded by name (Ctrl/Cmd+S, Ctrl+C, Alt+Tab, F2, arrows, Enter, Tab, Esc), because they describe process steps. Single printable characters are not recorded. | MUST | On | Unit test on the key classifier. | CAPTURE |
| PRV-KEY-03 | In the redacted tier, the field's bounding box is auto-blurred in frames captured after typing into it, until focus leaves and the field's content is no longer shown. The reviewer can un-blur a specific field in a specific step if its content is non-sensitive. | MUST | On | Test: frames after typing have a blur region on the field box. Un-blurring in review is logged in the step's redaction record. | CORE, REVIEW |
| PRV-KEY-04 | Two separate opt-ins (both off by default). **(a) Review-time reveal:** in review, the user can un-blur a field in a given step (PRV-KEY-03) and optionally type a plain-text note of the value into the step. No accessibility value is read after the fact, because none was stored. **(b) Pre-recording value capture:** before Start, the user (or the managed policy) can mark specific apps/fields as non-sensitive, such as dropdowns, status fields or generic search boxes. For those fields only, the tool stores the field's *final value*, read from accessibility on blur, not from keystrokes. Neither opt-in is available for secure fields or unknown targets. A captured value that matches any detector is auto-redacted and flagged. | SHOULD | Off | Test: (a) an un-blur plus a note appears in the export and the redaction record. (b) A pre-enabled fixture field stores its value. A value matching the SA ID detector is redacted and flagged. A secure field cannot be pre-enabled. | CAPTURE, REVIEW |
| PRV-KEY-05 | Labels of non-editable controls (buttons, menu items, tabs, links) are recorded, because they are the process. Grid and list cell contents (Excel, Caseware grids) are treated as values: the cell address and column header are recorded, and the content is redacted by default. | MUST | On | Test with a fixture grid: a click on a cell records "Cell B12 (column 'Amount')" without the cell content. | CAPTURE |
| PRV-KEY-06 | No build contains a raw-keystroke text logger. A "full text" debug mode, if one is ever needed, is compiled out of release builds. | MUST | n/a | CI check: grep the release bundle for the debug flag symbol and confirm it is absent. | PACKAGING |

### 7.5 Local PII detection and auto-blur (PRV-PII)

| ID | Req | Priority | Default | Acceptance check | Lane |
|---|---|---|---|---|---|
| PRV-PII-01 | Run on-device OCR on every stored frame or keyframe, plus window titles, URLs, control labels, transcripts and comments. Engine: Apple Vision on macOS, Windows OCR / Windows AI text recognition on Windows. Tesseract (bundled) is the fallback if the spike finds the platform engines unsuitable. **No network calls.** | MUST | On | Spike: run OCR with network blocked (firewall rule) and it succeeds. CI: a unit test on detector output from fixture images. | SPIKE, REVIEW |
| PRV-PII-02 | High-precision detectors, pre-blurred by default (the reviewer can un-blur with a reason): SA ID number (13 digits, valid date, C ∈ {0,1}, Luhn); payment card (13-19 digits, Luhn, known IIN ranges); SARS income tax ref (10 digits, prefix 0/1/2/3/9, mod-10 per the SARS BRS); VAT number (10 digits, prefix 4) [V2]; email address; SA phone numbers (`+27` / `0` followed by 9 digits) [I]; passwords visible as plain text after "Password:" labels [I]. | MUST | Pre-blurred | Detector unit tests with synthetic positive and negative fixtures. Target ≥ 0.95 recall on the synthetic set for structured IDs [I]. False-positive rate is reported, not gated. | REVIEW |
| PRV-PII-03 | Medium-precision detectors, shown as suggestions that the reviewer must resolve (blur or dismiss) before export: bank account numbers (7-11 digit runs near the keywords account, acc no, rekening, branch, or a 6-digit branch code) [I]; company registration numbers (`YYYY/NNNNNN/NN`) [I]; passport numbers near the keyword; dates of birth; street addresses (keyword and pattern); monetary amounts in client-file contexts [I]; person names from a local name model or dictionary [I]. | MUST | Suggest | The export gate test: unresolved suggestions block export. | REVIEW |
| PRV-PII-04 | Optional Moore-supplied **client-name dictionary** (from a ProfSoft client-list extract, stored encrypted locally and updated by IT). Matches in frames, titles and transcripts are pre-blurred. | SHOULD | Off until provided **SO** | Test with a synthetic dictionary. | REVIEW, CORE |
| PRV-PII-05 | Special-PI keyword detectors (medical aid, diagnosis, union, criminal record, race and religion fields) raise a **blocking** flag: the step must be deleted or the region blurred before export. | MUST | On | Test with synthetic fixtures. | REVIEW |
| PRV-PII-06 | Notification-banner regions (the top-right macOS banner area, the bottom-right Windows toast area) are auto-detected or auto-blurred when a toast window appears [I]. | SHOULD | On | Smoke test with a synthetic notification. | CAPTURE, REVIEW |
| PRV-PII-07 | The UI must state plainly that detection is assistive and can miss things. Microsoft's own Recall filter is documented as reducing, not eliminating, sensitive data, and testers found misses [Vs/V2]. | MUST | n/a | Copy review. | REVIEW |
| PRV-PII-08 | Detector set and version are recorded in the package's privacy manifest. | MUST | n/a | Schema test. | CORE |

### 7.6 Narration and audio (PRV-AUD)

| ID | Req | Priority | Default | Acceptance check | Lane |
|---|---|---|---|---|---|
| PRV-AUD-01 | The microphone opens only while narration is active (push-to-talk or toggle), with a distinct mic indicator. It closes on pause or stop. | MUST | Push-to-talk **SO** | Test: no audio samples are stored outside narration intervals. | OVERLAY |
| PRV-AUD-02 | Transcription runs on-device, for example a bundled whisper.cpp-class model or the OS on-device speech APIs [I, spike to choose]. No cloud speech services. | MUST | n/a | Spike: transcription works with network blocked. | SPIKE, OVERLAY |
| PRV-AUD-03 | Audio stays local and is **excluded from the export by default**. The export carries the reviewed transcript. Including audio is an explicit per-package opt-in with a warning that bystander voices may be present. | MUST | Excluded | Export test: the default package contains no audio files. | REVIEW, CORE |
| PRV-AUD-04 | Transcripts pass through the PRV-PII detectors and are reviewed step by step. | MUST | n/a | Test. | REVIEW |

### 7.7 Storage, encryption and retention on the device (PRV-STO)

| ID | Req | Priority | Default | Acceptance check | Lane |
|---|---|---|---|---|---|
| PRV-STO-01 | All recording data at rest (frames, events, audio, transcripts, detector results) is encrypted with a per-recording random 256-bit key using AEAD (AES-256-GCM or XChaCha20-Poly1305) [I]. Each per-recording key is wrapped by a device key held in the OS keystore: macOS Keychain, Windows DPAPI (user scope), for example through Electron `safeStorage` async APIs or a native helper [Vs for safeStorage's properties]. | MUST | On | Test: raw store files contain no PNG/JPEG/WAV magic bytes and no fixture strings. Decryption fails when the keystore entry is removed. | CORE |
| PRV-STO-02 | No plaintext temp files: frames are encrypted before they first touch disk, and the OS temp dir is not used for content. | MUST | n/a | Test: watch the temp dirs during a fixture recording and confirm no content files appear. | CORE, CAPTURE |
| PRV-STO-03 | The store lives in the per-user app-data location (`~/Library/Application Support/…`, `%LOCALAPPDATA%\…`). On startup and before export, the app refuses any path inside OneDrive, iCloud Drive, Dropbox, Google Drive or Desktop/Documents when those are cloud-synced (OneDrive Known Folder Move, iCloud Desktop & Documents) [I]. | MUST | n/a | Unit test of the path classifier, plus a smoke test with OneDrive KFM in the Win11 VM. | CORE |
| PRV-STO-04 | Document the DPAPI limitation. On Windows, other apps running as the same user can unwrap keys [Vs, Electron docs]. Moore must therefore rely on BitLocker / FileVault plus endpoint protection as the outer layer **SO**. | MUST | n/a | Appears in the admin guide. | PACKAGING |
| PRV-STO-05 | Retention: raw recordings auto-delete *N* days after creation (default 30), whether exported or not. A user can "keep" a recording up to a policy maximum (default 90). Exported package copies held by the tool follow the same rule. | MUST | 30 / 90 days **SO** | Clock-injected unit test: an expired recording is shredded at the next launch or daily check. | CORE |
| PRV-STO-06 | Deletion is crypto-shredding (destroy the wrapped key and keystore entry) followed by a file delete. Deleting individual steps removes their frames and events from the store, not just from the view. | MUST | n/a | Test: after a step delete, the frame blob is gone, and the remaining store cannot reconstruct it. | CORE |
| PRV-STO-07 | The user can delete any recording at any time, including all its derived data and local exports. One action does it. | MUST | n/a | UI plus a store test. | REVIEW |
| PRV-STO-08 | No remote crash reporting or telemetry by default. Electron `crashReporter` upload is disabled. Local logs contain no frames, titles, URLs, typed data or transcripts. | MUST | Off | Test: log output from a fixture session, grepped for fixture strings, gives zero hits. Config test: crashReporter `uploadToServer=false`. | PACKAGING, CORE |

### 7.8 Review and export gate (PRV-EXP)

| ID | Req | Priority | Default | Acceptance check | Lane |
|---|---|---|---|---|---|
| PRV-EXP-01 | Export happens only from the review screen, and only after all gate conditions pass: every step has been displayed at least once (scrolled into view); zero unresolved medium detections; zero blocking flags (special PI, unknown input target, unverified scope); and reviewer attestation is ticked. | MUST | n/a | Gate unit tests, one per condition. | REVIEW |
| PRV-EXP-02 | Attestation text, for example: "I have reviewed every step. This package contains only what is needed to understand the process. Client and personal details are removed, or I am authorised to share them." Moore approves the wording **SO**. | MUST | n/a | Copy review. | REVIEW |
| PRV-EXP-03 | A "**What Claude will see**" preview renders the exact export: redacted images, PROCESS.md, the step JSON and the transcript. The export is produced from that same render. | MUST | n/a | Test: the export bytes match the preview render hash. | REVIEW |
| PRV-EXP-04 | Redactions are burned into pixels (the region is replaced, not overlaid). Images are re-encoded with all metadata (EXIF/XMP, text chunks) stripped. The package never contains originals, undo history, unredacted thumbnails or the encrypted store. | MUST | n/a | Test: compare redacted regions in exported images with the originals and find no recoverable signal (region variance about 0 for a solid fill, or mosaic plus noise). Exiftool-style metadata check finds none. | REVIEW, CORE |
| PRV-EXP-05 | **Post-export verification pass**: re-run OCR and the high-precision detectors on the rendered export. Any hit outside an explicitly un-blurred region aborts the export. | MUST | On | Test: inject a fixture where the blur misses a digit. The export aborts and shows the location. | REVIEW |
| PRV-EXP-06 | Package defaults: titles redacted (app name kept); URLs reduced to origin plus path, with query and fragment stripped (path segments matching ID patterns replaced with `{id}`) [I]; typed values absent (except PRV-KEY-04 opt-ins); audio absent; machine name and OS username replaced by a recording-local pseudonym. | MUST | n/a | Schema and fixture tests. | CORE, REVIEW |
| PRV-EXP-07 | Every package includes `privacy.json`. It records: package ID, tool version, policy version and hash, reviewer pseudonym, export time (SAST plus UTC), counts of redactions by type, detectors and versions, opt-ins used, the gate checks passed, and the approved processing route statement. It also includes a short `README` with a confidentiality banner ("Confidential: Moore internal / for processing only via the approved route"). | MUST | n/a | Schema test (CORE owns the schema). | CORE |
| PRV-EXP-08 | v1 export is a local file (folder or zip) only. No upload, share sheet, email or cloud integration in v1. An optional encrypted package (passphrase or recipient key) is available for transport to Warp [I]. | MUST (local only); SHOULD (encrypted) | Local, unencrypted folder **SO** (Moore may require encryption) | Test: no network APIs in the export module. | REVIEW |
| PRV-EXP-09 | Optional two-person review (a second reviewer must approve before export), as a managed-policy switch. | SHOULD | Off **SO** | Test. | REVIEW |

### 7.9 Audit log (PRV-LOG)

| ID | Req | Priority | Default | Acceptance check | Lane |
|---|---|---|---|---|---|
| PRV-LOG-01 | A local append-only audit log as JSON Lines, each entry carrying the SHA-256 of the previous entry (a hash chain). Events: app start, permission grants, record start/pause/resume/stop, excluded-app hits (count only), secure-field events (count only), detector summary, review completed, un-blurs (count by type), export (package ID, SHA-256 of the package, path category, encrypted y/n), deletions (manual and retention), policy changes. | MUST | On | Test: tampering with any line breaks chain verification. Grepping for fixture strings finds zero content. | CORE |
| PRV-LOG-02 | The log contains no content: no frames, titles, URLs, field labels, transcripts or typed data. It identifies the user by OS account, because it is the firm's accountability record [L]. | MUST | n/a | Test as above. | CORE |
| PRV-LOG-03 | The log can be exported for Moore's information officer: a CSV of export events. Central forwarding is out of scope for v1. | SHOULD | n/a | Test. | REVIEW |
| PRV-LOG-04 | Log retention is separate from recording retention. | MUST | 3 years [I] **SO** | Unit test. | CORE |

### 7.10 Admin policy and transparency (PRV-ADM)

| ID | Req | Priority | Default | Acceptance check | Lane |
|---|---|---|---|---|---|
| PRV-ADM-01 | Managed policy file. On macOS: a configuration profile / managed preferences domain. On Windows: `HKLM\Software\Policies\…` or a machine-wide JSON in ProgramData, writable only by admins [I]. It controls the blocklist and allowlist, the allowlist-only mode, retention, idle timeout, max length, the narration mode, PRV-KEY-04 availability, encrypted-export requirement, two-person review, and the approved-route text. | MUST | Ships with secure defaults | Test: a user-level config cannot override a stricter managed value. | CORE, PACKAGING |
| PRV-ADM-02 | Policy can only tighten, never loosen, the built-in floors. Floors: no secure-field capture, no clipboard, no content keylogging, mandatory review gate. | MUST | n/a | Test: a managed policy that tries to disable a floor is ignored and logged. | CORE |
| PRV-ADM-03 | A first-run privacy notice (s18 elements: what is collected, the purpose, that it stays local until the user exports, who receives exports and that this involves transfer abroad to the US, rights, the information officer's contact, and how to complain to the Information Regulator) plus a link to Moore's staff policy. Moore supplies the wording **SO**. | MUST | n/a | UI test that the notice is shown before the first recording and its acknowledgement is logged. | OVERLAY, REVIEW |
| PRV-ADM-04 | An in-app "What does this tool capture?" page that mirrors section 2 of this document in plain language. | SHOULD | n/a | Copy review. | REVIEW |

### 7.11 Build, test and repo hygiene (PRV-DEV)

| ID | Req | Priority | Default | Acceptance check | Lane |
|---|---|---|---|---|---|
| PRV-DEV-01 | All test processes, fixtures, VM smoke evidence, PR screenshots and the "fresh Claude rebuilds the steps" acceptance test (lane acceptance 2-4) use **synthetic** data only: a synthetic company, synthetic SA IDs with valid checksums, fake bank numbers. Never a real Moore or client recording. | MUST | n/a | CI job fails if a `*.wrapkg`, package folder or media file appears outside `recorder/fixtures/`. PR checklist item. | PACKAGING, all lanes |
| PRV-DEV-02 | Synthetic PII fixture generator (SA ID with Luhn, tax ref with mod-10, card numbers with Luhn) shared across detector tests. | MUST | n/a | Unit test. | CORE |
| PRV-DEV-03 | Privacy regression suite runs in `pnpm test`: the PRV-KEY-01 string-absence test, PRV-SEC-02/03, PRV-EXP-04/05, PRV-LOG-01, PRV-STO-01/02. | MUST | n/a | Part of lane acceptance 1. | PACKAGING |
| PRV-DEV-04 | Signed and notarised builds (Apple Developer ID plus notarisation; Windows Authenticode). Consistent signing is also required for stable Keychain access [Vs, Electron docs]. | MUST (for distribution to Moore) | n/a | CI artefact check. | PACKAGING |
| PRV-DEV-05 | The capture and native-helper processes make no network calls. Enforce this with a test-time network stub that fails on any socket open. Auto-update, if any, runs in a separate process and sends no content. | MUST | n/a | Test. | CAPTURE, PACKAGING |

---

## 8. Defaults at a glance (proposed; **SO** = Moore confirms)

| Setting | Default |
|---|---|
| Capture scope | User-selected set of apps (pre-filled from the managed allowlist) **SO** |
| Keystrokes | Typing redacted (field, count bucket and terminating key only). Shortcuts by name. |
| Field values | Not captured. Review-time un-blur plus note, or pre-recording per-field value capture. Never for secure or unknown fields. Detector matches auto-redacted. |
| Secure or unknown input target | Fully suppressed. Field box blurred. Step flagged. |
| Clipboard | Never read |
| Blocklist | Password managers, messaging, meeting and call windows, banking, webmail, social media, private browsing, HR/payroll **SO** |
| Allowlist-only mode | Off (pilot candidate) **SO** |
| Idle auto-pause | 5 min **SO** |
| Lock or sleep | Auto-pause, manual resume |
| Max recording length | 60 min **SO** |
| Narration | Push-to-talk. Transcribed on-device. Audio not exported. **SO** |
| PII detectors | High-precision pre-blurred. Medium-precision must be resolved. Special PI blocks export. |
| Window titles / URLs in export | Titles redacted (app name kept). URLs origin plus path, query stripped. |
| Encryption at rest | Per-recording AEAD key, wrapped by the OS keystore, plus required FileVault/BitLocker **SO** |
| Raw retention | 30 days, "keep" up to 90 **SO** |
| Audit log retention | 3 years **SO** |
| Export | Local file only, review gate, attestation, post-export verification. Encryption optional **SO**. |
| Two-person review | Off **SO** |
| Telemetry / crash upload | Off |
| Approved Claude route | One Commercial-Terms org. Dedicated workspace with `allowed_inference_geos: ["us"]`. ZDR requested. Non-Covered model. No Files API, Batch or MCP for packages. **SO** |

---

## 9. What needs Moore's sign-off

Owner roles are suggestions. IO = Moore's information officer; QP = quality/ethics partner responsible for IRBA compliance; IT = Moore IT; HR = HR or managing partner.

| # | Decision | Why | Suggested owner | Blocks |
|---|---|---|---|---|
| S1 | **Personal information impact assessment** for the recorder pilot, seeded from this document | Regulation 4 duty of the IO [V] | IO | Real-data pilot |
| S2 | **Lawful basis per data-subject group** (section 3.6), including the s15 compatibility view for client data on screen | s11, s15 [V]; [L] | IO + counsel | Real-data pilot |
| S3 | **Purpose statement and staff policy**: voluntary use, no performance or disciplinary use, the right to decline and delete, s18 notice wording (PRV-ADM-03) | s13, s15, s18, s71 [V]; monitoring sensitivity | IO + HR | Rollout to staff |
| S4 | Whether to **inform or consult staff** before rollout | Employee-relations risk [I/L] | HR | Rollout |
| S5 | **IRBA confidentiality position**: (a) require training or demo client files where possible; (b) the conditions for recording live client files; (c) whether engagement letters or client terms need an AI and service-provider clause (R114.3 authorisation) | IESBA/IRBA R114 [V]; IRBA AI communiqués [V2] | QP | Any real-client export |
| S6 | **ISQM 1 update**: add the recorder and Claude processing to the firm's technology resources and GenAI policy (procurement, validation, monitoring) | IRBA Alert 11 [V2] | QP | Rollout |
| S7 | **Operator agreement Moore-Warp** (s21): security measures, immediate breach notice, sub-operator (Anthropic) terms, onward-transfer clause, deletion on termination | s20-21 [V] | IO + counsel + Warp | Any export leaving Moore |
| S8 | **s72 transfer basis** for packages processed by Claude in the US (or "global"): rely on (a) the Anthropic DPA plus the Moore-Warp contract, (b) de-identification so no PI crosses, or both. Update the PAIA/POPIA manual's transborder section if needed [V2: manual covers planned transborder flows]. | s72, s18(1)(g) [V] | IO + counsel | Any export leaving SA |
| S9 | **Approved Claude route**: whose org (Moore or Warp), workspace geo and inference-geo restriction, ZDR request, permitted models (not Covered Models for packages), permitted features | Anthropic retention and residency docs [V] | IO + Warp | Claude processing of real packages |
| S10 | **Default blocklist additions**: Moore's HR/payroll systems, the internal HR portal, personal-use apps | s26 special PI [V]; [I] | IT + IO | Pilot |
| S11 | **Allowlist-only mode for the pilot** (yes/no, and the app list) | Minimisation [I] | IT + IO | Pilot |
| S12 | **Retention**: raw recordings (30/90 days), exported packages at Warp and in Superbrain, audit log (3 years) | s14 [V] | IO | Pilot |
| S13 | **Encryption requirements**: FileVault/BitLocker mandatory on recorder machines; encrypted export packages required or not | s19 [V]; DPAPI limitation [V] | IT | Pilot |
| S14 | **Who may export, and where packages go**: a named folder or SharePoint location with restricted access, and who at Warp receives them | s22 / TVET precedent [V2] | IO + IT | Pilot |
| S15 | **Two-person review** for exports involving live client data (yes/no) | R114.1(d) [V]; [I] | QP | Real-client export |
| S16 | **Client-name dictionary** from ProfSoft for detection (yes/no; who maintains it) | Detection quality [I] | IT + IO | Optional |
| S17 | **Narration default** (push-to-talk vs toggle) and whether audio may ever be exported | Bystander PI [I] | IO | Pilot |
| S18 | **Attestation wording** for the export gate | Accountability [I] | IO + QP | Pilot |
| S19 | **Incident procedure**: what a user does if they realise a package contained unredacted data (who to tell, how fast), aligned with Moore's s22 process | s22 [V]; TVET precedent [V2] | IO | Pilot |
| S20 | **Remote-desktop/Citrix reality**: confirm how ProfSoft is accessed. If it is through RDP/Citrix, accept that secure-field detection is unavailable there and rely on fail-closed handling (PRV-SEC-03). | Technical limitation [I] | IT | Pilot design |

---

## 10. Mapping to lanes (what each lane's contract should include)

- **SPIKE:**
  - prove the secure-field signals on both OSes (PRV-SEC-01), including an HTML password input in Chrome and Edge;
  - confirm the opaque-window fail-closed path (PRV-SEC-03) with an RDP window in the Win11 VM;
  - confirm on-device OCR and transcription work with networking blocked (PRV-PII-01, PRV-AUD-02);
  - list the exact OS permissions needed (PRV-SEC-06);
  - test ScreenCaptureKit app exclusion and the Windows masking approach (PRV-SCOPE-01);
  - verify the macOS recording-indicator behaviour.
- **CORE:**
  - own the privacy schema: `privacy.json`, step redaction records, `scope_verified`, `input_target`, value-redaction state;
  - encryption store (PRV-STO-01..06);
  - audit log (PRV-LOG);
  - policy loader with floors (PRV-ADM-01/02);
  - synthetic PII fixture generator (PRV-DEV-02);
  - PROCESS.md generation never emits redacted content.
- **CAPTURE + native helpers:**
  - PRV-REC-01/02/04/05/08;
  - PRV-SCOPE;
  - PRV-SEC;
  - PRV-KEY-01/02/05;
  - no network (PRV-DEV-05).
- **OVERLAY + narration:**
  - indicator (PRV-REC-03);
  - pre-recording checklist (PRV-REC-07);
  - mic gating and on-device transcription (PRV-AUD-01/02);
  - first-run notice (PRV-ADM-03).
- **REVIEW / EXPORT + process-spec:**
  - PRV-PII;
  - PRV-KEY-03/04;
  - PRV-EXP;
  - PRV-AUD-03/04;
  - PRV-LOG-03;
  - the process-spec generator reads only the rendered, redacted export.
- **PACKAGING + CI:**
  - signing (PRV-DEV-04);
  - privacy regression suite in `pnpm test` (PRV-DEV-03);
  - the synthetic-only artefact check (PRV-DEV-01);
  - crash-reporter off (PRV-STO-08);
  - compiled-out debug keylogging (PRV-KEY-06);
  - an admin guide covering the DPAPI note (PRV-STO-04).

**Suggested privacy acceptance line for the lane plan [I]:** "On a synthetic test process containing a password field, an SA ID number, a client name in the window title and a URL with a query string, the exported package contains none of them. It does contain the step list, the highlight, the comment and the transcript, and `privacy.json` records each redaction." This complements lane acceptance items 2-4 without changing them.

---

## 11. Open questions

1. How is ProfSoft accessed at Moore: thick client, browser, or RDP/Citrix? This decides how much of the secure-field and control-metadata design works for ProfSoft.
2. Is Caseware's UI exposed through UI Automation well enough for control names and password detection? Needs a spike check with a trial copy.
3. Whose Anthropic organisation processes packages (Moore's or Warp's), and on which plan or terms? Is ZDR obtainable for that org?
4. Will Moore require that recordings use training or demo client files, or allow live files with redaction?
5. Where do exported packages live after export (Moore SharePoint, Warp storage, Superbrain)? Retention there is outside this tool but inside the POPIA analysis.
6. Does Moore Global (network) policy add constraints on AI tools or offshore processing? Not researched.
7. Has the Information Regulator published the s72 transborder or PIA guidance notes since this research? Re-check before sign-off.
8. Confirm the IRBA Code November 2024 wording of subsection 114 against the IRBA PDF, which returned 403 to automated fetch.
9. Confirm the RICA s5/s6 text and counsel's view on whether screen capture of received communications is "interception".
10. Does the app call Claude itself to generate the process spec, or is that done by a separate Superbrain/Claude Code step on the exported file? This document assumes the latter. If the former, add the approved-route exception to PRV-EXP-08.
11. On macOS, can shortcut and count-bucket capture work with Accessibility alone, or does it need Input Monitoring? (PRV-SEC-06)

---

## 12. Sources (accessed 21 November 2026 unless stated)

**Statute and regulator**

- POPIA consolidated text, popia.co.za (not the official gazette): s1 definitions, s6, s11, s13, s14, s15, s18, s19, s20, s21, s22, s26, s57, s71, s72. https://popia.co.za/section-1-definitions/ · https://popia.co.za/section-6-exclusions/ · https://popia.co.za/section-11-consent-justification-and-objection/ · https://popia.co.za/section-13-collection-for-specific-purpose/ · https://popia.co.za/section-14-retention-and-restriction-of-records/ · https://popia.co.za/section-15-further-processing-to-be-compatible-with-purpose-of-collection/ · https://popia.co.za/section-18-notification-to-data-subject-when-collecting-personal-information/ · https://popia.co.za/section-19-security-measures-on-integrity-and-confidentiality-of-personal-information/ · https://popia.co.za/section-20-information-processed-by-operator-or-person-acting-under-authority/ · https://popia.co.za/section-21-security-measures-regarding-information-processed-by-operator/ · https://popia.co.za/section-22-notification-of-security-compromises/ · https://popia.co.za/section-26-prohibition-on-processing-of-special-personal-information/ · https://popia.co.za/section-57-processing-subject-to-prior-authorisation/ · https://popia.co.za/section-71-automated-decision-making/ · https://popia.co.za/section-72-transfers-of-personal-information-outside-republic/
- Information Regulator, Guidance Note on Information Officers and Deputy Information Officers (text dated 1 April 2021, file hosted July 2025): https://inforegulator.org.za/wp-content/uploads/2025/07/Guidance_Note_on_Information_Officers_.pdf
- Amended POPIA Regulations, GN 6126, GG 52523, 17 April 2025: https://www.gov.za/sites/default/files/gcis_document/202504/52523gon6126.pdf (listing). Commentary: https://insightplus.bakermckenzie.com/bm/data-technology/south-africa-amendments-to-the-popia-regulations-key-changes-you-need-to-know
- Information Regulator enforcement notice, Central Johannesburg TVET College (May 2026): https://inforegulator.org.za/wp-content/uploads/2026/05/CJC-ENFORCEMENT-NOTICE-220526-redact_Redacted.pdf. Commentary: https://www.mondaq.com/southafrica/data-protection/1796688/information-regulators-first-enforcement-notice-for-2026 · https://www.polity.org.za/article/r500-000-fine-reinforces-the-consequences-of-failing-to-act-on-popia-breaches-2026-10-30
- Regulator on AI (ITWeb, Sep 2026): https://www.itweb.co.za/article/inforeg-unpacks-regulatory-complexities-posed-by-ai/KA3WwMdzPryvrydZ
- Bowmans, data protection developments (transborder and PIA guidance notes pending): https://bowmanslaw.com/insights/south-africa-data-protection-recent-developments-and-enforcement-trends/
- s72 commentary: https://cms.law/en/zaf/legal-updates/Managing-cross-border-data-transfers · https://www.michalsons.com/focus-areas/privacy-and-data-protection/transfers-of-personal-information-outside-south-africa
- RICA and workplace monitoring: https://www.polity.org.za/article/balancing-privacy-and-business-interests---the-intersection-of-popia-rica-and-workplace-surveillance-in-south-africa-2025-06-30 · https://www.michalsons.com/blog/monitoring-of-communications/171 · https://ictpolicyafrica.org/en/document/9mgx1y1zanr?page=17
- PAIA manual contents (transborder flows): https://www.stjohnscollege.co.za/uploads/files/St-Johns-Foundation-PAIA-Information-Manual.pdf (example manual, secondary)

**Professional (IRBA / IESBA)**

- IESBA Final Pronouncement, Technology-related Revisions to the Code (April 2023, updated 30 May 2023). Text of R114.1-R114.3, 114.1 A1, the Glossary and the effective date was extracted locally: https://ifacweb.blob.core.windows.net/publicfiles/2023-05/Final%20Pronouncement%2C%20Technology%20Revisions%20%28Final%20-%20April%2011%29%28Updated%20May%2030%29.pdf
- IRBA Code (revised November 2024) and IRBA technology pronouncement (both 403 to automated fetch): https://irba.co.za/upload/51_%20IRBA%20Code%202024.pdf · https://www.irba.co.za/upload/Final%20Pronouncement_Technology-related%20Revisions.pdf · https://accountingacademy.co.za/news/read/irba-code-of-conduct-published-nov-2024-edition
- IRBA Staff Audit Practice Alert 11 on GenAI (summary): https://acts.co.za/news/blog/2025/10/irba-audit-alert-11-genai
- IRBA AI Audit Risks Mitigation Update (2024): https://www.irba.co.za/upload/40_%20Artificial%20Intelligence%20Audit%20Risks%20Mitigation%20Update.pdf (secondary summary only)
- ICAEW, "AI and client data: complying with the principle of confidentiality" (9 Nov 2026, UK analogue): https://www.icaew.com/regulation/regulatory-news/regulatory-news-2026-11/ai-and-client-data-complying-with-the-principle-of-confidentiality

**Anthropic / Claude**

- Commercial Terms (effective 17 June 2025): https://www.anthropic.com/legal/commercial-terms
- Data Processing Addendum: https://www.anthropic.com/legal/data-processing-addendum · Subprocessors: https://www.anthropic.com/subprocessors
- API and data retention (ZDR, Covered Models, feature eligibility): https://platform.claude.com/docs/en/manage-claude/api-and-data-retention
- Data residency (`inference_geo`, workspace geo): https://platform.claude.com/docs/en/manage-claude/data-residency
- Features overview (input modalities): https://platform.claude.com/docs/en/build-with-claude/overview
- Commercial retention (as of 1 July 2026): https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data
- Consumer terms update (Aug 2025): https://www.anthropic.com/news/updates-to-our-consumer-terms

**Platform and technical**

- UI Automation IsPassword: https://msdn.microsoft.com/en-us/library/ms598241(v=vs.85) · https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.ispasswordproperty
- SetWindowDisplayAffinity: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity
- GraphicsCaptureSession.IsBorderRequired: https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturesession.isborderrequired
- Windows OCR: https://learn.microsoft.com/uwp/api/windows.media.ocr.ocrengine · https://learn.microsoft.com/en-us/windows/ai/apis/text-recognition
- Apple Vision text recognition: https://developer.apple.com/documentation/vision/recognizing-text-in-images
- ScreenCaptureKit SCContentFilter: https://developer.apple.com/documentation/screencapturekit/sccontentfilter
- macOS secure fields: https://bugzilla.mozilla.org/show_bug.cgi?id=721001 · https://bugzilla.mozilla.org/show_bug.cgi?id=394106 · https://www.1password.community/1password-at-work-58/secure-input-blocking-other-apps-event-taps-25015 · https://openradar.appspot.com/48953777
- macOS Sequoia screen-recording prompts: https://9to5mac.com/2024/08/14/macos-sequoia-screen-recording-prompt-monthly/ · https://tidbits.com/2024/08/19/apple-reduces-excessive-sequoia-permission-requests-shifts-to-monthly · https://macrumors.com/2024/10/07/apple-screen-recording-popup-update
- Electron safeStorage: https://www.electronjs.org/docs/latest/api/safe-storage
- Microsoft Recall filtering: https://support.microsoft.com/en-us/windows/filtering-apps-websites-and-sensitive-information-in-recall-a4c28bee-e200-4a4a-b60d-c0522b404a5b · test of misses: https://www.tomshardware.com/software/windows/microsoft-recall-screenshots-credit-cards-and-social-security-numbers-even-with-the-sensitive-information-filter-enabled
- Steps Recorder deprecation: https://support.microsoft.com/en-us/windows/steps-recorder-deprecation-a64888d7-8482-4965-8ce3-25fb004e975f
- UiPath Task Mining privacy: https://docs.uipath.com/task-mining/docs/protection-of-personal-data-and-privacy-of-the-users · https://docs.uipath.com/task-mining/automation-cloud/latest/user-guide/information-about-the-collected-data
- Power Automate process mining privacy: https://learn.microsoft.com/en-us/power-automate/process-advisor-security · https://learn.microsoft.com/en-us/flow/process-advisor-protect
- SA ID number: https://westerncape.gov.za/your_gov/70/documents/public_info/D/42415 · https://sources.debian.org/data/main/p/python-stdnum/2.2-1/stdnum/za/idnr.py · https://learn.microsoft.com/en-us/purview/sit-defn-south-africa-identification-number
- SARS tax reference: https://oecd.org/tax/automatic-exchange/crs-implementation-and-assistance/tax-identification-numbers/South-Africa-TIN.pdf · https://www.sars.gov.za/wp-content/uploads/Docs/PAYE/BRS/SARS_PAYE_BRS-PAYE-Employer-Reconciliation_V17-0-2.pdf
