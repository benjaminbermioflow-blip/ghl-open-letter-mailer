const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

const FLOW_TEMPLATE_ID = "10518";
const FIRST_TIME_TEMPLATE_ID = "11479";
const DEFAULT_GHL_LOCATION_ID = "D2KGPfSizh2vKCFYc9AV";
const OLC_CUSTOM_FIELDS = {
  ownerOfRecord: { id: "1486", key: "CF.OWNER_OF_RECORD", name: "Owner of Record" },
  caseNumber: { id: "1487", key: "CF.CASE_NUMBER", name: "Case Number" },
  amPhoneNumber: { id: "1488", key: "CF.AM_PHONE_NUMBER", name: "AM Phone Number" },
  county: { id: "1549", key: "CF.COUNTY", name: "County" },
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      return jsonResponse({ ok: true, service: "ghl-open-letter-mailer" });
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
    }

    let ghlPayload;
    try {
      ghlPayload = await request.json();
    } catch (error) {
      await notifySlack(env, "Invalid JSON received from GoHighLevel", { error: error.message });
      return jsonResponse({ ok: false, error: "Invalid JSON" }, 200);
    }

    try {
      const enrichedPayload = await enrichGhlPayload(env, ghlPayload);
      const template = selectTemplate(enrichedPayload);
      if (!template.shouldSend) {
        await notifySlack(env, "GHL mailer skipped: unsupported template selection", {
          contactId: getContactId(enrichedPayload),
          fullName: enrichedPayload.full_name || enrichedPayload.fullName || "",
          selectedTemplateValues: selectedTemplateValues(enrichedPayload),
        });

        return jsonResponse({ ok: true, skipped: true, reason: template.reason });
      }

      const contact = buildContact(enrichedPayload);
      if (contact.missing.length > 0) {
        await notifySlack(env, "GHL mailer skipped: missing required fields", {
          contactId: getContactId(enrichedPayload),
          fullName: enrichedPayload.full_name || enrichedPayload.fullName || "",
          templateId: template.templateId,
          missing: contact.missing,
        });

        return jsonResponse({ ok: false, skipped: true, missing: contact.missing }, 200);
      }

      const templateDetail = await getTemplateDetail(env, template.templateId);
      await ensureCustomFields(env, templateDetail);
      const orderPayload = {
        contacts: [contact.value],
        productId: Number(templateDetail.product?.id),
        templateId: Number(template.templateId),
        name: `GHL mailer - ${contact.value.firstName} ${contact.value.lastName}`.trim(),
        returnAddress: buildReturnAddress(enrichedPayload, env),
        crmMode: "zapier",
      };

      if (!orderPayload.productId) {
        throw new Error(`Open Letter Connect template "${template.templateId}" is missing product id`);
      }

      const order = await createOpenLetterOrder(env, orderPayload);
      return jsonResponse({ ok: true, templateId: template.templateId, order });
    } catch (error) {
      await notifySlack(env, "GHL mailer failed", {
        error: error.message,
        contactId: getContactId(ghlPayload),
        fullName: ghlPayload.full_name || ghlPayload.fullName || "",
      });

      return jsonResponse({ ok: false, error: error.message }, 200);
    }
  },
};

function selectTemplate(payload) {
  const selected = selectedTemplateValues(payload);

  if (selected.some(isFirstTimeTemplate)) {
    return {
      shouldSend: true,
      templateId: FIRST_TIME_TEMPLATE_ID,
    };
  }

  if (selected.some(isFlowTemplate)) {
    return {
      shouldSend: true,
      templateId: FLOW_TEMPLATE_ID,
    };
  }

  return {
    shouldSend: false,
    reason: "No supported mailing template was selected in Flow Property Group Template",
  };
}

function selectedTemplateValues(payload) {
  return valuesForNames(payload, [
    "Flow Property Group Template",
    "1st Time Mailing Template",
    "First Time Mailing Template",
    "Send a Mailer",
    "flowPropertyGroupTemplate",
    "flow_property_group_template",
    "firstTimeMailingTemplate",
    "first_time_mailing_template",
  ]);
}

