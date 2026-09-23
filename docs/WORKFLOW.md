# Weekly Adscade workflow

## Open the studio

On this Mac, double-click `Start Adscade Studio.command`, or run `npm run edit` in the repository. Keep the terminal running. Open the `/ads.html` address printed by Vite (normally http://127.0.0.1:5173/ads.html).

The English `small.en` model is installed locally by `npm run setup:transcription`. It is approximately 488 MB. Setup needs internet and a C++ compiler (`make` and Xcode command-line tools on macOS); subsequent transcription uses local audio and does not call an AI API. The renderer downloads its browser on first use. Fonts and the brand logo are bundled locally.

## Make an ad

1. Choose **New ad**, name it, and import your video clips. MP4, MOV, WebM, and M4V are accepted (up to 1 GB per file, two hours of source duration).
2. Use **In / Out** to keep the desired section of each clip. Reorder clips with the arrows. Seek in the preview and use **Split here** to divide a clip. Remove unwanted sections. All times are seconds; the output clock is 30 fps.
3. Preview both **1:1 Feed** and **9:16 Story**. Choose fill/crop or fit the full source, and adjust the focal point with Crop X/Y. The same focal point is used in both versions.
4. Import an MP3, M4A, or WAV if you want music. Set its level separately from each clip's voice volume. Music loops with a short fade at the start and end. Use music licensed for your advertising use.
5. Click **Transcribe this cut**. The app extracts the edited voice track, including silence for muted or silent clips, then generates English subtitles. Background music is excluded from transcription.
6. Click **Check spelling**. The local English dictionary offers suggestions; accepted names can go in the brand dictionary. Click a line's play button, listen, edit the wording and start/end times, then mark it **Reviewed**. Automatic transcription can mishear names, numbers, accents, and claims. Dictionary checks cannot verify meaning.
7. Fix overlapping subtitles or lines above 25 characters per second before export. Changing the cut resets subtitle review; transcribe again or check all timings and choose **Mark all reviewed**. Turning off subtitles is an explicit way to export without them.
8. Under **Brand & text**, adjust the hook, logo, caption style, and final CTA. **Save as default brand** stores a reusable preset for new ads; **Apply saved brand** updates the current ad. Existing projects retain their own settings.
9. **Save project**, then **Export both placements**. Downloads include 1080×1080 and 1080×1920 H.264/AAC MP4s, an SRT, and a JSON snapshot of the edit. Subtitles are burned into the video when enabled. Guides and editor controls are never rendered.

The safe-area guide is a conservative working aid, not a guarantee for every Meta placement. Review both files in Ads Manager's placement preview before publishing. The square and vertical outputs share the same cut and subtitles; the crop changes with the canvas. This app does not upload or publish ads.

## Where the work lives

| Folder/file           | Contents                                           |
| --------------------- | -------------------------------------------------- |
| `data/projects/`      | Saved ads and latest raw transcript recovery files |
| `data/brand.json`     | Your saved reusable brand preset                   |
| `data/media/`         | Imported source footage and music                  |
| `data/exports/`       | Final MP4s, subtitles, and edit snapshots          |
| `.local/whisper.cpp/` | Local transcription program and model              |

Back up the whole `data/` folder to preserve your footage and editable projects. Git deliberately excludes it, the transcription model, and original editor uploads. A commit is a backup of the app code, **not** a backup of your videos or brand-preset changes. The bundled starter preset is in `src/ads/model.ts`.

The latest saved project opens on launch. Its most recent export links remain available after reopening. Save before switching projects or closing the app; unsaved changes trigger a browser warning. Transcription results are additionally saved as `<project-id>-transcript.json` for recovery; use **Restore last transcript** if a browser refresh interrupted your review. Only one transcription/export job runs at a time. A cancelled/failed export deletes its incomplete files; it leaves the saved project intact.

The studio is intended for one local editor at a time. Keep it bound to `127.0.0.1`; it is not an authenticated hosted application. Static `dist/` files alone cannot import, save, transcribe, or export; these actions need the local Vite server.

## Verification

`npm run check` runs type checking, lint, unit tests, and both builds. `npm run test:e2e` checks local API restrictions and the browser editing workflow. Install its browser with `npx playwright install chromium` once.

To make the synthetic English fixture used by the browser and full integration checks on macOS:

```sh
mkdir -p .local/test
say -v Samantha -r 145 -o .local/test/speech.aiff 'Are you spending money on ads without getting qualified leads? At Adscade, we help you turn attention into booked appointments. Book a discovery call today.'
node --input-type=module <<'JS'
import ffmpeg from 'ffmpeg-static';
import {execFileSync} from 'node:child_process';
execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-i', '.local/test/speech.aiff', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '.local/test/english-sample.mp4']);
JS
```

With the studio running, `npx tsx scripts/verify-workflow.ts` imports the fixture, transcribes real speech, asserts recognized words, and renders a six-second two-clip edit in both formats. It writes only synthetic local verification projects. These checks do not establish accuracy or rendering speed for every accent, codec, computer, or a full two-minute production ad.

## Costs and licensing

There is no paid transcription API or cloud-render requirement in this workflow. It uses local compute and storage. AI-assistant subscriptions/usage, paid media assets, and advertising spend are separate. The editor code is MIT; Remotion has separate licensing terms. The pinned Remotion 4 version's free license covers individuals and for-profit organizations with up to three employees, including commercial videos. Check https://www.remotion.dev/license for your organization and before upgrading Remotion. The Adscade logo is a brand asset; fonts include their own license notices.
