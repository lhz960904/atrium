import AppKit
import ApplicationServices
import CoreGraphics
import CoreServices
import Foundation

final class OverlayCursorView: NSView {
  private let drawingInset = CGPoint(x: 30, y: 30)
  private let scaleAnchor = CGPoint(x: 30.35, y: 48.31)

  var pulseAlpha: CGFloat = 0 {
    didSet {
      needsDisplay = true
    }
  }

  var cursorScale: CGFloat = 1 {
    didSet {
      needsDisplay = true
    }
  }

  var cursorAngle: CGFloat = 0 {
    didSet {
      needsDisplay = true
    }
  }

  var pressed: Bool = false {
    didSet {
      needsDisplay = true
    }
  }

  override var isOpaque: Bool { false }

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)

    NSGraphicsContext.saveGraphicsState()
    let transform = NSAffineTransform()
    transform.translateX(by: scaleAnchor.x, yBy: scaleAnchor.y)
    transform.rotate(byRadians: cursorAngle)
    transform.scale(by: cursorScale)
    transform.translateX(by: -scaleAnchor.x, yBy: -scaleAnchor.y)
    transform.concat()

    let pulseRect = NSRect(x: 2 + drawingInset.x, y: 5 + drawingInset.y, width: 28, height: 28)
    if pulseAlpha > 0.01 {
      let pulse = NSBezierPath(ovalIn: pulseRect.insetBy(dx: -3, dy: -3))
      NSColor(calibratedRed: 1.0, green: 1.0, blue: 1.0, alpha: pulseAlpha * 0.18).setFill()
      pulse.fill()

      NSColor(calibratedRed: 1.0, green: 1.0, blue: 1.0, alpha: pulseAlpha * 0.45).setStroke()
      pulse.lineWidth = 1.2
      pulse.stroke()
    }

    let shadowPath = roundedPointerPath(inset: 1.0)

    NSGraphicsContext.saveGraphicsState()
    let glow = NSShadow()
    glow.shadowBlurRadius = pressed ? 9 : 10
    glow.shadowOffset = NSSize(width: 0, height: 0)
    glow.shadowColor = NSColor(calibratedWhite: 0.0, alpha: pressed ? 0.38 : 0.28)
    glow.set()
    NSColor(calibratedWhite: 1.0, alpha: 0.7).setStroke()
    shadowPath.lineWidth = 4.2
    shadowPath.lineJoinStyle = .round
    shadowPath.lineCapStyle = .round
    shadowPath.stroke()
    NSGraphicsContext.restoreGraphicsState()

    let arrow = roundedPointerPath(inset: 0)

    let fillAlpha: CGFloat = pressed ? 0.68 : 0.54
    NSColor(calibratedWhite: 0.10, alpha: fillAlpha).setFill()
    arrow.fill()

    NSColor(calibratedWhite: 1.0, alpha: pressed ? 0.94 : 0.86).setStroke()
    arrow.lineWidth = pressed ? 2.2 : 2.0
    arrow.lineJoinStyle = .round
    arrow.lineCapStyle = .round
    arrow.stroke()
    NSGraphicsContext.restoreGraphicsState()
  }

  private func roundedPointerPath(inset: CGFloat) -> NSBezierPath {
    let path = NSBezierPath()
    let scale = (22.0 - (inset * 2.0)) / 39.0
    let offsetX = drawingInset.x + inset
    let offsetY = drawingInset.y + inset
    func point(_ x: CGFloat, _ y: CGFloat) -> NSPoint {
      NSPoint(x: offsetX + (x * scale), y: offsetY + ((39.0 - y) * scale))
    }

    path.move(to: point(6.5338, 33.7802))
    path.line(to: point(0.617737, 6.56569))
    path.curve(
      to: point(6.53598, 0.611297),
      controlPoint1: point(-0.152622, 3.02196),
      controlPoint2: point(2.98763, -0.137475)
    )
    path.line(to: point(33.93, 6.39198))
    path.curve(
      to: point(35.1843, 15.7308),
      controlPoint1: point(38.5345, 7.36361),
      controlPoint2: point(39.3692, 13.5787)
    )
    path.line(to: point(23.7471, 21.6122))
    path.curve(
      to: point(21.5782, 23.7895),
      controlPoint1: point(22.8135, 22.0923),
      controlPoint2: point(22.0547, 22.854)
    )
    path.line(to: point(15.8751, 34.9872))
    path.curve(
      to: point(6.5338, 33.7802),
      controlPoint1: point(13.7419, 39.1757),
      controlPoint2: point(7.53229, 38.3733)
    )
    path.close()

    return path
  }
}

final class OverlayCursorController {
  static let shared = OverlayCursorController()

  // The activity cursor is a decorative overlay drawn on top of the real cursor,
  // but CGEvent clicks warp the real system cursor to the target anyway — so it's
  // redundant with the pointer the user already sees, and its per-action
  // animation only adds latency. Disabled until it becomes a true synthetic
  // cursor (one that acts without moving the real pointer); flip to re-enable.
  private let enabled = false

  private let size = CGSize(width: 96, height: 96)
  private let hotspot = CGPoint(x: 30.35, y: 48.31)
  private let idleHideDelay: TimeInterval = 8
  private let defaultCursorDirection: CGFloat = (3 * .pi) / 4
  private let overlayQueue = DispatchQueue(label: "computer-use.overlay")
  private var window: NSWindow?
  private var view: OverlayCursorView? {
    window?.contentView as? OverlayCursorView
  }
  private var currentPoint: CGPoint?
  private var hideWorkItem: DispatchWorkItem?
  private var targetWindowID: CGWindowID?
  private var targetWindowLevel: NSWindow.Level = .normal

  private init() {
    NSApplication.shared.setActivationPolicy(.accessory)
  }

  func configure(for entry: WindowEntry?) {
    targetWindowID = entry?.windowID
    targetWindowLevel = .normal
    window?.level = targetWindowLevel
  }

  func showActivity(at point: CGPoint, wiggle: Bool = true) {
    guard enabled, isFinitePoint(point) else {
      return
    }
    animate(to: point, duration: 0.22, settle: false)
    if wiggle {
      thinkingWiggle()
    }
    extendVisibility()
  }

  func extendVisibility(after delay: TimeInterval? = nil) {
    scheduleIdleHide(after: delay ?? idleHideDelay)
  }

  func animate(to point: CGPoint, duration: TimeInterval = 0.16) {
    guard isFinitePoint(point) else {
      return
    }
    animate(to: point, duration: duration, settle: true)
  }

  private func animate(to point: CGPoint, duration: TimeInterval, settle: Bool) {
    guard enabled, isFinitePoint(point) else {
      return
    }
    cancelHide()
    let start = animationStartPoint(for: point)
    guard isFinitePoint(start) else {
      return
    }
    show(at: start)

    let dx = point.x - start.x
    let dy = point.y - start.y
    let distance = sqrt((dx * dx) + (dy * dy))
    let adjustedDuration = max(duration, min(0.7, 0.22 + (distance / 700.0)))
    let steps = max(Int(adjustedDuration / 0.024), 1)
    for step in 1...steps {
      let progress = CGFloat(step) / CGFloat(steps)
      let eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - pow(-2 * progress + 2, 2) / 2
      let next = CGPoint(
        x: start.x + ((point.x - start.x) * eased),
        y: start.y + ((point.y - start.y) * eased)
      )
      move(to: next)
      RunLoop.current.run(until: Date().addingTimeInterval(adjustedDuration / Double(steps)))
    }

    currentPoint = point
    if settle {
      settleRotation()
    }
  }

  func move(to point: CGPoint) {
    guard enabled, isFinitePoint(point) else {
      return
    }
    cancelHide()
    let window = ensureWindow()
    window.level = targetWindowLevel
    if let currentPoint {
      view?.cursorAngle = movementRotation(from: currentPoint, to: point)
    }
    let appKitPoint = appKitPoint(fromDisplayPoint: point)
    guard isFinitePoint(appKitPoint) else {
      return
    }
    window.setFrameOrigin(NSPoint(x: appKitPoint.x - hotspot.x, y: appKitPoint.y - hotspot.y))
    if let targetWindowID {
      window.order(.above, relativeTo: Int(targetWindowID))
    } else {
      window.orderFront(nil)
    }
    if window.alphaValue < 0.98 {
      NSAnimationContext.runAnimationGroup { context in
        context.duration = 0.12
        window.animator().alphaValue = 1
      }
    } else {
      window.alphaValue = 1
    }
    currentPoint = point
  }

  func scheduleIdleHide(after delay: TimeInterval? = nil) {
    cancelHide()
    let workItem = DispatchWorkItem { [weak self] in
      DispatchQueue.main.async { [weak self] in
        guard let self, let window = self.window else {
          return
        }
        self.view?.pulseAlpha = 0
        self.view?.pressed = false
        window.alphaValue = 0
        window.orderOut(nil)
      }
    }
    hideWorkItem = workItem
    overlayQueue.asyncAfter(deadline: .now() + (delay ?? idleHideDelay), execute: workItem)
  }

  // Collapse the overlay right now, synchronously on the caller's thread. The
  // idle-hide work item can't do this once a turn ends: it hops to the main
  // queue, which never drains while the helper blocks on readLine with no
  // runloop — so the app hides the overlay explicitly at turn end instead.
  func hide() {
    cancelHide()
    view?.pulseAlpha = 0
    view?.pressed = false
    window?.alphaValue = 0
    window?.orderOut(nil)
    currentPoint = nil
  }

  func pulse() {
    guard enabled else { return }
    _ = ensureWindow()
    view?.pressed = true
    view?.pulseAlpha = 1
    view?.cursorScale = 0.9

    let steps = 6
    for step in 1...steps {
      let progress = CGFloat(step) / CGFloat(steps)
      let eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - pow(-2 * progress + 2, 3) / 2
      view?.pulseAlpha = 1 - progress
      view?.cursorScale = 0.9 + (0.1 * eased)
      RunLoop.current.run(until: Date().addingTimeInterval(0.026))
    }

    view?.pressed = false
    view?.pulseAlpha = 0
    view?.cursorScale = 1
  }

  func thinkingWiggle(cycles: Int = 2) {
    _ = ensureWindow()
    let baseAngle = view?.cursorAngle ?? 0
    let frames = max(cycles * 8, 1)
    for frame in 0...frames {
      let progress = CGFloat(frame) / CGFloat(frames)
      let wave = sin(progress * CGFloat(cycles) * 2 * .pi)
      view?.cursorAngle = baseAngle + (wave * 0.14)
      RunLoop.current.run(until: Date().addingTimeInterval(0.034))
    }
    view?.cursorAngle = baseAngle
  }

  func settleRotation() {
    guard let view else {
      return
    }
    let startAngle = view.cursorAngle
    let steps = 8
    for step in 1...steps {
      let progress = CGFloat(step) / CGFloat(steps)
      let eased = 1 - pow(1 - progress, 2)
      view.cursorAngle = startAngle * (1 - eased)
      RunLoop.current.run(until: Date().addingTimeInterval(0.022))
    }
    view.cursorAngle = 0
  }

  private func show(at point: CGPoint) {
    move(to: point)
  }

  private func animationStartPoint(for target: CGPoint) -> CGPoint {
    if let currentPoint {
      return currentPoint
    }

    let mouse = displayPoint(fromAppKitPoint: NSEvent.mouseLocation)
    let dx = target.x - mouse.x
    let dy = target.y - mouse.y
    let distance = sqrt((dx * dx) + (dy * dy))
    if distance >= 18 {
      return mouse
    }

    return CGPoint(x: target.x - 26, y: target.y + 22)
  }

