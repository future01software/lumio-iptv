#!/bin/sh
# Generates synthetic test media for the mock Xtream server (needs ffmpeg).
set -e
cd "$(dirname "$0")"
mkdir -p media/live media/vod
ffmpeg -y -loglevel error -f lavfi -i "testsrc2=size=1280x720:rate=25" -f lavfi -i "sine=frequency=440" -t 120 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -g 50 -c:a aac -f hls -hls_time 4 -hls_list_size 0 \
  -hls_segment_filename media/live/seg%03d.ts media/live/index.m3u8
ffmpeg -y -loglevel error -f lavfi -i "smptehdbars=size=1280x720:rate=25" -f lavfi -i "sine=frequency=660" -t 240 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -movflags +faststart media/movie.mp4
ffmpeg -y -loglevel error -i media/movie.mp4 -c copy -f hls -hls_time 6 -hls_list_size 0 -hls_playlist_type vod \
  -hls_segment_filename media/vod/seg%03d.ts media/vod/index.m3u8
echo "media ready"
