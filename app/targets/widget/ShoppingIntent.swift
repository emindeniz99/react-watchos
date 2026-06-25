import AppIntents
import Foundation
import WidgetKit

// IMPORTANT: this file is duplicated verbatim at app/targets/watch/ShoppingIntent.swift.
// A widget's configuration intent (and its AppEntity/EntityQuery) must appear
// in BOTH the widget extension's AND the host app's AppIntents metadata —
// WidgetKit resolves the configuration against the *app* bundle. apple-targets'
// file-system-synchronized groups can't add one file to two targets, so the
// source is duplicated into each target folder. Keep the two copies identical.

/// Mirrors the JS ShoppingList shape (demo/shoppingStore.ts).
private struct StoredShoppingList: Codable {
    let id: String
    let name: String
}

/// Reads the JS-owned shopping lists from App Group storage (written by the
/// JS Storage API as JSON under "<storagePrefix><key>").
enum ShoppingData {
    // These MUST match SharedWidgetStore (swift/Sources/ReactWatchSupport),
    // which is the canonical source: it owns `storagePrefix` and takes the
    // group id via init. They are hardcoded (and duplicated across the two
    // ShoppingIntent.swift copies) only because this file is synced into two
    // app targets and kept dependency-free — it can't import that package.
    // Keep them in sync if either value ever changes there.
    private static let appGroupId = "group.com.emindeniz99.reactwatch"
    private static let storagePrefix = "react.storage."

    private static func string(forKey key: String) -> String? {
        UserDefaults(suiteName: appGroupId)?.string(forKey: storagePrefix + key)
    }

    static func lists() -> [(id: String, name: String)] {
        guard let json = string(forKey: "shopping.lists"),
              let lists = try? JSONDecoder().decode(
                  [StoredShoppingList].self, from: Data(json.utf8)
              )
        else { return [] }
        return lists.map { ($0.id, $0.name) }
    }

    /// The list chosen in-app (setFeaturedList); JS stores it as a JSON string
    /// or null.
    static func featuredId() -> String? {
        guard let json = string(forKey: "shopping.featuredListId"),
              let id = try? JSONDecoder().decode(String?.self, from: Data(json.utf8))
        else { return nil }
        return id
    }

    /// The fallback list a complication shows when the user hasn't picked one
    /// via the native per-complication picker (SelectShoppingListIntent): the
    /// in-app featured list, else the first list. ShoppingConfiguration uses
    /// `configuration.list?.id ?? defaultId()`, so an explicit picker choice
    /// overrides this; the in-app featured list is only the unconfigured default.
    static func defaultId() -> String? {
        featuredId() ?? lists().first?.id
    }
}

struct ShoppingListEntity: AppEntity {
    let id: String
    let name: String

    static var typeDisplayRepresentation: TypeDisplayRepresentation {
        "Shopping List"
    }

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }

    static var defaultQuery = ShoppingListQuery()
}

/// Resolves entities from the JS-owned lists in App Group storage.
struct ShoppingListQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [ShoppingListEntity] {
        ShoppingData.lists()
            .filter { identifiers.contains($0.id) }
            .map { ShoppingListEntity(id: $0.id, name: $0.name) }
    }

    func suggestedEntities() async throws -> [ShoppingListEntity] {
        ShoppingData.lists().map { ShoppingListEntity(id: $0.id, name: $0.name) }
    }
}

struct SelectShoppingListIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource {
        "Shopping List"
    }

    static var description: IntentDescription {
        IntentDescription("Choose which shopping list this complication shows.")
    }

    @Parameter(title: "List")
    var list: ShoppingListEntity?
}