  private func movementRotation(from start: CGPoint, to end: CGPoint) -> CGFloat {
    guard isFinitePoint(start), isFinitePoint(end) else {
      return view?.cursorAngle ?? 0
    }
    let dx = end.x - start.x
    let dy = end.y - start.y
    guard hypot(dx, dy) >= 1 else {
      return view?.cursorAngle ?? 0
    }

    let appKitDy = -dy
    let desiredDirection = atan2(appKitDy, dx)
    return desiredDirection - defaultCursorDirection
  }

  private func cancelHide() {
    hideWorkItem?.cancel()
    hideWorkItem = nil
  }

  private func ensureWindow() -> NSWindow {
    if let window {
      return window
    }

    let rect = NSRect(x: 0, y: 0, width: size.width, height: size.height)
    let window = NSWindow(
      contentRect: rect,
      styleMask: .borderless,
      backing: .buffered,
      defer: false
    )
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = false
    window.ignoresMouseEvents = true
    window.level = targetWindowLevel
    window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
    window.alphaValue = 0
    window.contentView = OverlayCursorView(frame: rect)
    self.window = window
    return window
  }
}

func desktopFrame() -> CGRect {
  let screenFrame = NSScreen.screens.map(\.frame).reduce(into: CGRect.null) { result, frame in
    result = result.union(frame)
  }
  if !screenFrame.isNull, !screenFrame.isEmpty, isFiniteRect(screenFrame) {
    return screenFrame
  }

  let mainDisplayFrame = CGDisplayBounds(CGMainDisplayID())
  if !mainDisplayFrame.isNull, !mainDisplayFrame.isEmpty, isFiniteRect(mainDisplayFrame) {
    return mainDisplayFrame
  }

  return CGRect(x: 0, y: 0, width: 1, height: 1)
}

func appKitPoint(fromDisplayPoint point: CGPoint) -> CGPoint {
  guard isFinitePoint(point) else {
    return point
  }
  let frame = desktopFrame()
  return CGPoint(x: point.x, y: frame.maxY - point.y)
}

func displayPoint(fromAppKitPoint point: CGPoint) -> CGPoint {
  guard isFinitePoint(point) else {
    return point
  }
  let frame = desktopFrame()
  return CGPoint(x: point.x, y: frame.maxY - point.y)
}

func isFinitePoint(_ point: CGPoint) -> Bool {
  point.x.isFinite && point.y.isFinite
}

func isFiniteRect(_ rect: CGRect) -> Bool {
  rect.origin.x.isFinite
    && rect.origin.y.isFinite
    && rect.size.width.isFinite
    && rect.size.height.isFinite
}

struct WindowEntry {
  let pid: pid_t
  let windowID: CGWindowID
  let ownerName: String
  let title: String?
  let bounds: CGRect
}

struct AppMetadata {
  let path: String
  let bundleId: String?
  let displayName: String
  let lastUsed: Date?
  let lastUsedRaw: String?
  let useCount: Int?
}

struct Request: Decodable {
  let id: String
  let method: String
  let params: [String: JSONValue]
}

struct Response: Encodable {
  let id: String
  let ok: Bool
  let result: ResultPayload?
  let error: String?
}

struct ResultPayload: Encodable {
  let ok: Bool
  let toolName: String
  let app: AppPayload?
  let snapshot: SnapshotPayload?
  let artifacts: ArtifactsPayload?
  let data: [String: JSONValue]?
  let warnings: [String]
  let meta: MetaPayload
  let error: ErrorPayload?
}

struct AppPayload: Encodable {
  let name: String?
  let bundleId: String?
  let pid: Int?
}

struct SnapshotPayload: Encodable {
  let windowTitle: String?
  let treeText: String
  let elements: [ElementPayload]
}

struct ElementPayload: Encodable {
  let index: String
  let id: String?
  let role: String?
  let title: String?
  let description: String?
  let value: JSONValue?
  let help: String?
  let enabled: Bool?
  let focused: Bool?
  let settable: Bool?
  let actions: [String]?
  let bounds: BoundsPayload?
}

struct BoundsPayload: Encodable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct ArtifactsPayload: Encodable {
  let screenshotMimeType: String?
  let screenshotBase64: String?
}

struct AXSnapshotData {
  let treeText: String
  let elements: [ElementPayload]
  let warnings: [String]
}

struct MetaPayload: Encodable {
  let observedShape: String
  let rawText: String?
}

struct ErrorPayload: Encodable {
  let code: String
  let message: String
  let retryable: Bool
}

enum JSONValue: Codable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case object([String: JSONValue])
  case array([JSONValue])
  case null

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode([String: JSONValue].self) {
      self = .object(value)
    } else if let value = try? container.decode([JSONValue].self) {
      self = .array(value)
    } else {
      self = .null
    }
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .string(let value):
      try container.encode(value)
    case .number(let value):
      try container.encode(value)
    case .bool(let value):
      try container.encode(value)
    case .object(let value):
      try container.encode(value)
    case .array(let value):
      try container.encode(value)
    case .null:
      try container.encodeNil()
    }
  }
}

let decoder = JSONDecoder()
let encoder = JSONEncoder()

let windowEntriesCacheTTL: TimeInterval = 0.2
let appMetadataCacheTTL: TimeInterval = 30
let appActivationDelayMicros: useconds_t = 60_000
let clickIntervalDelayMicros: useconds_t = 20_000
let actionSettleDelayMicros: useconds_t = 60_000
let revealSettleDelayMicros: useconds_t = 35_000
let keyRepeatDelayMicros: useconds_t = 15_000
let scrollFocusDelayMicros: useconds_t = 30_000

var cachedWindowEntries: [WindowEntry] = []
var cachedWindowEntriesAt: Date?
var cachedAppMetadataIndex: [String: AppMetadata] = [:]
var cachedAppMetadataAt: Date?

func waitForAsyncResult(
  timeout: TimeInterval,
  pollInterval: TimeInterval = 0.01,
  isFinished: () -> Bool
) -> Bool {
  let deadline = Date().addingTimeInterval(timeout)
  while !isFinished() {
    if Date() >= deadline {
      return false
    }
    RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(pollInterval))
  }
  return true
}

func writeResponse(_ response: Response) {
  guard let data = try? encoder.encode(response), let line = String(data: data, encoding: .utf8) else {
    return
  }
  FileHandle.standardOutput.write(Data((line + "\n").utf8))
}

func makeErrorResult(toolName: String, code: String, message: String) -> ResultPayload {
  ResultPayload(
    ok: false,
    toolName: toolName,
    app: nil,
    snapshot: nil,
    artifacts: nil,
    data: nil,
    warnings: [],
    meta: MetaPayload(observedShape: "text_error", rawText: message),
    error: ErrorPayload(code: code, message: message, retryable: false)
  )
}

func windowEntries() -> [WindowEntry] {
  if let cachedAt = cachedWindowEntriesAt,
    Date().timeIntervalSince(cachedAt) < windowEntriesCacheTTL
  {
    return cachedWindowEntries
  }

  guard let infoList = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
    as? [[String: Any]]
  else {
    return []
  }

  let entries: [WindowEntry] = infoList.compactMap { info -> WindowEntry? in
    guard let ownerPID = info[kCGWindowOwnerPID as String] as? pid_t, ownerPID > 0 else {
      return nil
    }
    guard let ownerName = info[kCGWindowOwnerName as String] as? String, !ownerName.isEmpty else {
      return nil
    }

    let layer = info[kCGWindowLayer as String] as? Int ?? 0
    if layer != 0 {
      return nil
    }

    guard let boundsDict = info[kCGWindowBounds as String] as? [String: Any] else {
      return nil
    }

    let width = boundsDict["Width"] as? Double ?? 0
    let height = boundsDict["Height"] as? Double ?? 0
    if width < 20 || height < 20 {
      return nil
    }

    let x = boundsDict["X"] as? Double ?? 0
    let y = boundsDict["Y"] as? Double ?? 0
    let bounds = CGRect(x: x, y: y, width: width, height: height)

    let title = info[kCGWindowName as String] as? String
    let windowID = info[kCGWindowNumber as String] as? UInt32 ?? 0
    return WindowEntry(pid: ownerPID, windowID: windowID, ownerName: ownerName, title: title, bounds: bounds)
  }

  cachedWindowEntries = entries
  cachedWindowEntriesAt = Date()
  return entries
}

func refreshWindowEntries() -> [WindowEntry] {
  cachedWindowEntries = []
  cachedWindowEntriesAt = nil
  return windowEntries()
}

func runningApp(for pid: pid_t) -> NSRunningApplication? {
  NSRunningApplication(processIdentifier: pid)
}

func metadataDateFormatter() -> DateFormatter {
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.dateFormat = "yyyy-MM-dd HH:mm:ss Z"
  return formatter
}

func shell(_ launchPath: String, _ arguments: [String]) -> String? {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: launchPath)
  process.arguments = arguments

  let stdout = Pipe()
  process.standardOutput = stdout
  process.standardError = Pipe()

  do {
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
      return nil
    }

    let data = stdout.fileHandleForReading.readDataToEndOfFile()
    return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
  } catch {
    return nil
  }
}

func appDisplayName(_ app: NSRunningApplication) -> String {
  app.localizedName ?? app.bundleIdentifier ?? "Unknown App"
}

func normalizeMetadataString(_ raw: Any?) -> String? {
  if let value = raw as? String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed != "(null)", trimmed != "null", !trimmed.isEmpty else {
      return nil
    }
    if trimmed.hasPrefix("\""), trimmed.hasSuffix("\""), trimmed.count >= 2 {
      return String(trimmed.dropFirst().dropLast())
    }
    return trimmed
  }
  return nil
}

func installedApplicationPaths() -> [String] {
  let fileManager = FileManager.default
  let roots = [
    "/Applications",
    "/System/Applications",
    "/System/Applications/Utilities",
    "\(NSHomeDirectory())/Applications",
  ]

  var paths = Set<String>()
  for app in NSWorkspace.shared.runningApplications {
    if let bundlePath = app.bundleURL?.path, bundlePath.hasSuffix(".app") {
      paths.insert(bundlePath)
    }
  }

  for root in roots {
    guard let enumerator = fileManager.enumerator(
      at: URL(fileURLWithPath: root),
      includingPropertiesForKeys: [.isDirectoryKey],
      options: [.skipsHiddenFiles]
    ) else {
      continue
    }

    while let url = enumerator.nextObject() as? URL {
      if url.pathExtension == "app" {
        paths.insert(url.path)
        enumerator.skipDescendants()
      }
    }
  }

  return Array(paths)
}

func mdlsMetadata(for appPath: String) -> AppMetadata? {
  guard let output = shell(
    "/usr/bin/mdls",
    [
      "-raw",
      "-name", "kMDItemCFBundleIdentifier",
      "-name", "kMDItemDisplayName",
      "-name", "kMDItemLastUsedDate",
      "-name", "kMDItemUseCount",
      appPath,
    ]
  ) else {
    return nil
  }

  let lines = output
    .split(omittingEmptySubsequences: false, whereSeparator: { $0 == "\n" || $0 == "\0" })
    .map(String.init)
  guard lines.count >= 4 else {
    return nil
  }

  let formatter = metadataDateFormatter()

  let bundleId = normalizeMetadataString(lines[0])
  let displayName = normalizeMetadataString(lines[1]) ?? URL(fileURLWithPath: appPath).deletingPathExtension().lastPathComponent
  let lastUsedRaw = normalizeMetadataString(lines[2])
  let lastUsed = lastUsedRaw.flatMap { formatter.date(from: $0) }
  let useCount = normalizeMetadataString(lines[3]).flatMap(Int.init)

  return AppMetadata(
    path: appPath,
    bundleId: bundleId,
    displayName: displayName,
    lastUsed: lastUsed,
    lastUsedRaw: lastUsedRaw,
    useCount: useCount
  )
}

