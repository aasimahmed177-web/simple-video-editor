# Simple ChatGPT + Claude Video Editor

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
