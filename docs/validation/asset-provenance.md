# Ludex Stage A asset provenance

## Original cinema lounge background

- Site asset: `public/art/lounge.webp`
- Created: 2026-10-06
- Source: original text-to-image generation through the Azure Foundry Images API using the local `azure-imagegen` skill helper.
- Model: `gpt-image-2.5-flare`
- Requested quality: `high`
- Generated source: `/tmp/ludex-lounge-original-20261006.png`, 1536 × 1024 pixels. This temporary source is not needed by the site.
- Final delivery: 1536 × 658 pixels, WebP at quality 90, 40,522 bytes.
- SHA-256: `fce7b7e45585cc1978a315a37b03c100c475fb86ceaf3e20d5cff490b312167b`

The prompt requested an original empty cinema auditorium with deep aubergine and charcoal walls, dark plum velvet seat silhouettes, subdued copper details, a dim wall sconce, and projection light spilling from the far right through soft haze. It specified a nearly black left third for overlay content, low-key editorial lighting, real architectural depth, and no people, text, logos, borders, or UI. No reference image or remote media was supplied.

The generated source was visually inspected. ImageMagick cropped the source to `1536x658+0+190`, stripped metadata, and encoded it with WebP quality 90 and method 6. The finished crop was also visually inspected and retains the dark left side, seating detail, copper sconce, and screen-right glow. Its dimensions and file size were verified with `magick identify`; its checksum was verified with `sha256sum`.

## Original midnight premiere architecture

- Assets: `public/art/premiere.webp`, `apps/mobile/assets/art/premiere.webp`
- Created: 2026-10-06, through the Azure Foundry image helper.
- Model: `gpt-image-2.5-sunburst`, quality `high`, explicitly requested by the user.
- Source: `/tmp/ludex-premiere-sunburst-20261006.png`.
- Delivery: 1920 × 823 pixels; WebP quality 88, metadata stripped; 152,936 bytes.
- SHA-256: `350886e691a07b788949968957ec4008b26b4550ae35f82ee84f9d184356bfcc`.

The prompt specified an original surreal high-fashion cinema installation: monumental coral velvet folded ribbon through an aubergine auditorium, an oval lavender screen, chartreuse floor reflections, floating film frames, architectural materials, dark left third and right focal point; no people, text, logos or UI. No reference media was supplied. The result and optimized delivery were visually inspected. ImageMagick resized to 1920px width, stripped metadata and encoded WebP. This is brand architecture, not film/game cover art or a connected provider.

## Sora typography (2026-10-07)

Google Fonts `ofl/sora/Sora[wght].ttf`, sourced from the google/fonts repository, designer Jonathan Barnbrook and Julián Moncada; SIL OFL included as `Sora-OFL.txt` in both font directories. The original variable font was compressed into the web WOFF2. Android's 400/500/600/700/800 static instances were created with FontTools `instantiateVariableFont`; registered aliases, rather than synthetic font weights, select them. This pass reused the original Sunburst art, without another raster generation request.
