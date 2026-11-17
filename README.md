# NEXORA Telegram Mini App — starter

A first implementation scaffold for a Telegram Mini App hosted on Cloudflare Workers with D1.

## Current project settings
- Token ticker: NEX
- NEX Jetton Master supplied by project owner: `EQD90OIarz0MQmRuL_nTCIAzbDPh2DJckk9oiSUdLFjMtrdu`
- Activation amount requested: `0.1 GRAM`
- Level 1 target emission: `320 NEX / day` (13.333333... NEX/hour)
- Mining accrues by elapsed server time, not by keeping a process running 24/7.

## Important configuration still required
The supplied GRAM address must be classified as either:
1. a wallet address that receives native TON, or
2. a GRAM Jetton Master / token contract, in which case a destination wallet and Jetton transfer verification are also required.

Do not activate mining until a server-side chain verifier confirms the exact asset, amount, recipient, sender, and transaction uniqueness. The current `/api/mining/start` intentionally refuses activation until that verifier is implemented.

The NEX contract address is stored here as owner-provided input, not treated as verified. Verify it on a TON explorer before using it for deposits, boosts, or withdrawals.

## Setup
1. Create a GitHub repository and upload this project.
2. Install Node.js LTS locally.
3. Run `npm install`.
4. Create a Cloudflare D1 database: `npm run db:create`.
5. Put the returned database ID in `wrangler.toml`.
6. Apply schema: `npm run db:migrate:local` for local testing, then `npm run db:migrate:remote`.
7. Set secrets:
   - `npx wrangler secret put TELEGRAM_BOT_TOKEN`
   - `npx wrangler secret put TELEGRAM_WEBHOOK_SECRET`
8. Run `npm run dev`, then deploy with `npm run deploy`.
9. Configure your Telegram bot's Mini App URL and webhook URL after deploying.

## Security notes
- Never put bot tokens, seed phrases, or private keys in GitHub.
- Telegram `initData` is validated server-side for API requests.
- Wallet address linking is not wallet ownership proof. Implement TON Connect proof verification before withdrawals.
- Task completion, ad rewards, referral qualification, payments, and withdrawals need server-side verification and abuse controls.
- A displayed NEX balance is an internal ledger balance until a real on-chain distribution mechanism is implemented.
- The UI is a starter layout, not a finished financial product.
