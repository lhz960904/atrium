/*
 * Rounds the corners of a screenshot and floats it on a soft drop shadow over
 * a transparent canvas — the same look macOS window capture (⇧⌘5) produces,
 * which CDP screenshots lack. Invoked by scripts/screenshot.ts; also usable
 * standalone: swift scripts/beautify-screenshot.swift <in.png> <out.png> [radius] [pad]
 */
import AppKit
import CoreGraphics

let args = CommandLine.arguments
guard args.count >= 3 else {
  FileHandle.standardError.write(Data("usage: beautify-screenshot.swift <in.png> <out.png> [radius] [pad]\n".utf8))
  exit(1)
}
let inPath = args[1]
let outPath = args[2]
let radius: CGFloat = args.count > 3 ? CGFloat(Double(args[3]) ?? 28) : 28
let pad: CGFloat = args.count > 4 ? CGFloat(Double(args[4]) ?? 110) : 110

guard let image = NSImage(contentsOfFile: inPath),
      let source = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
else {
  FileHandle.standardError.write(Data("could not read \(inPath)\n".utf8))
  exit(1)
}
let width = CGFloat(source.width)
let height = CGFloat(source.height)

let context = CGContext(
  data: nil,
  width: Int(width + pad * 2),
  height: Int(height + pad * 2),
  bitsPerComponent: 8,
  bytesPerRow: 0,
  space: CGColorSpace(name: CGColorSpace.sRGB)!,
  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
)!

let rect = CGRect(x: pad, y: pad, width: width, height: height)
let path = CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)

context.saveGState()
context.setShadow(
  offset: CGSize(width: 0, height: -30),
  blur: 90,
  color: CGColor(red: 0, green: 0, blue: 0, alpha: 0.38)
)
context.addPath(path)
context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
context.fillPath()
context.restoreGState()

context.saveGState()
context.addPath(path)
context.clip()
context.draw(source, in: rect)
context.restoreGState()

let rendered = context.makeImage()!
let representation = NSBitmapImageRep(cgImage: rendered)
try! representation.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: outPath))
