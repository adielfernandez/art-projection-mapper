# CLAUDE.md

Project spec: see `ProjectBrief.md`. The app was finished and used for the Halloween 2026 party; the brief describes its final behavior, §9 records the design decisions and §10 the unfinished work (the Choreographed mode on branch `feature/choreography-mode`). The README is the user guide and has a map of the code under *For developers*.

For new work, go step by step and stop after each change to what is projected, so the user can verify it on the physical projector (Claude Code cannot see the projection). When behavior changes, update the README, `ProjectBrief.md` and `fpo/QA.md` together so they keep agreeing.

## Conventions

- Do not add dependencies beyond the approved list (`three`, `@types/three`, `vite`, `typescript`, `vitest`, `@fontsource/source-serif-4`, `@fontsource/public-sans`) without asking.
- Pin `three` to an exact version. Do not upgrade it without asking.
- TypeScript strict mode. No `any` in schema or state code.
- All persisted data goes through typed schemas in `src/state/schema.ts`, with defaults in `defaults.ts` and migrations in `migrate.ts`.
- Never write to disk except from an explicit Save action.
- Renderer and panel read state through store subscriptions and change it only through store actions.
- All animation timing uses the rAF delta-time clock.
- Write Vitest tests for all math and selection logic. Run `npm test` (and `npm run build`) before reporting work complete.
- Layout (as the project ended):
  ```
  src/
    main.ts
    state/      store.ts, schema.ts, defaults.ts, migrate.ts
    io/         projectController.ts, projectFolder.ts, configIO.ts, poolIO.ts, handleStore.ts
    math/       homography.ts, homography.test.ts, geometry.ts
    render/     renderer.ts, quadCamera.ts, quadLayer.ts, testPattern.ts,
                transitionMaterial.ts, debugOverlay.ts
    content/    selection.ts, shuffleBag.ts, shuffleBag.test.ts, scheduler.ts,
                mediaLoader.ts, decodeWorker.ts, motion.ts, playlist.ts
    captions/   captionLayout.ts, captionRenderer.ts
    ui/         panel.ts, hotkeys.ts, pointerMapping.ts, controls.ts, sections/*.ts, panel.css
  ```

## Commands

- `npm run dev` — Vite dev server on localhost
- `npm run build` — typecheck + production build
- `npm test` — Vitest
- `npm run typecheck` — typecheck only
- `python fpo/generate.py` — build the FPO test shows used by `fpo/QA.md` (needs Pillow and ffmpeg)
