/*
 * Compiles the production JS bundle to QuickJS bytecode (.qbc) using the SAME
 * vendored quickjs-ng the watch app embeds, so the serialized bytecode version
 * always matches the runtime that reads it (JSRuntime.evaluateBytecode). This
 * is the inverse of the runtime's load path: we COMPILE_ONLY the bundle as a
 * global script and JS_WriteObject it as bytecode; the watch app later does
 * JS_ReadObject + JS_EvalFunction on the same blob (see embed-host.c).
 *
 * The eval type MUST match the runtime's .js path (JS_EVAL_TYPE_GLOBAL), or the
 * function object shape won't line up with JS_EvalFunction.
 *
 * usage: qjs-compile [--strip-debug] <bundle.js> <out.qbc> [out.hash]
 *
 * The optional third argument writes bundle.js's content hash (FNV-1a 64-bit,
 * lowercase hex, no leading zeros) — byte-for-byte the same algorithm as
 * Swift's ReactWatchSupport.ContentHash and manifest.mts's contentHash(). All
 * three assert the shared vector file
 * js/swift/Tests/ReactWatchTests/Fixtures/content-hash-vectors.json (this
 * side via js/test/content-hash-parity.test.ts, which drives THIS tool's
 * [out.hash] path). ReactWatchHost.loadShipped
 * refuses to trust `bundle.qbc` unless this stamp matches ContentHash.of the
 * `bundle.js` sitting next to it (OP-1): the two are compiled in separate
 * build steps, so a hand-swapped source must not silently boot the OLD
 * bytecode's app.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "quickjs.h"

static uint64_t fnv1a(const unsigned char *data, size_t len) {
    uint64_t hash = 0xcbf29ce484222325ULL;
    for (size_t i = 0; i < len; i++) {
        hash ^= data[i];
        hash *= 0x100000001b3ULL;
    }
    return hash;
}

static char *read_file(const char *path, size_t *out_len) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *buf = malloc((size_t)len + 1);
    if (!buf) {
        fclose(f);
        return NULL;
    }
    if (fread(buf, 1, (size_t)len, f) != (size_t)len) {
        fclose(f);
        free(buf);
        return NULL;
    }
    buf[len] = '\0';
    fclose(f);
    *out_len = (size_t)len;
    return buf;
}

int main(int argc, char **argv) {
    // --strip-debug: the escape hatch for a consumer who has decided they do
    // not want symbolication at all — no map kept, no crash reporter, and the
    // ~45 KB of flash back. Opt-in and off by default, because a stripped blob
    // is a ONE-WAY door: `at fn (<null>:0:1)` frames from the field cannot be
    // recovered later by any tooling, while the default's 45 KB can always be
    // reclaimed by rebuilding with this flag.
    int write_flags = JS_WRITE_OBJ_BYTECODE | JS_WRITE_OBJ_STRIP_SOURCE;
    if (argc > 1 && strcmp(argv[1], "--strip-debug") == 0) {
        write_flags |= JS_WRITE_OBJ_STRIP_DEBUG;
        argv++;
        argc--;
    }
    if (argc < 3) {
        fprintf(stderr, "usage: %s [--strip-debug] <bundle.js> <out.qbc>\n",
                argv[0]);
        return 2;
    }
    size_t src_len = 0;
    char *src = read_file(argv[1], &src_len);
    if (!src) {
        fprintf(stderr, "qjs-compile: cannot read %s\n", argv[1]);
        return 2;
    }

    // Hashed from the exact bytes just read, before anything below can touch
    // them — this is the stamp ReactWatchHost.loadShipped pairs bundle.qbc to.
    if (argc >= 4) {
        uint64_t hash = fnv1a((const unsigned char *)src, src_len);
        FILE *hf = fopen(argv[3], "w");
        if (!hf || fprintf(hf, "%llx", (unsigned long long)hash) < 0) {
            fprintf(stderr, "qjs-compile: cannot write %s\n", argv[3]);
            if (hf) fclose(hf);
            free(src);
            return 2;
        }
        fclose(hf);
    }

    JSRuntime *rt = JS_NewRuntime();
    JSContext *ctx = JS_NewContext(rt);

    // Compile only (no execution): yields the global-script function object the
    // runtime will JS_EvalFunction. No __host bridge is needed because nothing
    // runs here.
    JSValue obj = JS_Eval(ctx, src, src_len, "bundle.js",
                          JS_EVAL_TYPE_GLOBAL | JS_EVAL_FLAG_COMPILE_ONLY);
    free(src);
    if (JS_IsException(obj)) {
        JSValue exc = JS_GetException(ctx);
        const char *msg = JS_ToCString(ctx, exc);
        fprintf(stderr, "qjs-compile: compile failed: %s\n", msg ? msg : "?");
        JS_FreeCString(ctx, msg);
        JS_FreeValue(ctx, exc);
        JS_FreeValue(ctx, obj);
        JS_FreeContext(ctx);
        JS_FreeRuntime(rt);
        return 1;
    }

    // STRIP_SOURCE yes, STRIP_DEBUG no — the two are not the same trade.
    //
    // STRIP_DEBUG drops the per-opcode line/column tables, and without them
    // quickjs-ng has nothing to build a frame out of: EVERY production frame
    // came back as `at fn (<null>:0:1)` — no filename, no line, no column. A
    // source map is indexed by line+column, so on the path the watch actually
    // runs (JSRuntime.evaluateBytecode reads this .qbc, not bundle.js) the map
    // the build faithfully emits beside every bundle was inert, and
    // `pnpm symbolicate` had nothing to resolve. Keeping the tables makes
    // bytecode frames byte-identical to the source-parsed ones —
    // `at d0 (bundle.min.js:16:25030)`, column landing on the real throw site
    // — for +45.4 KB of .qbc (204,979 -> 250,361 B on the minified app bundle;
    // the debug tables scale with OPCODE COUNT, not source text), +36 KB of
    // QuickJS heap (1,056,103 -> 1,092,729 B), +0.07 ms in JS_ReadObject
    // (1.23 -> 1.31 ms, median of 21 runs) and eval unchanged. Stack positions
    // on the shipped artifact are worth 45 KB of flash.
    // js/test/qbc-symbolication.test.ts is the end-to-end guard: it runs THIS
    // tool's output in the real engine and resolves a frame back to the .tsx,
    // and it fails on a `<null>` frame — the regression signature of
    // STRIP_DEBUG coming back.
    //
    // STRIP_SOURCE stays on unconditionally: measured on the same bundle,
    // retaining the source text blows the blob out to 903 KB (+652 KB over the
    // 250 KB above, more than triple) and buys nothing for stacks — they are
    // byte-identical either way, because the positions above come from the
    // debug tables, not from the embedded text. All it buys is a readable
    // Function.prototype.toString, which nothing on the watch reads.
    //
    // The watch applies this SAME policy when it compiles an applied OTA
    // bundle on device — see qjs_write_obj_bytecode_strip_source() in
    // js/swift/Sources/CQuickJS/include/quickjs-swift-shim.h, which
    // JSRuntime.compileToBytecode passes to JS_WriteObject. Two sites, one
    // decision: change one and change the other.
    size_t out_len = 0;
    uint8_t *out = JS_WriteObject(ctx, &out_len, obj, write_flags);
    JS_FreeValue(ctx, obj);
    if (!out) {
        fprintf(stderr, "qjs-compile: JS_WriteObject failed\n");
        JS_FreeContext(ctx);
        JS_FreeRuntime(rt);
        return 1;
    }

    FILE *of = fopen(argv[2], "wb");
    if (!of || fwrite(out, 1, out_len, of) != out_len) {
        fprintf(stderr, "qjs-compile: cannot write %s\n", argv[2]);
        if (of) fclose(of);
        js_free(ctx, out);
        JS_FreeContext(ctx);
        JS_FreeRuntime(rt);
        return 2;
    }
    fclose(of);
    js_free(ctx, out);

    // The version stamp is the human-readable answer to "which engine is this
    // bytecode for?" — it must equal the vendored quickjs-ng (see VERSION.md).
    fprintf(stderr, "qjs-compile: %s (%zu B) -> %s (%zu B) [quickjs-ng %s]\n",
            argv[1], src_len, argv[2], out_len, JS_GetVersion());

    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
    return 0;
}
