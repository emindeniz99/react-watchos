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
// The on-device write policy for the OTA bytecode cache
// (JSRuntime.compileToBytecode), and it is deliberately the SAME policy the
// build-time compiler uses on the shipped bundle — see the long comment in
// tools/qjs-compile/qjs-compile.c, which is the other half of this decision.
// Keep the two in step: they serialize the same engine for the same reader
// (JS_ReadObject + JS_EvalFunction), so a divergence is a silent regression on
// one path only.
//
// STRIP_SOURCE, because carrying the source text in the blob is pure cost on
// the watch. Measured on the real minified app bundle (201,829 B of JS)
// through this exact path: the blob goes 908,332 -> 252,952 B (-655,380 B,
// 3.6x) and the QuickJS heap right after JS_ReadObject goes
// 1,273,294 -> 618,293 B (-655,001 B, -51%), with deserialize 1.49 -> 1.17 ms
// (median of 21). The OTA cache is written per applied bundle and kept in
// flash next to its record, so before this the watch paid that 652 KB twice —
// once on disk, once in the heap of the platform where memory is the first
// wall. It buys nothing back: stacks are byte-identical either way (positions
// come from the debug tables, not the text), only
// Function.prototype.toString goes sourceless, and nothing on the watch reads
// it.
//
// NOT STRIP_DEBUG — the name says "strip source" and stops there on purpose.
// Dropping the per-opcode line/column tables turns every production frame into
// `at fn (<null>:0:1)`, which no source map can resolve after the fact;
// js/test/qbc-symbolication.test.ts guards that end of the policy for the
// build tool; RuntimeSmokeTests guards it here (the stack assertion in
// testCompileToBytecodeStripsSourceButKeepsStackPositions).
static inline int qjs_write_obj_bytecode_strip_source(void) {
    return JS_WRITE_OBJ_BYTECODE | JS_WRITE_OBJ_STRIP_SOURCE;
}
// Opaque identity of a JSValue (a promise, for the rejection tracker) as a
// bare pointer, for use as a dictionary key — never dereferenced.
static inline const void *qjs_value_get_ptr(JSValue v) { return JS_VALUE_GET_PTR(v); }

// The two inputs JSRuntime needs to size the engine's stack-overflow guard to
// the thread an entry actually runs on (JS_SetMaxStackSize is relative to the
// SP JS_UpdateStackTop recorded, so the size must be measured from the same
// place): the current SP, taken the way quickjs.c's js_get_stack_pointer
// takes it, and the current thread's stack floor (lowest valid address), 0
// when the platform can't say. In C rather than Swift because glibc hides
// pthread_getattr_np behind _GNU_SOURCE, which Swift's Glibc import does not
// define; the prototype is restated below so the Linux (CI) build sees it.
static inline uintptr_t qjs_stack_pointer(void) {
    return (uintptr_t)__builtin_frame_address(0);
}
#if defined(__APPLE__)
#include <pthread.h>
static inline uintptr_t qjs_thread_stack_floor(void) {
    pthread_t self = pthread_self();
    return (uintptr_t)pthread_get_stackaddr_np(self) - pthread_get_stacksize_np(self);
}
#elif defined(__linux__)
#include <pthread.h>
extern int pthread_getattr_np(pthread_t, pthread_attr_t *);
static inline uintptr_t qjs_thread_stack_floor(void) {
    pthread_attr_t attr;
    void *addr;
    size_t size;
    if (pthread_getattr_np(pthread_self(), &attr) != 0) return 0;
    int rc = pthread_attr_getstack(&attr, &addr, &size);
    pthread_attr_destroy(&attr);
    return rc == 0 ? (uintptr_t)addr : 0;
}
#else
static inline uintptr_t qjs_thread_stack_floor(void) { return 0; }
#endif

#endif
