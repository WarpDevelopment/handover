// Handover click and control helper for macOS.
//
// One Swift file: `npm run build:helper:mac` (swiftc -O). Privacy floors
// (docs/recorder/tester-package.md section 1):
//   * A LISTEN-ONLY CGEventTap for mouse-down events only. Never an active tap, never keyboard events.
//   * Control role and name only. AXValue is never read. Secure text fields keep role and name and are
//     flagged isPassword.
//   * No network access.
//
// Protocol: JSON lines on stdout (see native/windows/HandoverHelper.cs for the full list).
//   hello, capabilities, click, error, and selftest with --selftest.
// Coordinates are global points with a top-left origin (`macos_global_points`).
// The process exits when stdin closes.

import ApplicationServices
import AppKit
import Foundation

let helperVersion = "1.0.0"
let lookupTimeoutSeconds = 0.3

// MARK: - Output

let outLock = NSLock()

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: []) else { return }
    outLock.lock()
    defer { outLock.unlock() }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
}

func log(_ message: String) {
    FileHandle.standardError.write(Data(("[HandoverHelper] " + message + "\n").utf8))
}

// MARK: - Accessibility lookup (names and roles only; AXValue is never read)

func axString(_ element: AXUIElement, _ attribute: String) -> String? {
    var ref: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &ref) == .success,
          let value = ref as? String else { return nil }
    return value
}

func axElement(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
    var ref: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &ref) == .success,
          let value = ref, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}

/// Int(x) traps on NaN, infinity and huge values, and AX geometry can be any of them (NAT-10).
func safeInt(_ value: CGFloat) -> Int? {
    let d = Double(value)
    guard d.isFinite, abs(d) < 1_000_000 else { return nil }
    return Int(d.rounded())
}

func axBounds(_ element: AXUIElement) -> [String: Int]? {
    var posRef: CFTypeRef?
    var sizeRef: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &posRef) == .success,
          AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef) == .success,
          let p = posRef, let s = sizeRef,
          CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &point),
          AXValueGetValue(s as! AXValue, .cgSize, &size),
          let x = safeInt(point.x), let y = safeInt(point.y),
          let w = safeInt(size.width), let h = safeInt(size.height) else { return nil }
    return ["x": x, "y": y, "width": w, "height": h]
}

/// Control and line-separator characters become a space: U+0085, U+2028 and U+2029 split a line in some
/// readers (NAT-3).
func clean(_ s: String?) -> String {
    guard let s = s else { return "" }
    var out = ""
    for scalar in s.unicodeScalars {
        let v = scalar.value
        let blank = v < 0x20 || v == 0x7f || v == 0x85 || v == 0x2028 || v == 0x2029
        out.unicodeScalars.append(blank ? " " : scalar)
        if out.count >= 200 { break }
    }
    return out
}

func normalisedRole(role: String, subrole: String?) -> String {
    if subrole == "AXTabButton" { return "tab" }
    if subrole == "AXDialog" || subrole == "AXSystemDialog" { return "dialog" }
    switch role {
    case "AXButton", "AXMenuButton": return "button"
    case "AXTextField", "AXTextArea", "AXSearchField": return "textbox"
    case "AXComboBox", "AXPopUpButton": return "combobox"
    case "AXMenuItem", "AXMenuBarItem": return "menuitem"
    case "AXLink": return "link"
    case "AXCheckBox": return "checkbox"
    case "AXRadioButton": return "radio"
    case "AXCell": return "cell"
    case "AXRow": return "row"
    case "AXStaticText": return "text"
    case "AXImage": return "image"
    case "AXWindow": return "window"
    case "AXSheet", "AXDrawer": return "dialog"
    case "AXWebArea": return "document"
    case "AXGroup", "AXScrollArea", "AXSplitGroup", "AXToolbar", "AXList", "AXOutline", "AXTable": return "pane"
    default: return "other"
    }
}

func elementName(_ element: AXUIElement) -> String {
    // AXTitle, then AXDescription. Never AXValue.
    let title = axString(element, kAXTitleAttribute as String) ?? ""
    if !title.isEmpty { return clean(title) }
    return clean(axString(element, kAXDescriptionAttribute as String))
}

