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
