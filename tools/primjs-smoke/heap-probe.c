/*
 * EXPERIMENT (see README.md) — answers one question the side-by-side table
 * could not: PrimJS reports a 0.0 MB engine heap, so is our heap number simply
 * unavailable on PrimJS, or is embed-host.c reading the wrong field?
 *
 * embed-smoke's memory budget gate (tools/embed-smoke/run.sh) is built on
 * JS_ComputeMemoryUsage().memory_used_size, deliberately, because it is the one
 * portable engine-side number — peak RSS units differ per platform, so RSS
 * could never be the gate. If that call does not work on a candidate engine,
 * the budget gate does not port, and that is a bigger deal than any timing
 * difference: it is a gate this repo would lose.
 *
 * So this dumps the WHOLE JSMemoryUsage struct plus, on PrimJS, the engine's
 * own LEPUS_GetHeapSize(). It boots the real bundle (same __host mock shape as
 * embed-host.c, minus the assertions) and drains microtasks, so the numbers are
 * comparable to the [mem] line — just without the interaction the epilogue
 * drives, which keeps this file from becoming a second embed-host.
 *
 * usage: heap-probe <bundle.js>
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

static JSValue host_noop(JSContext *ctx, JSValueConst this_val, int argc,
                         JSValueConst *argv) {
    (void)ctx;
    (void)this_val;
    (void)argc;
    (void)argv;
    return JS_UNDEFINED;
}

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: %s <bundle.js>\n", argv[0]);
        return 2;
    }
    size_t len = 0;
    char *src = read_file(argv[1], &len);
    if (!src) {
        fprintf(stderr, "heap-probe: cannot read %s\n", argv[1]);
        return 2;
    }

    JSRuntime *rt = JS_NewRuntime();
    JSContext *ctx = JS_NewContext(rt);
    JSValue global = JS_GetGlobalObject(ctx);
    JSValue host = JS_NewObject(ctx);
    static const char *const methods[] = {"commit", "log", "setTimer",
                                          "clearTimer", "publishWidgets"};
    for (size_t i = 0; i < sizeof methods / sizeof *methods; i++) {
        JS_SetPropertyStr(ctx, host, methods[i],
                          JS_NewCFunction(ctx, host_noop, methods[i], 1));
    }
    JS_SetPropertyStr(ctx, global, "__host", host);
    JS_SetPropertyStr(ctx, global, "__commits", JS_NewArray(ctx));
    JS_SetPropertyStr(ctx, global, "__timers", JS_NewArray(ctx));
    JS_FreeValue(ctx, global);

    JSValue result = JS_Eval(ctx, src, len, "bundle.js", JS_EVAL_TYPE_GLOBAL);
    free(src);
    if (JS_IsException(result)) {
        JSValue exc = JS_GetException(ctx);
        const char *msg = JS_ToCString(ctx, exc);
        fprintf(stderr, "heap-probe: bundle threw: %s\n", msg ? msg : "?");
        return 1;
    }
    JS_FreeValue(ctx, result);
    for (;;) {
        JSContext *pending = NULL;
        if (JS_ExecutePendingJob(rt, &pending) <= 0) break;
    }

    /* memset first: the point of this probe is to tell "the engine wrote 0"
     * apart from "the engine wrote nothing at all", and an uninitialised struct
     * would make every field look like garbage instead of like an untouched
     * zero. embed-host.c passes an uninitialised JSMemoryUsage the same way
     * quickjs-ng's own tools do, which is fine there and not fine here. */
    JSMemoryUsage usage;
    memset(&usage, 0, sizeof usage);
    JS_ComputeMemoryUsage(rt, &usage);
    printf("malloc_size       %lld\n", (long long)usage.malloc_size);
    printf("malloc_count      %lld\n", (long long)usage.malloc_count);
    printf("memory_used_size  %lld\n", (long long)usage.memory_used_size);
    printf("memory_used_count %lld\n", (long long)usage.memory_used_count);
    printf("obj_count         %lld\n", (long long)usage.obj_count);
    printf("str_count         %lld\n", (long long)usage.str_count);
    printf("atom_count        %lld\n", (long long)usage.atom_count);
    printf("shape_count       %lld\n", (long long)usage.shape_count);
#ifdef PRIMJS
    /* PrimJS-only, and the reason this probe is worth keeping: the LEPUS_*
     * heap accounting that DOES work in a default build, plus which memory
     * manager is actually live. LEPUS_IsGCModeRT == 0 means the tracing GC —
     * one of PrimJS's two headline features — is NOT running here. */
    printf("LEPUS_GetHeapSize %llu\n", (unsigned long long)LEPUS_GetHeapSize(rt));
    printf("LEPUS_IsGCModeRT  %d\n", (int)LEPUS_IsGCModeRT(rt));
#endif
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
    return 0;
}