/// pids we switched AXManualAccessibility on for. Lookups run on a concurrent queue, so every access holds the lock.
var manualAccessibilityDone = Set<pid_t>()
let manualLock = NSLock()

/// Electron apps only expose their tree once AXManualAccessibility is set. Harmless for other apps.
/// Returns true when the attribute was newly set by this call, so the caller can retry its hit test once.
/// A pid is marked done only after the set succeeded (NAT-9).
func enableManualAccessibility(pid: pid_t) -> Bool {
    manualLock.lock()
    defer { manualLock.unlock() }
    if manualAccessibilityDone.contains(pid) { return false }
    let app = AXUIElementCreateApplication(pid)
    let result = AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    if result == .success {
        manualAccessibilityDone.insert(pid)
        return true
    }
    return false
}

/// Puts every app back the way we found it: the attribute is switched off again on exit (NAT-9).
func disableManualAccessibility() {
    manualLock.lock()
    let pids = manualAccessibilityDone
    manualAccessibilityDone.removeAll()
    manualLock.unlock()
    for pid in pids {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.2)
        _ = AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanFalse)
    }
}

func shutdown() -> Never {
    disableManualAccessibility()
    exit(0)
}

struct LookupOutcome {
    var target: [String: Any]?
    var reason: String?
}

/// The ancestry walk may use this much of a lookup; what it collected by then is kept (NAT-5).
let ancestryBudgetSeconds = 0.2

/// `publish` is called as soon as the element itself is resolved, before the ancestry walk, so a timeout
/// during the walk still returns the control instead of losing the click.
func lookupAtPoint(x: Double, y: Double, started: Date = Date(),
                   publish: (LookupOutcome) -> Void = { _ in }) -> LookupOutcome {
    let system = AXUIElementCreateSystemWide()
    AXUIElementSetMessagingTimeout(system, Float(lookupTimeoutSeconds))
    var found: AXUIElement?
    var err = AXUIElementCopyElementAtPosition(system, Float(x), Float(y), &found)
    guard err == .success, var element = found else {
        return LookupOutcome(target: nil, reason: err == .cannotComplete ? "timeout" : "opaque_toolkit")
    }

    var pid: pid_t = 0
    AXUIElementGetPid(element, &pid)
    if pid != 0, enableManualAccessibility(pid: pid) {
        // The app only starts exposing its tree after the attribute is set: hit-test once more.
        var retried: AXUIElement?
        err = AXUIElementCopyElementAtPosition(system, Float(x), Float(y), &retried)
        if err == .success, let again = retried {
            element = again
            var p2: pid_t = 0
            AXUIElementGetPid(again, &p2)
            if p2 != 0 { pid = p2 }
        }
    }

    let rawRole = axString(element, kAXRoleAttribute as String) ?? ""
    let subrole = axString(element, kAXSubroleAttribute as String)
    let role = normalisedRole(role: rawRole, subrole: subrole)
    let isPassword = subrole == "AXSecureTextField"
    let name = elementName(element)
    let bounds = axBounds(element)

    // Ancestry: nearest parent first while walking, then reversed to window-first.
    var parents: [(String, String)] = []
    var windowTitle = ""
    var windowBounds: [String: Int]?
    let identifier = axString(element, kAXIdentifierAttribute as String)
    var appInfo: [String: Any]?
    if pid != 0, let app = NSRunningApplication(processIdentifier: pid) {
        var info: [String: Any] = ["name": clean(app.localizedName)]
        if let bundle = app.bundleIdentifier { info["bundleId"] = bundle }
        appInfo = info
    }

    /// The outcome from what has been collected so far.
    func build() -> LookupOutcome {
        var shown = Array(parents.reversed())
        if shown.count > 6 { shown = [shown[0]] + Array(shown.suffix(5)) }

        var weak = name.isEmpty || role == "other"
        if !weak, role != "window", let b = bounds, let w = windowBounds,
           let bw = b["width"], let bh = b["height"], let ww = w["width"], let wh = w["height"] {
            // Doubles: the product of two Ints can overflow (NAT-10).
            let winArea = Double(ww) * Double(wh)
            if winArea > 0, Double(bw) * Double(bh) / winArea > 0.6 { weak = true }
        }

        var target: [String: Any] = [
            "grounding": weak ? "accessibility_weak" : "accessibility",
            "source": "ax",
            "role": role,
            "nativeRole": subrole != nil && !(subrole ?? "").isEmpty ? "\(rawRole)/\(subrole!)" : rawRole,
            "name": name,
            "isPassword": isPassword,
        ]
        if let id = identifier, !id.isEmpty { target["axIdentifier"] = clean(id) }
        if let b = bounds { target["bounds"] = b }
        if !shown.isEmpty { target["ancestry"] = shown.map { ["role": $0.0, "name": $0.1] } }
        if let info = appInfo { target["app"] = info }
        if !windowTitle.isEmpty { target["windowTitle"] = windowTitle }
        return LookupOutcome(target: target, reason: weak ? "opaque_toolkit" : nil)
    }

    // The element is resolved: hand it over now. Everything below only adds detail.
    publish(build())

    var current = element
    for _ in 0..<24 {
        if Date().timeIntervalSince(started) >= ancestryBudgetSeconds { break }
        guard let parent = axElement(current, kAXParentAttribute as String) else { break }
        let pRaw = axString(parent, kAXRoleAttribute as String) ?? ""
        if pRaw == "AXApplication" { break }
        let pRole = normalisedRole(role: pRaw, subrole: axString(parent, kAXSubroleAttribute as String))
        let pName = elementName(parent)
        parents.append((pRole, pName))
        if pRaw == "AXWindow" {
            windowTitle = pName
            windowBounds = axBounds(parent)
            break // the first window parent ends the walk
        }
        current = parent
    }
    return build()
}

