// Swift-friendly wrappers for QuickJS macros Swift cannot import.
// Used as the watch target's bridging header (see project README).
#ifndef QUICKJS_SWIFT_SHIM_H
#define QUICKJS_SWIFT_SHIM_H

#include "quickjs.h"

static inline JSValue qjs_undefined(void) { return JS_UNDEFINED; }
static inline JSValue qjs_null(void) { return JS_NULL; }
static inline int qjs_eval_type_global(void) { return JS_EVAL_TYPE_GLOBAL; }
static inline int qjs_read_obj_bytecode(void) { return JS_READ_OBJ_BYTECODE; }
// Compile a global script without running it (returns a function object to be
// serialized with JS_WriteObject / run with JS_EvalFunction).
static inline int qjs_eval_flag_compile_only(void) {
    return JS_EVAL_TYPE_GLOBAL | JS_EVAL_FLAG_COMPILE_ONLY;
}
static inline int qjs_write_obj_bytecode(void) { return JS_WRITE_OBJ_BYTECODE; }
// Opaque identity of a JSValue (a promise, for the rejection tracker) as a
// bare pointer, for use as a dictionary key — never dereferenced.
static inline const void *qjs_value_get_ptr(JSValue v) { return JS_VALUE_GET_PTR(v); }

#endif
