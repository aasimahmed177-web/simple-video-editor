# Adscade Ad Studio

A local workflow for editing short Meta ad videos: English transcription, subtitle spelling and timing review, reusable Adscade branding, and paired 1:1 / 9:16 MP4 exports.

## Start the ad studio

Requires Node.js 20.19+ (or a supported newer release) and a C++ compiler for the one-time transcription setup.

```bash
npm install
npm run setup:transcription
npm run edit
```

Open `http://127.0.0.1:5173/ads.html`. On macOS, you can also double-click **Start Adscade Studio.command** after installation.

Import footage → make the cut → transcribe → check spelling and timing → save → export both placements. The bundled Adscade preset uses the live VSL-5-2 logo and green/gold/cream palette; its CTA and caption styling remain editable. No paid AI API or cloud-render service is required.

**[Weekly workflow, backup instructions, verification, and licensing](docs/WORKFLOW.md)**

Footage, transcripts, presets, models, and exports stay in ignored local folders. They are not committed to Git. Save projects explicitly and back up `data/` separately. Software fixes can be committed normally in Git or GitHub Desktop.

## Original composition editor

The original utility is retained at `/editor.html`. Its original documentation follows.

### Simple ChatGPT + Claude Video Editor

An unofficial, local-first visual editor for Remotion compositions. It gives AI-assisted video projects a simple canvas for final visual changes.

This community project is not affiliated with or endorsed by OpenAI, Anthropic, or Remotion.

## What it does

- Select and drag exposed elements on the video canvas. Dragged positions save when released.
- Change position, size, rotation, and opacity.
- Edit text and colors.
- Replace images with local files.
- Hide, restore, reset, and undo changes.
- Double-click empty space for a frame-linked comment dialogue.
- Double-click an element for a floating, movable, resizable control and comment card.
- Show saved comments as numbered blue pins during their saved second.
- Edit, jump to, delete, or copy all comments with time, frame, scene, element, X, and Y details.
- Save changes to JSON in the project.
- Use the same saved state in the editor preview and Remotion render.

## Start

Requirements: Node.js 20 or newer.

```bash
npm install
npm run edit
```

Open `http://127.0.0.1:5173/editor.html`.

Run Remotion Studio with `npm run dev`. Render the neutral demo with `npm run render`.

## Adapt it to your composition

1. Wrap each visual element with `Editable` from `src/editor/Editable.tsx`.
2. Give each element a stable ID, a plain label, and a supported kind.
3. Pass the saved `EditorState` to your composition.
4. Keep `editMode` false in clean renders.

Saved edits live in `src/editor-state.json`. Review notes live in `src/editor-comments.json`. Public scene names and frame ranges live in `src/editor-config.ts`. Replacement images are written to `public/uploads/`.

The local Vite API writes files on your computer. It has no authentication and is for local development only. Do not expose the editor server to the public internet.

## Checks

```bash
npm run check
npm run render
```

## Project limits

This is a small community utility. Issues and pull requests are welcome on a best-effort basis. There is no support promise, response-time promise, or public roadmap.

## License

MIT. See [LICENSE](LICENSE).
