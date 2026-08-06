[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / onLuminanceReduced

# Function: onLuminanceReduced()

> **onLuminanceReduced**(`handler`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/appState.ts:57](https://github.com/emindeniz99/react-watchos/blob/main/js/src/appState.ts#L57)

Runs `handler` whenever the display enters or leaves reduced luminance
(Always-On wrist-down). Returns an unsubscribe.

The handler is also called **once on mount** with the current state, so an
app that launches while the wrist is already down learns it immediately
instead of believing luminance is normal until the next wrist movement.

```tsx
const [dimmed, setDimmed] = useState(false);
useEffect(() => onLuminanceReduced(setDimmed), []);
useEffect(() => {
  if (dimmed) return;              // wrist down: no ticking
  const t = setInterval(tick, 100);
  return () => clearInterval(t);
}, [dimmed]);
```

## Parameters

### handler

(`reduced`) => `void`

## Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)
