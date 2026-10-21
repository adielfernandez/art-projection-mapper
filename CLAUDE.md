# CLAUDE.md

Project spec: see `ProjectBrief.md`. Work milestone by milestone (brief §6) and stop at the end of each for the user to verify on the physical projector.

## Conventions

- Do not add dependencies beyond the approved list (`three`, `@types/three`, `vite`, `typescript`, `vitest`, `@fontsource/source-serif-4`, `@fontsource/public-sans`) without asking.
- Pin `three` to an exact version. Do not upgrade it without asking.
- TypeScript strict mode. No `any` in schema or state code.
- All persisted data goes through typed schemas in `src/state/schema.ts`, with defaults in `defaults.ts` and migrations in `migrate.ts`.
- Never write to disk except from an explicit Save action.
- Renderer and panel read state through store subscriptions and change it only through store actions.
- All animation timing uses the rAF delta-time clock.
- Write Vitest tests for all math and selection logic. Run `npm test` before reporting a milestone complete.
- Suggested layout:
  ```
  src/
    main.ts
    state/      store.ts, schema.ts, defaults.ts, migrate.ts
    io/         projectFolder.ts, configIO.ts, poolIO.ts, handleStore.ts
    math/       homography.ts, homography.test.ts, geometry.ts
    render/     renderer.ts, quadCamera.ts, frameRenderer.ts, wallRenderer.ts,
                testPattern.ts, transitionMaterial.ts, debugOverlay.ts
    content/    selection.ts, shuffleBag.ts, shuffleBag.test.ts, scheduler.ts,
                mediaLoader.ts, motion.ts
    captions/   captionLayout.ts, captionRenderer.ts
    ui/         panel.ts, hotkeys.ts, sections/*.ts, panel.css
  ```

## Commands

- `npm run dev` — Vite dev server on localhost
- `npm run build` — typecheck + production build
- `npm test` — Vitest