/// Runs the AX lookup on a background queue and gives up after 300 ms.
let axQueue = DispatchQueue(label: "handover.ax-lookup", attributes: .concurrent)
/// Lookups still blocked inside AX, in total and per owning process (NAT-11): one hung app stops lookups
/// against that app only, not against every other window.
var stuckTotal = 0
var stuckByPid = [pid_t: Int]()
let stuckLock = NSLock()
let maxStuckTotal = 8
let maxStuckPerPid = 2

/// The process that owns the topmost normal window at the point, or 0. Only the pid and the bounds of each
/// window are read; window names (which would need Screen Recording permission) never are.
func windowOwnerPid(x: Double, y: Double) -> pid_t {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
            as? [[String: Any]] else { return 0 }
    for window in list {
        guard (window[kCGWindowLayer as String] as? Int) == 0,
              let boundsDict = window[kCGWindowBounds as String] as? NSDictionary,
              let rect = CGRect(dictionaryRepresentation: boundsDict as CFDictionary),
              rect.contains(CGPoint(x: x, y: y)),
              let owner = window[kCGWindowOwnerPID as String] as? Int else { continue }
        return pid_t(owner)
    }
    return 0
}

func lookupWithTimeout(x: Double, y: Double) -> LookupOutcome {
    let owner = windowOwnerPid(x: x, y: y)
    stuckLock.lock()
    if stuckTotal >= maxStuckTotal || (stuckByPid[owner] ?? 0) >= maxStuckPerPid {
        stuckLock.unlock()
        return LookupOutcome(target: nil, reason: "timeout")
    }
    stuckTotal += 1
    stuckByPid[owner, default: 0] += 1
    stuckLock.unlock()

    /// The latest outcome the lookup published; read under the lock after a timeout.
    final class Box { var latest: LookupOutcome?; var final: LookupOutcome? }
    let box = Box()
    let boxLock = NSLock()
    let done = DispatchSemaphore(value: 0)
    let started = Date()
    axQueue.async {
        let result = lookupAtPoint(x: x, y: y, started: started) { partial in
            boxLock.lock(); box.latest = partial; boxLock.unlock()
        }
        boxLock.lock(); box.final = result; boxLock.unlock()
        stuckLock.lock()
        stuckTotal -= 1
        let n = (stuckByPid[owner] ?? 1) - 1
        if n <= 0 { stuckByPid.removeValue(forKey: owner) } else { stuckByPid[owner] = n }
        stuckLock.unlock()
        done.signal()
    }
    let timedOut = done.wait(timeout: .now() + lookupTimeoutSeconds) == .timedOut
    boxLock.lock()
    defer { boxLock.unlock() }
    if let final = box.final { return final }
    // Timed out: an element that was already resolved is returned without its full ancestry (NAT-5).
    if let partial = box.latest, partial.target != nil { return partial }
    return LookupOutcome(target: nil, reason: timedOut ? "timeout" : "opaque_toolkit")
}

