#!/usr/bin/env bash
# P4c-Vorbereitung: synthetisches HLS-Testmaterial für den Samsung-Test (eigener Inhalt: Testbild, weißer Blitz +
# Piepton alle 2 s gleichzeitig → A/V-Versatz am Inhalt erkennbar). Ausgabe: tests/web/public/p4/<fall>/…
# Keine fremden Medien, keine Anmeldung. Aufruf: bash tools/p4test/make-device-page.sh   (ffmpeg mit libx264)
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=tests/web/public/p4
rm -rf "$OUT"; mkdir -p "$OUT"
V() { echo "testsrc2=size=$1:rate=25,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='eq(mod(n\,50)\,0)',format=yuv420p"; }
A() { echo "aevalsrc=exprs='if(lt(mod(t\,2)\,0.04)\,0.8*sin(2*PI*$1*t)\,0)':sample_rate=48000:channel_layout=stereo"; }
X264=(-c:v libx264 -profile:v main -preset veryfast -crf 30 -g 50 -keyint_min 50 -sc_threshold 0 -bf 2 -threads 1 -flags:v +bitexact)
AAC=(-c:a aac -b:a 48k -ac 2 -ar 48000 -flags:a +bitexact)
COMMON=(-hide_banner -v error -y)
OUTO=(-fflags +bitexact -map_metadata -1)
hls() {   # hls NAME TYPE SECONDS SEG_SECONDS INPUTS... -- OUTPUT_ARGS...
  local name=$1 type=$2 dur=$3 seg=$4; shift 4
  local ins=(); while [ "$1" != -- ]; do ins+=("$1"); shift; done; shift
  local ext=ts; [ "$type" = fmp4 ] && ext=m4s
  mkdir -p "$OUT/$name"
  ( cd "$OUT/$name" && ffmpeg "${COMMON[@]}" "${ins[@]}" -t "$dur" "${OUTO[@]}" "$@" -f hls -hls_time "$seg" -hls_playlist_type vod \
      -hls_segment_type "$type" -hls_flags independent_segments -hls_segment_filename "s%v_%03d.$ext" \
      $([ "$type" = fmp4 ] && echo -hls_fmp4_init_filename init_%v.mp4) -master_pl_name master.m3u8 'v%v.m3u8' )
}
I360=(-f lavfi -i "$(V 640x360)"); I180=(-f lavfi -i "$(V 320x180)"); AHI=(-f lavfi -i "$(A 1000)"); ALO=(-f lavfi -i "$(A 400)")
# T1/T2: TS, getrennte Tonspur bzw. im Videostrom
hls ts_sep mpegts 20 4 "${I360[@]}" "${AHI[@]}" -- -map 0:v -map 1:a "${X264[@]}" "${AAC[@]}" -var_stream_map 'v:0,agroup:aud a:0,agroup:aud,default:yes,language:de'
hls ts_muxed mpegts 20 4 "${I360[@]}" "${AHI[@]}" -- -map 0:v -map 1:a "${X264[@]}" "${AAC[@]}" -var_stream_map 'v:0,a:0'
# T3/T4: fMP4, getrennt bzw. gemuxt
hls fmp4_sep fmp4 20 4 "${I360[@]}" "${AHI[@]}" -- -map 0:v -map 1:a "${X264[@]}" "${AAC[@]}" -var_stream_map 'v:0,agroup:aud a:0,agroup:aud,default:yes,language:de'
hls fmp4_muxed fmp4 20 4 "${I360[@]}" "${AHI[@]}" -- -map 0:v -map 1:a "${X264[@]}" "${AAC[@]}" -var_stream_map 'v:0,a:0'
# T5: zwei Qualitäten (360p, 180p) mit gemeinsamer Tonspur
hls quality mpegts 20 4 "${I360[@]}" "${AHI[@]}" -- -map 0:v -map 0:v -map 1:a -filter:v:1 scale=320:180 "${X264[@]}" "${AAC[@]}" \
  -var_stream_map 'v:0,agroup:aud v:1,agroup:aud a:0,agroup:aud,default:yes,language:de'
# T6: zwei Tonspuren: Deutsch = hoher Piepton (1 kHz), Englisch = tiefer Piepton (400 Hz)
hls two_audio fmp4 20 4 "${I360[@]}" "${AHI[@]}" "${ALO[@]}" -- -map 0:v -map 1:a -map 2:a "${X264[@]}" "${AAC[@]}" \
  -var_stream_map 'v:0,agroup:aud a:0,agroup:aud,default:yes,language:de a:1,agroup:aud,language:en'
# T7–T11: lange Ladezeit durch viele kleine Segmente (5 min, 1 s je Segment, ≈ 600 Abrufe), kleines Bild
hls slow mpegts 300 1 "${I180[@]}" "${AHI[@]}" -- -map 0:v -map 1:a -c:v libx264 -profile:v main -preset veryfast -crf 38 -g 25 \
  -keyint_min 25 -sc_threshold 0 -bf 2 -threads 1 -flags:v +bitexact "${AAC[@]}" -var_stream_map 'v:0,agroup:aud a:0,agroup:aud,default:yes,language:de'
# T14a: AES-128 verschlüsselt (eigener Wegwerf-Schlüssel, nur Testmaterial) – muss abgelehnt werden
mkdir -p "$OUT/aes"
head -c 16 /dev/urandom > "$OUT/aes/key.bin"
printf 'key.bin\n%s\n' "$PWD/$OUT/aes/key.bin" > "$OUT/aes/keyinfo"
( cd "$OUT/aes" && ffmpeg "${COMMON[@]}" -f lavfi -i "$(V 320x180)" -f lavfi -i "$(A 1000)" -t 12 "${OUTO[@]}" -map 0:v -map 1:a "${X264[@]}" "${AAC[@]}" \
    -f hls -hls_time 4 -hls_playlist_type vod -hls_key_info_file keyinfo -hls_segment_filename 's_%03d.ts' master.m3u8 )
rm -f "$OUT/aes/keyinfo"
# T14b: Live (ohne EXT-X-ENDLIST, ohne VOD-Kennung) – muss abgelehnt werden
mkdir -p "$OUT/live"
cp "$OUT/ts_muxed"/s0_*.ts "$OUT/live/"
grep -v -e '^#EXT-X-ENDLIST' -e '^#EXT-X-PLAYLIST-TYPE' "$OUT/ts_muxed/v0.m3u8" > "$OUT/live/index.m3u8"
SUMS="$(mktemp)"
find "$OUT" -type f | LC_ALL=C sort | while read -r f; do printf '%s  %s\n' "$(shasum -a 256 < "$f" | cut -c1-64)" "${f#$OUT/}"; done > "$SUMS"
mv "$SUMS" "$OUT/SHA256SUMS"
du -sh "$OUT"; find "$OUT" -type f | wc -l
