// DIAGNOSTIC ONLY — does NOT send funds. Verifies signature locally + via node simulate.
import fetch from 'node-fetch';
import { createHash } from 'crypto';

const TREASURY = 'terra1549z8zd9hkggzlwf0rcuszhc9rs9fxqfy2kagt';
const LCD_URL  = 'https://terra-classic-lcd.publicnode.com';
const CHAIN_ID = 'columbus-5';

function encodeVarint(n){n=Number(n);const b=[];while(n>127){b.push((n&0x7f)|0x80);n=Math.floor(n/128);}b.push(n&0x7f);return Buffer.from(b);}
function encodeField(f,w,d){const t=encodeVarint((f<<3)|w);if(w===2)return Buffer.concat([t,encodeVarint(d.length),d]);return t;}

async function main(){
  const mnemonic = process.env.TREASURY_MNEMONIC;
  if(!mnemonic){console.error('No TREASURY_MNEMONIC');process.exit(1);}

  const { mnemonicToSeedSync } = await import('bip39');
  const { BIP32Factory } = await import('bip32');
  const eccMod = await import('tiny-secp256k1');
  const secp256k1 = eccMod.default || eccMod;
  console.log('tiny-secp256k1 keys:', Object.keys(secp256k1).slice(0,6).join(','));
  console.log('has .sign:', typeof secp256k1.sign);

  const bip32 = BIP32Factory(secp256k1);
  const child = bip32.fromSeed(mnemonicToSeedSync(mnemonic)).derivePath("m/44'/330'/0'/0/0");
  const privateKey = child.privateKey, publicKey = child.publicKey;
  console.log('pubkey length:', publicKey.length, '(expect 33 compressed)');
  console.log('privkey length:', privateKey.length, '(expect 32)');

  // account info
  const acc = (await (await fetch(`${LCD_URL}/cosmos/auth/v1beta1/accounts/${TREASURY}`)).json());
  console.log('\n=== ACCOUNT JSON STRUCTURE ===');
  console.log(JSON.stringify(acc, null, 2).slice(0, 800));

  const a = acc?.account || {};
  const accountNumber = parseInt(a.account_number ?? a.base_account?.account_number ?? '0');
  const sequence = parseInt(a.sequence ?? a.base_account?.sequence ?? '0');
  console.log('\nParsed accountNumber:', accountNumber, '| sequence:', sequence);

  // sign a tiny test tx (1 uluna to self) — DO NOT broadcast, only simulate
  const enc = s => Buffer.from(s);
  const amountUluna = 1;
  const coinP=Buffer.concat([encodeField(1,2,enc('uluna')),encodeField(2,2,enc(String(amountUluna)))]);
  const msgSP=Buffer.concat([encodeField(1,2,enc(TREASURY)),encodeField(2,2,enc(TREASURY)),encodeField(3,2,coinP)]);
  const anyMsg=Buffer.concat([encodeField(1,2,enc('/cosmos.bank.v1beta1.MsgSend')),encodeField(2,2,msgSP)]);
  const txBodyP=Buffer.concat([encodeField(1,2,anyMsg),encodeField(2,2,enc(''))]);
  const pubkeyAny=Buffer.concat([encodeField(1,2,enc('/cosmos.crypto.secp256k1.PubKey')),encodeField(2,2,encodeField(1,2,publicKey))]);
  const modeInfoP=encodeField(1,2,Buffer.concat([encodeVarint((1<<3)|0),encodeVarint(1)]));
  const signerP=Buffer.concat([encodeField(1,2,pubkeyAny),encodeField(2,2,modeInfoP),encodeVarint((3<<3)|0),encodeVarint(sequence)]);
  const feeCoinP=Buffer.concat([encodeField(1,2,enc('uluna')),encodeField(2,2,enc('8500000'))]);
  const feeP=Buffer.concat([encodeField(1,2,feeCoinP),encodeVarint((2<<3)|0),encodeVarint(300000)]);
  const authInfoP=Buffer.concat([encodeField(1,2,signerP),encodeField(2,2,feeP)]);
  const signDocP=Buffer.concat([encodeField(1,2,txBodyP),encodeField(2,2,authInfoP),encodeField(3,2,enc(CHAIN_ID)),encodeVarint((4<<3)|0),encodeVarint(accountNumber),encodeVarint((5<<3)|0),encodeVarint(sequence)]);

  const msgHash = createHash('sha256').update(signDocP).digest();
  const sig = Buffer.from(secp256k1.sign(msgHash, privateKey));
  console.log('\n=== SIGNATURE ===');
  console.log('signature length:', sig.length, '(MUST be 64)');

  // verify locally
  const verifies = secp256k1.verify(msgHash, publicKey, sig);
  console.log('local verify:', verifies);

  const txRawP=Buffer.concat([encodeField(1,2,txBodyP),encodeField(2,2,authInfoP),encodeField(3,2,sig)]);

  // simulate (does NOT cost funds)
  const sim = await (await fetch(`${LCD_URL}/cosmos/tx/v1beta1/simulate`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({tx_bytes:txRawP.toString('base64')}),
  })).json();
  console.log('\n=== SIMULATE RESULT ===');
  console.log(JSON.stringify(sim,null,2).slice(0,600));
}
main().catch(e=>{console.error('Fatal:',e.message);process.exit(1);});
