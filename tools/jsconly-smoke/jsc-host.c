/*
 * EXPERIMENT (see README.md in this directory) — the JavaScriptCore twin of
 * tools/embed-smoke/embed-host.c.
 *
 * Same bundle, same host surface, same assertions, different engine. Where
 * embed-host.c calls quickjs-ng's C API, this file calls JSC's
 * (<JavaScriptCore/JavaScript.h>): JSGlobalContextCreate, JSEvaluateScript,
 * JSObjectMakeFunctionWithCallback, JSValueToStringCopy. Nothing in
 * tools/embed-smoke is modified — that host stays the baseline every gate uses.
 *
 * Why a second host at all, when the PrimJS experiment could reuse the repo's
 * unmodified ones: PrimJS advertises a QuickJS-shaped API and a ~90-line
 * rename bridge was enough. JSC shares no vocabulary with QuickJS — different
 * types, different ownership model (autoreleasing JSValueRef vs refcounted
 * JSValue), exceptions returned through an out-parameter rather than a
 * sentinel value. There is no bridge to write; the embedding is a rewrite.
 * That is itself a finding, and ADAPTER.md §1 costs it out.
 *
 * The four assertions this proves are NOT here: they live in
 * ./smoke-epilogue.js, which is byte-for-byte the epilogue embedded in
 * embed-host.c and which BOTH hosts evaluate via embed-host.c's existing
 * optional-epilogue argument. One file, two engines — so neither side can be
 * measured against a different smoke test.
 *
 * usage: jsc-host [--parse-only] <bundle.js> <epilogue.js>
 *
 *   default      install __host, evaluate the bundle, run the epilogue,
 *                print the smoke JSON on stdout and [mem]/[boot] on stderr
 *   --parse-only time JSCheckScriptSyntax alone and exit; see the note on
 *                the [boot] line below for why this needs its own run
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <time.h>
#include <JavaScriptCore/JavaScript.h>
/* NOT part of the public C API. JSGetMemoryUsageStatistics is the only
 * engine-side heap number JSC exposes to a C embedder, and it lives in a
 * PRIVATE header — on Apple platforms that makes it SPI, which is why
 * fetch-and-build.sh copies this one header out deliberately and separately.
 * embed-smoke's 6 MB budget gate is built on quickjs-ng's PUBLIC
 * JS_ComputeMemoryUsage; porting that gate to JSC means depending on SPI.
 * See README.md "Stage 3 — memory" and ADAPTER.md §3. */
#include <JavaScriptCore/JSBasePrivate.h>

/* ---- small conveniences over the C API -------------------------------- */

/* JSC has no "make a JSStringRef and forget it" — every JSStringRef is
 * refcounted and must be released, including the ones that only exist to name
 * a property. These two wrappers keep the release paired with the create at
 * every call site below. */
static JSStringRef s_new(const char *utf8) {
    return JSStringCreateWithUTF8CString(utf8);
}

static void set_prop(JSContextRef ctx, JSObjectRef object, const char *name,
                     JSValueRef value) {
    JSStringRef key = s_new(name);
    JSObjectSetProperty(ctx, object, key, value, kJSPropertyAttributeNone, NULL);
    JSStringRelease(key);
}

static JSValueRef get_prop(JSContextRef ctx, JSObjectRef object, const char *name) {
    JSStringRef key = s_new(name);
    JSValueRef value = JSObjectGetProperty(ctx, object, key, NULL);
    JSStringRelease(key);
    return value;
}

/* Copies a JSValue out as UTF-8. Caller frees. JSC keeps strings as UTF-16
 * internally, so every crossing costs a transcode — unlike quickjs-ng, whose
 * JS_ToCString hands back the engine's own bytes for an ASCII string. */
static char *to_utf8(JSContextRef ctx, JSValueRef value) {
    JSStringRef s = JSValueToStringCopy(ctx, value, NULL);
    if (!s) return NULL;
    size_t max = JSStringGetMaximumUTF8CStringSize(s);
    char *buf = malloc(max);
    if (buf) JSStringGetUTF8CString(s, buf, max);
    JSStringRelease(s);
    return buf;
}

static void install_function(JSContextRef ctx, JSObjectRef object, const char *name,
                             JSObjectCallAsFunctionCallback callback) {
    JSStringRef fname = s_new(name);
    JSObjectRef fn = JSObjectMakeFunctionWithCallback(ctx, fname, callback);
    JSObjectSetProperty(ctx, object, fname, fn, kJSPropertyAttributeNone, NULL);
    JSStringRelease(fname);
}

/* ---- the __host mock, mirroring embed-host.c one for one --------------- */

static void push_to_global_array(JSContextRef ctx, const char *name, JSValueRef value) {
    JSObjectRef global = JSContextGetGlobalObject(ctx);
    JSObjectRef arr = JSValueToObject(ctx, get_prop(ctx, global, name), NULL);
    if (!arr) return;
    double len = JSValueToNumber(ctx, get_prop(ctx, arr, "length"), NULL);
    JSObjectSetPropertyAtIndex(ctx, arr, (unsigned)len, value, NULL);
}

