/*
 * EXPERIMENT (tools/primjs-smoke/README.md) — the thinnest possible bridge that
 * lets this repo's UNMODIFIED C hosts (tools/embed-smoke/embed-host.c,
 * tools/vendored-qjs/main.c, tools/qjs-compile/qjs-compile.c) compile and link
 * against Lynx's PrimJS instead of the vendored quickjs-ng.
 *
 * Nothing in the repo's own build ever sees this file: it is selected by
 * putting THIS directory ahead of PrimJS's include directory on the compiler's
 * search path, so `#include "quickjs.h"` lands here first and `#include_next`
 * continues on to PrimJS's real header. The hosts keep saying `JS_Eval`; PrimJS
 * hears `LEPUS_Eval`.
 *
 * The file's real product is not the aliases — it is the CENSUS. PrimJS
 * advertises a "QuickJS-compatible C API"; the aliases below are the exact
 * price of that word "compatible", and each section is a row in the
 * compatibility table in README.md. Read the comments as findings, not as
 * apologies for a workaround.
 */
#ifndef PRIMJS_SMOKE_COMPAT_QUICKJS_H
#define PRIMJS_SMOKE_COMPAT_QUICKJS_H

/* GAP 1 — PrimJS's quickjs.h is not self-contained for a C translation unit.
 * It declares `bool` parameters and returns `false` from a static inline
 * (LEPUS_VALUE_IS_NAN, LEPUS_IsGCMode, LEPUS_SetGCPauseSuppressionMode, ~12
 * declarations in all) without ever including <stdbool.h>. It compiles only
 * because every one of PrimJS's own translation units is C++ (quickjs.cc), where
 * `bool` is a keyword. quickjs-ng includes <stdbool.h> itself. Any C embedder
 * hits this on line one, so the include has to come BEFORE the real header. */
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include_next "quickjs.h"

/* GAP 2 — the header hijacks printf. PrimJS's quickjs.h ends its DEBUG_MEMORY
 * block with a bare `#else / #define printf(...)`, so unless the embedder
 * happens to build with -DDEBUG_MEMORY, every printf in every file that
 * includes quickjs.h expands to NOTHING. This is silent: no warning, no link
 * error, just a program that stops writing to stdout. embed-host.c prints its
 * whole JSON result document with printf, so without this #undef the PrimJS
 * host runs the bundle correctly and reports absolutely nothing. Of everything
 * in this file, this is the one that would cost a real embedder an afternoon. */
#undef printf

/* GAP 3 — the wholesale rename. PrimJS carries the QuickJS API shape but not
 * its spelling: every public type and function is LEPUS_*, a Lynx-era fork of
 * the name (LEPUS is Lynx's scripting layer). Nothing here changes behaviour;
 * it is a pure vocabulary translation, and it is mechanical enough that this
 * whole block was written by reading one header. Note the inconsistency:
 * JSAtom, JSString and JSMapRecord kept their JS_ spelling, so the rename is
 * not even total. */
#define JSRuntime LEPUSRuntime
#define JSContext LEPUSContext
#define JSValue LEPUSValue
#define JSValueConst LEPUSValueConst
#define JSObject LEPUSObject
#define JSClassID LEPUSClassID
#define JSMemoryUsage LEPUSMemoryUsage
#define JSCFunction LEPUSCFunction
#define JSModuleDef LEPUSModuleDef

#define JS_UNDEFINED LEPUS_UNDEFINED
#define JS_NULL LEPUS_NULL
#define JS_TRUE LEPUS_TRUE
#define JS_FALSE LEPUS_FALSE
#define JS_EXCEPTION LEPUS_EXCEPTION

#define JS_EVAL_TYPE_GLOBAL LEPUS_EVAL_TYPE_GLOBAL
#define JS_EVAL_TYPE_MODULE LEPUS_EVAL_TYPE_MODULE
#define JS_EVAL_FLAG_STRICT LEPUS_EVAL_FLAG_STRICT
#define JS_EVAL_FLAG_COMPILE_ONLY LEPUS_EVAL_FLAG_COMPILE_ONLY

#define JS_READ_OBJ_BYTECODE LEPUS_READ_OBJ_BYTECODE
#define JS_READ_OBJ_ROM_DATA LEPUS_READ_OBJ_ROM_DATA
#define JS_WRITE_OBJ_BYTECODE LEPUS_WRITE_OBJ_BYTECODE
#define JS_WRITE_OBJ_BSWAP LEPUS_WRITE_OBJ_BSWAP

#define JS_NewRuntime LEPUS_NewRuntime
#define JS_FreeRuntime LEPUS_FreeRuntime
#define JS_NewContext LEPUS_NewContext
#define JS_FreeContext LEPUS_FreeContext
#define JS_GetRuntime LEPUS_GetRuntime
#define JS_SetMemoryLimit LEPUS_SetMemoryLimit
#define JS_SetMaxStackSize LEPUS_SetMaxStackSize
#define JS_RunGC LEPUS_RunGC

