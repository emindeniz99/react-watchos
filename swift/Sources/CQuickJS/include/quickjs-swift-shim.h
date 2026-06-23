// Swift-friendly wrappers for QuickJS macros Swift cannot import.
// Used as the watch target's bridging header (see project README).
#ifndef QUICKJS_SWIFT_SHIM_H
#define QUICKJS_SWIFT_SHIM_H

#include "quickjs.h"

static inline JSValue qjs_undefined(void) { return JS_UNDEFINED; }
static inline JSValue qjs_null(void) { return JS_NULL; }
static inline int qjs_eval_type_global(void) { return JS_EVAL_TYPE_GLOBAL; }
static inline int qjs_read_obj_bytecode(void) { return JS_READ_OBJ_BYTECODE; }

// Numeric/bool value constructors. QuickJS declares these js_force_inline,
// which Swift cannot import, so expose thin wrappers for JSRuntime.swift.
static inline JSValue qjs_new_bool(JSContext *ctx, bool val) { return JS_NewBool(ctx, val); }
static inline JSValue qjs_new_int32(JSContext *ctx, int32_t val) { return JS_NewInt32(ctx, val); }
static inline JSValue qjs_new_int64(JSContext *ctx, int64_t val) { return JS_NewInt64(ctx, val); }
static inline JSValue qjs_new_float64(JSContext *ctx, double val) { return JS_NewFloat64(ctx, val); }

#endif