function isFlowTemplate(value) {
  const normalized = normalizeSelection(value);
  return normalized === "flowmailingtemplate" ||
    normalized === "flowpropertygrouptemplate" ||
    normalized === "sendamailer";
}

function isFirstTimeTemplate(value) {
  const normalized = normalizeSelection(value);
  return normalized === "1sttimemailingtemplate" ||
    normalized === "firsttimemailingtemplate" ||
    normalized === "firstmailingtemplate" ||
    normalized === "1stmailingtemplate";
}

function buildContact(payload) {
  const firstName = clean(payload.first_name || payload.firstName);
  const lastName = clean(payload.last_name || payload.lastName);
  const address1 = clean(firstPresent(payload, ["Mailing Address", "mailingAddress"]));
  const address2 = clean(firstPresent(payload, ["Mailing Address 2", "mailingAddress2"]));
  const city = clean(firstPresent(payload, ["Mailing City", "mailingCity"]));
  const state = clean(firstPresent(payload, ["Mailing State", "mailingState"])).toUpperCase();
  const zip = clean(firstPresent(payload, ["Mailing Zip", "Mailing Postal Code", "mailingZip", "mailingPostalCode"]));
  const propertyAddress = clean(firstPresent(payload, [
    "Property Street Address",
    "Property Street address",
    "Property Address",
    "Street address",
    "Street Address",
    "address1",
    "propertyAddress",
    "propertyStreetAddress",
  ]));
  const propertyCity = clean(firstPresent(payload, ["Property City", "City", "propertyCity"])) || city;
  const propertyState = (clean(firstPresent(payload, ["Property State", "State", "propertyState"])) || state).toUpperCase();
  const propertyZip = clean(firstPresent(payload, [
    "Property Zip",
    "Property Zip Code",
    "Property Postal Code",
    "Postal code",
    "Postal Code",
    "propertyZip",
    "propertyZipCode",
    "propertyPostalCode",
  ])) || zip;
  const ownerOfRecord = clean(firstPresent(payload, ["Owner of Record Full Name", "Owner of Record"]));
  const caseNumber = clean(firstPresent(payload, ["Case/Suit #", "Case Suit #", "Case Number", "caseNumber"]));
  const amPhoneNumber = clean(firstPresent(payload, ["AM Phone Number", "AM Phone", "amPhoneNumber"]));
  const county = clean(firstPresent(payload, ["County", "county"]));

  const value = {
    firstName,
    lastName,
    address1,
    address2,
    city,
    state,
    zip,
    ADDRESS_1: address1,
    CITY: city,
    STATE: state,
    ZIP_CODE: zip,
    companyName: clean(payload.company_name || payload.companyName),
    phoneNo: clean(payload.phone),
    email: clean(payload.email),
    propertyAddress,
    propertyCity,
    propertyState,
    propertyZip,
    PROPERTY_ADDRESS: propertyAddress,
    PROPERTY_CITY: propertyCity,
    PROPERTY_STATE: propertyState,
    PROPERTY_ZIP_CODE: propertyZip,
    custom_field_1: ownerOfRecord,
    custom_field_2: caseNumber,
    custom_field_3: amPhoneNumber,
    custom_field_4: county,
    OWNER_OF_RECORD: ownerOfRecord,
    CASE_NUMBER: caseNumber,
    AM_PHONE_NUMBER: amPhoneNumber,
    COUNTY: county,
    Owner_Of_Record: ownerOfRecord,
    Case_Number: caseNumber,
    AM_Phone_Number: amPhoneNumber,
    County: county,
    "Owner of Record": ownerOfRecord,
    "Case Number": caseNumber,
    "AM Phone Number": amPhoneNumber,
    "{{CF.OWNER_OF_RECORD}}": ownerOfRecord,
    "{{CF.CASE_NUMBER}}": caseNumber,
    "{{CF.AM_PHONE_NUMBER}}": amPhoneNumber,
    "{{CF.COUNTY}}": county,
    campaign_phone: clean(payload.user?.phone || payload.location?.phone),
    meta_data: {
      ghl_contact_id: clean(payload.contact_id || payload["Contact ID"]),
      owner_of_record: ownerOfRecord,
      case_number: caseNumber,
      am_phone_number: amPhoneNumber,
      county,
      workflow_id: clean(payload.workflow?.id),
      workflow_name: clean(payload.workflow?.name),
      source: "gohighlevel",
    },
  };

  const required = ["firstName", "lastName", "address1", "city", "state", "zip", "propertyAddress"];
  const missing = required.filter((field) => !value[field]);

  return {
    value,
    missing,
  };
}

