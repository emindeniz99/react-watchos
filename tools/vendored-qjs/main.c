// A `qjs`-shaped CLI built from the VENDORED quickjs-ng — the engine the watch
// actually runs (js/swift/Sources/CQuickJS, exposed to SwiftPM as a target, so
// the same sources compile for watchOS).
//
// Why this exists at all: the engine gate used to run against whatever `apt-get
// install quickjs` provided, which is Bellard's QuickJS (`qjs --help` reports
// "version 2021-03-27") — a DIFFERENT engine from quickjs-ng 0.16.1. The
// divergence is not cosmetic. Given the same minified bundle:
//
//     apt qjs:        at o (min.js)              <- no name, no line at all
//     vendored ng:    at n (min.js:1:30)         <- line AND column
//
// So the old gate could pass on behaviour the shipped engine does not have, and
// stack-trace work (source maps need the column) looked impossible when it is
// not. Testing the engine we ship is the whole point of the gate.
//
// Deliberately minimal: quickjs-libc.c is NOT vendored (the Swift target has no
// use for `std`/`os`), so this provides only what the smoke harness needs —
// `print` for the result channel and `console.*` for diagnostics. Anything more
// would be inventing a runtime the watch does not have.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "quickjs.h"

static char *read_file(const char *path, size_t *len) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return NULL; }
    long size = ftell(f);
    if (size < 0 || fseek(f, 0, SEEK_SET) != 0) { fclose(f); return NULL; }
    char *buf = malloc((size_t)size + 1);
    if (!buf) { fclose(f); return NULL; }
    if (fread(buf, 1, (size_t)size, f) != (size_t)size) {
        free(buf);
        fclose(f);
        return NULL;
    }
    buf[size] = '\0';
    *len = (size_t)size;
    fclose(f);
    return buf;
}

// Joins the arguments with spaces onto `out`, matching what a caller expects
// from either `print` or `console.log`.
static JSValue write_line(JSContext *ctx, FILE *out, int argc, JSValueConst *argv) {
    for (int i = 0; i < argc; i++) {
        const char *s = JS_ToCString(ctx, argv[i]);
        if (!s) return JS_EXCEPTION;
        fprintf(out, "%s%s", i ? " " : "", s);
        JS_FreeCString(ctx, s);
    }
    fputc('\n', out);
    return JS_UNDEFINED;
}

// `print` owns STDOUT: the smoke harness prints one JSON document with it and
// the test parses stdout whole, so nothing else may write there.
static JSValue js_print(JSContext *ctx, JSValueConst this_val, int argc,
                        JSValueConst *argv) {
    (void)this_val;
    return write_line(ctx, stdout, argc, argv);
}

// `console.*` goes to STDERR for the same reason — a stray log must not corrupt
// the result document. This mirrors the `[js]` convention in
// tools/embed-smoke/embed-host.c.
static JSValue js_console(JSContext *ctx, JSValueConst this_val, int argc,
                          JSValueConst *argv) {
    (void)this_val;
    return write_line(ctx, stderr, argc, argv);
}

static void dump_error(JSContext *ctx) {
    JSValue exception = JS_GetException(ctx);
    const char *message = JS_ToCString(ctx, exception);
    fprintf(stderr, "%s\n", message ? message : "(uncatchable)");
    if (message) JS_FreeCString(ctx, message);

    JSValue stack = JS_GetPropertyStr(ctx, exception, "stack");
    if (!JS_IsUndefined(stack)) {
        const char *trace = JS_ToCString(ctx, stack);
        if (trace) {
            fprintf(stderr, "%s\n", trace);
            JS_FreeCString(ctx, trace);
        }
    }
    JS_FreeValue(ctx, stack);
    JS_FreeValue(ctx, exception);
}

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: %s <script.js>\n", argv[0]);
        return 2;
    }

    size_t len = 0;
    char *source = read_file(argv[1], &len);
    if (!source) {
        fprintf(stderr, "cannot read %s\n", argv[1]);
        return 2;
    }

    JSRuntime *runtime = JS_NewRuntime();
    JSContext *ctx = JS_NewContext(runtime);
    JSValue global = JS_GetGlobalObject(ctx);

    JS_SetPropertyStr(ctx, global, "print",
                      JS_NewCFunction(ctx, js_print, "print", 1));
    JSValue console = JS_NewObject(ctx);
    for (const char *const *name = (const char *const[]){"log", "warn", "error",
                                                         "info", "debug", NULL};
         *name; name++) {
        JS_SetPropertyStr(ctx, console, *name,
                          JS_NewCFunction(ctx, js_console, *name, 1));
    }
    JS_SetPropertyStr(ctx, global, "console", console);
    JS_FreeValue(ctx, global);

    int status = 0;
    JSValue result = JS_Eval(ctx, source, len, argv[1], JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(result)) {
        dump_error(ctx);
        status = 1;
    }
    JS_FreeValue(ctx, result);

    // Drain the microtask queue: a bundle that resolves a promise on the last
    // line has not finished when JS_Eval returns, and a smoke test that exits
    // here would report a tree that was never committed.
    for (;;) {
        JSContext *pending = NULL;
        int more = JS_ExecutePendingJob(runtime, &pending);
        if (more < 0) {
            dump_error(pending ? pending : ctx);
            status = 1;
            break;
        }
        if (more == 0) break;
    }

    JS_FreeContext(ctx);
    JS_FreeRuntime(runtime);
    free(source);
    return status;
}
