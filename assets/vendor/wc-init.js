// Инициализация WalletConnect. Раньше SignClient импортировался прямо с
// esm.sh: сторонний домен получал те же права, что и наш собственный код, а
// SRI для ESM-импорта не работает - подпись файла проверить нечем.
//
// Теперь бандл лежит рядом. Собран локально:
//   npm i @walletconnect/sign-client@2.17.4 esbuild
//   esbuild entry.js --bundle --format=esm --platform=browser --target=es2020 \
//     --minify --define:global=globalThis --outfile=wc-sign-client.js
//
// Событие wc-ready сохранено: код, который его ждёт, менять не нужно.
import SignClient from './wc-sign-client.js';
window._WCSignClient = SignClient;
window.dispatchEvent(new Event('wc-ready'));
