import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildContact,
  buildReturnAddress,
  getAssignedOwner,
  getContactId,
  isFirstTimeTemplate,
  isFlowTemplate,
  normalizeGhlContact,
  olcTemplateCustomFields,
  selectTemplate,
  upsertTemplateFields,
} from "../src/worker.js";

const ghlPayload = {
  "Flow Property Group Template": ["Flow Mailing Template"],
  "Mailing Address": "123 main st",
  "Mailing City": "houston",
  "Mailing State": "TX",
  "Mailing Zip": 77023,
  address1: "456 property rd",
  "City": "Dallas",
  "State": "TX",
  "Postal code": 75201,
  "Owner of Record Full Name": "Genesis Owner",
  "Case/Suit #": "482515",
  "AM Phone Number": "512-998-0956",
  "County": "Harris",
  contact_id: "10Rmlj1WunMFog5KT9mq",
  first_name: "Max",
  last_name: "Verstappen (TEST)",
  full_name: "Max Verstappen (TEST)",
  phone: "+18049161006",
};

describe("GHL to Open Letter mapping", () => {
  it("uses Flow Mailing Template when that GHL value is selected", () => {
    assert.deepEqual(selectTemplate({
      "Flow Property Group Template": ["Flow Mailing Template"],
    }), {
      shouldSend: true,
      templateId: "10518",
    });
  });

  it("uses Flow Mailing Template for legacy Flow trigger values", () => {
    assert.equal(selectTemplate({
      "Flow Property Group Template": ["Flow Property Group Template"],
    }).templateId, "10518");

    assert.equal(selectTemplate({
      "Flow Property Group Template": ["Send a Mailer"],
    }).templateId, "10518");
  });

  it("uses 1st Time Mailing Template when that GHL value is selected", () => {
    assert.deepEqual(selectTemplate({
      "Flow Property Group Template": ["1st Time Mailing Template"],
    }), {
      shouldSend: true,
      templateId: "11479",
    });
  });

  it("uses 1st Time Mailing Template when its own GHL checkbox field is selected", () => {
    assert.deepEqual(selectTemplate({
      customFields: [
        { name: "1st Time Mailing Template", value: "Yes" },
      ],
    }), {
      shouldSend: true,
      templateId: "11479",
    });
  });

  it("uses Flow Mailing Template from nested GHL custom fields", () => {
    assert.deepEqual(selectTemplate({
      customData: {
        "Flow Property Group Template": "Flow Mailing Template",
      },
    }), {
      shouldSend: true,
      templateId: "10518",
    });
  });

  it("skips unsupported selections", () => {
    assert.equal(selectTemplate({
      "Flow Property Group Template": ["Something Else"],
    }).shouldSend, false);
  });

  it("detects only the supported template names", () => {
    assert.equal(isFlowTemplate("Flow Mailing Template"), true);
    assert.equal(isFirstTimeTemplate("1st Time Mailing Template"), true);
    assert.equal(isFirstTimeTemplate("First Time Mailing Template"), true);
    assert.equal(isFirstTimeTemplate("First Mailing Template"), true);
  });

  it("normalizes a GHL contact lookup response", () => {
    const contact = normalizeGhlContact({
      id: "abc123",
      firstName: "Lewis",
      lastName: "Hamilton",
      name: "Lewis Hamilton",
      email: "lewis@example.com",
      phone: "+15555550123",
      address1: "100 Main St",
      city: "Austin",
      state: "TX",
      postalCode: "78748",
      locationId: "D2KGPfSizh2vKCFYc9AV",
      customFields: [
        { name: "Owner of Record Full Name", value: "Toto Wolff" },
      ],
    });

    assert.equal(contact.contact_id, "abc123");
    assert.equal(contact.first_name, "Lewis");
    assert.equal(contact.last_name, "Hamilton");
    assert.equal(contact.full_name, "Lewis Hamilton");
    assert.equal(contact.postalCode, "78748");
    assert.deepEqual(contact.customFields, [
      { name: "Owner of Record Full Name", value: "Toto Wolff" },
    ]);
  });

  it("detects contact id from common webhook fields", () => {
    assert.equal(getContactId({ contact_id: "one" }), "one");
    assert.equal(getContactId({ contactId: "two" }), "two");
    assert.equal(getContactId({ "Contact ID": "three" }), "three");
  });

  it("maps GHL fields into an Open Letter contact", () => {
    const contact = buildContact(ghlPayload);

    assert.deepEqual(contact.missing, []);
    assert.equal(contact.value.firstName, "Max");
    assert.equal(contact.value.lastName, "Verstappen (TEST)");
    assert.equal(contact.value.address1, "123 main st");
    assert.equal(contact.value.city, "houston");
    assert.equal(contact.value.state, "TX");
    assert.equal(contact.value.zip, "77023");
    assert.equal(contact.value.ADDRESS_1, "123 main st");
    assert.equal(contact.value.CITY, "houston");
    assert.equal(contact.value.STATE, "TX");
    assert.equal(contact.value.ZIP_CODE, "77023");
    assert.equal(contact.value.propertyAddress, "456 property rd");
    assert.equal(contact.value.propertyCity, "Dallas");
    assert.equal(contact.value.propertyState, "TX");
    assert.equal(contact.value.propertyZip, "75201");
    assert.equal(contact.value.PROPERTY_ADDRESS, "456 property rd");
    assert.equal(contact.value.PROPERTY_CITY, "Dallas");
    assert.equal(contact.value.PROPERTY_STATE, "TX");
    assert.equal(contact.value.PROPERTY_ZIP_CODE, "75201");
    assert.equal(contact.value.OWNER_OF_RECORD, "Genesis Owner");
    assert.equal(contact.value.CASE_NUMBER, "482515");
    assert.equal(contact.value.AM_PHONE_NUMBER, "512-998-0956");
    assert.equal(contact.value.COUNTY, "Harris");
    assert.equal(contact.value.custom_field_1, "Genesis Owner");
    assert.equal(contact.value.custom_field_2, "482515");
    assert.equal(contact.value.custom_field_3, "512-998-0956");
    assert.equal(contact.value.custom_field_4, "Harris");
    assert.equal(contact.value.Owner_Of_Record, "Genesis Owner");
    assert.equal(contact.value.Case_Number, "482515");
    assert.equal(contact.value.AM_Phone_Number, "512-998-0956");
    assert.equal(contact.value.County, "Harris");
    assert.equal(contact.value["Owner of Record"], "Genesis Owner");
    assert.equal(contact.value["Case Number"], "482515");
    assert.equal(contact.value["AM Phone Number"], "512-998-0956");
    assert.equal(contact.value["{{CF.OWNER_OF_RECORD}}"], "Genesis Owner");
    assert.equal(contact.value["{{CF.CASE_NUMBER}}"], "482515");
    assert.equal(contact.value["{{CF.AM_PHONE_NUMBER}}"], "512-998-0956");
    assert.equal(contact.value["{{CF.COUNTY}}"], "Harris");
  });

  it("normalizes OLC template custom field registrations with field ids", () => {
    const fields = upsertTemplateFields([
      { key: "{{C.FIRST_NAME}}", value: "First Name" },
      { key: "{{CF.COUNTY}}", value: "County", strict: false, defaultValue: "" },
      { key: "{{CF.CASE_NUMBER}}", value: "Case Number", strict: false, defaultValue: "" },
    ], olcTemplateCustomFields());

    assert.deepEqual(fields, [
      { key: "{{C.FIRST_NAME}}", value: "First Name" },
      {
        id: "1549",
        key: "{{CF.COUNTY}}",
        value: "County",
        strict: false,
        defaultValue: "",
      },
      {
        id: "1487",
        key: "{{CF.CASE_NUMBER}}",
        value: "Case Number",
        strict: false,
        defaultValue: "",
      },
      {
        id: "1486",
        key: "{{CF.OWNER_OF_RECORD}}",
        value: "Owner of Record",
        strict: false,
        defaultValue: "",
      },
      {
        id: "1488",
        key: "{{CF.AM_PHONE_NUMBER}}",
        value: "AM Phone Number",
        strict: false,
        defaultValue: "",
      },
    ]);
  });

  it("requires only the fields needed to place a mailer", () => {
    const contact = buildContact({
      first_name: "Lewis",
      last_name: "Hamilton",
    });

    assert.deepEqual(contact.missing, ["address1", "city", "state", "zip", "propertyAddress"]);
  });

  it("maps assigned owner into sender first and last name", () => {
    const payload = {
      ...ghlPayload,
      "Assigned Owner": "Dwight Kim",
    };

    const owner = getAssignedOwner(payload);
    const returnAddress = buildReturnAddress(payload);

    assert.deepEqual(owner, { firstName: "Dwight", lastName: "Kim" });
    assert.equal(returnAddress.firstName, "Dwight");
    assert.equal(returnAddress.lastName, "Kim");
    assert.equal(returnAddress.companyName, "Flow Property Group");
  });
});
