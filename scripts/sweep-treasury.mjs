// One-off: показывает адреса секретов и переводит LUNC со старых кошельков на новые.
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { stringToPath } from '@cosmjs/crypto';
import { StargateClient, SigningStargateClient, GasPrice } from '@cosmjs/stargate';

const RPC = 'https://terra-classic-rpc.publicnode.com:443';
const WALLETS = {
  TREASURY: { old: 'terra1549z8zd9hkggzlwf0rcuszhc9rs9fxqfy2kagt', to: 'terra1cjpwx84jj2u822wmzuylfzsf99rr3gdn2sqesw' },
  RESERVE:  { old: 'terra10q6syec2e27x8g76a0mvm3frgvarl5dz27a2jz', to: 'terra1e0m2ajgn5m8tq9dehu5w5zlvaklagdpcaeuw3a' },
  REWARDS:  { old: 'terra1ty6fxd9u0jzae5lpzcs56rfclxg4q32hw5x4ce', to: 'terra10gf6zq5f0nrpcx0k2zlsrv79ec28p320fezq9q' },
  KEEPER:   { old: null, to: null },
};
const PICK = process.env.WALLET || 'list';
const DRY  = process.env.DRY_RUN !== 'false';

async function open(name) {
  const m = process.env[name + '_MNEMONIC'];
  if (!m) return null;
  const w = await DirectSecp256k1HdWallet.fromMnemonic(m, { prefix: 'terra', hdPaths: [stringToPath("m/44'/330'/0'/0/0")] });
  const [{ address }] = await w.getAccounts();
  return { w, address };
}

const q = await StargateClient.connect(RPC);
for (const name of Object.keys(WALLETS)) {
  const k = await open(name);
  if (!k) { console.log(name, 'secret not set'); continue; }
  const bal = BigInt((await q.getBalance(k.address, 'uluna')).amount);
  console.log(name, k.address, Number(bal) / 1e6, 'LUNC');
}
if (PICK === 'list') process.exit(0);

const cfg = WALLETS[PICK];
if (!cfg || !cfg.to) throw new Error('unknown wallet ' + PICK);
const k = await open(PICK);
if (!k || k.address !== cfg.old) throw new Error('signer mismatch for ' + PICK);
const client = await SigningStargateClient.connectWithSigner(RPC, k.w, { gasPrice: GasPrice.fromString('28.325uluna') });
const bal = BigInt((await client.getBalance(cfg.old, 'uluna')).amount);
const amount = bal - 30_000_000n;
console.log('sweep', PICK, Number(amount) / 1e6, 'LUNC ->', cfg.to);
if (DRY || amount <= 0n) { console.log('dry run - nothing sent'); process.exit(0); }
const r = await client.sendTokens(cfg.old, cfg.to, [{ denom: 'uluna', amount: amount.toString() }], 1.6);
console.log('send tx', r.transactionHash);