func mdQueryMetadata(for item: MDItem, formatter: DateFormatter) -> AppMetadata? {
  let path = normalizeMetadataString(MDItemCopyAttribute(item, kMDItemPath as CFString))
  let bundleId = normalizeMetadataString(MDItemCopyAttribute(item, kMDItemCFBundleIdentifier as CFString))
  let displayName = normalizeMetadataString(MDItemCopyAttribute(item, kMDItemDisplayName as CFString))
    ?? path.map { URL(fileURLWithPath: $0).deletingPathExtension().lastPathComponent }
  let lastUsedDate = MDItemCopyAttribute(item, kMDItemLastUsedDate as CFString) as? Date
  let lastUsedRaw = lastUsedDate.map { formatter.string(from: $0) }
  let useCount = (MDItemCopyAttribute(item, "kMDItemUseCount" as CFString) as? NSNumber)?.intValue

  guard let path, let displayName else {
    return nil
  }

  return AppMetadata(
    path: path,
    bundleId: bundleId,
    displayName: displayName,
    lastUsed: lastUsedDate,
    lastUsedRaw: lastUsedRaw,
    useCount: useCount
  )
}

func mdQueryAppMetadataIndex() -> [String: AppMetadata] {
  let formatter = metadataDateFormatter()
  let queryString = "kMDItemContentType == 'com.apple.application-bundle'"
  let sortingAttrs = [kMDItemLastUsedDate as CFString] as CFArray
  guard let query = MDQueryCreate(kCFAllocatorDefault, queryString as CFString, nil, sortingAttrs) else {
    return [:]
  }

  MDQuerySetSearchScope(query, [kMDQueryScopeComputerIndexed] as CFArray, 0)
  MDQuerySetMaxCount(query, 400)
  guard MDQueryExecute(query, CFOptionFlags(kMDQuerySynchronous.rawValue)) else {
    return [:]
  }

  var byBundleId: [String: AppMetadata] = [:]
  let resultCount = MDQueryGetResultCount(query)
  if resultCount <= 0 {
    return byBundleId
  }

  for index in 0..<resultCount {
    guard let rawItem = MDQueryGetResultAtIndex(query, index) else {
      continue
    }
    let item = unsafeBitCast(rawItem, to: MDItem.self)
    guard let metadata = mdQueryMetadata(for: item, formatter: formatter),
      let bundleId = metadata.bundleId
    else {
      continue
    }

    if let existing = byBundleId[bundleId] {
      let existingScore = (existing.lastUsed?.timeIntervalSince1970 ?? 0) + Double(existing.useCount ?? 0)
      let metadataScore = (metadata.lastUsed?.timeIntervalSince1970 ?? 0) + Double(metadata.useCount ?? 0)
      if metadataScore > existingScore {
        byBundleId[bundleId] = metadata
      }
    } else {
      byBundleId[bundleId] = metadata
    }
  }

  return byBundleId
}

func appMetadataIndex() -> [String: AppMetadata] {
  if let cachedAt = cachedAppMetadataAt,
    Date().timeIntervalSince(cachedAt) < appMetadataCacheTTL
  {
    return cachedAppMetadataIndex
  }

  var byBundleId = mdQueryAppMetadataIndex()

  if byBundleId.isEmpty {
    for path in installedApplicationPaths() {
      guard let metadata = mdlsMetadata(for: path), let bundleId = metadata.bundleId else {
        continue
      }

      if let existing = byBundleId[bundleId] {
        let existingScore = (existing.lastUsed?.timeIntervalSince1970 ?? 0) + Double(existing.useCount ?? 0)
        let metadataScore = (metadata.lastUsed?.timeIntervalSince1970 ?? 0) + Double(metadata.useCount ?? 0)
        if metadataScore > existingScore {
          byBundleId[bundleId] = metadata
        }
      } else {
        byBundleId[bundleId] = metadata
      }
    }
  }

  cachedAppMetadataIndex = byBundleId
  cachedAppMetadataAt = Date()
  return byBundleId
}

func appIdentityKey(_ app: NSRunningApplication) -> String {
  if let bundleId = app.bundleIdentifier, !bundleId.isEmpty {
    return bundleId
  }
  return appDisplayName(app).lowercased()
}

func appScore(_ app: NSRunningApplication, visiblePIDs: Set<pid_t>, frontmostPID: pid_t?) -> Int {
  var score = 0
  if app.processIdentifier == frontmostPID {
    score += 100
  }
  if visiblePIDs.contains(app.processIdentifier) {
    score += 50
  }
  if app.activationPolicy == .regular {
    score += 20
  }
  if app.bundleIdentifier != nil {
    score += 5
  }
  return score
}

func isLikelyUserFacingApp(_ app: NSRunningApplication, visiblePIDs: Set<pid_t>, frontmostPID: pid_t?) -> Bool {
  let bundleId = app.bundleIdentifier?.lowercased() ?? ""
  let name = appDisplayName(app).lowercased()

  let excludedBundleFragments = [
    ".helper",
    ".agent",
    ".uiagent",
    ".xpc",
    ".daemon",
  ]
  if excludedBundleFragments.contains(where: { bundleId.contains($0) }) {
    return false
  }

  let excludedBundleIDs = [
    "com.apple.windowmanager",
    "com.apple.dock",
    "com.apple.systemuiserver",
  ]
  if excludedBundleIDs.contains(bundleId) {
    return false
  }

  if app.processIdentifier == frontmostPID || visiblePIDs.contains(app.processIdentifier) {
    return true
  }

  guard app.activationPolicy == .regular else {
    return false
  }

  let excludedNameFragments = [
    " helper",
    "agent",
    "server",
    "pty-host",
    "filewatcher",
    "shared-process",
    "notification",
    "windowmanager",
    "systemuiserver",
    "control center",
    "centre de contrôle",
    "centre de notifications",
    "dock",
    "spotlight",
    "storeuid",
    "wifi",
    "wi-fi",
  ]
  if excludedNameFragments.contains(where: { name.contains($0) }) {
    return false
  }

  return true
}

func listAppsResult() -> ResultPayload {
  if let target = frontmostActivityTarget() {
    revealObservationPoint(entry: target.entry, point: target.point)
  }

  let frontmostPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
  let visiblePIDs = Set(windowEntries().map(\.pid))
  let metadataByBundleId = appMetadataIndex()
  var uniqueApps: [String: NSRunningApplication] = [:]

  for app in NSWorkspace.shared.runningApplications {
    guard !app.isTerminated else {
      continue
    }
    guard app.bundleIdentifier != nil || app.localizedName != nil else {
      continue
    }
    guard isLikelyUserFacingApp(app, visiblePIDs: visiblePIDs, frontmostPID: frontmostPID) else {
      continue
    }

    let key = appIdentityKey(app)
    if let existing = uniqueApps[key] {
      if appScore(app, visiblePIDs: visiblePIDs, frontmostPID: frontmostPID) > appScore(existing, visiblePIDs: visiblePIDs, frontmostPID: frontmostPID) {
        uniqueApps[key] = app
      }
    } else {
      uniqueApps[key] = app
    }
  }

  var appObjects: [[String: JSONValue]] = Array(uniqueApps.values)
    .sorted {
      let leftScore = appScore($0, visiblePIDs: visiblePIDs, frontmostPID: frontmostPID)
      let rightScore = appScore($1, visiblePIDs: visiblePIDs, frontmostPID: frontmostPID)
      if leftScore != rightScore {
        return leftScore > rightScore
      }
      let leftName = appDisplayName($0)
      let rightName = appDisplayName($1)
      return leftName.localizedCaseInsensitiveCompare(rightName) == .orderedAscending
    }
    .map { app in
      let metadata = app.bundleIdentifier.flatMap { metadataByBundleId[$0] }
      var object: [String: JSONValue] = [
        "name": .string(metadata?.displayName ?? appDisplayName(app)),
        "bundleId": app.bundleIdentifier.map(JSONValue.string) ?? .null,
        "pid": .number(Double(app.processIdentifier)),
        "running": .bool(true),
        "frontmost": .bool(app.processIdentifier == frontmostPID),
        "visible": .bool(visiblePIDs.contains(app.processIdentifier)),
      ]
      if let lastUsedRaw = metadata?.lastUsedRaw {
        object["lastUsed"] = .string(lastUsedRaw)
      }
      if let useCount = metadata?.useCount {
        object["uses"] = .number(Double(useCount))
      }
      return object
    }

  let knownBundleIds = Set(appObjects.compactMap { object -> String? in
    if case .string(let bundleId)? = object["bundleId"] {
      return bundleId
    }
    return nil
  })

  let recentNonRunning = metadataByBundleId.values
    .filter { metadata in
      guard let bundleId = metadata.bundleId, metadata.lastUsed != nil else {
        return false
      }
      return !knownBundleIds.contains(bundleId)
    }
    .sorted {
      if $0.lastUsed != $1.lastUsed {
        return ($0.lastUsed ?? .distantPast) > ($1.lastUsed ?? .distantPast)
      }
      return ($0.useCount ?? 0) > ($1.useCount ?? 0)
    }
    .prefix(20)

  for metadata in recentNonRunning {
    var object: [String: JSONValue] = [
      "name": .string(metadata.displayName),
      "bundleId": metadata.bundleId.map(JSONValue.string) ?? .null,
      "running": .bool(false),
      "frontmost": .bool(false),
      "visible": .bool(false),
    ]
    if let lastUsedRaw = metadata.lastUsedRaw {
      object["lastUsed"] = .string(lastUsedRaw)
    }
    if let useCount = metadata.useCount {
      object["uses"] = .number(Double(useCount))
    }
    appObjects.append(object)
  }

  let apps = appObjects
    .sorted { left, right in
      let leftRunning = if case .bool(let value)? = left["running"] { value } else { false }
      let rightRunning = if case .bool(let value)? = right["running"] { value } else { false }
      if leftRunning != rightRunning {
        return leftRunning && !rightRunning
      }

      let leftFrontmost = if case .bool(let value)? = left["frontmost"] { value } else { false }
      let rightFrontmost = if case .bool(let value)? = right["frontmost"] { value } else { false }
      if leftFrontmost != rightFrontmost {
        return leftFrontmost && !rightFrontmost
      }

      let leftVisible = if case .bool(let value)? = left["visible"] { value } else { false }
      let rightVisible = if case .bool(let value)? = right["visible"] { value } else { false }
      if leftVisible != rightVisible {
        return leftVisible && !rightVisible
      }

      let leftLastUsed = left["lastUsed"].flatMap { if case .string(let value) = $0 { value } else { nil } } ?? ""
      let rightLastUsed = right["lastUsed"].flatMap { if case .string(let value) = $0 { value } else { nil } } ?? ""
      if leftLastUsed != rightLastUsed {
        return leftLastUsed > rightLastUsed
      }

      let leftUses = left["uses"].flatMap { if case .number(let value) = $0 { value } else { nil } } ?? 0
      let rightUses = right["uses"].flatMap { if case .number(let value) = $0 { value } else { nil } } ?? 0
      if leftUses != rightUses {
        return leftUses > rightUses
      }

      let leftName = left["name"].flatMap { if case .string(let value) = $0 { value } else { nil } } ?? ""
      let rightName = right["name"].flatMap { if case .string(let value) = $0 { value } else { nil } } ?? ""
      return leftName.localizedCaseInsensitiveCompare(rightName) == .orderedAscending
    }
    .map(JSONValue.object)

  let rawText = apps.compactMap { value -> String? in
    guard case .object(let object) = value else { return nil }
    guard case .string(let name)? = object["name"] else { return nil }
    let bundleText: String
    if case .string(let bundleId)? = object["bundleId"] {
      bundleText = bundleId
    } else {
      bundleText = "<unknown>"
    }
    var flags: [String] = []
    if case .bool(true)? = object["running"] {
      flags.append("running")
    }
    if case .string(let lastUsed)? = object["lastUsed"] {
      flags.append("last-used=\(String(lastUsed.prefix(10)))")
    }
    if case .number(let uses)? = object["uses"] {
      flags.append("uses=\(Int(uses))")
    }
    return "\(name) — \(bundleText) [\(flags.joined(separator: ", "))]"
  }.joined(separator: "\n")

  let result = ResultPayload(
    ok: true,
    toolName: "list_apps",
    app: nil,
    snapshot: nil,
    artifacts: nil,
    data: ["apps": .array(apps)],
    warnings: [],
    meta: MetaPayload(observedShape: "text", rawText: rawText),
    error: nil
  )
  OverlayCursorController.shared.extendVisibility()
  return result
}

