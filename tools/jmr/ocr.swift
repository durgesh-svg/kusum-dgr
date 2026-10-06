import Foundation
import PDFKit
import Vision
import AppKit

// Usage: ocr <pdf> <out.txt>   -- renders page 1 at high DPI, tries 4 orientations,
// keeps the one Vision is most confident about, writes recognised lines.
let args = CommandLine.arguments
guard args.count == 3, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])), let page = doc.page(at: 0) else { exit(2) }
let bounds = page.bounds(for: .mediaBox)
let scale: CGFloat = 3.0
func render(rotate: Int) -> CGImage? {
    let w = Int(bounds.width*scale), h = Int(bounds.height*scale)
    let rw = (rotate % 2 == 0) ? w : h, rh = (rotate % 2 == 0) ? h : w
    guard let ctx = CGContext(data: nil, width: rw, height: rh, bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
    ctx.setFillColor(CGColor.white); ctx.fill(CGRect(x: 0, y: 0, width: rw, height: rh))
    ctx.translateBy(x: CGFloat(rw)/2, y: CGFloat(rh)/2)
    ctx.rotate(by: CGFloat(rotate) * .pi/2)
    ctx.translateBy(x: -CGFloat(w)/2, y: -CGFloat(h)/2)
    ctx.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: ctx)
    return ctx.makeImage()
}
var best: (Double, [String]) = (-1, [])
for r in 0..<4 {
    guard let img = render(rotate: r) else { continue }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate; req.usesLanguageCorrection = false
    try? VNImageRequestHandler(cgImage: img, options: [:]).perform([req])
    let obs = req.results ?? []
    let lines = obs.compactMap { $0.topCandidates(1).first }
    let score = lines.reduce(0.0) { $0 + Double($1.confidence) * Double($1.string.count) }
    if score > best.0 { best = (score, lines.map { $0.string }) }
}
try? best.1.joined(separator: "\n").write(toFile: args[2], atomically: true, encoding: .utf8)
print("\(args[1].split(separator: "/").last!): \(best.1.count) lines")
