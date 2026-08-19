import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useActionData, Form } from "@remix-run/react";
import { Page, Layout, Card, TextField, Button, Select, FormLayout, Banner } from "@shopify/polaris";
import { useEffect, useState } from "react";
import shopify from "../shopify.server.js";
import { createBrand } from "../services/brand.server.js";
import { COMMON_TIMEZONES } from "../utils/dateTime.js";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  const formData = await request.formData();

  const name = (formData.get("name") as string).trim();
  const logoUrl = (formData.get("logoUrl") as string).trim() || undefined;
  const timezone = (formData.get("timezone") as string) || "UTC";

  if (!name) return json({ error: "Brand name is required." });

  await createBrand(session.shop, { name, logoUrl, timezone });
  // There is no single-brand route, so the list is where a new brand shows up.
  return redirect("/app/brands");
};

// The values a fresh form starts from. Discarding on the save bar restores these.
const INITIAL_NAME = "";
const INITIAL_LOGO_URL = "";
const INITIAL_TIMEZONE = "UTC";

export default function NewBrand() {
  const actionData = useActionData<typeof action>();
  const [name, setName] = useState(INITIAL_NAME);
  const [logoUrl, setLogoUrl] = useState(INITIAL_LOGO_URL);
  const [timezone, setTimezone] = useState(INITIAL_TIMEZONE);

  // actionData is immutable, so dismissal lives here. Every new action response
  // is a fresh object, which un-dismisses the banner for the next failure.
  const [errorDismissed, setErrorDismissed] = useState(false);
  useEffect(() => setErrorDismissed(false), [actionData]);

  // Fired by the save bar's Discard button (App Bridge resets the form), so the
  // controlled fields have to be put back to their loaded values by hand.
  function handleReset() {
    setName(INITIAL_NAME);
    setLogoUrl(INITIAL_LOGO_URL);
    setTimezone(INITIAL_TIMEZONE);
  }

  return (
    <Page title="New Brand" backAction={{ content: "Brands", url: "/app/brands" }}>
      <Layout>
        <Layout.Section>
          <Card>
            {/* data-save-bar lets App Bridge track dirty state on the real form
                element and render the contextual save bar. */}
            <Form method="post" data-save-bar onReset={handleReset}>
              <FormLayout>
                {actionData?.error && !errorDismissed && (
                  <Banner tone="critical" onDismiss={() => setErrorDismissed(true)}>
                    {actionData.error}
                  </Banner>
                )}
                <TextField
                  label="Brand name"
                  name="name"
                  value={name}
                  onChange={setName}
                  autoComplete="off"
                  placeholder="Acme Co."
                />
                <TextField
                  label="Logo URL (optional)"
                  name="logoUrl"
                  value={logoUrl}
                  onChange={setLogoUrl}
                  autoComplete="off"
                  placeholder="https://..."
                />
                <Select
                  label="Default timezone"
                  name="timezone"
                  options={COMMON_TIMEZONES.map((tz) => ({ label: tz, value: tz }))}
                  value={timezone}
                  onChange={setTimezone}
                />
                <Button variant="primary" submit>Create Brand</Button>
              </FormLayout>
            </Form>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