func resolveApp(_ ref: String) -> NSRunningApplication? {
  let runningApps = NSWorkspace.shared.runningApplications
  if let exactBundle = NSRunningApplication.runningApplications(withBundleIdentifier: ref).first {
    return exactBundle
  }
  if let exact = runningApps.first(where: { $0.bundleIdentifier == ref || $0.localizedName == ref }) {
    return exact
  }
  let lowered = ref.lowercased()
  return runningApps.first {
    $0.bundleIdentifier?.lowercased() == lowered || $0.localizedName?.lowercased() == lowered
  }
}

func resolveWindowEntry(_ ref: String) -> WindowEntry? {
  let lowered = ref.lowercased()
  return windowEntries().first { entry in
    let ownerMatch = entry.ownerName.lowercased() == lowered
    let titleMatch = entry.title?.lowercased() == lowered
    return ownerMatch || titleMatch
  }
}

func windowInfo(for pid: pid_t) -> WindowEntry? {
  windowEntries()
    .filter { $0.pid == pid }
    .max {
      let leftArea = $0.bounds.width * $0.bounds.height
      let rightArea = $1.bounds.width * $1.bounds.height
      if leftArea == rightArea {
        return $0.windowID < $1.windowID
      }
      return leftArea < rightArea
    }
}

func resolvedWindowInfo(appRef: String) -> WindowEntry? {
  (resolveApp(appRef).flatMap { windowInfo(for: $0.processIdentifier) }) ?? resolveWindowEntry(appRef)
}

func windowCenter(_ entry: WindowEntry) -> CGPoint {
  CGPoint(x: entry.bounds.midX, y: entry.bounds.midY)
}

func frontmostActivityTarget() -> (entry: WindowEntry?, point: CGPoint)? {
  if let frontmost = NSWorkspace.shared.frontmostApplication,
    let entry = windowInfo(for: frontmost.processIdentifier)
  {
    return (entry, windowCenter(entry))
  }

  let mouse = displayPoint(fromAppKitPoint: NSEvent.mouseLocation)
  return (nil, mouse)
}

func revealObservationPoint(entry: WindowEntry?, point: CGPoint, wiggle: Bool = true) {
  OverlayCursorController.shared.configure(for: entry)
  OverlayCursorController.shared.showActivity(at: point, wiggle: wiggle)
}

func revealObservationPoint(appRef: String, entry: WindowEntry? = nil, wiggle: Bool = true) {
  if let app = resolveApp(appRef),
    let focused = preferredKeyboardFocusElement(for: app),
    let bounds = axBounds(focused)
  {
    revealObservationPoint(
      entry: entry ?? windowInfo(for: app.processIdentifier),
      point: keyboardFocusPoint(for: focused, bounds: bounds),
      wiggle: wiggle
    )
    return
  }

  let targetEntry = entry ?? resolvedWindowInfo(appRef: appRef)
  if let targetEntry {
    revealObservationPoint(entry: targetEntry, point: windowCenter(targetEntry), wiggle: wiggle)
  }
}

func isLikelyStageManagerThumbnail(_ entry: WindowEntry) -> Bool {
  entry.bounds.minX < 180 && entry.bounds.width <= 340 && entry.bounds.height <= 220
}

func windowManagerPID() -> pid_t? {
  let infoList = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
    as? [[String: Any]] ?? []
  return infoList.compactMap { info -> pid_t? in
    guard (info[kCGWindowOwnerName as String] as? String) == "WindowManager" else {
      return nil
    }
    return info[kCGWindowOwnerPID as String] as? pid_t
  }.first
}

func axElementArray(_ element: AXUIElement, _ attribute: String) -> [AXUIElement] {
  (axValue(element, attribute) as? [AXUIElement]) ?? []
}

func axFrame(_ element: AXUIElement) -> CGRect? {
  guard let value = axTypedValue(element, "AXFrame") else {
    return nil
  }

  var rect = CGRect.zero
  guard AXValueGetValue(value, .cgRect, &rect) else {
    return nil
  }
  return rect
}

func collectStageManagerButtons(_ element: AXUIElement, into output: inout [AXUIElement], depth: Int = 0) {
  if depth > 8 {
    return
  }

  if axActions(element).contains("AXAddToStage") {
    output.append(element)
  }

  for child in axElementArray(element, kAXChildrenAttribute as String) {
    collectStageManagerButtons(child, into: &output, depth: depth + 1)
  }
  for child in axElementArray(element, "AXContents") {
    collectStageManagerButtons(child, into: &output, depth: depth + 1)
  }
  for child in axElementArray(element, "AXWindows") {
    collectStageManagerButtons(child, into: &output, depth: depth + 1)
  }
}

func stageManagerButton(for entry: WindowEntry) -> AXUIElement? {
  guard let pid = windowManagerPID() else {
    return nil
  }

  let root = AXUIElementCreateApplication(pid)
  var buttons: [AXUIElement] = []
  collectStageManagerButtons(root, into: &buttons)
  let targetMid = CGPoint(x: entry.bounds.midX, y: entry.bounds.midY)
  return buttons.min { left, right in
    let leftFrame = axFrame(left) ?? .zero
    let rightFrame = axFrame(right) ?? .zero
    let leftDistance = hypot(leftFrame.midX - targetMid.x, leftFrame.midY - targetMid.y)
    let rightDistance = hypot(rightFrame.midX - targetMid.x, rightFrame.midY - targetMid.y)
    return leftDistance < rightDistance
  }
}

func addStageManagerThumbnailToCurrentStack(entry: WindowEntry, previousFrontmost: NSRunningApplication?) -> WindowEntry? {
  guard let button = stageManagerButton(for: entry) else {
    return nil
  }

  let addError = AXUIElementPerformAction(button, "AXAddToStage" as CFString)
  usleep(appActivationDelayMicros)

  var refreshedEntry = refreshWindowEntries().first { $0.windowID == entry.windowID }
  if addError == .success, let currentEntry = refreshedEntry, isLikelyStageManagerThumbnail(currentEntry) {
    _ = AXUIElementPerformAction(button, kAXPressAction as CFString)
    usleep(appActivationDelayMicros)
    refreshedEntry = refreshWindowEntries().first { $0.windowID == entry.windowID }
  }

  if let previousFrontmost {
    previousFrontmost.activate()
    usleep(appActivationDelayMicros)
  }

  return refreshedEntry
}

func prepareAppForStateCapture(app: NSRunningApplication?, entry: WindowEntry) -> WindowEntry {
  guard let app, app.processIdentifier == entry.pid else {
    return entry
  }

  let previousFrontmost = NSWorkspace.shared.frontmostApplication
  if isLikelyStageManagerThumbnail(entry),
    let stackedEntry = addStageManagerThumbnailToCurrentStack(entry: entry, previousFrontmost: previousFrontmost)
  {
    return stackedEntry
  }

  return entry
}

func screenPoint(forScreenshotPoint point: CGPoint, appRef: String) -> CGPoint? {
  guard let entry = resolvedWindowInfo(appRef: appRef) else {
    return nil
  }

  return CGPoint(x: entry.bounds.origin.x + point.x, y: entry.bounds.origin.y + point.y)
}

func axValue(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
  var value: CFTypeRef?
  let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
  guard error == .success else {
    return nil
  }
  return value
}

func axElementValue(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
  guard let value = axValue(element, attribute) else {
    return nil
  }
  return unsafeBitCast(value, to: AXUIElement.self)
}

func axTypedValue(_ element: AXUIElement, _ attribute: String) -> AXValue? {
  guard let value = axValue(element, attribute) else {
    return nil
  }
  return unsafeBitCast(value, to: AXValue.self)
}

func axString(_ element: AXUIElement, _ attribute: String) -> String? {
  axValue(element, attribute) as? String
}

func axBool(_ element: AXUIElement, _ attribute: String) -> Bool? {
  axValue(element, attribute) as? Bool
}

func axChildren(_ element: AXUIElement) -> [AXUIElement] {
  (axValue(element, kAXChildrenAttribute as String) as? [AXUIElement]) ?? []
}

func axParent(_ element: AXUIElement) -> AXUIElement? {
  axElementValue(element, kAXParentAttribute as String)
}

func axActions(_ element: AXUIElement) -> [String] {
  var actions: CFArray?
  let error = AXUIElementCopyActionNames(element, &actions)
  guard error == .success, let actions else {
    return []
  }
  return actions as? [String] ?? []
}

func axBounds(_ element: AXUIElement) -> BoundsPayload? {
  guard let positionValue = axTypedValue(element, kAXPositionAttribute as String),
    let sizeValue = axTypedValue(element, kAXSizeAttribute as String)
  else {
    return nil
  }

  var point = CGPoint.zero
  var size = CGSize.zero
  guard AXValueGetValue(positionValue, .cgPoint, &point), AXValueGetValue(sizeValue, .cgSize, &size) else {
    return nil
  }

  return BoundsPayload(x: point.x, y: point.y, width: size.width, height: size.height)
}

func axIsSettable(_ element: AXUIElement, _ attribute: String) -> Bool {
  var settable: DarwinBoolean = false
  let error = AXUIElementIsAttributeSettable(element, attribute as CFString, &settable)
  return error == .success && settable.boolValue
}

func axRootElement(for app: NSRunningApplication) -> AXUIElement {
  let appElement = AXUIElementCreateApplication(app.processIdentifier)
  if let focusedWindow = axElementValue(appElement, kAXFocusedWindowAttribute as String) {
    return focusedWindow
  }
  if let mainWindow = axElementValue(appElement, kAXMainWindowAttribute as String) {
    return mainWindow
  }
  return appElement
}

func axFocusedElement(for app: NSRunningApplication) -> AXUIElement? {
  let appElement = AXUIElementCreateApplication(app.processIdentifier)
  if let focusedElement = axElementValue(appElement, kAXFocusedUIElementAttribute as String) {
    return focusedElement
  }
  return nil
}

func displayRoleName(_ role: String?) -> String {
  switch role {
  case kAXWindowRole:
    return "standard window"
  case kAXGroupRole:
    return "container"
  case kAXSplitGroupRole:
    return "split group"
  case kAXSplitterRole:
    return "splitter"
  case kAXScrollAreaRole:
    return "scroll area"
  case kAXStaticTextRole:
    return "text"
  case kAXButtonRole:
    return "button"
  case kAXMenuButtonRole:
    return "menu button"
  case kAXMenuBarRole:
    return "menu bar"
  case kAXToolbarRole:
    return "toolbar"
  case "AXWebArea":
    return "HTML content"
  case "AXTabGroup":
    return "tab group"
  case "AXRadioButton":
    return "tab"
  case "AXTextField":
    return "text field"
  case kAXTextAreaRole:
    return "text area"
  case "AXPopUpButton":
    return "popup button"
  default:
    let raw = role ?? "element"
    return raw.replacingOccurrences(of: "AX", with: "").lowercased()
  }
}