function buildReturnAddress(payload, env = {}) {
  const assignedOwner = getAssignedOwner(payload);

  return {
    firstName: assignedOwner.firstName || clean(env.RETURN_FIRST_NAME),
    lastName: assignedOwner.lastName || clean(env.RETURN_LAST_NAME),
    companyName: clean(env.RETURN_COMPANY_NAME) || "Flow Property Group",
    address1: clean(env.RETURN_ADDRESS_1) || "8701 S 1st St",
    address2: clean(env.RETURN_ADDRESS_2) || "Bldg 2 Ste 215",
    city: clean(env.RETURN_CITY) || "Austin",
    state: (clean(env.RETURN_STATE) || "TX").toUpperCase(),
    zip: clean(env.RETURN_ZIP) || "78748",
    phoneNo: clean(payload.user?.phone || env.RETURN_PHONE),
    email: clean(payload.user?.email || env.RETURN_EMAIL),
  };
}

async function enrichGhlPayload(env, payload) {
  const token = clean(env.GHL_API_TOKEN);
  const contactId = getContactId(payload);

  if (!token || !contactId) {
    return payload;
  }

  try {
    const response = await fetch(`${ghlBaseUrl(env)}/contacts/${encodeURIComponent(contactId)}`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        version: "v3",
      },
    });
    const data = await readJsonResponse(response, "GoHighLevel contact lookup failed");
    const contact = data.contact || data.data?.contact || data.data || data;
    const normalized = normalizeGhlContact(contact);

    return {
      ...normalized,
      ...payload,
      ghlContact: contact,
    };
  } catch (error) {
    await notifySlack(env, "GHL contact lookup failed; using webhook payload only", {
      error: error.message,
      contactId,
      locationId: ghlLocationId(env),
    });
    return payload;
  }
}

function normalizeGhlContact(contact) {
  if (!contact || typeof contact !== "object") {
    return {};
  }

  return {
    id: clean(contact.id),
    contact_id: clean(contact.id),
    firstName: clean(contact.firstName || contact.first_name),
    first_name: clean(contact.firstName || contact.first_name),
    lastName: clean(contact.lastName || contact.last_name),
    last_name: clean(contact.lastName || contact.last_name),
    fullName: clean(contact.name || contact.fullName || contact.full_name),
    full_name: clean(contact.name || contact.fullName || contact.full_name),
    email: clean(contact.email),
    phone: clean(contact.phone),
    address1: clean(contact.address1),
    city: clean(contact.city),
    state: clean(contact.state),
    postalCode: clean(contact.postalCode || contact.postal_code),
    locationId: clean(contact.locationId),
    customFields: contact.customFields || contact.customField || contact.customData || [],
    customData: contact.customData || {},
  };
}

