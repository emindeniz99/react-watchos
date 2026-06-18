import Foundation
import ReactWatchCore

// Decodes a real commit tree (Fixtures/tree.json) with the watch app's
// RNTree/RNNode decoder and asserts the wire contract, including the new
// TimerText primitive.

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("CommitContract FAIL: \(message)\n".utf8))
    exit(1)
}

func find(_ node: RNNode, _ type: String) -> RNNode? {
    if node.type == type { return node }
    for child in node.children {
        if let match = find(child, type) { return match }
    }
    return nil
}

func findText(_ node: RNNode, _ text: String) -> RNNode? {
    if node.type == "Text", node.string("text") == text { return node }
    for child in node.children {
        if let match = findText(child, text) { return match }
    }
    return nil
}

let path = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1] : "Fixtures/tree.json"
guard let data = FileManager.default.contents(atPath: path) else {
    fail("cannot read \(path)")
}

let tree: RNTree
do {
    tree = try JSONDecoder().decode(RNTree.self, from: data)
} catch {
    fail("decode failed: \(error)")
}

guard tree.v == 1 else { fail("unexpected schema version \(tree.v)") }
guard let root = tree.root, root.type == "VStack" else {
    fail("root is not a VStack")
}
guard let timer = find(root, "TimerText") else { fail("no TimerText node") }
guard timer.double("since") == 1000 else {
    fail("TimerText.since = \(String(describing: timer.double("since")))")
}
guard let toggle = find(root, "Toggle"), toggle.bool("value") == true else {
    fail("Toggle.value not true")
}
guard findText(root, "Connected") != nil else {
    fail("Text.text not folded correctly")
}
guard let crown = find(root, "CrownRotation"),
      crown.double("from") == 0, crown.double("through") == 10,
      crown.double("value") == 5 else {
    fail("CrownRotation range/value not decoded")
}

print("CommitContract OK: seq=\(tree.seq), TimerText.since=\(timer.double("since")!), Toggle.value=\(toggle.bool("value")!), Crown.through=\(crown.double("through")!)")