func displayActionName(_ action: String) -> String? {
  switch action {
  case kAXRaiseAction:
    return "Raise"
  case kAXPressAction:
    return nil
  case kAXConfirmAction:
    return "Confirm"
  case kAXCancelAction:
    return "Cancel"
  case kAXShowMenuAction:
    return "ShowMenu"
  case kAXPickAction:
    return "Pick"
  default:
    if action.hasPrefix("AXScroll") {
      return nil
    }
    if action.hasPrefix("AX") {
      return String(action.dropFirst(2))
    }
    return action
  }
}

func hasMeaningfulPresentationMetadata(_ element: AXUIElement) -> Bool {
  let title = axString(element, kAXTitleAttribute as String)
  let description = axString(element, kAXDescriptionAttribute as String)
  let help = axString(element, kAXHelpAttribute as String)
  let value = formattedAXValue(axValue(element, kAXValueAttribute as String))
  let identifier = axString(element, kAXIdentifierAttribute as String)
  let focused = axBool(element, kAXFocusedAttribute as String) == true

  if !(title?.isEmpty ?? true) || !(description?.isEmpty ?? true) || !(help?.isEmpty ?? true) || !(value?.isEmpty ?? true) || focused {
    return true
  }

  guard let identifier else {
    return false
  }

  let trimmed = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmed.isEmpty else {
    return false
  }

  let lowered = trimmed.lowercased()
  if lowered.hasPrefix("group") || lowered.hasPrefix("toolbar") || lowered.hasPrefix("scrollarea") {
    return false
  }

  return true
}

func hasMeaningfulSecondaryAction(_ element: AXUIElement) -> Bool {
  axActions(element).contains { action in
    switch action {
    case kAXShowMenuAction, kAXRaiseAction:
      return false
    default:
      return !action.hasPrefix("AXScroll")
    }
  }
}

func formattedAXValue(_ value: CFTypeRef?) -> String? {
  if let stringValue = value as? String, !stringValue.isEmpty {
    return stringValue
  }
  if let numberValue = value as? NSNumber {
    return numberValue.stringValue
  }
  if let boolValue = value as? Bool {
    return boolValue ? "true" : "false"
  }
  return nil
}

func axElementSummary(_ element: AXUIElement, semanticID: String) -> String {
  let role = axString(element, kAXRoleAttribute as String) ?? "element"
  let title = axString(element, kAXTitleAttribute as String)
  let description = axString(element, kAXDescriptionAttribute as String)
  let value = axValue(element, kAXValueAttribute as String)
  let focused = axBool(element, kAXFocusedAttribute as String) == true
  let enabled = axBool(element, kAXEnabledAttribute as String)
  let settable = axIsSettable(element, kAXValueAttribute as String)
  let actions = axActions(element).compactMap(displayActionName(_:))

  var line = displayRoleName(role)
  if let title, !title.isEmpty, role == kAXWindowRole {
    line += " \(title)"
  } else if role == kAXStaticTextRole, let renderedValue = formattedAXValue(value) {
    line += " \(renderedValue)"
  }

  var details: [String] = []
  if let description, !description.isEmpty, description != title {
    details.append("Description: \(description)")
  }
  if role != kAXStaticTextRole, let renderedValue = formattedAXValue(value) {
    details.append(renderedValue)
  }

  var flags: [String] = []
  if enabled == false {
    flags.append("disabled")
  }
  if settable {
    flags.append("settable")
  }
  if focused && role != kAXTextAreaRole {
    flags.append("focused")
  }
  if !flags.isEmpty {
    details.append("(\(flags.joined(separator: ", ")))")
  }

  details.append("ID: \(semanticID)")
  if !actions.isEmpty {
    details.append("Secondary Actions: \(actions.joined(separator: ", "))")
  }

  if !details.isEmpty {
    line += ", " + details.joined(separator: ", ")
  }

  return line
}

func semanticIDComponent(from rawValue: String?) -> String? {
  guard let rawValue else {
    return nil
  }

  let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmed.isEmpty else {
    return nil
  }

  if trimmed.rangeOfCharacter(from: CharacterSet.alphanumerics.inverted) == nil {
    return trimmed
  }

  let words = trimmed
    .components(separatedBy: CharacterSet.alphanumerics.inverted)
    .filter { !$0.isEmpty }

  guard !words.isEmpty else {
    return nil
  }

  let component = words
    .map { word in
      let lowered = word.lowercased()
      return lowered.prefix(1).uppercased() + lowered.dropFirst()
    }
    .joined()

  return component.isEmpty ? nil : component
}

func baseSemanticID(for element: AXUIElement) -> String {
  let role = axString(element, kAXRoleAttribute as String) ?? "AXElement"
  if role == kAXWindowRole {
    return "main"
  }

  if let component = semanticIDComponent(from: axString(element, kAXIdentifierAttribute as String)) {
    return component
  }
  if let component = semanticIDComponent(from: axString(element, kAXDescriptionAttribute as String)) {
    return component
  }
  if let component = semanticIDComponent(from: axString(element, kAXTitleAttribute as String)) {
    return component
  }
  if let component = semanticIDComponent(from: axString(element, kAXHelpAttribute as String)) {
    return component
  }
  if let value = axValue(element, kAXValueAttribute as String) as? String,
    let component = semanticIDComponent(from: value),
    !component.isEmpty
  {
    return component
  }

  return semanticIDComponent(from: role.replacingOccurrences(of: "AX", with: "")) ?? "Element"
}

func nextSemanticID(for element: AXUIElement, usedIDs: inout [String: Int]) -> String {
  let base = baseSemanticID(for: element)
  let key = base.lowercased()
  let nextCount = (usedIDs[key] ?? 0) + 1
  usedIDs[key] = nextCount
  return nextCount == 1 ? base : "\(base)\(nextCount)"
}

func shouldPresentElement(_ element: AXUIElement) -> Bool {
  let role = axString(element, kAXRoleAttribute as String) ?? ""
  let childCount = axChildren(element).count

  if role == kAXGroupRole {
    if !hasMeaningfulPresentationMetadata(element) && !hasMeaningfulSecondaryAction(element) {
      return false
    }
    if childCount == 1 && !hasMeaningfulSecondaryAction(element) {
      return false
    }
  }

  if role == kAXToolbarRole {
    return hasMeaningfulPresentationMetadata(element) || childCount > 0
  }

  if role == kAXSplitterRole {
    return hasMeaningfulPresentationMetadata(element)
  }

  if role == kAXScrollAreaRole {
    return hasMeaningfulPresentationMetadata(element) || childCount > 0
  }

  return true
}

func walkPresentedAXTree(
  root: AXUIElement,
  maxDepth: Int = 12,
  maxPresentedElements: Int = 400,
  maxChildrenPerNode: Int = 120,
  visitor: (_ element: AXUIElement, _ index: String, _ semanticID: String, _ depth: Int) -> Void
) -> [String] {
  var nextIndex = 0
  var usedIDs: [String: Int] = [:]
  var warnings: [String] = []

  func walk(_ element: AXUIElement, depth: Int, presentedDepth: Int) {
    if nextIndex >= maxPresentedElements || depth > maxDepth {
      return
    }

    let children = axChildren(element)
    if children.count > maxChildrenPerNode {
      warnings.append("Accessibility tree truncated for large child lists.")
    }

    let present = shouldPresentElement(element)
    let currentDepth = present ? presentedDepth : max(presentedDepth - 1, 0)
    if present {
      let index = "\(nextIndex)"
      nextIndex += 1
      let semanticID = nextSemanticID(for: element, usedIDs: &usedIDs)
      visitor(element, index, semanticID, currentDepth)
    }

    for child in children.prefix(maxChildrenPerNode) {
      walk(child, depth: depth + 1, presentedDepth: currentDepth + 1)
      if nextIndex >= maxPresentedElements {
        return
      }
    }
  }

  walk(root, depth: 0, presentedDepth: 0)
  return warnings
}

func buildAXSnapshot(for app: NSRunningApplication) -> AXSnapshotData {
  let root = axRootElement(for: app)
  var elements: [ElementPayload] = []
  var lines: [String] = []
  let warnings = walkPresentedAXTree(root: root) { element, index, semanticID, depth in
    let value = axValue(element, kAXValueAttribute as String)
    let normalizedValue: JSONValue?
    if let stringValue = value as? String {
      normalizedValue = .string(stringValue)
    } else if let boolValue = value as? Bool {
      normalizedValue = .bool(boolValue)
    } else if let numberValue = value as? NSNumber {
      normalizedValue = .number(numberValue.doubleValue)
    } else {
      normalizedValue = nil
    }

    let actions = axActions(element)
    elements.append(
      ElementPayload(
        index: index,
        id: semanticID,
        role: axString(element, kAXRoleAttribute as String),
        title: axString(element, kAXTitleAttribute as String),
        description: axString(element, kAXDescriptionAttribute as String),
        value: normalizedValue,
        help: axString(element, kAXHelpAttribute as String),
        enabled: axBool(element, kAXEnabledAttribute as String),
        focused: axBool(element, kAXFocusedAttribute as String),
        settable: axIsSettable(element, kAXValueAttribute as String),
        actions: actions.isEmpty ? nil : actions,
        bounds: axBounds(element)
      )
    )
    lines.append("\(String(repeating: "\t", count: max(depth, 0)))\(index) \(axElementSummary(element, semanticID: semanticID))")
  }

  if lines.isEmpty {
    let snapshot = AXSnapshotData(
      treeText: "",
      elements: elements,
      warnings: warnings + ["Accessibility tree extraction returned no visible elements."]
    )
    return snapshot
  }

  let snapshot = AXSnapshotData(treeText: lines.joined(separator: "\n"), elements: elements, warnings: warnings)
  return snapshot
}

func axElementByIndex(for app: NSRunningApplication, index targetIndex: String) -> AXUIElement? {
  let root = axRootElement(for: app)
  var indexMatch: AXUIElement?
  var semanticMatch: AXUIElement?
  // Each element prints both a numeric index and a semantic `ID:`, and the model
  // may address either — accept both so an advertised id (e.g. a window's
  // `ID: main` with a Raise action) is actually invocable. Prefer the exact
  // numeric index so a semantic id can't shadow a different element's index.
  _ = walkPresentedAXTree(root: root) { element, index, semanticID, _ in
    if indexMatch == nil && index == targetIndex {
      indexMatch = element
    } else if semanticMatch == nil && semanticID == targetIndex {
      semanticMatch = element
    }
  }
  return indexMatch ?? semanticMatch
}

func centerPoint(for bounds: BoundsPayload) -> CGPoint? {
  guard bounds.width > 0, bounds.height > 0 else {
    return nil
  }
  return CGPoint(x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2)
}

func axBoundsForInteraction(_ element: AXUIElement) -> BoundsPayload? {
  if let bounds = axBounds(element), bounds.width > 0, bounds.height > 0 {
    return bounds
  }

  for child in axChildren(element).prefix(20) {
    if let bounds = axBoundsForInteraction(child) {
      return bounds
    }
  }

  return nil
}

func resolveElementTarget(
  appRef: String,
  elementIndex: String
) -> (app: NSRunningApplication, element: AXUIElement, bounds: BoundsPayload, point: CGPoint)? {
  guard let app = resolveApp(appRef) else {
    return nil
  }
  guard let element = axElementByIndex(for: app, index: elementIndex),
    let bounds = axBoundsForInteraction(element),
    let point = centerPoint(for: bounds)
  else {
    return nil
  }
  return (app: app, element: element, bounds: bounds, point: point)
}

func isScrollableRole(_ role: String?) -> Bool {
  switch role {
  case kAXScrollAreaRole, "AXWebArea":
    return true
  default:
    return false
  }
}