// MARK: - Click pipeline (serial, off the tap callback)

let clickQueue = DispatchQueue(label: "handover.click-pipeline")
var queuedClicks = 0
let queuedLock = NSLock()

func handleClick(button: String, count: Int, x: Double, y: Double) {
    queuedLock.lock()
    queuedClicks += 1
    let backlog = queuedClicks
    queuedLock.unlock()

    clickQueue.async {
        defer { queuedLock.lock(); queuedClicks -= 1; queuedLock.unlock() }
        let started = Date()
        var outcome: LookupOutcome
        if !AXIsProcessTrusted() {
            outcome = LookupOutcome(target: nil, reason: "permission_missing")
        } else if backlog > 8 {
            outcome = LookupOutcome(target: nil, reason: "timeout")
        } else {
            outcome = lookupWithTimeout(x: x, y: y)
        }
        var message: [String: Any] = [
            "type": "click",
            "button": button,
            "clickCount": min(max(count, 1), 2),
            "x": safeInt(CGFloat(x)) ?? 0,
            "y": safeInt(CGFloat(y)) ?? 0,
            "lookupMs": Int(Date().timeIntervalSince(started) * 1000),
        ]
        if let target = outcome.target { message["target"] = target }
        if let reason = outcome.reason { message["unavailableReason"] = reason }
        emit(message)
    }
}

// MARK: - Listen-only mouse-down tap

var eventTap: CFMachPort?
var tapSource: CFRunLoopSource?

let tapCallback: CGEventTapCallBack = { _, type, event, _ in
    switch type {
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        // Only re-enable while still allowed; the poll below tears the tap down when trust is gone (NAT-1).
        if AXIsProcessTrusted(), let tap = eventTap { CGEvent.tapEnable(tap: tap, enable: true) }
    case .leftMouseDown, .rightMouseDown, .otherMouseDown:
        let button = type == .leftMouseDown ? "left" : (type == .rightMouseDown ? "right" : "middle")
        let count = Int(event.getIntegerValueField(.mouseEventClickState))
        let p = event.location
        handleClick(button: button, count: count, x: Double(p.x), y: Double(p.y))
    default:
        break
    }
    // Listen-only: the event is never modified or swallowed.
    return Unmanaged.passUnretained(event)
}

func mouseDownMask() -> CGEventMask {
    return (1 << CGEventType.leftMouseDown.rawValue)
        | (1 << CGEventType.rightMouseDown.rawValue)
        | (1 << CGEventType.otherMouseDown.rawValue)
}

func makeTap() -> CFMachPort? {
    return CGEvent.tapCreate(tap: .cgSessionEventTap, place: .tailAppendEventTap,
                             options: .listenOnly, eventsOfInterest: mouseDownMask(),
                             callback: tapCallback, userInfo: nil)
}

func installTap() -> Bool {
    if eventTap != nil { return true }
    guard let tap = makeTap() else { return false }
    eventTap = tap
    tapSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetCurrent(), tapSource, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    return true
}

/// Disable, remove and invalidate the tap and forget it (NAT-1).
func teardownTap() {
    if let source = tapSource { CFRunLoopRemoveSource(CFRunLoopGetCurrent(), source, .commonModes) }
    if let tap = eventTap {
        CGEvent.tapEnable(tap: tap, enable: false)
        CFMachPortInvalidate(tap)
    }
    eventTap = nil
    tapSource = nil
}

