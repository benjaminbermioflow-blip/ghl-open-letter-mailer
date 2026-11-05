# GHL to Open Letter Connect Direct Mail Workflow

## Cloudflare Worker Setup

The recommended production path is the Cloudflare Worker in this folder. It receives the GoHighLevel webhook, confirms `Send a Mailer` includes `Send a Mailer`, maps the mailing fields, fetches the Open Letter Connect template titled `Flow Mailing Template`, and creates an Open Letter Connect order using your default return address.

### 1. Deploy the Worker

In Cloudflare Workers, create a Worker named `ghl-open-letter-mailer` and paste the contents of `src/worker.js`, or deploy from this folder with Wrangler:

```powershell
npm install
npx wrangler login
npx wrangler deploy
```

### 2. Add Worker Secrets

Add these as Cloudflare Worker secrets, not plain text variables:

- `OLC_API_KEY`
- `SLACK_WEBHOOK_URL`

If using Wrangler:

```powershell
npx wrangler secret put OLC_API_KEY
npx wrangler secret put SLACK_WEBHOOK_URL
```

### 3. Configure GoHighLevel

Replace the current Webhook.site test URL in the GoHighLevel workflow with the deployed Worker URL.

Add this plain Worker variable in Cloudflare:

- `OLC_TEMPLATE_TITLE` = `Flow Mailing Template`

The tested GHL payload sends the trigger as:

```json
"Send a Mailer": ["Send a Mailer"]
```

The Worker expects the mailing fields:

```json
"Mailing Address": "123 main st",
"Mailing City": "houston",
"Mailing State": "TX",
"Mailing Zip": 77023
```

For the Open Letter Connect placeholder `{{C.OWNER_OF_RECORD}}`, the Worker sends the GoHighLevel `Owner of Record` custom field as:

```json
"OWNER_OF_RECORD": "Genesis2"
```

It falls back to `Owner of Record Full Name` if `Owner of Record` is not present.

It also supports fallback field names `Street Address`, `City Address`, `State Address`, and `Zip Address`.

### 4. Failure Alerts

If the trigger is selected but required mailing fields are missing, or if Open Letter Connect returns an error, the Worker posts a failure alert to Slack. The Worker returns HTTP 200 for handled failures so GoHighLevel does not accidentally retry and create duplicate mail attempts.

## Legacy n8n Draft

This workflow starts in Go High Level when the contact custom field `send a mailer` is selected, sends the contact and address data to n8n, then creates an Open Letter Connect order using an existing template.

## 1. Import the n8n Workflow

Import `ghl-open-letter-direct-mail.workflow.json` into n8n.

Create an n8n HTTP Header Auth credential named `Open Letter Connect Bearer Token`:

- Header name: `Authorization`
- Header value: `Bearer YOUR_OPEN_LETTER_CONNECT_TOKEN`

Then open the `Create Open Letter Order` node and select that credential.

## 2. Add n8n Variables

Add these n8n variables before testing:

- `OLC_PRODUCT_ID`
- `OLC_TEMPLATE_ID`
- `RETURN_FIRST_NAME`
- `RETURN_LAST_NAME`
- `RETURN_COMPANY_NAME`
- `RETURN_ADDRESS_1`
- `RETURN_ADDRESS_2`
- `RETURN_CITY`
- `RETURN_STATE`
- `RETURN_ZIP`
- `RETURN_PHONE`
- `RETURN_EMAIL`

Use Open Letter Connect `GET /api/v1/templates` to find the existing template ID, and `GET /api/v1/products` to find the matching direct mail product ID.

## 3. Configure Go High Level

In Go High Level, create a contact workflow:

1. Trigger: `Contact Changed`
2. Filter: custom field `send a mailer` equals the selected/send value you use in your account.
3. Action: `Custom Webhook`
4. Method: `POST`
5. URL: your n8n production webhook URL for `/webhook/ghl-send-mailer`
6. Content-Type: `application/json`

Use this JSON body and fill each value with the matching HighLevel dynamic field picker:

```json
{
  "contactId": "{{ contact.id }}",
  "sendMailer": "{{ send a mailer custom field value }}",
  "firstName": "{{ contact.first_name }}",
  "lastName": "{{ contact.last_name }}",
  "companyName": "{{ contact.company_name }}",
  "email": "{{ contact.email }}",
  "phone": "{{ contact.phone }}",
  "address1": "{{ contact.address1 }}",
  "address2": "{{ contact.address2 }}",
  "city": "{{ contact.city }}",
  "state": "{{ contact.state }}",
  "zip": "{{ contact.postal_code }}",
  "propertyAddress": "{{ property address custom field }}",
  "propertyCity": "{{ property city custom field }}",
  "propertyState": "{{ property state custom field }}",
  "propertyZip": "{{ property zip custom field }}",
  "campaignPhone": "{{ location.phone }}"
}
```

HighLevel merge-field names vary by account and custom field, so choose them from the dynamic field picker instead of typing the custom-field placeholders manually.

## 4. Test

Run the n8n workflow in test mode, copy the test webhook URL into the HighLevel Custom Webhook action, and update a test contact so `send a mailer` is selected.

Check that:

- n8n receives the payload.
- The `Ready to Send?` node routes to `true`.
- Open Letter Connect returns `Order Created Successfully`.
- The Open Letter order uses the expected `templateId` and `productId`.

After testing, replace the HighLevel webhook URL with the n8n production webhook URL and activate the n8n workflow.
