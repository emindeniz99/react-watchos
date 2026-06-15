import Foundation

// Decodes a real publishWidgets payload (Fixtures/widgets.json) with the
// widget extension's PublishedWidgets decoder and asserts the timeline,
// relevance, and control contract.

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("WidgetContract FAIL: \(message)\n".utf8))
    exit(1)
}

let path = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1] : "Fixtures/widgets.json"
guard let data = FileManager.default.contents(atPath: path) else {
    fail("cannot read \(path)")
}

let payload: PublishedWidgets
do {
    payload = try JSONDecoder().decode(PublishedWidgets.self, from: data)
} catch {
    fail("decode failed: \(error)")
}

guard payload.v == 1 else { fail("unexpected schema version \(payload.v)") }
guard let stopwatch = payload.widgets["stopwatch"] else {
    fail("missing stopwatch widget")
}
guard let circular = stopwatch["accessoryCircular"],
      let entry = circular.entries.first else {
    fail("missing accessoryCircular timeline entry")
}
guard entry.tree?.type == "Gauge" else { fail("entry tree is not a Gauge") }
guard entry.relevance?.score == 50 else {
    fail("relevance score = \(String(describing: entry.relevance?.score))")
}
guard let control = payload.controls?["sw.start"], control.label == "Start" else {
    fail("control sw.start not decoded")
}

print("WidgetContract OK: families=\(stopwatch.keys.sorted()), control=\(control.label), relevance=\(entry.relevance!.score)")
