import Foundation
import ScreenCaptureKit
import AppKit

_ = NSApplication.shared

struct CaptureRequest {
  let pid: pid_t
  let windowID: CGWindowID?
  let title: String?
}

func parseArguments() -> CaptureRequest? {
  var pid: pid_t?
  var windowID: CGWindowID?
  var title: String?

  var index = 1
  while index < CommandLine.arguments.count {
    let argument = CommandLine.arguments[index]
    switch argument {
    case "--pid":
      index += 1
      guard index < CommandLine.arguments.count, let value = Int32(CommandLine.arguments[index]) else {
        return nil
      }
      pid = value
    case "--window-id":
      index += 1
      guard index < CommandLine.arguments.count, let value = UInt32(CommandLine.arguments[index]) else {
        return nil
      }
      windowID = value
    case "--title":
      index += 1
      guard index < CommandLine.arguments.count else {
        return nil
      }
      title = CommandLine.arguments[index]
    default:
      return nil
    }
    index += 1
  }

  guard let pid else {
    return nil
  }

  return CaptureRequest(pid: pid, windowID: windowID, title: title)
}

func pngData(from image: CGImage) -> Data? {
  let bitmapRep = NSBitmapImageRep(cgImage: image)
  return bitmapRep.representation(using: .png, properties: [:])
}

func chooseWindow(in content: SCShareableContent, request: CaptureRequest) -> SCWindow? {
  if let windowID = request.windowID,
    let exact = content.windows.first(where: { $0.windowID == windowID })
  {
    return exact
  }

  let candidates = content.windows.filter { window in
    guard window.owningApplication?.processID == request.pid else {
      return false
    }
    if let title = request.title, let windowTitle = window.title {
      return windowTitle == title
    }
    return true
  }

  return candidates.max {
    let leftArea = $0.frame.width * $0.frame.height
    let rightArea = $1.frame.width * $1.frame.height
    if leftArea == rightArea {
      return $0.windowID < $1.windowID
    }
    return leftArea < rightArea
  }
}

func captureDisplayWindow(_ window: SCWindow, display: SCDisplay, timeoutSeconds: TimeInterval = 2) -> CGImage? {
  let semaphore = DispatchSemaphore(value: 0)
  let filter = SCContentFilter(display: display, including: [window])
  let config = SCStreamConfiguration()
  config.width = max(Int(window.frame.width.rounded(.up)), 1)
  config.height = max(Int(window.frame.height.rounded(.up)), 1)
  config.showsCursor = false

  var image: CGImage?
  SCScreenshotManager.captureImage(contentFilter: filter, configuration: config) { capturedImage, _ in
    image = capturedImage
    semaphore.signal()
  }

  guard semaphore.wait(timeout: .now() + timeoutSeconds) == .success else {
    return nil
  }
  return image
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}

guard let request = parseArguments() else {
  fail("usage: WindowCaptureHelper --pid <pid> [--window-id <id>] [--title <title>]")
}

let contentSemaphore = DispatchSemaphore(value: 0)
var shareableContent: SCShareableContent?
SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: false) { content, _ in
  shareableContent = content
  contentSemaphore.signal()
}

guard contentSemaphore.wait(timeout: .now() + 2) == .success,
  let shareableContent,
  let window = chooseWindow(in: shareableContent, request: request),
  let display = shareableContent.displays.first(where: { $0.frame.intersects(window.frame) }) ?? shareableContent.displays.first
else {
  fail("screen capture window lookup failed")
}

guard let capturedImage = captureDisplayWindow(window, display: display),
  let data = pngData(from: capturedImage)
else {
  fail("screen capture image capture failed")
}

FileHandle.standardOutput.write(Data(data.base64EncodedString().utf8))
