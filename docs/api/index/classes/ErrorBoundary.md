[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ErrorBoundary

# Class: ErrorBoundary

Defined in: [js/src/errorBoundary.tsx:33](https://github.com/emindeniz99/react-watchos/blob/main/js/src/errorBoundary.tsx#L33)

Catches render/lifecycle errors in its subtree and shows `fallback`
instead of letting the whole app fail (WatchRoot rethrows uncaught
errors). Wrap a screen so one broken screen doesn't take down the rest.
React boundaries don't catch errors in event handlers — those still
surface through the host's onError banner.

The React `componentStack` (which component tree threw) is surfaced to both
`onError` and the function `fallback`, so a dev overlay / remote inspector
can point at the offending component rather than just the error message.

## Extends

- `Component`\<`Props`, `State`\>

## Constructors

### Constructor

> **new ErrorBoundary**(`props`): `ErrorBoundary`

Defined in: [node\_modules/.pnpm/@types+react@19.2.18/node\_modules/@types/react/index.d.ts:958](https://github.com/emindeniz99/react-watchos/blob/main/node_modules/.pnpm/@types+react@19.2.18/node_modules/@types/react/index.d.ts#L958)

#### Parameters

##### props

`Props`

#### Returns

`ErrorBoundary`

#### Inherited from

`Component<Props, State>.constructor`

### Constructor

> **new ErrorBoundary**(`props`, `context`): `ErrorBoundary`

Defined in: [node\_modules/.pnpm/@types+react@19.2.18/node\_modules/@types/react/index.d.ts:966](https://github.com/emindeniz99/react-watchos/blob/main/node_modules/.pnpm/@types+react@19.2.18/node_modules/@types/react/index.d.ts#L966)

#### Parameters

##### props

`Props`

##### context

`any`

value of the parent [Context](https://react.dev/reference/react/Component#context) specified
in `contextType`.

#### Returns

`ErrorBoundary`

#### Inherited from

`Component<Props, State>.constructor`

## Properties

### context

> **context**: `unknown`

Defined in: [node\_modules/.pnpm/@types+react@19.2.18/node\_modules/@types/react/index.d.ts:955](https://github.com/emindeniz99/react-watchos/blob/main/node_modules/.pnpm/@types+react@19.2.18/node_modules/@types/react/index.d.ts#L955)

If using React Context, re-declare this in your class to be the
`React.ContextType` of your `static contextType`.
Should be used with type annotation or static contextType.

#### Example

```ts
static contextType = MyContext
// For TS pre-3.7:
context!: React.ContextType<typeof MyContext>
// For TS 3.7 and above:
declare context: React.ContextType<typeof MyContext>
```

#### See

[React Docs](https://react.dev/reference/react/Component#context)

#### Inherited from

`Component.context`

***

### props

> `readonly` **props**: `Readonly`\<`P`\>

Defined in: [node\_modules/.pnpm/@types+react@19.2.18/node\_modules/@types/react/index.d.ts:979](https://github.com/emindeniz99/react-watchos/blob/main/node_modules/.pnpm/@types+react@19.2.18/node_modules/@types/react/index.d.ts#L979)

#### Inherited from

`Component.props`

***

### state

> **state**: `State`

Defined in: [js/src/errorBoundary.tsx:34](https://github.com/emindeniz99/react-watchos/blob/main/js/src/errorBoundary.tsx#L34)

#### Overrides

`Component.state`

***

### contextType?

> `static` `optional` **contextType?**: `Context`\<`any`\>

Defined in: [node\_modules/.pnpm/@types+react@19.2.18/node\_modules/@types/react/index.d.ts:931](https://github.com/emindeniz99/react-watchos/blob/main/node_modules/.pnpm/@types+react@19.2.18/node_modules/@types/react/index.d.ts#L931)

If set, `this.context` will be set at runtime to the current value of the given Context.

#### Example

```ts
type MyContext = number
const Ctx = React.createContext<MyContext>(0)

class Foo extends React.Component {
  static contextType = Ctx
  context!: React.ContextType<typeof Ctx>
  render () {
    return <>My context's value: {this.context}</>;
  }
}
```

#### See

[https://react.dev/reference/react/Component#static-contexttype](https://react.dev/reference/react/Component#static-contexttype)

#### Inherited from

`Component.contextType`

***

### ~~propTypes?~~

> `static` `optional` **propTypes?**: `any`

Defined in: [node\_modules/.pnpm/@types+react@19.2.18/node\_modules/@types/react/index.d.ts:937](https://github.com/emindeniz99/react-watchos/blob/main/node_modules/.pnpm/@types+react@19.2.18/node_modules/@types/react/index.d.ts#L937)

Ignored by React.

#### Deprecated

Only kept in types for backwards compatibility. Will be removed in a future major release.

#### Inherited from

`Component.propTypes`

## Methods

### componentDidCatch()

> **componentDidCatch**(`error`, `info`): `void`

Defined in: [js/src/errorBoundary.tsx:40](https://github.com/emindeniz99/react-watchos/blob/main/js/src/errorBoundary.tsx#L40)

Catches exceptions generated in descendant components. Unhandled exceptions will cause
the entire component tree to unmount.

#### Parameters

##### error

`Error`

##### info

`ErrorInfo`

#### Returns

`void`

#### Overrides

`Component.componentDidCatch`

***

### componentDidMount()?

> `optional` **componentDidMount**(): `void`

Defined in: [node\_modules/.pnpm/@types+react@19.2.18/node\_modules/@types/react/index.d.ts:1198](https://github.com/emindeniz99/react-watchos/blob/main/node_modules/.pnpm/@types+react@19.2.18/node_modules/@types/react/index.d.ts#L1198)

Called immediately after a component is mounted. Setting state here will trigger re-rendering.

#### Returns

`void`

#### Inherited from

`Component.componentDidMount`

***

### componentDidUpdate()?

> `optional` **componentDidUpdate**(`prevProps`, `prevState`, `snapshot?`): `void`

Defined in: [node\_modules/.pnpm/@types+react@19.2.18/node\_modules/@types/react/index.d.ts:1261](https://github.com/emindeniz99/react-watchos/blob/main/node_modules/.pnpm/@types+react@19.2.18/node_modules/@types/react/index.d.ts#L1261)

Called immediately after updating occurs. Not called for the initial render.

The snapshot is only present if [getSnapshotBeforeUpdate](#getsnapshotbeforeupdate) is present and returns non-null.

#### Parameters

##### prevProps

`Readonly`\<`P`\>

##### prevState

`Readonly`\<`S`\>

##### snapshot?

`any`

#### Returns

`void`

#### Inherited from

`Component.componentDidUpdate`

***

### ~~componentWillMount()?~~

> `optional` **componentWillMount**(): `void`

Defined in: [node\_modules/.pnpm/@types+react@19.2.18/node\_modules/@types/react/index.d.ts:1277](https://github.com/emindeniz99/react-watchos/blob/main/node_modules/.pnpm/@types+react@19.2.18/node_modules/@types/react/index.d.ts#L1277)

Called immediately before mounting occurs, and before Component.render.
Avoid introducing any side-effects or subscriptions in this method.

Note: the presence of NewLifecycle.getSnapshotBeforeUpdate getSnapshotBeforeUpdate
or StaticLifecycle.getDerivedStateFromProps getDerivedStateFromProps prevents
this from being invoked.

#### Returns

`void`

#### Deprecated

16.3, use ComponentLifecycle.componentDidMount componentDidMount or the constructor instead; will stop working in React 17

#### See

 - [https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#initializing-state](https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#initializing-state)
 - [https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#gradual-migration-path](https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#gradual-migration-path)

#### Inherited from

`Component.componentWillMount`

***

### ~~componentWillReceiveProps()?~~

> `optional` **componentWillReceiveProps**(`nextProps`, `nextContext`): `void`

Defined in: [node\_modules/.pnpm/@types+react@19.2.18/node\_modules/@types/react/index.d.ts:1308](https://github.com/emindeniz99/react-watchos/blob/main/node_modules/.pnpm/@types+react@19.2.18/node_modules/@types/react/index.d.ts#L1308)

Called when the component may be receiving new props.
React may call this even if props have not changed, so be sure to compare new and existing
props if you only want to handle changes.

Calling Component.setState generally does not trigger this method.

Note: the presence of NewLifecycle.getSnapshotBeforeUpdate getSnapshotBeforeUpdate
or StaticLifecycle.getDerivedStateFromProps getDerivedStateFromProps prevents
this from being invoked.

#### Parameters

##### nextProps

`Readonly`\<`P`\>

##### nextContext

`any`

#### Returns

`void`

#### Deprecated

16.3, use static StaticLifecycle.getDerivedStateFromProps getDerivedStateFromProps instead; will stop working in React 17

#### See

 - [https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#updating-state-based-on-props](https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#updating-state-based-on-props)
 - [https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#gradual-migration-path](https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#gradual-migration-path)

#### Inherited from

`Component.componentWillReceiveProps`

***

### componentWillUnmount()?

> `optional` **componentWillUnmount**(): `void`

Defined in: [node\_modules/.pnpm/@types+react@19.2.18/node\_modules/@types/react/index.d.ts:1214](https://github.com/emindeniz99/react-watchos/blob/main/node_modules/.pnpm/@types+react@19.2.18/node_modules/@types/react/index.d.ts#L1214)

Called immediately before a component is destroyed. Perform any necessary cleanup in this method, such as
cancelled network requests, or cleaning up any DOM elements created in `componentDidMount`.

#### Returns

`void`

#### Inherited from

`Component.componentWillUnmount`

***

### ~~componentWillUpdate()?~~

> `optional` **componentWillUpdate**(`nextProps`, `nextState`, `nextContext`): `void`

Defined in: [node\_modules/.pnpm/@types+react@19.2.18/node\_modules/@types/react/index.d.ts:1340](https://github.com/emindeniz99/react-watchos/blob/main/node_modules/.pnpm/@types+react@19.2.18/node_modules/@types/react/index.d.ts#L1340)

Called immediately before rendering when new props or state is received. Not called for the initial render.

Note: You cannot call Component.setState here.

Note: the presence of NewLifecycle.getSnapshotBeforeUpdate getSnapshotBeforeUpdate
or StaticLifecycle.getDerivedStateFromProps getDerivedStateFromProps prevents
this from being invoked.

#### Parameters

##### nextProps

`Readonly`\<`P`\>

##### nextState

`Readonly`\<`S`\>

##### nextContext

`any`

#### Returns

`void`

#### Deprecated

16.3, use getSnapshotBeforeUpdate instead; will stop working in React 17

#### See

 - [https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#reading-dom-properties-before-an-update](https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#reading-dom-properties-before-an-update)
 - [https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#gradual-migration-path](https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#gradual-migration-path)

#### Inherited from

`Component.componentWillUpdate`

***

### forceUpdate()

> **forceUpdate**(`callback?`): `void`

Defined in: [node\_modules/.pnpm/@types+react@19.2.18/node\_modules/@types/react/index.d.ts:976](https://github.com/emindeniz99/react-watchos/blob/main/node_modules/.pnpm/@types+react@19.2.18/node_modules/@types/react/index.d.ts#L976)

#### Parameters

##### callback?

() => `void`

#### Returns

`void`

#### Inherited from

`Component.forceUpdate`

***

### getSnapshotBeforeUpdate()?

> `optional` **getSnapshotBeforeUpdate**(`prevProps`, `prevState`): `any`

Defined in: [node\_modules/.pnpm/@types+react@19.2.18/node\_modules/@types/react/index.d.ts:1255](https://github.com/emindeniz99/react-watchos/blob/main/node_modules/.pnpm/@types+react@19.2.18/node_modules/@types/react/index.d.ts#L1255)

Runs before React applies the result of Component.render render to the document, and
returns an object to be given to [componentDidUpdate](#componentdidupdate). Useful for saving
things such as scroll position before Component.render render causes changes to it.

Note: the presence of this method prevents any of the deprecated
lifecycle events from running.

#### Parameters

##### prevProps

`Readonly`\<`P`\>

##### prevState

`Readonly`\<`S`\>

#### Returns

`any`

#### Inherited from

`Component.getSnapshotBeforeUpdate`

***

### render()

> **render**(): `ReactNode`

Defined in: [js/src/errorBoundary.tsx:47](https://github.com/emindeniz99/react-watchos/blob/main/js/src/errorBoundary.tsx#L47)

#### Returns

`ReactNode`

#### Overrides

`Component.render`

***

### setState()

> **setState**\<`K`\>(`state`, `callback?`): `void`

Defined in: [node\_modules/.pnpm/@types+react@19.2.18/node\_modules/@types/react/index.d.ts:971](https://github.com/emindeniz99/react-watchos/blob/main/node_modules/.pnpm/@types+react@19.2.18/node_modules/@types/react/index.d.ts#L971)

#### Type Parameters

##### K

`K` *extends* keyof `State`

#### Parameters

##### state

`State` \| ((`prevState`, `props`) => `State` \| `Pick`\<`State`, `K`\> \| `null`) \| `Pick`\<`State`, `K`\> \| `null`

##### callback?

() => `void`

#### Returns

`void`

#### Inherited from

`Component.setState`

***

### shouldComponentUpdate()?

> `optional` **shouldComponentUpdate**(`nextProps`, `nextState`, `nextContext`): `boolean`

Defined in: [node\_modules/.pnpm/@types+react@19.2.18/node\_modules/@types/react/index.d.ts:1209](https://github.com/emindeniz99/react-watchos/blob/main/node_modules/.pnpm/@types+react@19.2.18/node_modules/@types/react/index.d.ts#L1209)

Called to determine whether the change in props and state should trigger a re-render.

`Component` always returns true.
`PureComponent` implements a shallow comparison on props and state and returns true if any
props or states have changed.

If false is returned, Component.render, `componentWillUpdate`
and `componentDidUpdate` will not be called.

#### Parameters

##### nextProps

`Readonly`\<`P`\>

##### nextState

`Readonly`\<`S`\>

##### nextContext

`any`

#### Returns

`boolean`

#### Inherited from

`Component.shouldComponentUpdate`

***

### ~~UNSAFE\_componentWillMount()?~~

> `optional` **UNSAFE\_componentWillMount**(): `void`

Defined in: [node\_modules/.pnpm/@types+react@19.2.18/node\_modules/@types/react/index.d.ts:1292](https://github.com/emindeniz99/react-watchos/blob/main/node_modules/.pnpm/@types+react@19.2.18/node_modules/@types/react/index.d.ts#L1292)

Called immediately before mounting occurs, and before Component.render.
Avoid introducing any side-effects or subscriptions in this method.

This method will not stop working in React 17.

Note: the presence of NewLifecycle.getSnapshotBeforeUpdate getSnapshotBeforeUpdate
or StaticLifecycle.getDerivedStateFromProps getDerivedStateFromProps prevents
this from being invoked.

#### Returns

`void`

#### Deprecated

16.3, use ComponentLifecycle.componentDidMount componentDidMount or the constructor instead

#### See

 - [https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#initializing-state](https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#initializing-state)
 - [https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#gradual-migration-path](https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#gradual-migration-path)

#### Inherited from

`Component.UNSAFE_componentWillMount`

***

### ~~UNSAFE\_componentWillReceiveProps()?~~

> `optional` **UNSAFE\_componentWillReceiveProps**(`nextProps`, `nextContext`): `void`

Defined in: [node\_modules/.pnpm/@types+react@19.2.18/node\_modules/@types/react/index.d.ts:1326](https://github.com/emindeniz99/react-watchos/blob/main/node_modules/.pnpm/@types+react@19.2.18/node_modules/@types/react/index.d.ts#L1326)

Called when the component may be receiving new props.
React may call this even if props have not changed, so be sure to compare new and existing
props if you only want to handle changes.

Calling Component.setState generally does not trigger this method.

This method will not stop working in React 17.

Note: the presence of NewLifecycle.getSnapshotBeforeUpdate getSnapshotBeforeUpdate
or StaticLifecycle.getDerivedStateFromProps getDerivedStateFromProps prevents
this from being invoked.

#### Parameters

##### nextProps

`Readonly`\<`P`\>

##### nextContext

`any`

#### Returns

`void`

#### Deprecated

16.3, use static StaticLifecycle.getDerivedStateFromProps getDerivedStateFromProps instead

#### See

 - [https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#updating-state-based-on-props](https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#updating-state-based-on-props)
 - [https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#gradual-migration-path](https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#gradual-migration-path)

#### Inherited from

`Component.UNSAFE_componentWillReceiveProps`

***

### ~~UNSAFE\_componentWillUpdate()?~~

> `optional` **UNSAFE\_componentWillUpdate**(`nextProps`, `nextState`, `nextContext`): `void`

Defined in: [node\_modules/.pnpm/@types+react@19.2.18/node\_modules/@types/react/index.d.ts:1356](https://github.com/emindeniz99/react-watchos/blob/main/node_modules/.pnpm/@types+react@19.2.18/node_modules/@types/react/index.d.ts#L1356)

Called immediately before rendering when new props or state is received. Not called for the initial render.

Note: You cannot call Component.setState here.

This method will not stop working in React 17.

Note: the presence of NewLifecycle.getSnapshotBeforeUpdate getSnapshotBeforeUpdate
or StaticLifecycle.getDerivedStateFromProps getDerivedStateFromProps prevents
this from being invoked.

#### Parameters

##### nextProps

`Readonly`\<`P`\>

##### nextState

`Readonly`\<`S`\>

##### nextContext

`any`

#### Returns

`void`

#### Deprecated

16.3, use getSnapshotBeforeUpdate instead

#### See

 - [https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#reading-dom-properties-before-an-update](https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#reading-dom-properties-before-an-update)
 - [https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#gradual-migration-path](https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html#gradual-migration-path)

#### Inherited from

`Component.UNSAFE_componentWillUpdate`

***

### getDerivedStateFromError()

> `static` **getDerivedStateFromError**(`error`): `Partial`\<`State`\>

Defined in: [js/src/errorBoundary.tsx:36](https://github.com/emindeniz99/react-watchos/blob/main/js/src/errorBoundary.tsx#L36)

#### Parameters

##### error

`Error`

#### Returns

`Partial`\<`State`\>
