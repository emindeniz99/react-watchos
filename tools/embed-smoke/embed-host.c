/*
 * Reference embedding of the production bundle in QuickJS via the C API —
 * the exact call sequence JSRuntime.swift performs on the watch:
 *
 *   1. install __host.{commit,log,setTimer,clearTimer} as C functions
 *   2. JS_Eval the bundle (renders the app, commits the first tree)
 *   3. drain pending jobs (microtasks)
 *   4. call __dispatchEvent / __fireTimer for interactions and timers
 *
 * Run with ./run.sh. Keeps committed trees in a JS-side array purely for
 * inspection; on the watch each commit is decoded into SwiftUI state.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "quickjs.h"

static void push_to_global_array(JSContext *ctx, const char *name, JSValueConst value) {
    JSValue global = JS_GetGlobalObject(ctx);
    JSValue arr = JS_GetPropertyStr(ctx, global, name);
    JSValue lenv = JS_GetPropertyStr(ctx, arr, "length");
    int32_t len = 0;
    JS_ToInt32(ctx, &len, lenv);
    JS_FreeValue(ctx, lenv);
    JS_SetPropertyUint32(ctx, arr, (uint32_t)len, JS_DupValue(ctx, value));
    JS_FreeValue(ctx, arr);
    JS_FreeValue(ctx, global);
}

static JSValue host_commit(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    (void)this_val;
    if (argc > 0) push_to_global_array(ctx, "__commits", argv[0]);
    return JS_UNDEFINED;
}

static JSValue host_log(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    (void)this_val;
    if (argc > 0) {
        const char *s = JS_ToCString(ctx, argv[0]);
        if (s) {
            fprintf(stderr, "[js] %s\n", s);
            JS_FreeCString(ctx, s);
        }
    }
    return JS_UNDEFINED;
}

static JSValue host_set_timer(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    (void)this_val;
    if (argc > 0) push_to_global_array(ctx, "__timers", argv[0]);
    return JS_UNDEFINED;
}

static JSValue host_clear_timer(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    (void)ctx; (void)this_val; (void)argc; (void)argv;
    return JS_UNDEFINED;
}

static void drain_jobs(JSRuntime *rt) {
    JSContext *ctx;
    while (JS_ExecutePendingJob(rt, &ctx) > 0)
        ;
}

static char *read_file(const char *path, size_t *out_len) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *buf = malloc((size_t)len + 1);
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

static const char *epilogue =
    "(() => {\n"
    "  while (__timers.length > 0) globalThis.__fireTimer(__timers.shift());\n"
    "  const findAll = (node, type, out = []) => {\n"
    "    if (node.type === type) out.push(node);\n"
    "    for (const c of node.children) findAll(c, type, out);\n"
    "    return out;\n"
    "  };\n"
    "  const initial = JSON.parse(__commits[__commits.length - 1]);\n"
    "  const plus = findAll(initial.root, 'Button')[1];\n"
    "  const handled = globalThis.__dispatchEvent(plus.id, 'press');\n"
    "  const after = JSON.parse(__commits[__commits.length - 1]);\n"
    "  return JSON.stringify({\n"
    "    handled,\n"
    "    initialCount: findAll(initial.root, 'Text')[1].props.text,\n"
    "    countAfterPress: findAll(after.root, 'Text')[1].props.text,\n"
    "  });\n"
    "})()";

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: %s <bundle.js>\n", argv[0]);
        return 2;
    }
    size_t len = 0;
    char *bundle = read_file(argv[1], &len);
    if (!bundle) {
        fprintf(stderr, "cannot read %s\n", argv[1]);
        return 2;
    }

    JSRuntime *rt = JS_NewRuntime();
    JSContext *ctx = JS_NewContext(rt);

    JSValue global = JS_GetGlobalObject(ctx);
    JSValue host = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, host, "commit", JS_NewCFunction(ctx, host_commit, "commit", 1));
    JS_SetPropertyStr(ctx, host, "log", JS_NewCFunction(ctx, host_log, "log", 1));
    JS_SetPropertyStr(ctx, host, "setTimer", JS_NewCFunction(ctx, host_set_timer, "setTimer", 2));
    JS_SetPropertyStr(ctx, host, "clearTimer", JS_NewCFunction(ctx, host_clear_timer, "clearTimer", 1));
    JS_SetPropertyStr(ctx, global, "__host", host);
    JS_SetPropertyStr(ctx, global, "__commits", JS_NewArray(ctx));
    JS_SetPropertyStr(ctx, global, "__timers", JS_NewArray(ctx));
    JS_FreeValue(ctx, global);

    JSValue result = JS_Eval(ctx, bundle, len, "bundle.js", JS_EVAL_TYPE_GLOBAL);
    free(bundle);
    if (JS_IsException(result)) {
        JSValue exc = JS_GetException(ctx);
        const char *msg = JS_ToCString(ctx, exc);
        fprintf(stderr, "bundle threw: %s\n", msg ? msg : "?");
        return 1;
    }
    JS_FreeValue(ctx, result);
    drain_jobs(rt);

    JSValue summary = JS_Eval(ctx, epilogue, strlen(epilogue), "epilogue.js", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(summary)) {
        JSValue exc = JS_GetException(ctx);
        const char *msg = JS_ToCString(ctx, exc);
        fprintf(stderr, "epilogue threw: %s\n", msg ? msg : "?");
        return 1;
    }
    drain_jobs(rt);
    const char *out = JS_ToCString(ctx, summary);
    printf("%s\n", out);
    JS_FreeCString(ctx, out);
    JS_FreeValue(ctx, summary);

    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
    return 0;
}
