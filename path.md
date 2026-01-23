# Anarkai Path Aliases Standard

To ensure consistency across the monorepo and avoid module resolution conflicts, we adhere to the following conventions.

## 1. Prefer Package Names
Whenever possible, refer to shared code by its package name, as defined in `package.json`.

*   **`ssh`**: The core logic engine.
*   **`engine-pixi`**: The PixiJS rendering engine.
*   **`pounce-ts`**: The reactive framework.

Examples:
```typescript
import { Tile } from 'ssh/src/lib/board/tile'
import { goods } from 'ssh/assets/game-content'
import { compose } from 'pounce-ts'
```

## 2. Workspace Linking (The "Self" Alias)
To support monorepo development where packages are consumed from source (without building), consuming applications should configure an alias that maps the package name to the local directory.

**vite.config.ts (in apps)**:
```typescript
resolve: {
  alias: {
    // Map package name to workspace folder
    'ssh': resolvePath(__dirname, '../../engines/ssh'),
    'engine-pixi': resolvePath(__dirname, '../../engines/pixi'),
  }
}
```

## 3. App-Local Aliases
Use aliases to conveniently refer to the current application's folders.

*   **`@app`**: The `src` root of the current app.
*   **`$lib`** or **`@app/lib`**: The `lib` folder of the current app.
*   **`$assets`**: The `assets` folder of the current app.

**Note**: Do not use these aliases inside shared engines. Engines should be self-contained or use package names to refer to dependencies.

## 4. Internal Imports (Within a Package)
Within a shared package (e.g. inside `engines/ssh`), always use **relative imports**.

*   ✅ `import { foo } from '../../utils'`
*   ❌ `import { foo } from 'ssh/src/lib/utils'` (Avoid circular package reference if possible)
*   ❌ `import { foo } from '$lib/utils'` (Never use app aliases)