function getAssignedOwner(payload) {
  const ownerFirst = clean(firstPresent(payload, [
    "Assigned Owner First Name",
    "Assigned User First Name",
    "assigned_owner_first_name",
    "assignedUserFirstName",
  ]));
  const ownerLast = clean(firstPresent(payload, [
    "Assigned Owner Last Name",
    "Assigned User Last Name",
    "assigned_owner_last_name",
    "assignedUserLastName",
  ]));

  if (ownerFirst || ownerLast) {
    return { firstName: ownerFirst, lastName: ownerLast };
  }

  const ownerFullName = clean(firstPresent(payload, [
    "Assigned Owner",
    "Assigned User",
    "Contact Owner",
    "assigned_owner",
    "assignedUser",
    "assignedTo",
    "contactOwner",
  ]));

  if (ownerFullName) {
    return splitFullName(ownerFullName);
  }

  if (payload.assignedTo && typeof payload.assignedTo === "object") {
    const assignedFirst = clean(payload.assignedTo.firstName || payload.assignedTo.first_name);
    const assignedLast = clean(payload.assignedTo.lastName || payload.assignedTo.last_name);

    if (assignedFirst || assignedLast) {
      return { firstName: assignedFirst, lastName: assignedLast };
    }

    return splitFullName(clean(payload.assignedTo.name || payload.assignedTo.fullName));
  }

  if (payload.user && typeof payload.user === "object") {
    return {
      firstName: clean(payload.user.firstName || payload.user.first_name),
      lastName: clean(payload.user.lastName || payload.user.last_name),
    };
  }

  return { firstName: "", lastName: "" };
}

function splitFullName(fullName) {
  const parts = clean(fullName).split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
}

async function getTemplateDetail(env, templateId) {
  const response = await fetch(`${baseUrl(env)}/templates/${templateId}`, {
    headers: authHeaders(env),
  });
  const data = await readJsonResponse(response, "Open Letter Connect template detail request failed");
  return data?.data || data;
}

async function ensureCustomFields(env, template) {
  const fields = Array.isArray(template.fields) ? [...template.fields] : [];
  const requiredFields = olcTemplateCustomFields();
  const normalizedFields = upsertTemplateFields(fields, requiredFields);

  if (JSON.stringify(fields) === JSON.stringify(normalizedFields)) {
    return;
  }

  const templatePath = pathFromDownloadUrl(template.templateUrl);
  const thumbnailPath = pathFromDownloadUrl(template.thumbnailUrl);

  if (!templatePath || !thumbnailPath) {
    throw new Error("Unable to resolve Open Letter Connect template paths for custom field registration");
  }

  const response = await fetch(`${baseUrl(env)}/templates/${template.id}`, {
    method: "PATCH",
    headers: {
      ...authHeaders(env),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      title: template.title,
      productId: Number(template.product?.id),
      templatePath,
      thumbnailPath,
      fields: normalizedFields,
    }),
  });

  await readJsonResponse(response, "Open Letter Connect template custom field registration failed");
}

function olcTemplateCustomFields() {
  return [
    OLC_CUSTOM_FIELDS.ownerOfRecord,
    OLC_CUSTOM_FIELDS.caseNumber,
    OLC_CUSTOM_FIELDS.amPhoneNumber,
    OLC_CUSTOM_FIELDS.county,
  ].map((field) => ({
    id: field.id,
    key: `{{${field.key}}}`,
    value: field.name,
    strict: false,
    defaultValue: "",
  }));
}

function upsertTemplateFields(fields, requiredFields) {
  const requiredByKey = new Map(requiredFields.map((field) => [field.key, field]));
  const seen = new Set();
  const normalized = fields.map((field) => {
    const required = requiredByKey.get(field.key);
    if (!required) {
      return field;
    }

    seen.add(field.key);
    return {
      ...field,
      ...required,
    };
  });

  for (const required of requiredFields) {
    if (!seen.has(required.key)) {
      normalized.push(required);
    }
  }

  return normalized;
}

async function createOpenLetterOrder(env, orderPayload) {
  const response = await fetch(`${baseUrl(env)}/orders`, {
    method: "POST",
    headers: {
      ...authHeaders(env),
      "content-type": "application/json",
    },
    body: JSON.stringify(orderPayload),
  });

  return readJsonResponse(response, "Open Letter Connect order request failed");
}

