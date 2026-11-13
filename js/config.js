// 엔진·편집기 위치. (?chrome=embed: 파일 열기·저장은 집필실이 맡는 임베드 모드)
// studio/ 폴더를 다시 빌드하면(scripts/build-studio.sh) 이 파일이 자동으로 갱신된다.
export const WASM_URL = new URL('../studio/assets/rhwp_bg-B5Jf95sq.wasm', import.meta.url).href;
export const STUDIO_URL = new URL('../studio/index.html?chrome=embed', import.meta.url).href;