#define JS_GetGlobalObject LEPUS_GetGlobalObject
#define JS_NewObject LEPUS_NewObject
#define JS_NewArray LEPUS_NewArray
#define JS_NewCFunction LEPUS_NewCFunction
#define JS_NewCFunction2 LEPUS_NewCFunction2
#define JS_NewString LEPUS_NewString
#define JS_NewInt32 LEPUS_NewInt32
#define JS_NewBool LEPUS_NewBool

#define JS_GetPropertyStr LEPUS_GetPropertyStr
#define JS_SetPropertyStr LEPUS_SetPropertyStr
#define JS_SetPropertyUint32 LEPUS_SetPropertyUint32
#define JS_GetPropertyUint32 LEPUS_GetPropertyUint32

#define JS_FreeValue LEPUS_FreeValue
#define JS_FreeValueRT LEPUS_FreeValueRT
#define JS_DupValue LEPUS_DupValue
#define JS_ToCString LEPUS_ToCString
#define JS_ToCStringLen LEPUS_ToCStringLen
#define JS_FreeCString LEPUS_FreeCString
#define JS_ToInt32 LEPUS_ToInt32
#define JS_ToFloat64 LEPUS_ToFloat64

#define JS_IsException LEPUS_IsException
#define JS_IsUndefined LEPUS_IsUndefined
#define JS_IsNull LEPUS_IsNull
#define JS_IsString LEPUS_IsString
#define JS_IsObject LEPUS_IsObject
#define JS_GetException LEPUS_GetException
#define JS_Throw LEPUS_Throw
#define JS_Call LEPUS_Call

#define JS_Eval LEPUS_Eval
#define JS_ExecutePendingJob LEPUS_ExecutePendingJob
#define JS_IsJobPending LEPUS_IsJobPending
#define JS_ReadObject LEPUS_ReadObject
#define JS_WriteObject LEPUS_WriteObject
#define JS_ComputeMemoryUsage LEPUS_ComputeMemoryUsage

/* GAP 4 — js_free is lepus_free. Same contract (free a buffer the engine
 * allocated, e.g. JS_WriteObject's), different name. */
#define js_free lepus_free

/* GAP 5 — JS_EvalFunction changed ARITY, not just its name. quickjs-ng:
 *     JSValue JS_EvalFunction(JSContext *ctx, JSValue fun_obj);
 * PrimJS keeps Bellard's older three-argument form, which still takes an
 * explicit `this`:
 *     LEPUSValue LEPUS_EvalFunction(LEPUSContext *, LEPUSValue, LEPUSValueConst);
 * A #define cannot alias across an arity change, so this is a function-like
 * macro that supplies the `this` quickjs-ng bakes in. This is the first gap a
 * mechanical rename would NOT have caught — every call site needs editing, and
 * a real port would have to decide the value per site rather than assume
 * undefined. It matters here because JS_EvalFunction is the SHIPPED bytecode
 * boot path (JSRuntime.evaluateBytecode). */
#define JS_EvalFunction(ctx, fun_obj) \
    LEPUS_EvalFunction((ctx), (fun_obj), LEPUS_UNDEFINED)

/* GAP 6 — the two write flags our bytecode pipeline depends on DO NOT EXIST.
 * quickjs-ng offers four JS_WRITE_OBJ_* flags; PrimJS offers the two Bellard
 * shipped in 2019 (BYTECODE, BSWAP). Missing:
 *
 *   JS_WRITE_OBJ_STRIP_SOURCE — tools/qjs-compile passes this UNCONDITIONALLY.
 *     Without it the source text is serialized into the blob. On our bundle
 *     quickjs-ng measured 250 KB with the flag vs 903 KB without (see the long
 *     comment in qjs-compile.c), so its absence is not cosmetic: it is a ~3.6x
 *     .qbc size regression on an artifact that ships in the app binary.
 *   JS_WRITE_OBJ_STRIP_DEBUG — the opt-in `--strip-debug` escape hatch. Less
 *     load-bearing (we deliberately leave it off), but a consumer who wanted
 *     the 45 KB back would have no way to ask for it.
 *
 * Defined to 0 so the hosts compile; the measurement in README.md reports the
 * resulting blob size, which is the honest number for what PrimJS can produce. */
#define JS_WRITE_OBJ_STRIP_SOURCE 0
#define JS_WRITE_OBJ_STRIP_DEBUG 0

/* GAP 7 — no JS_GetVersion. quickjs-ng exposes the engine version as a string
 * and tools/qjs-compile stamps it into the build log so a .qbc can be traced to
 * the engine that wrote it (VERSION.md). PrimJS has LEPUS_GetPrimjsVersion(),
 * which returns a packed uint64 with no documented layout, so the equivalent
 * stamp has to be synthesized. */
static inline const char *JS_GetVersion(void) {
    static char buf[48];
    unsigned long long v = (unsigned long long)LEPUS_GetPrimjsVersion();
    snprintf(buf, sizeof buf, "primjs %llu.%llu.%llu", (v >> 16) & 0xff,
             (v >> 8) & 0xff, v & 0xff);
    return buf;
}

#endif /* PRIMJS_SMOKE_COMPAT_QUICKJS_H */