func scrollInteractionPoint(for element: AXUIElement) -> CGPoint? {
  var current: AXUIElement? = element
  var depth = 0

  while let candidate = current, depth < 12 {
    let role = axString(candidate, kAXRoleAttribute as String)
    if isScrollableRole(role),
      let bounds = axBoundsForInteraction(candidate),
      let point = centerPoint(for: bounds)
    {
      return point
    }

    current = axParent(candidate)
    depth += 1
  }

  return nil
}

func boundsContainPoint(_ bounds: BoundsPayload, point: CGPoint) -> Bool {
  point.x >= bounds.x &&
    point.x <= (bounds.x + bounds.width) &&
    point.y >= bounds.y &&
    point.y <= (bounds.y + bounds.height)
}

func axClickableElement(at point: CGPoint, for app: NSRunningApplication) -> AXUIElement? {
  let root = axRootElement(for: app)
  var bestMatch: (element: AXUIElement, area: CGFloat)?

  func score(_ element: AXUIElement, bounds: BoundsPayload) -> CGFloat {
    let actions = axActions(element)
    guard actions.contains(kAXPressAction as String) || actions.contains(kAXPickAction as String) else {
      return .greatestFiniteMagnitude
    }
    guard boundsContainPoint(bounds, point: point) else {
      return .greatestFiniteMagnitude
    }
    return bounds.width * bounds.height
  }

  func walk(_ element: AXUIElement, depth: Int) {
    if depth > 10 {
      return
    }

    if let bounds = axBounds(element) {
      let area = score(element, bounds: bounds)
      if area.isFinite {
        if let currentBest = bestMatch {
          if area < currentBest.area {
            bestMatch = (element, area)
          }
        } else {
          bestMatch = (element, area)
        }
      }
    }

    for child in axChildren(element).prefix(60) {
      walk(child, depth: depth + 1)
    }
  }

  walk(root, depth: 0)
  return bestMatch?.element
}

func performSemanticClick(at point: CGPoint, appRef: String) -> Bool {
  guard let app = resolveApp(appRef),
    let element = axClickableElement(at: point, for: app)
  else {
    return false
  }

  let actions = axActions(element)
  let actionName: String?
  if actions.contains(kAXPressAction as String) {
    actionName = kAXPressAction as String
  } else if actions.contains(kAXPickAction as String) {
    actionName = kAXPickAction as String
  } else {
    actionName = nil
  }

  guard let actionName else {
    return false
  }

  return AXUIElementPerformAction(element, actionName as CFString) == .success
}

func preferredKeyboardFocusElement(for app: NSRunningApplication) -> AXUIElement? {
  if let focused = axFocusedElement(for: app), axBounds(focused) != nil {
    return focused
  }

  let root = axRootElement(for: app)
  var candidate: AXUIElement?

  func score(_ element: AXUIElement) -> Int {
    let role = axString(element, kAXRoleAttribute as String) ?? ""
    let settable = axIsSettable(element, kAXValueAttribute as String)
    var score = 0

    if settable {
      score += 5
    }
    if role == kAXTextFieldRole as String || role == kAXTextAreaRole as String {
      score += 5
    }
    if role == kAXComboBoxRole as String || role == "AXSearchField" {
      score += 4
    }

    return score
  }

  func walk(_ element: AXUIElement, depth: Int) {
    if candidate != nil || depth > 8 {
      return
    }

    if score(element) >= 5, axBounds(element) != nil {
      candidate = element
      return
    }

    for child in axChildren(element).prefix(40) {
      walk(child, depth: depth + 1)
      if candidate != nil {
        return
      }
    }
  }

  walk(root, depth: 0)
  return candidate
}

func keyboardFocusPoint(for element: AXUIElement, bounds: BoundsPayload) -> CGPoint {
  let role = axString(element, kAXRoleAttribute as String) ?? ""
  let isLargeTextInput = (role == kAXTextAreaRole as String || role == "AXWebArea") && bounds.width > 180 && bounds.height > 80
  if isLargeTextInput {
    return CGPoint(
      x: bounds.x + min(max(bounds.width * 0.08, 24), 96),
      y: bounds.y + min(max(bounds.height * 0.08, 24), 44)
    )
  }

  return CGPoint(x: bounds.x + (bounds.width / 2), y: bounds.y + (bounds.height / 2))
}

func focusPoint(for appRef: String) -> CGPoint? {
  if let app = resolveApp(appRef) {
    if let focusedElement = preferredKeyboardFocusElement(for: app), let bounds = axBounds(focusedElement) {
      return keyboardFocusPoint(for: focusedElement, bounds: bounds)
    }
  }

  if let entry = resolvedWindowInfo(appRef: appRef) {
    return CGPoint(x: entry.bounds.midX, y: entry.bounds.midY)
  }

  return nil
}

func revealInteractionPoint(_ point: CGPoint, clickToFocus: Bool) -> Bool {
  OverlayCursorController.shared.animate(to: point, duration: 0.14)
  if clickToFocus {
    guard postClick(at: point) else {
      return false
    }
  }
  OverlayCursorController.shared.pulse()
  usleep(revealSettleDelayMicros)
  return true
}

func getAppStateResult(appRef: String) -> ResultPayload {
  let resolvedApp = resolveApp(appRef)
  // Surface a minimized window before resolving its on-screen entry — otherwise
  // a backgrounded native app reads as "app not found" or an empty tree. Wait
  // out the restore animation so CGWindowList sees the window.
  if let resolvedApp, deminiaturizeWindows(for: resolvedApp) {
    usleep(appActivationDelayMicros * 5)
  }
  let resolvedEntry = resolvedApp.flatMap { windowInfo(for: $0.processIdentifier) } ?? resolveWindowEntry(appRef)
  return getAppStateResult(appRef: appRef, resolvedApp: resolvedApp, resolvedEntry: resolvedEntry)
}

func getAppStateResult(
  appRef: String,
  resolvedApp: NSRunningApplication?,
  resolvedEntry: WindowEntry?
) -> ResultPayload {
  guard let entry = resolvedEntry else {
    return makeErrorResult(toolName: "get_app_state", code: "app_not_found", message: "appNotFound(\"\(appRef)\")")
  }

  let app = resolvedApp ?? runningApp(for: entry.pid)
  let captureEntry = prepareAppForStateCapture(app: app, entry: entry)
  revealObservationPoint(appRef: appRef, entry: captureEntry)
  let title = entry.title
  let bundleId = app?.bundleIdentifier ?? appRef
  let appName = app?.localizedName ?? entry.ownerName
  let axSnapshot = app.map(buildAXSnapshot)
  let bodyText = axSnapshot?.treeText ?? ""
  let treeText = bodyText.isEmpty
    ? "App=\(bundleId) (pid \(entry.pid))\nWindow: \"\(title ?? "<unknown>")\", App: \(appName)."
    : "App=\(bundleId) (pid \(entry.pid))\nWindow: \"\(title ?? "<unknown>")\", App: \(appName).\n\(bodyText)"
  let rawText = "Computer Use state (CUA App Version: 750)\n<app_state>\n\(treeText)\n\n</app_state>"

  // Screenshots are taken by Atrium's main process (which holds the Screen
  // Recording grant); the helper only returns the window info the main process
  // needs to capture it — screen capture is bound to the originating process's
  // own grant, which a child helper never inherits.
  let result = ResultPayload(
    ok: true,
    toolName: "get_app_state",
    app: AppPayload(name: appName, bundleId: app?.bundleIdentifier, pid: Int(entry.pid)),
    snapshot: SnapshotPayload(windowTitle: title, treeText: treeText, elements: axSnapshot?.elements ?? []),
    artifacts: nil,
    data: [
      "windowId": .number(Double(entry.windowID)),
      "windowX": .number(Double(entry.bounds.origin.x)),
      "windowY": .number(Double(entry.bounds.origin.y)),
      "windowWidth": .number(Double(entry.bounds.width)),
      "windowHeight": .number(Double(entry.bounds.height)),
    ],
    warnings: [
      axSnapshot == nil ? "Accessibility tree extraction is unavailable for this app instance." : nil,
      axSnapshot?.warnings.first,
    ].compactMap { $0 },
    meta: MetaPayload(observedShape: "state+image", rawText: rawText),
    error: nil
  )
  OverlayCursorController.shared.extendVisibility()
  return result
}

func targetWindowElement(for app: NSRunningApplication) -> AXUIElement? {
  let appElement = AXUIElementCreateApplication(app.processIdentifier)
  if let focusedWindow = axElementValue(appElement, kAXFocusedWindowAttribute as String) {
    return focusedWindow
  }
  if let mainWindow = axElementValue(appElement, kAXMainWindowAttribute as String) {
    return mainWindow
  }
  return nil
}

@discardableResult
func raiseTargetWindow(for app: NSRunningApplication) -> Bool {
  guard let window = targetWindowElement(for: app) else {
    return false
  }
  return AXUIElementPerformAction(window, kAXRaiseAction as CFString) == .success
}

// Un-minimize any minimized windows so a backgrounded app can be read and acted
// on. A minimized window is absent from the on-screen window list (CGWindowList),
// so without this a minimized native app resolves to no window at all. Returns
// whether anything was restored, so the caller can wait out the restore animation.
@discardableResult
func deminiaturizeWindows(for app: NSRunningApplication) -> Bool {
  let appElement = AXUIElementCreateApplication(app.processIdentifier)
  var restored = false
  for window in axElementArray(appElement, kAXWindowsAttribute as String) {
    if axBool(window, kAXMinimizedAttribute as String) == true,
      AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, false as CFTypeRef) == .success
    {
      restored = true
    }
  }
  return restored
}

func mouseButton(from rawValue: String?) -> CGMouseButton {
  switch rawValue {
  case "right":
    return .right
  case "middle":
    return .center
  default:
    return .left
  }
}

func withActivatedApp<T>(
  appRef: String,
  activate: Bool = true,
  restorePreviousFocus: Bool = true,
  stackTargetBehindPrevious: Bool = false,
  action: () -> T
) -> T {
  let previousFrontmost = NSWorkspace.shared.frontmostApplication
  let targetApp = resolveApp(appRef)
  let targetEntry = resolvedWindowInfo(appRef: appRef)

  if activate, let targetApp {
    let previousIsTarget = previousFrontmost?.processIdentifier == targetApp.processIdentifier
    if stackTargetBehindPrevious, !previousIsTarget {
      _ = raiseTargetWindow(for: targetApp)
      usleep(appActivationDelayMicros)
    } else {
      targetApp.activate()
      usleep(appActivationDelayMicros)
    }
  }

  OverlayCursorController.shared.configure(for: targetEntry)
  if activate, let targetEntry {
    OverlayCursorController.shared.showActivity(at: windowCenter(targetEntry), wiggle: false)
  }
  let result = action()

  if restorePreviousFocus, let previousFrontmost, previousFrontmost.processIdentifier != targetApp?.processIdentifier {
    previousFrontmost.activate()
    usleep(appActivationDelayMicros)
  }

  return result
}

func mouseEventTypes(for button: CGMouseButton) -> (down: CGEventType, up: CGEventType) {
  switch button {
  case .right:
    return (.rightMouseDown, .rightMouseUp)
  case .center:
    return (.otherMouseDown, .otherMouseUp)
  default:
    return (.leftMouseDown, .leftMouseUp)
  }
}

func postClick(at location: CGPoint, button: CGMouseButton = .left, clickCount: Int = 1) -> Bool {
  let eventTypes = mouseEventTypes(for: button)
  for _ in 0..<clickCount {
    guard let downEvent = CGEvent(mouseEventSource: nil, mouseType: eventTypes.down, mouseCursorPosition: location, mouseButton: button),
      let upEvent = CGEvent(mouseEventSource: nil, mouseType: eventTypes.up, mouseCursorPosition: location, mouseButton: button)
    else {
      return false
    }

    downEvent.setIntegerValueField(.mouseEventClickState, value: Int64(clickCount))
    upEvent.setIntegerValueField(.mouseEventClickState, value: Int64(clickCount))
    downEvent.post(tap: .cghidEventTap)
    upEvent.post(tap: .cghidEventTap)
    usleep(clickIntervalDelayMicros)
  }
  return true
}

