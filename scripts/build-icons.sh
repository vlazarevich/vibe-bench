#!/bin/sh
# Requires librsvg (rsvg-convert) and ImageMagick (magick).
set -eu
cd "$(dirname "$0")/.."
for size in 16 32 48 180 192 512; do
  rsvg-convert -w "$size" -h "$size" apps/web/public/assets/vibe-bench.svg \
    -o "apps/web/public/assets/vibe-bench-${size}.png"
done
magick apps/web/public/assets/vibe-bench-16.png apps/web/public/assets/vibe-bench-32.png \
  apps/web/public/assets/vibe-bench-48.png apps/web/public/assets/favicon.ico