static JSValueRef host_commit(JSContextRef ctx, JSObjectRef fn, JSObjectRef self,
                              size_t argc, const JSValueRef argv[], JSValueRef *exc) {
    (void)fn; (void)self; (void)exc;
    if (argc > 0) push_to_global_array(ctx, "__commits", argv[0]);
    return JSValueMakeUndefined(ctx);
}

static JSValueRef host_log(JSContextRef ctx, JSObjectRef fn, JSObjectRef self,
                           size_t argc, const JSValueRef argv[], JSValueRef *exc) {
    (void)fn; (void)self; (void)exc;
    if (argc > 0) {
        char *s = to_utf8(ctx, argv[0]);
        if (s) {
            fprintf(stderr, "[js] %s\n", s);
            free(s);
        }
    }
    return JSValueMakeUndefined(ctx);
}

static JSValueRef host_set_timer(JSContextRef ctx, JSObjectRef fn, JSObjectRef self,
                                 size_t argc, const JSValueRef argv[], JSValueRef *exc) {
    (void)fn; (void)self; (void)exc;
    if (argc > 0) push_to_global_array(ctx, "__timers", argv[0]);
    return JSValueMakeUndefined(ctx);
}

/* clearTimer and publishWidgets are no-ops on the quickjs side too — the smoke
 * asserts nothing about them, but the bundle calls them at load. */
static JSValueRef host_noop(JSContextRef ctx, JSObjectRef fn, JSObjectRef self,
                            size_t argc, const JSValueRef argv[], JSValueRef *exc) {
    (void)fn; (void)self; (void)argc; (void)argv; (void)exc;
    return JSValueMakeUndefined(ctx);
}

/* ---- io --------------------------------------------------------------- */

static char *read_file(const char *path, size_t *out_len) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *buf = malloc((size_t)len + 1);
    if (!buf || fread(buf, 1, (size_t)len, f) != (size_t)len) {
        fclose(f);
        free(buf);
        return NULL;
    }
    buf[len] = '\0';
    fclose(f);
    *out_len = (size_t)len;
    return buf;
}

static double ms_since(struct timespec a, struct timespec b) {
    return (double)(b.tv_sec - a.tv_sec) * 1000.0
           + (double)(b.tv_nsec - a.tv_nsec) / 1.0e6;
}

/* Prints an exception the way embed-host.c does: the message, on stderr. */
static void report(JSContextRef ctx, const char *what, JSValueRef exception) {
    char *msg = exception ? to_utf8(ctx, exception) : NULL;
    fprintf(stderr, "%s: %s\n", what, msg ? msg : "?");
    free(msg);
}

