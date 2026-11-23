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

func axBounds(_ element: AXUIElement) -> [String: Int]? {
    var posRef: CFTypeRef?
    var sizeRef: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &posRef) == .success,
          AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef) == .success,
          let p = posRef, let s = sizeRef else { return nil }
    var point = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &point),
          AXValueGetValue(s as! AXValue, .cgSize, &size) else { return nil }
    return ["x": Int(point.x.rounded()), "y": Int(point.y.rounded()),
            "width": Int(size.width.rounded()), "height": Int(size.height.rounded())]
}

func clean(_ s: String?) -> String {
    guard let s = s else { return "" }
    var out = ""
    for scalar in s.unicodeScalars {
        out.unicodeScalars.append(scalar.value < 0x20 || scalar.value == 0x7f ? " " : scalar)
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

var manualAccessibilityDone = Set<pid_t>()

/// Electron apps only expose their tree once AXManualAccessibility is set. Harmless for other apps.
func enableManualAccessibility(pid: pid_t) {
    if manualAccessibilityDone.contains(pid) { return }
    manualAccessibilityDone.insert(pid)
    let app = AXUIElementCreateApplication(pid)
    _ = AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
}

struct LookupOutcome {
    var target: [String: Any]?
    var reason: String?
}

func lookupAtPoint(x: Double, y: Double) -> LookupOutcome {
    let system = AXUIElementCreateSystemWide()
    AXUIElementSetMessagingTimeout(system, Float(lookupTimeoutSeconds))
    var found: AXUIElement?
    let err = AXUIElementCopyElementAtPosition(system, Float(x), Float(y), &found)
    guard err == .success, let element = found else {
        return LookupOutcome(target: nil, reason: err == .cannotComplete ? "timeout" : "opaque_toolkit")
    }

    var pid: pid_t = 0
    AXUIElementGetPid(element, &pid)
    if pid != 0 { enableManualAccessibility(pid: pid) }

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
    var current = element
    for _ in 0..<24 {
        guard let parent = axElement(current, kAXParentAttribute as String) else { break }
        let pRaw = axString(parent, kAXRoleAttribute as String) ?? ""
        if pRaw == "AXApplication" { break }
        let pRole = normalisedRole(role: pRaw, subrole: axString(parent, kAXSubroleAttribute as String))
        let pName = elementName(parent)
        parents.append((pRole, pName))
        if pRaw == "AXWindow" { windowTitle = pName; windowBounds = axBounds(parent) }
        current = parent
    }
    parents.reverse()
    if parents.count > 6 { parents = [parents[0]] + Array(parents.suffix(5)) }

    var weak = name.isEmpty || role == "other"
    if !weak, role != "window", let b = bounds, let w = windowBounds {
        let winArea = Double(w["width"]! * w["height"]!)
        if winArea > 0, Double(b["width"]! * b["height"]!) / winArea > 0.6 { weak = true }
    }

    var target: [String: Any] = [
        "grounding": weak ? "accessibility_weak" : "accessibility",
        "source": "ax",
        "role": role,
        "nativeRole": subrole != nil && !(subrole ?? "").isEmpty ? "\(rawRole)/\(subrole!)" : rawRole,
        "name": name,
        "isPassword": isPassword,
    ]
    if let id = axString(element, kAXIdentifierAttribute as String), !id.isEmpty {
        target["axIdentifier"] = clean(id)
    }
    if let b = bounds { target["bounds"] = b }
    if !parents.isEmpty { target["ancestry"] = parents.map { ["role": $0.0, "name": $0.1] } }
    if pid != 0, let app = NSRunningApplication(processIdentifier: pid) {
        var appInfo: [String: Any] = ["name": clean(app.localizedName)]
        if let bundle = app.bundleIdentifier { appInfo["bundleId"] = bundle }
        target["app"] = appInfo
    }
    if !windowTitle.isEmpty { target["windowTitle"] = windowTitle }
    return LookupOutcome(target: target, reason: weak ? "opaque_toolkit" : nil)
}

/// Runs the AX lookup on a background queue and gives up after 300 ms.
let axQueue = DispatchQueue(label: "handover.ax-lookup", attributes: .concurrent)
var stuckLookups = 0
let stuckLock = NSLock()

func lookupWithTimeout(x: Double, y: Double) -> LookupOutcome {
    stuckLock.lock()
    let stuck = stuckLookups
    stuckLock.unlock()
    if stuck >= 4 { return LookupOutcome(target: nil, reason: "timeout") }

    final class Box { var value: LookupOutcome? }
    let box = Box()
    let done = DispatchSemaphore(value: 0)
    stuckLock.lock(); stuckLookups += 1; stuckLock.unlock()
    axQueue.async {
        let result = lookupAtPoint(x: x, y: y)
        box.value = result
        stuckLock.lock(); stuckLookups -= 1; stuckLock.unlock()
        done.signal()
    }
    if done.wait(timeout: .now() + lookupTimeoutSeconds) == .timedOut {
        return LookupOutcome(target: nil, reason: "timeout")
    }
    return box.value ?? LookupOutcome(target: nil, reason: "opaque_toolkit")
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
            "x": Int(x.rounded()),
            "y": Int(y.rounded()),
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
        // Only re-enable while still allowed; the poll below tears it down if trust is gone.
        if let tap = eventTap { CGEvent.tapEnable(tap: tap, enable: true) }
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
    return 0
}

func run() -> Int32 {
    emit(["type": "hello", "helper": "HandoverHelper", "version": helperVersion,
          "platform": "macos", "protocol": 1])
    if CommandLine.arguments.contains("--selftest") { return selftest() }

    var lastTrusted = AXIsProcessTrusted()
    var lastHook = installTap()
    emit(capabilities(hook: lastHook, trusted: lastTrusted))
    if !lastHook {
        emit(["type": "error", "message": "event tap unavailable (permission not granted yet)"])
    }

    // Exit when the parent closes our stdin.
    Thread.detachNewThread {
        while FileHandle.standardInput.availableData.count > 0 {}
        exit(0)
    }

    // Poll trust every 1.5 s: report changes, retry the tap until it can be created.
    let timer = DispatchSource.makeTimerSource(queue: .main)
    timer.schedule(deadline: .now() + 1.5, repeating: 1.5)
    timer.setEventHandler {
        let trusted = AXIsProcessTrusted()
        let hook = installTap()
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