func clickResult(params: [String: JSONValue]) -> ResultPayload {
  guard case .string(let appRef)? = params["app"] else {
    return makeErrorResult(toolName: "click", code: "internal_error", message: "Missing app parameter")
  }

  let clickCount: Int
  if case .number(let rawCount)? = params["click_count"] {
    clickCount = max(Int(rawCount), 1)
  } else {
    clickCount = 1
  }

  let buttonName: String?
  if case .string(let rawButton)? = params["mouse_button"] {
    buttonName = rawButton
  } else {
    buttonName = nil
  }

  let button = mouseButton(from: buttonName)

  let location: CGPoint
  let semanticElement: AXUIElement?
  if case .string(let elementIndex)? = params["element_index"] {
    guard let target = resolveElementTarget(appRef: appRef, elementIndex: elementIndex) else {
      return makeErrorResult(toolName: "click", code: "invalid_element", message: "\(elementIndex) is an invalid element ID")
    }
    location = target.point
    semanticElement = target.element
  } else if case .number(let xValue)? = params["x"], case .number(let yValue)? = params["y"] {
    guard let resolvedLocation = screenPoint(forScreenshotPoint: CGPoint(x: xValue, y: yValue), appRef: appRef) else {
      return makeErrorResult(toolName: "click", code: "app_not_found", message: "appNotFound(\"\(appRef)\")")
    }
    location = resolvedLocation
    semanticElement = nil
  } else {
    return makeErrorResult(
      toolName: "click",
      code: "unsupported_action",
      message: "Click requires element_index or x/y coordinates."
    )
  }

  let canUseSemanticClick = button == .left && clickCount == 1 && semanticElement != nil
  var success = false

  if canUseSemanticClick {
    success = withActivatedApp(
      appRef: appRef,
      activate: true,
      restorePreviousFocus: true,
      stackTargetBehindPrevious: true
    ) {
      OverlayCursorController.shared.animate(to: location)
      let pressed = performSemanticClick(at: location, appRef: appRef)
      if pressed {
        OverlayCursorController.shared.pulse()
        OverlayCursorController.shared.extendVisibility()
      }
      return pressed
    }
  }

  if !success {
    success = withActivatedApp(
      appRef: appRef,
      activate: true,
      restorePreviousFocus: true,
      stackTargetBehindPrevious: true
    ) {
      OverlayCursorController.shared.animate(to: location)
      let clickSucceeded = postClick(at: location, button: button, clickCount: clickCount)
      OverlayCursorController.shared.pulse()
      OverlayCursorController.shared.extendVisibility()
      return clickSucceeded
    }
  }

  guard success else {
    return makeErrorResult(toolName: "click", code: "internal_error", message: "Unable to create native click events.")
  }

  usleep(actionSettleDelayMicros)
  return getAppStateResult(appRef: appRef)
}

func dragResult(params: [String: JSONValue]) -> ResultPayload {
  guard case .string(let appRef)? = params["app"] else {
    return makeErrorResult(toolName: "drag", code: "internal_error", message: "Missing app parameter")
  }
  guard case .number(let fromX)? = params["from_x"],
    case .number(let fromY)? = params["from_y"],
    case .number(let toX)? = params["to_x"],
    case .number(let toY)? = params["to_y"]
  else {
    return makeErrorResult(toolName: "drag", code: "internal_error", message: "Missing drag coordinates")
  }

  let from = CGPoint(x: fromX, y: fromY)
  let to = CGPoint(x: toX, y: toY)
  guard let fromScreen = screenPoint(forScreenshotPoint: from, appRef: appRef),
    let toScreen = screenPoint(forScreenshotPoint: to, appRef: appRef)
  else {
    return makeErrorResult(toolName: "drag", code: "app_not_found", message: "appNotFound(\"\(appRef)\")")
  }
  let steps = 12

  let success = withActivatedApp(appRef: appRef, restorePreviousFocus: true, stackTargetBehindPrevious: true) {
    OverlayCursorController.shared.animate(to: fromScreen, duration: 0.14)

    guard let moveEvent = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: fromScreen, mouseButton: .left),
      let downEvent = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: fromScreen, mouseButton: .left)
    else {
      return false
    }

    moveEvent.post(tap: .cghidEventTap)
    usleep(clickIntervalDelayMicros)
    downEvent.post(tap: .cghidEventTap)
    usleep(clickIntervalDelayMicros)

    for index in 1...steps {
      let progress = Double(index) / Double(steps)
      let point = CGPoint(
        x: fromScreen.x + ((toScreen.x - fromScreen.x) * progress),
        y: fromScreen.y + ((toScreen.y - fromScreen.y) * progress)
      )
      OverlayCursorController.shared.move(to: point)
      guard let dragEvent = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: point, mouseButton: .left) else {
        return false
      }
      dragEvent.post(tap: .cghidEventTap)
      RunLoop.current.run(until: Date().addingTimeInterval(0.02))
    }

    guard let upEvent = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: toScreen, mouseButton: .left) else {
      return false
    }
    upEvent.post(tap: .cghidEventTap)
    OverlayCursorController.shared.pulse()
    OverlayCursorController.shared.extendVisibility()
    return true
  }

  if !success {
    return makeErrorResult(toolName: "drag", code: "internal_error", message: "Unable to post native drag events.")
  }

  usleep(actionSettleDelayMicros)
  return getAppStateResult(appRef: appRef)
}

func unicodeKeyPair(text: String, flags: CGEventFlags = []) -> Bool {
  guard let keyDown = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
    let keyUp = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
  else {
    return false
  }

  keyDown.flags = flags
  keyUp.flags = flags
  keyDown.keyboardSetUnicodeString(stringLength: text.utf16.count, unicodeString: Array(text.utf16))
  keyUp.keyboardSetUnicodeString(stringLength: text.utf16.count, unicodeString: Array(text.utf16))
  keyDown.post(tap: .cghidEventTap)
  keyUp.post(tap: .cghidEventTap)
  return true
}

func typeCharacter(_ character: Character) -> Bool {
  let text = String(character)
  if let code = keyCode(for: text) {
    return postKeyCode(code, flags: [])
  }
  return unicodeKeyPair(text: text)
}

func modifierFlags(from parts: ArraySlice<String>) -> CGEventFlags {
  var flags: CGEventFlags = []
  for part in parts {
    switch part {
    case "cmd", "command", "super":
      flags.insert(.maskCommand)
    case "ctrl", "control":
      flags.insert(.maskControl)
    case "alt", "option":
      flags.insert(.maskAlternate)
    case "shift":
      flags.insert(.maskShift)
    default:
      break
    }
  }
  return flags
}

func keyCode(for rawKey: String) -> CGKeyCode? {
  switch rawKey.lowercased() {
  case "a": return 0
  case "s": return 1
  case "d": return 2
  case "f": return 3
  case "h": return 4
  case "g": return 5
  case "z": return 6
  case "x": return 7
  case "c": return 8
  case "v": return 9
  case "b": return 11
  case "q": return 12
  case "w": return 13
  case "e": return 14
  case "r": return 15
  case "y": return 16
  case "t": return 17
  case "1": return 18
  case "2": return 19
  case "3": return 20
  case "4": return 21
  case "6": return 22
  case "5": return 23
  case "=": return 24
  case "9": return 25
  case "7": return 26
  case "-": return 27
  case "8": return 28
  case "0": return 29
  case "]": return 30
  case "o": return 31
  case "u": return 32
  case "[": return 33
  case "i": return 34
  case "p": return 35
  case "l": return 37
  case "j": return 38
  case "'": return 39
  case "k": return 40
  case ";": return 41
  case "\\": return 42
  case ",": return 43
  case "/": return 44
  case "n": return 45
  case "m": return 46
  case ".": return 47
  case "`": return 50
  case "return", "enter": return 36
  case "tab": return 48
  case "space": return 49
  case "delete", "backspace": return 51
  case "escape", "esc": return 53
  case "left": return 123
  case "right": return 124
  case "down": return 125
  case "up": return 126
  default: return nil
  }
}

func postKeyCode(_ keyCode: CGKeyCode, flags: CGEventFlags) -> Bool {
  guard let keyDown = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true),
    let keyUp = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false)
  else {
    return false
  }

  keyDown.flags = flags
  keyUp.flags = flags
  keyDown.post(tap: .cghidEventTap)
  keyUp.post(tap: .cghidEventTap)
  return true
}

func typeTextResult(params: [String: JSONValue]) -> ResultPayload {
  guard case .string(let appRef)? = params["app"] else {
    return makeErrorResult(toolName: "type_text", code: "internal_error", message: "Missing app parameter")
  }
  guard case .string(let text)? = params["text"] else {
    return makeErrorResult(toolName: "type_text", code: "internal_error", message: "Missing text parameter")
  }

  let success = withActivatedApp(appRef: appRef, restorePreviousFocus: true) {
    if let point = focusPoint(for: appRef), !revealInteractionPoint(point, clickToFocus: true) {
      return false
    }

    for (index, character) in text.enumerated() {
      if !typeCharacter(character) {
        return false
      }
      if index % 30 == 0 {
        OverlayCursorController.shared.extendVisibility()
      }
      usleep(keyRepeatDelayMicros)
    }
    OverlayCursorController.shared.extendVisibility()
    return true
  }

  if !success {
    return makeErrorResult(toolName: "type_text", code: "internal_error", message: "Unable to post native text events.")
  }

  usleep(actionSettleDelayMicros)
  return getAppStateResult(appRef: appRef)
}

func pressKeyResult(params: [String: JSONValue]) -> ResultPayload {
  guard case .string(let appRef)? = params["app"] else {
    return makeErrorResult(toolName: "press_key", code: "internal_error", message: "Missing app parameter")
  }
  guard case .string(let keySpec)? = params["key"] else {
    return makeErrorResult(toolName: "press_key", code: "internal_error", message: "Missing key parameter")
  }

  let parts = keySpec.split(separator: "+").map(String.init)
  guard let rawKey = parts.last, !rawKey.isEmpty else {
    return makeErrorResult(toolName: "press_key", code: "internal_error", message: "Invalid key parameter")
  }

  let flags = modifierFlags(from: parts.dropLast()[...])
  let success = withActivatedApp(appRef: appRef, activate: true, restorePreviousFocus: true) {
    if let point = focusPoint(for: appRef) {
      let shouldClickToFocus = flags.isEmpty && (rawKey.count == 1 || rawKey.lowercased() == "space")
      if !revealInteractionPoint(point, clickToFocus: shouldClickToFocus) {
        return false
      }
    }

    if let code = keyCode(for: rawKey) {
      let posted = postKeyCode(code, flags: flags)
      OverlayCursorController.shared.extendVisibility()
      return posted
    }
    if rawKey.count == 1 {
      let posted = unicodeKeyPair(text: rawKey, flags: flags)
      OverlayCursorController.shared.extendVisibility()
      return posted
    }
    return false
  }

  if !success {
    return makeErrorResult(
      toolName: "press_key",
      code: "unsupported_action",
      message: "Native helper does not support key specification: \(keySpec)"
    )
  }

  usleep(actionSettleDelayMicros)
  return getAppStateResult(appRef: appRef)
}

