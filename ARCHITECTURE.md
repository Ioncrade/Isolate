# Browser Architecture

The desktop release exposes FastAPI endpoints backed by global Python state. That design cannot use an end user's GPU from a Vercel deployment. The web version therefore keeps the same workflow behind browser-local services; Vercel is only the static origin.

| Desktop capability | Browser implementation |
| --- | --- |
| `/api/health`, heartbeat | Capability ledger reports WebGPU or CPU/WASM readiness; no server lifecycle is required. |
| `/api/session/load` | `VideoFrameReader.open()` validates a local `File`, records project metadata, and retains only a revocable object URL. |
| `/api/frames/{frame}` | `VideoFrameReader.readFrame()` seeks and decodes one resolution-capped frame at a time. |
| `/api/sam/predict` | `SamClient.predict()` sends one frame to `sam2.worker.ts`; the worker caches only that frame's embedding. |
| `/api/track/*` | `App.trackRange()` performs bounded, cancellable forward/backward prompt propagation and commits each mask before continuing. |
| `/api/masks/{frame}` | `ProjectStorage` reads and writes PNG alpha masks in IndexedDB. |
| `/api/export` | `createTransparentWebm()` composites original-color frames with stored alpha masks and records one local VP9/VP8 WebM. |
| `/api/model/*` | Transformers.js downloads quantized SAM2 weights directly to browser cache and selects WebGPU or WASM. |

## Memory and storage invariants

- Source duration is at most 20 seconds and source size at most 500 MB.
- The decoded working frame preserves source dimensions up to 2560×1440 landscape, 1440×2560 portrait, or 3.7 megapixels for other aspect ratios.
- SAM2 preprocesses that working frame to its fixed 1024×1024 model input and post-processes the resulting mask back to the working dimensions.
- Analysis is 6–8 FPS and never exceeds 200 frames.
- Only the active RGBA frame, active mask, and active SAM2 embedding remain in memory.
- Completed masks are compressed to PNG immediately and persisted under a 64 MB per-project ceiling.
- Tracking is sequential and cancellable between frames.
- Transparent WebM recording is real-time, sequential, cancellable, encoded at 4–12 Mbps according to resolution, and capped at 64 MB of compressed output. Final duration metadata is repaired locally before download.
- The export canvas and RGBA buffer are reused; raw frames are released between iterations rather than accumulated.
- The source file is never persisted in IndexedDB or sent over the network.

## Session recovery

Project metadata, frame states, and masks persist in IndexedDB. The active project and frame are mirrored in `sessionStorage`. Because source footage is deliberately not persisted, a reload asks the user to reconnect the same local file before editing continues.