async function notifySlack(env, title, details) {
  if (!env.SLACK_WEBHOOK_URL) {
    return;
  }

  const text = [
    `*${title}*`,
    "```",
    JSON.stringify(details, null, 2),
    "```",
  ].join("\n");

  await fetch(env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

async function readJsonResponse(response, message) {
  const text = await response.text();
  let data = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    throw new Error(`${message}: HTTP ${response.status} ${JSON.stringify(data)}`);
  }

  return data;
}

function authHeaders(env) {
  if (!env.OLC_API_KEY) {
    throw new Error("Missing OLC_API_KEY secret");
  }

  return {
    accept: "application/json",
    authorization: `Bearer ${env.OLC_API_KEY}`,
  };
}

function baseUrl(env) {
  return (env.OLC_BASE_URL || "https://api.openletterconnect.com/api/v1").replace(/\/$/, "");
}

function ghlBaseUrl(env) {
  return (env.GHL_BASE_URL || "https://services.leadconnectorhq.com").replace(/\/$/, "");
}

function ghlLocationId(env) {
  return clean(env.GHL_LOCATION_ID) || DEFAULT_GHL_LOCATION_ID;
}

function getContactId(payload) {
  return clean(firstPresent(payload, [
    "contact_id",
    "contactId",
    "Contact ID",
    "id",
  ]));
}

function pathFromDownloadUrl(url) {
  return clean(url).replace(/^https:\/\/api\.openletterconnect\.com\/api\/v1\/download\//, "");
}

function firstPresent(payload, names) {
  for (const name of names) {
    const values = valuesForNames(payload, [name]);
    if (values.length > 0) {
      return values[0];
    }
  }

  return "";
}

function valuesForNames(payload, names) {
  const wanted = new Set(names.map(normalizeFieldName));
  const found = [];

  collectNamedValues(payload, wanted, found, new Set());

  return found.map(clean).filter(Boolean);
}

function collectNamedValues(value, wanted, found, seen) {
  if (!value || typeof value !== "object" || seen.has(value)) {
    return;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectNamedValues(item, wanted, found, seen);
    }
    return;
  }

  for (const [key, raw] of Object.entries(value)) {
    if (wanted.has(normalizeFieldName(key))) {
      found.push(...arrayValues(raw));
      if (isStandaloneSelectedFieldName(key) && isSelectedRawValue(raw)) {
        found.push(key);
      }
    }

    if (raw && typeof raw === "object") {
      collectNamedValues(raw, wanted, found, seen);
    }
  }

  const label = value.name || value.fieldName || value.label || value.title || value.key;
  if (label && wanted.has(normalizeFieldName(label))) {
    found.push(...arrayValues(value.value ?? value.fieldValue ?? value.selectedValue ?? value.values));
    if (isStandaloneSelectedFieldName(label) && isSelectedRawValue(value.value ?? value.fieldValue ?? value.selectedValue ?? value.values)) {
      found.push(label);
    }
  }
}

function isStandaloneSelectedFieldName(name) {
  const normalized = normalizeFieldName(name);
  return normalized === "1sttimemailingtemplate" ||
    normalized === "firsttimemailingtemplate" ||
    normalized === "sendamailer";
}

function isSelectedRawValue(value) {
  if (value === true) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.some(isSelectedRawValue);
  }

  const normalized = normalizeSelection(value);
  return normalized !== "" &&
    normalized !== "false" &&
    normalized !== "no" &&
    normalized !== "off" &&
    normalized !== "unchecked" &&
    normalized !== "none";
}

function arrayValues(raw) {
  if (Array.isArray(raw)) {
    return raw;
  }

  if (raw === undefined || raw === null) {
    return [];
  }

  return [raw];
}

function normalizeSelection(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeFieldName(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function clean(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

export {
  buildContact,
  buildReturnAddress,
  getAssignedOwner,
  getContactId,
  normalizeGhlContact,
  isFirstTimeTemplate,
  isFlowTemplate,
  olcTemplateCustomFields,
  selectTemplate,
  upsertTemplateFields,
};