int main(int argc, char **argv) {
    int parse_only = 0;
    int argi = 1;
    if (argi < argc && strcmp(argv[argi], "--parse-only") == 0) {
        parse_only = 1;
        argi++;
    }
    if (argc - argi < (parse_only ? 1 : 2)) {
        fprintf(stderr, "usage: %s [--parse-only] <bundle.js> <epilogue.js>\n", argv[0]);
        return 2;
    }

    size_t len = 0;
    char *bundle = read_file(argv[argi], &len);
    if (!bundle) {
        fprintf(stderr, "cannot read %s\n", argv[argi]);
        return 2;
    }

    JSGlobalContextRef ctx = JSGlobalContextCreate(NULL);
    JSStringRef source = s_new(bundle);
    /* "bundle.js", exactly as embed-host.c names it, so the stack positions
     * the two engines report are directly comparable. */
    JSStringRef source_url = s_new("bundle.js");

    /* PARSE-ONLY MODE, and why it is a separate process rather than a first
     * phase of the normal run.
     *
     * embed-host.c splits the load in two by compiling with
     * JS_EVAL_FLAG_COMPILE_ONLY and evaluating the resulting function.
     * **JSC's public C API has no compile-without-run entry point.** The
     * closest is JSCheckScriptSyntax, which parses and throws the result away
     * — but running it before JSEvaluateScript would populate the VM's
     * SourceProviderCache and make the eval that follows measure a warm parse.
     * So the two numbers are taken from two runs of two fresh VMs, and the
     * [boot] line says which one it is. The consequence for the comparison
     * table: JSC's "load" INCLUDES its parse, and quickjs-ng's "eval" does
     * not. README.md's table states that in the header rather than hiding it
     * behind a subtraction. */
    if (parse_only) {
        JSValueRef exc = NULL;
        struct timespec t0, t1;
        clock_gettime(CLOCK_MONOTONIC, &t0);
        bool ok = JSCheckScriptSyntax(ctx, source, source_url, 1, &exc);
        clock_gettime(CLOCK_MONOTONIC, &t1);
        if (!ok) {
            report(ctx, "parse failed", exc);
            return 1;
        }
        fprintf(stderr, "[boot] parse %.1f ms (JSCheckScriptSyntax)\n", ms_since(t0, t1));
        return 0;
    }

    size_t epilogue_len = 0;
    char *epilogue = read_file(argv[argi + 1], &epilogue_len);
    if (!epilogue) {
        fprintf(stderr, "cannot read %s\n", argv[argi + 1]);
        return 2;
    }

    /* The same five host methods JSRuntime.swift installs and embed-host.c
     * mocks. Nothing here is JSC-specific except the spelling. */
    JSObjectRef global = JSContextGetGlobalObject(ctx);
    JSObjectRef host = JSObjectMake(ctx, NULL, NULL);
    install_function(ctx, host, "commit", host_commit);
    install_function(ctx, host, "log", host_log);
    install_function(ctx, host, "setTimer", host_set_timer);
    install_function(ctx, host, "clearTimer", host_noop);
    install_function(ctx, host, "publishWidgets", host_noop);
    set_prop(ctx, global, "__host", host);
    set_prop(ctx, global, "__commits", JSObjectMakeArray(ctx, 0, NULL, NULL));
    set_prop(ctx, global, "__timers", JSObjectMakeArray(ctx, 0, NULL, NULL));

    /* Cold-start cost, the same window embed-host.c times: parse + compile +
     * eval (which renders the app and commits the first tree). Microtasks are
     * NOT drained by hand here and that is not an omission — JSC drains its
     * microtask queue when the JSLock is released, and every C API entry point
     * takes and releases that lock, so the drain is inside the measured
     * JSEvaluateScript. quickjs-ng makes the embedder call
     * JS_ExecutePendingJob; JSC does it for you. (ADAPTER.md §3 — this is one
     * of the places JSRuntime.swift's explicit job pump would become dead
     * code.) */
    JSValueRef exception = NULL;
    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);
    JSValueRef result = JSEvaluateScript(ctx, source, NULL, source_url, 1, &exception);
    clock_gettime(CLOCK_MONOTONIC, &t1);
    JSStringRelease(source);
    free(bundle);
    if (!result) {
        report(ctx, "bundle threw", exception);
        return 1;
    }
    double load_ms = ms_since(t0, t1);

    JSStringRef epilogue_src = s_new(epilogue);
    JSStringRef epilogue_url = s_new(argv[argi + 1]);
    exception = NULL;
    JSValueRef summary = JSEvaluateScript(ctx, epilogue_src, NULL, epilogue_url, 1, &exception);
    JSStringRelease(epilogue_src);
    JSStringRelease(epilogue_url);
    free(epilogue);
    if (!summary) {
        report(ctx, "epilogue threw", exception);
        return 1;
    }
    char *out = to_utf8(ctx, summary);
    printf("%s\n", out ? out : "?");
    free(out);

    /* JSC's heap accounting, from the private header. Two numbers because they
     * answer different questions and quickjs-ng's single memory_used_size sits
     * between them: heapSize is what the GC currently holds live-plus-garbage,
     * and JSC's GC is generational and lazy, so a forced JSGarbageCollect
     * before reading it is the only way to get a number that means "what this
     * app actually needs". README.md reports both; embed-smoke's budget gate
     * would have to pick one. */
    JSObjectRef stats = JSGetMemoryUsageStatistics(ctx);
    double heap = JSValueToNumber(ctx, get_prop(ctx, stats, "heapSize"), NULL);
    double capacity = JSValueToNumber(ctx, get_prop(ctx, stats, "heapCapacity"), NULL);
    double objects = JSValueToNumber(ctx, get_prop(ctx, stats, "objectCount"), NULL);
    JSGarbageCollect(ctx);
    stats = JSGetMemoryUsageStatistics(ctx);
    double heap_gc = JSValueToNumber(ctx, get_prop(ctx, stats, "heapSize"), NULL);

    struct rusage ru;
    getrusage(RUSAGE_SELF, &ru);
    /* ru_maxrss is KB on Linux, bytes on macOS — same caveat embed-host.c
     * carries, and the reason the repo's gate is on the engine heap and not on
     * RSS. */
    fprintf(stderr,
            "[mem] jsc heap: %.1f MB, after gc: %.1f MB, capacity: %.1f MB, "
            "objects: %.0f, process peak rss: %ld %s\n",
            heap / (1024.0 * 1024.0), heap_gc / (1024.0 * 1024.0),
            capacity / (1024.0 * 1024.0), objects, ru.ru_maxrss,
#ifdef __APPLE__
            "bytes"
#else
            "KB"
#endif
    );
    fprintf(stderr, "[boot] load %.1f ms (parse+eval, one JSEvaluateScript)\n", load_ms);

    JSStringRelease(source_url);
    JSGlobalContextRelease(ctx);
    return 0;
}