func setValueResult(params: [String: JSONValue]) -> ResultPayload {
  guard case .string(let appRef)? = params["app"] else {
    return makeErrorResult(toolName: "set_value", code: "internal_error", message: "Missing app parameter")
  }
  guard case .string(let elementIndex)? = params["element_index"] else {
    return makeErrorResult(toolName: "set_value", code: "internal_error", message: "Missing element_index parameter")
  }
  guard case .string(let value)? = params["value"] else {
    return makeErrorResult(toolName: "set_value", code: "internal_error", message: "Missing value parameter")
  }

  guard let app = resolveApp(appRef) else {
    return makeErrorResult(toolName: "set_value", code: "app_not_found", message: "appNotFound(\"\(appRef)\")")
  }
  guard let element = axElementByIndex(for: app, index: elementIndex) else {
    return makeErrorResult(toolName: "set_value", code: "invalid_element", message: "\(elementIndex) is an invalid element ID")
  }

  let targetPoint = axBounds(element).map { CGPoint(x: $0.x + ($0.width / 2), y: $0.y + ($0.height / 2)) }

  if let targetPoint {
    _ = revealInteractionPoint(targetPoint, clickToFocus: false)
  }

  var success = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFString) == .success
  if !success {
    success = withActivatedApp(appRef: appRef) {
      AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFString) == .success
    }
  }

  if !success {
    return makeErrorResult(toolName: "set_value", code: "accessibility_error", message: "Accessibility error: Unable to set element value")
  }

  OverlayCursorController.shared.extendVisibility()
  usleep(actionSettleDelayMicros)
  return getAppStateResult(appRef: appRef)
}

func axActionName(for action: String) -> String {
  switch action.lowercased() {
  case "raise":
    return kAXRaiseAction as String
  case "press":
    return kAXPressAction as String
  case "confirm":
    return kAXConfirmAction as String
  case "cancel":
    return kAXCancelAction as String
  case "showmenu":
    return kAXShowMenuAction as String
  case "pick":
    return kAXPickAction as String
  default:
    if action.hasPrefix("AX") {
      return action
    }
    return action
  }
}

func performSecondaryActionResult(params: [String: JSONValue]) -> ResultPayload {
  guard case .string(let appRef)? = params["app"] else {
    return makeErrorResult(toolName: "perform_secondary_action", code: "internal_error", message: "Missing app parameter")
  }
  guard case .string(let elementIndex)? = params["element_index"] else {
    return makeErrorResult(toolName: "perform_secondary_action", code: "internal_error", message: "Missing element_index parameter")
  }
  guard case .string(let action)? = params["action"] else {
    return makeErrorResult(toolName: "perform_secondary_action", code: "internal_error", message: "Missing action parameter")
  }

  guard let app = resolveApp(appRef) else {
    return makeErrorResult(toolName: "perform_secondary_action", code: "app_not_found", message: "appNotFound(\"\(appRef)\")")
  }
  guard let element = axElementByIndex(for: app, index: elementIndex) else {
    return makeErrorResult(toolName: "perform_secondary_action", code: "invalid_element", message: "\(elementIndex) is an invalid element ID")
  }

  let resolvedAction = axActionName(for: action)
  var success = false

  if resolvedAction != kAXRaiseAction as String {
    success = AXUIElementPerformAction(element, resolvedAction as CFString) == .success
  }

  if !success {
    success = withActivatedApp(
      appRef: appRef,
      activate: resolvedAction == kAXRaiseAction as String || resolvedAction == kAXPressAction as String,
      restorePreviousFocus: resolvedAction != kAXRaiseAction as String
    ) {
      if AXUIElementPerformAction(element, resolvedAction as CFString) == .success {
        return true
      }

      if resolvedAction == kAXPressAction as String, let bounds = axBounds(element) {
        let center = CGPoint(x: bounds.x + (bounds.width / 2), y: bounds.y + (bounds.height / 2))
        OverlayCursorController.shared.animate(to: center)
        let clicked = postClick(at: center)
        OverlayCursorController.shared.pulse()
        OverlayCursorController.shared.extendVisibility()
        return clicked
      }

      if resolvedAction == kAXRaiseAction as String {
        if let app = resolveApp(appRef) {
          app.activate()
          return true
        }
      }

      return false
    }
  }

  if !success {
    return makeErrorResult(
      toolName: "perform_secondary_action",
      code: "accessibility_error",
      message: "Accessibility error: Unable to perform action \(action)"
    )
  }

  usleep(actionSettleDelayMicros)
  return getAppStateResult(appRef: appRef)
}

func scrollResult(params: [String: JSONValue]) -> ResultPayload {
  guard case .string(let appRef)? = params["app"] else {
    return makeErrorResult(toolName: "scroll", code: "internal_error", message: "Missing app parameter")
  }
  guard case .string(let elementIndex)? = params["element_index"] else {
    return makeErrorResult(toolName: "scroll", code: "internal_error", message: "Missing element_index parameter")
  }
  guard case .string(let direction)? = params["direction"] else {
    return makeErrorResult(toolName: "scroll", code: "internal_error", message: "Missing direction parameter")
  }

  let pages: Int
  if case .number(let rawPages)? = params["pages"] {
    pages = max(Int(rawPages), 1)
  } else {
    pages = 1
  }

  guard let target = resolveElementTarget(appRef: appRef, elementIndex: elementIndex) else {
    return makeErrorResult(toolName: "scroll", code: "invalid_element", message: "\(elementIndex) is an invalid element ID")
  }

  guard let scrollPoint = scrollInteractionPoint(for: target.element) else {
    usleep(actionSettleDelayMicros)
    return getAppStateResult(appRef: appRef)
  }

  let delta = 480 * pages
  let success = withActivatedApp(appRef: appRef) {
    let center = scrollPoint
    OverlayCursorController.shared.animate(to: center, duration: 0.14)
    guard let mouseMove = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: center, mouseButton: .left) else {
      return false
    }
    mouseMove.post(tap: .cghidEventTap)
    usleep(scrollFocusDelayMicros)

    guard let event = CGEvent(
      scrollWheelEvent2Source: nil,
      units: .pixel,
      wheelCount: 2,
      wheel1: 0,
      wheel2: 0,
      wheel3: 0
    ) else {
      return false
    }

    event.location = center
    switch direction.lowercased() {
    case "up":
      event.setIntegerValueField(.scrollWheelEventDeltaAxis1, value: Int64(delta))
      event.setIntegerValueField(.scrollWheelEventPointDeltaAxis1, value: Int64(delta))
      event.setIntegerValueField(.scrollWheelEventFixedPtDeltaAxis1, value: Int64(delta * 65536))
    case "down":
      event.setIntegerValueField(.scrollWheelEventDeltaAxis1, value: Int64(-delta))
      event.setIntegerValueField(.scrollWheelEventPointDeltaAxis1, value: Int64(-delta))
      event.setIntegerValueField(.scrollWheelEventFixedPtDeltaAxis1, value: Int64(-delta * 65536))
    case "left":
      event.setIntegerValueField(.scrollWheelEventDeltaAxis2, value: Int64(delta))
      event.setIntegerValueField(.scrollWheelEventPointDeltaAxis2, value: Int64(delta))
      event.setIntegerValueField(.scrollWheelEventFixedPtDeltaAxis2, value: Int64(delta * 65536))
    case "right":
      event.setIntegerValueField(.scrollWheelEventDeltaAxis2, value: Int64(-delta))
      event.setIntegerValueField(.scrollWheelEventPointDeltaAxis2, value: Int64(-delta))
      event.setIntegerValueField(.scrollWheelEventFixedPtDeltaAxis2, value: Int64(-delta * 65536))
    default:
      return false
    }

    event.post(tap: .cghidEventTap)
    OverlayCursorController.shared.pulse()
    OverlayCursorController.shared.extendVisibility()
    return true
  }

  if !success {
    return makeErrorResult(
      toolName: "scroll",
      code: "unsupported_action",
      message: "Native helper does not support scroll direction: \(direction)"
    )
  }

  usleep(actionSettleDelayMicros)
  return getAppStateResult(appRef: appRef)
}

// Self-report TCC status. This helper — not Atrium's main process — is the
// signed identity that holds Accessibility + Screen Recording, so it is the
// only correct source of truth for the settings UI's permission state.
func permissionsResult() -> ResultPayload {
  let accessibility = AXIsProcessTrusted()
  let screenRecording = CGPreflightScreenCaptureAccess()
  return ResultPayload(
    ok: true,
    toolName: "permissions",
    app: nil,
    snapshot: nil,
    artifacts: nil,
    data: ["accessibility": .bool(accessibility), "screenRecording": .bool(screenRecording)],
    warnings: [],
    meta: MetaPayload(observedShape: "text", rawText: nil),
    error: nil
  )
}

func hideOverlayResult() -> ResultPayload {
  OverlayCursorController.shared.hide()
  return ResultPayload(
    ok: true,
    toolName: "hide_overlay",
    app: nil,
    snapshot: nil,
    artifacts: nil,
    data: nil,
    warnings: [],
    meta: MetaPayload(observedShape: "text", rawText: nil),
    error: nil
  )
}

// On-screen bounds of an app's main window via CGWindowList — no TCC grant
// needed, so the drag overlay can anchor below System Settings before the user
// has granted anything. Returns the largest layer-0 window for the bundle id.
func windowBoundsResult(bundleId: String) -> ResultPayload {
  let matches = refreshWindowEntries().filter {
    runningApp(for: $0.pid)?.bundleIdentifier == bundleId
  }
  let main = matches.max {
    ($0.bounds.width * $0.bounds.height) < ($1.bounds.width * $1.bounds.height)
  }
  var data: [String: JSONValue] = ["found": .bool(main != nil)]
  if let win = main {
    data["x"] = .number(Double(win.bounds.origin.x))
    data["y"] = .number(Double(win.bounds.origin.y))
    data["width"] = .number(Double(win.bounds.width))
    data["height"] = .number(Double(win.bounds.height))
  }
  return ResultPayload(
    ok: true,
    toolName: "get_window_bounds",
    app: nil,
    snapshot: nil,
    artifacts: nil,
    data: data,
    warnings: [],
    meta: MetaPayload(observedShape: "text", rawText: nil),
    error: nil
  )
}

while let line = readLine() {
  if line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
    continue
  }

  do {
    let request = try decoder.decode(Request.self, from: Data(line.utf8))
    let result: ResultPayload

    switch request.method {
    case "list_apps":
      result = listAppsResult()
    case "get_app_state":
      guard case .string(let appRef)? = request.params["app"] else {
        result = makeErrorResult(toolName: "get_app_state", code: "internal_error", message: "Missing app parameter")
        writeResponse(Response(id: request.id, ok: result.ok, result: result, error: nil))
        continue
      }
      result = getAppStateResult(appRef: appRef)
    case "click":
      result = clickResult(params: request.params)
    case "drag":
      result = dragResult(params: request.params)
    case "type_text":
      result = typeTextResult(params: request.params)
    case "press_key":
      result = pressKeyResult(params: request.params)
    case "perform_secondary_action":
      result = performSecondaryActionResult(params: request.params)
    case "set_value":
      result = setValueResult(params: request.params)
    case "scroll":
      result = scrollResult(params: request.params)
    case "permissions":
      result = permissionsResult()
    case "hide_overlay":
      result = hideOverlayResult()
    case "get_window_bounds":
      guard case .string(let bundleId)? = request.params["bundleId"] else {
        result = makeErrorResult(
          toolName: "get_window_bounds", code: "internal_error", message: "Missing bundleId parameter")
        writeResponse(Response(id: request.id, ok: result.ok, result: result, error: nil))
        continue
      }
      result = windowBoundsResult(bundleId: bundleId)
    default:
      result = makeErrorResult(toolName: request.method, code: "unsupported_action", message: "Unsupported helper method: \(request.method)")
    }

    writeResponse(Response(id: request.id, ok: true, result: result, error: nil))
  } catch {
    writeResponse(Response(id: "unknown", ok: false, result: nil, error: String(describing: error)))
  }
}
