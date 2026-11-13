#!/usr/bin/env bash
# rhwp 편집기(studio/)와 엔진(vendor/)을 새 버전으로 다시 만든다.
#
# 사용법:  scripts/build-studio.sh <rhwp 저장소 경로> [버전]
#   예)   git clone --depth 1 --branch v0.9.0 https://github.com/edwardkim/rhwp ../rhwp
#         scripts/build-studio.sh ../rhwp 0.9.0
#
# 주의: rhwp 저장소의 태그(v0.9.0)와 npm 패키지 버전(0.9.0)을 반드시 맞춘다.
#       서로 다르면 편집 화면에서 페이지가 그려지지 않을 수 있다.
set -euo pipefail

RHWP="$(cd "${1:?rhwp 저장소 경로를 주세요}" && pwd)"
VER="${2:-0.9.0}"
APP="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1) 엔진(@rhwp/core)과 임베드 SDK(@rhwp/editor)를 npm에서 받는다.
(cd "$TMP" && npm init -y >/dev/null && npm install --silent "@rhwp/core@$VER" "@rhwp/editor@$VER")
CORE="$TMP/node_modules/@rhwp/core"
EDITOR="$TMP/node_modules/@rhwp/editor"

# 2) 편집기를 그 엔진으로 빌드한다(AI 도우미·외부 웹폰트 제외).
mkdir -p "$RHWP/pkg"
cp "$CORE"/rhwp.js "$CORE"/rhwp.d.ts "$CORE"/rhwp_bg.wasm "$CORE"/rhwp_bg.wasm.d.ts "$RHWP/pkg/"
(cd "$RHWP/rhwp-studio" && npm ci --silent \
  && RHWP_WITHOUT_AI=1 RHWP_WITHOUT_HWPCTRL=1 RHWP_DISABLE_EXTERNAL_WEBFONTS=1 npx vite build --base=./)

# 3) 결과물을 앱으로 옮긴다. 오프라인 보관은 집필실의 sw.js가 맡으므로 편집기 자체 PWA 파일은 뺀다.
rm -rf "$APP/studio" "$APP/vendor/rhwp-core" "$APP/vendor/rhwp-editor"
cp -r "$RHWP/rhwp-studio/dist" "$APP/studio"
(cd "$APP/studio" && rm -rf samples sw.js workbox-*.js registerSW.js manifest.webmanifest rhwp.js rhwp.d.ts rhwp_bg.wasm.d.ts)
sed -i -e 's#<link rel="manifest" href="./manifest.webmanifest">##' \
       -e 's#<script id="vite-plugin-pwa:register-sw" src="./registerSW.js"></script>##' "$APP/studio/index.html"

mkdir -p "$APP/vendor/rhwp-core" "$APP/vendor/rhwp-editor"
cp "$CORE"/rhwp.js "$CORE"/LICENSE "$APP/vendor/rhwp-core/"
cp -r "$CORE/notices" "$APP/vendor/rhwp-core/"
cp "$EDITOR"/index.js "$EDITOR"/transport.js "$EDITOR"/document-agent-contract.js "$EDITOR"/LICENSE "$APP/vendor/rhwp-editor/"
cp "$RHWP/LICENSE" "$APP/studio/LICENSE"
cp "$RHWP/THIRD_PARTY_LICENSES.md" "$APP/studio/THIRD_PARTY_LICENSES.md"

# 4) 엔진 파일 이름(해시 포함)을 설정에 반영한다. 집필 화면과 편집기가 같은 파일을 함께 쓴다.
WASM="$(basename "$(ls "$APP"/studio/assets/rhwp_bg-*.wasm)")"
sed -i -E "s#studio/assets/rhwp_bg-[^']+\.wasm#studio/assets/$WASM#" "$APP/js/config.js"
echo "완료: rhwp $VER / $WASM"
