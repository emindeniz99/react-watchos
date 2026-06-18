// Swift-friendly wrappers for QuickJS macros Swift cannot import.
// Used as the watch target's bridging header (see project README).
#ifndef QUICKJS_SWIFT_SHIM_H
#define QUICKJS_SWIFT_SHIM_H

#include "quickjs.h"

static inline JSValue qjs_undefined(void) { return JS_UNDEFINED; }
static inline JSValue qjs_null(void) { return JS_NULL; }
static inline int qjs_eval_type_global(void) { return JS_EVAL_TYPE_GLOBAL; }
static inline int qjs_read_obj_bytecode(void) { return JS_READ_OBJ_BYTECODE; }

#endif
