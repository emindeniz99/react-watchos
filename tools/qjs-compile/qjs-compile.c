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
 * usage: qjs-compile <bundle.js> <out.qbc>
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "quickjs.h"

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
    if (argc < 3) {
        fprintf(stderr, "usage: %s <bundle.js> <out.qbc>\n", argv[0]);
        return 2;
    }
    size_t src_len = 0;
    char *src = read_file(argv[1], &src_len);
    if (!src) {
        fprintf(stderr, "qjs-compile: cannot read %s\n", argv[1]);
        return 2;
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

    // Strip source text + debug line info: the shipped .qbc is the optimized
    // production artifact, while the dev/source path stays on bundle.js (which
    // keeps readable watch-side stack traces). Stripping drops the embedded
    // copy of the source, keeping the blob from dwarfing the bundle it encodes.
    size_t out_len = 0;
    uint8_t *out = JS_WriteObject(
        ctx, &out_len, obj,
        JS_WRITE_OBJ_BYTECODE | JS_WRITE_OBJ_STRIP_SOURCE |
            JS_WRITE_OBJ_STRIP_DEBUG);
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
