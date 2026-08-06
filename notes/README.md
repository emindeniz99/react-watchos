# Notes

Research notes and references that inform `react-watchos` (the folder and
commit-scope name `react-native-watchos` is historical) but aren't
tied to a specific code change. Kept in-repo (versioned, reviewable, next to the
code they inform) instead of in a personal tool.

## Convention

- One Markdown file per source or topic, kebab-cased.
- Start each note with: the **original reference link**, the **date captured**,
  and a one-line **why it matters here**.
- Summarize the *takeaways* in our own words; don't paste articles wholesale.
- When a note drives a code change later, link the commit/PR from the note.

## Index

| Note | Source | Relevance |
|------|--------|-----------|
| [watchconnectivity-reliability.md](watchconnectivity-reliability.md) | Tarek Sabry — "WatchConnectivity was failing 40% of the time" | Phone↔watch transport reliability; we depend on `react-native-watch-connectivity` |
| [swift-weekly-issue-135.md](swift-weekly-issue-135.md) | Fatbobman's Swift Weekly #135 | SPM-vs-CocoaPods direction, SwiftUI/Swift 6 / background-refresh tips |
