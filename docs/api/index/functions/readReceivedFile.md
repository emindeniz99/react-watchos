[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / readReceivedFile

# Function: readReceivedFile()

> **readReceivedFile**(`path`, `options?`): `Promise`\<[`ReceivedFileChunk`](../interfaces/ReceivedFileChunk.md)\>

Defined in: [js/src/connectivity.ts:355](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L355)

Reads a file this app received, by the `path` its [onReceivedFile](onReceivedFile.md)
event carried — the package's byte-reading API for the inbox, and the reason
[ReceivedFile.path](../interfaces/ReceivedFile.md#path) says not to `fetch` one.

Reads at most one chunk per call, so a file larger than the bridge's body
ceiling is still readable — the ceiling bounds a chunk, not the file:

```ts
let b64 = "";
for (let offset = 0; ; ) {
  const chunk = await readReceivedFile(file.path, { offset });
  b64 += chunk.base64;                 // chunks concatenate, see `base64`
  if (chunk.eof) break;
  offset += chunk.bytes;               // NOT the length you asked for
}
await deleteReceivedFile(file.path);
```

Gated on `connectivity`, with the receive itself — reading a file the host
handed you is the same privilege as deleting it, not a network one.

### Cost

The read, the base64 and the JSON hop all happen on the main thread, so a
ceiling-sized chunk is a visible pause. Pass a smaller `length` — at least 3,
see the refusals below — if you are reading while anything is animating, and
prefer a user action over a render or sensor path.

Rejects `INVALID_REQUEST` for a path outside the inbox, a path retention has
already reclaimed, an `offset`/`length` that is not a whole number of bytes
(both are `number` here, so `{ offset: file.size / 2 }` is type-legal and
refused — round it yourself), a negative `offset`, an `offset` past the end,
a `length` that is not positive, a `length` over the chunk ceiling, and a
window of 1 or 2 bytes that stops short of the end — a chunk that does not
end the file is trimmed to a multiple of 3 so its base64 concatenates (see
[ReceivedFileChunk.base64](../interfaces/ReceivedFileChunk.md#base64)), and nothing under 3 bytes survives that
trim. So `{ offset: 0, length: 2 }` to peek at a header is a refusal, not a
short read: ask for 3 or more, or for the whole file, and slice the bytes
yourself. The host never silently returns a different range than the one
asked for.

## Parameters

### path

`string`

### options?

#### length?

`number`

#### offset?

`number`

## Returns

`Promise`\<[`ReceivedFileChunk`](../interfaces/ReceivedFileChunk.md)\>