/// True only when the tap exists, its port is valid and it is enabled: the one honest meaning of `hook`.
func tapHealthy() -> Bool {
    guard let tap = eventTap else { return false }
    return CFMachPortIsValid(tap) && CGEvent.tapIsEnabled(tap: tap)
}

var previouslyTrusted = false
var trustRevoked = false

/// One pass of the poll. Trust that is REVOKED mid-run (trusted, then not) tears the tap down, and it is not
/// rebuilt until trust returns. A Mac that was never trusted keeps trying to create the tap as before, so
/// clicks still arrive as visual-only `permission_missing` steps when the tap can exist without Accessibility.
/// A tap that exists but is dead or disabled is rebuilt. Returns the trust and hook state to report.
func reconcileTap() -> (trusted: Bool, hook: Bool) {
    let trusted = AXIsProcessTrusted()
    if previouslyTrusted, !trusted {
        teardownTap()
        trustRevoked = true
    }
    if trusted { trustRevoked = false }
    previouslyTrusted = trusted
    if eventTap != nil, !tapHealthy() { teardownTap() } // rebuilt just below
    if eventTap == nil, !trustRevoked { _ = installTap() }
    return (trusted, tapHealthy())
}

func capabilities(hook: Bool, trusted: Bool) -> [String: Any] {
    return ["type": "capabilities", "hook": hook, "accessibility": trusted, "uia": false,
            "interactive": true, "elevated": false, "space": "macos_global_points"]
}

// MARK: - Entry points

func selftest() -> Int32 {
    let trusted = AXIsProcessTrusted()
    var tapCreatable = false
    if let tap = makeTap() {
        tapCreatable = true
        CFMachPortInvalidate(tap)
    }
    emit(capabilities(hook: tapCreatable, trusted: trusted))
    var report: [String: Any] = ["type": "selftest", "accessibilityTrusted": trusted, "hookInstalled": tapCreatable]
    if trusted {
        let started = Date()
        let outcome = lookupWithTimeout(x: 10, y: 10)
        report["fromPointMs"] = Int(Date().timeIntervalSince(started) * 1000)
        report["fromPoint"] = outcome.target != nil ? "found" : "none"
        if let reason = outcome.reason { report["reason"] = reason }
    } else {
        report["fromPoint"] = "skipped"
        report["reason"] = "permission_missing"
    }
    emit(report)
    disableManualAccessibility()
    return 0
}

func run() -> Int32 {
    emit(["type": "hello", "helper": "HandoverHelper", "version": helperVersion,
          "platform": "macos", "protocol": 1])
    if CommandLine.arguments.contains("--selftest") { return selftest() }

    var (lastTrusted, lastHook) = reconcileTap()
    emit(capabilities(hook: lastHook, trusted: lastTrusted))
    if !lastHook {
        emit(["type": "error", "message": "event tap unavailable (permission not granted yet)"])
    }

    // Exit when the parent closes our stdin, putting AXManualAccessibility back first.
    Thread.detachNewThread {
        while FileHandle.standardInput.availableData.count > 0 {}
        shutdown()
    }
    // Same on SIGTERM and SIGINT.
    var signalSources: [DispatchSourceSignal] = []
    for sig in [SIGTERM, SIGINT] {
        signal(sig, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: sig, queue: .global())
        source.setEventHandler { shutdown() }
        source.resume()
        signalSources.append(source)
    }

    // Poll every 1.5 s: tear the tap down when trust is gone, rebuild it when it died or was never created,
    // and report any change. `hook` is true only while the tap exists and is enabled (NAT-1).
    let timer = DispatchSource.makeTimerSource(queue: .main)
    timer.schedule(deadline: .now() + 1.5, repeating: 1.5)
    timer.setEventHandler {
        let (trusted, hook) = reconcileTap()
        if trusted != lastTrusted || hook != lastHook {
            lastTrusted = trusted
            lastHook = hook
            emit(capabilities(hook: hook, trusted: trusted))
        }
    }
    timer.resume()

    CFRunLoopRun()
    return 0
}

exit(run())
