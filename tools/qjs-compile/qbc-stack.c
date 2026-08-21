/*
 * Runs a .qbc through the PRODUCTION load path and prints the Error.stack of
 * whatever it throws.
 *
 * Why this exists as its own tiny host rather than a flag on embed-host.c:
 * embed-host asserts a healthy boot (it installs __host, drives an
 * interaction, and treats a throw as failure). The question here is the exact
 * opposite — "when shipped bytecode throws, what positions does the engine
 * report?" — and that is the only question this file answers. It is the middle
 * of the chain js/test/qbc-symbolication.test.ts proves end to end: the .qbc
 * comes from the real qjs-compile, the stack printed here is fed straight into
 * the shipped symbolicator (js/scripts/symbolicate-core.ts) and resolved back
 * to the .tsx it was built from.
 *
 * The load sequence is JS_ReadObject + JS_EvalFunction — byte for byte what
 * JSRuntime.evaluateBytecode does on the watch, and NOT the source parser, so
 * the positions printed are the ones a real on-wrist crash would carry. That
 * is the whole point: with JS_WRITE_OBJ_STRIP_DEBUG (which qjs-compile.c
 * deliberately no longer passes) every frame here reads `<null>:0:1`.
 *
 * No __host bridge is installed: the fixture throws at module scope, so it
 * never reaches anything that would need one. Keeping the host empty also
 * keeps this file from quietly becoming a second embed-host.
 *
 * usage: qbc-stack <bundle.qbc>
 * stdout: the thrown error's message, then its `stack` (one frame per line)
 * exit:   0 when it threw (the expected case), 1 when it did NOT throw or the
 *         bytecode could not be read — a silent pass here would make the test
 *         that reads this output vacuous.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "quickjs.h"

static uint8_t *read_file(const char *path, size_t *out_len) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t *buf = malloc((size_t)len + 1);
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

/* Prints a JSValue as a line of stdout; frees the value and the C string. */
static void print_value(JSContext *ctx, JSValue value) {
    const char *s = JS_ToCString(ctx, value);
    printf("%s\n", s ? s : "?");
    JS_FreeCString(ctx, s);
    JS_FreeValue(ctx, value);
}

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: %s <bundle.qbc>\n", argv[0]);
        return 1;
    }
    size_t len = 0;
    uint8_t *blob = read_file(argv[1], &len);
    if (!blob) {
        fprintf(stderr, "qbc-stack: cannot read %s\n", argv[1]);
        return 1;
    }

    JSRuntime *rt = JS_NewRuntime();
    JSContext *ctx = JS_NewContext(rt);

    JSValue fn = JS_ReadObject(ctx, blob, len, JS_READ_OBJ_BYTECODE);
    free(blob);
    if (JS_IsException(fn)) {
        JSValue exc = JS_GetException(ctx);
        const char *msg = JS_ToCString(ctx, exc);
        fprintf(stderr, "qbc-stack: JS_ReadObject failed: %s\n", msg ? msg : "?");
        JS_FreeCString(ctx, msg);
        JS_FreeValue(ctx, exc);
        JS_FreeValue(ctx, fn);
        JS_FreeContext(ctx);
        JS_FreeRuntime(rt);
        return 1;
    }

    JSValue result = JS_EvalFunction(ctx, fn);
    if (!JS_IsException(result)) {
        JS_FreeValue(ctx, result);
        fprintf(stderr, "qbc-stack: %s ran without throwing — the fixture is "
                        "supposed to throw, so there is no stack to report\n",
                argv[1]);
        JS_FreeContext(ctx);
        JS_FreeRuntime(rt);
        return 1;
    }
    JS_FreeValue(ctx, result);

    JSValue exc = JS_GetException(ctx);
    print_value(ctx, JS_DupValue(ctx, exc));
    /* quickjs-ng puts the frames in `.stack` WITHOUT the message header, the
     * same string JSRuntime.swift reads when it reports a `js.eval`
     * diagnostic — print it verbatim so the test parses exactly what the
     * watch would have logged. */
    print_value(ctx, JS_GetPropertyStr(ctx, exc, "stack"));
    JS_FreeValue(ctx, exc);

    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
    return 0;
}
