# GHL Open Letter Mailer

Cloudflare Worker that receives GoHighLevel contact webhooks and creates Open Letter Connect orders, with Slack failure notifications.

## Template Routing

- Flow Mailing Template: OLC template `10518`.
- 1st Time Mailing Template: OLC template `11479` (Latest).

## Custom Fields

| GoHighLevel field | OLC placeholder |
| --- | --- |
| Owner of Record Full Name | `{{CF.OWNER_OF_RECORD}}` |
| Case/Suit # | `{{CF.CASE_NUMBER}}` |
| AM Phone Number | `{{CF.AM_PHONE_NUMBER}}` |
| County | `{{CF.COUNTY}}` |

Mailing fields populate the recipient address. Property fields, including `address1`, populate the property address. Assigned Owner supplies the sender name.

## Setup

Use a current Node.js runtime with npm installed:

```sh
npm install
npm test
npx wrangler login
npx wrangler secret put OLC_API_KEY
npx wrangler secret put SLACK_WEBHOOK_URL
npx wrangler secret put GHL_API_TOKEN
npm run deploy
```

Set `GHL_LOCATION_ID` in `wrangler.toml` for the intended subaccount. Never commit API tokens or Slack webhook URLs. For local development, keep secrets in an ignored `.dev.vars` file.

Configure the GHL workflow to POST JSON to the deployed Worker URL. GET requests return a health response without creating an order. A valid POST can create a paid mail order; use deliberate test contacts and inspect the order before mailing.

## Verification And Limitations

The unit tests cover routing and field transformations, not live GHL retrieval, OLC rendering, or delivery. Deploying this repository does not itself verify those external services. ID-only GHL custom fields are not resolved to field names by this implementation; supply named fields in the webhook. The Worker has no webhook authentication or duplicate-order protection, so protect access before broader production use.

`setup-direct-mail-workflow.md` and `ghl-open-letter-direct-mail.workflow.json` are historical setup materials, including an older n8n draft. They do not describe all current Worker behavior. The current implementation is `src/worker.js`.
