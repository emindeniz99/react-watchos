// Perf evaluation for the bridge rewrite, on the REAL quickjs-ng engine.
// Compares the OLD native->JS path (build a JS source string + JS_Eval, which
// lexes/parses/compiles every call, + JSON.parse in JS) against the NEW path
// (build QuickJS values directly + JS_Call on a cached function), mirroring the
// JSRuntime.swift change. Conservative: the OLD case here builds its JSON with
// snprintf, cheaper than the Swift JSONSerialization it replaces, so the real
// speedup is at least this large.
#include "quickjs-swift-shim.h"
#include <stdio.h>
#include <string.h>
#include <time.h>

static double now_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec * 1e9 + (double)ts.tv_nsec;
}

int main(void) {
    JSRuntime *rt = JS_NewRuntime();
    JSContext *ctx = JS_NewContext(rt);
    JSValue global = JS_GetGlobalObject(ctx);

    // Representative handlers (a 3-field sensor sample, like the 10 Hz motion
    // path). OLD takes a JSON string and JSON.parses it (today's contract);
    // NEW takes the object directly (the new contract).
    const char *setup =
        "globalThis.__sink = 0;"
        "globalThis.__pushOld = function(name, json){"
        "  var p = JSON.parse(json); globalThis.__sink += p.x + p.y + p.z; };"
        "globalThis.__pushNew = function(name, obj){"
        "  globalThis.__sink += obj.x + obj.y + obj.z; };";
    JSValue r = JS_Eval(ctx, setup, strlen(setup), "setup.js",
                        JS_EVAL_TYPE_GLOBAL);
    JS_FreeValue(ctx, r);

    const int N = 100000;

    // OLD: fresh JS source string + JS_Eval every call (compile each time).
    double t0 = now_ns();
    for (int i = 0; i < N; i++) {
        char code[256];
        snprintf(code, sizeof code,
                 "globalThis.__pushOld(\"sensor.motion\", "
                 "\"{\\\"x\\\":%d,\\\"y\\\":%d,\\\"z\\\":%d}\")",
                 i % 10, (i + 1) % 10, (i + 2) % 10);
        JSValue rr = JS_Eval(ctx, code, strlen(code), "push.js",
                             JS_EVAL_TYPE_GLOBAL);
        JS_FreeValue(ctx, rr);
    }
    double t1 = now_ns();

    // NEW: resolve the callback once, then build values + JS_Call each time.
    JSValue pushNew = JS_GetPropertyStr(ctx, global, "__pushNew");
    double t2 = now_ns();
    for (int i = 0; i < N; i++) {
        JSValue name = JS_NewString(ctx, "sensor.motion");
        JSValue obj = JS_NewObject(ctx);
        JS_SetPropertyStr(ctx, obj, "x", qjs_new_int32(ctx, i % 10));
        JS_SetPropertyStr(ctx, obj, "y", qjs_new_int32(ctx, (i + 1) % 10));
        JS_SetPropertyStr(ctx, obj, "z", qjs_new_int32(ctx, (i + 2) % 10));
        JSValue argv[2] = {name, obj};
        JSValue rr = JS_Call(ctx, pushNew, JS_UNDEFINED, 2, argv);
        JS_FreeValue(ctx, name);
        JS_FreeValue(ctx, obj);
        JS_FreeValue(ctx, rr);
    }
    double t3 = now_ns();
    JS_FreeValue(ctx, pushNew);

    double oldNs = (t1 - t0) / N;
    double newNs = (t3 - t2) / N;
    printf("iterations      : %d\n", N);
    printf("OLD eval-string : %8.0f ns/call\n", oldNs);
    printf("NEW JS_Call     : %8.0f ns/call\n", newNs);
    printf("speedup         : %8.1fx\n", oldNs / newNs);

    JSValue sink = JS_GetPropertyStr(ctx, global, "__sink");
    double s = 0;
    JS_ToFloat64(ctx, &s, sink);
    JS_FreeValue(ctx, sink);
    printf("(sink=%.0f, both paths executed)\n", s);

    JS_FreeValue(ctx, global);
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
    return 0;
}
