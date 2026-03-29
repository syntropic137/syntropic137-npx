---
name: User cares about strict type safety
description: User explicitly requires TypeScript strict mode and values type safety
type: feedback
---

Always use strict mode in TypeScript. User explicitly asked for type safety.

**Why:** User stated "I really care about type safety."

**How to apply:** Keep `"strict": true` in tsconfig.json. Avoid `any` types, use proper generics and narrowing. Don't use type assertions unless absolutely necessary.
